"""Gold layer: rebuilds the silver message table as a star schema for the chat agent.

Run: python code/gold.py   (after code/silver.py)
Downloads silver/message.parquet from the bucket and writes gold/<table>.parquet and gold/manifest.json.

A star schema is a central table of events (a fact table) whose code and ID columns are looked up in small
descriptive tables (dimension tables). Here:

  fact_message     one row per message of every type: the silver table, plus the columns below
  fact_order       one row per order (JSE order_id), summarising its execution reports and requests
  fact_compid_day  one row per CompID per day, counting each kind of message
  dim_compid, dim_date, dim_security, dim_message_type, dim_code, dim_reject_code   descriptions of the codes

Columns added to the silver table in fact_message:
- is_rejection: true when the message rejects something the client sent. Every Reject (3) and Order Cancel Reject
  (9); an execution report with execution_type or order_status 8; a mass cancel report with status 0; a Logon
  Response with a reject_code other than 0 (logged in) and 3 (logged in, but the new password does not meet the
  password policy). Other messages, including Logon Responses with code 0 or 3, are false.
- <code column>_name beside each code column: the code's meaning from dim_code (side_name "Buy" beside side "1"),
  and message_type_name and ref_message_type_name from dim_message_type. "Code not in the JSE list" when a code
  has no meaning there. Reject code meanings stay in dim_reject_code, because they are long texts and about
  0.86 million messages carry a reject code.
- report_event: what happened to the order in an execution report. execution_type gives it when filled (August and
  September). July reports have only order_status, so it is worked out: a trade when executed_quantity is above 0;
  for order_status 0 (New), "New (accepted)" on the order's first report and "Amended" on a later one (in
  September, where both columns are filled, execution_type 0 is always the order's first report and 5, Amended,
  never is); "Amended or Restated" for order_status 1 without a trade; Cancelled, Expired, Rejected or Suspended
  for order_status 4, 6, 8 and 9.
"""

import json
import tempfile
from pathlib import Path

import duckdb

from storage import CODE_DIR, delete, download, list_files, save_scripts, upload

KNOWLEDGE_DIR = CODE_DIR.parent / "web" / "knowledge"

MESSAGE_TYPES = [
    ("A", "Logon", "client", "logon"),
    ("B", "Logon Response", "JSE", "logon_response"),
    ("5", "Logout", "client or JSE", "logout"),
    ("D", "New Order", "client", "new_order_single"),
    ("F", "Order Cancel Request", "client", "order_cancel_request"),
    ("G", "Order Cancel/Replace Request (amend)", "client", "order_cancel_replace_request"),
    ("q", "Order Mass Cancel Request", "client", "order_mass_cancel_request"),
    ("8", "Execution Report", "JSE", "execution_report"),
    ("9", "Order Cancel Reject", "JSE", "order_cancel_reject"),
    ("r", "Order Mass Cancel Report", "JSE", "order_mass_cancel_report"),
    ("3", "Reject (message failed gateway validation)", "JSE", "reject"),
]

# Meanings of code values, from web/knowledge/field_codes.md (JSE Volume 01E, Native Trading Gateway).
CODES = {
    "side": {"1": "Buy", "2": "Sell"},
    "order_type": {"1": "Market", "2": "Limit", "3": "Stop", "4": "Stop Limit", "50": "Pegged", "51": "Pegged Limit"},
    "time_in_force": {"0": "DAY (expires at market end)", "1": "GTC Good Till Cancel", "3": "IOC Immediate or Cancel",
                      "4": "FOK Fill or Kill", "5": "OPG At the Open (opening auction only)", "6": "GTD Good Till Date",
                      "8": "GTT Good Till Time", "9": "GFA Good for Auction (next auction only)",
                      "10": "ATC At the Close (closing auction only)", "12": "CPX Closing Price Cross",
                      "50": "GDX Good for EOD Volume Auction Uncross (removed)", "51": "GFX Good for Intraday Auction"},
    "capacity": {"2": "Principal", "3": "Agency"},
    "cancel_on_disconnect": {"0": "Do not cancel", "1": "Cancel"},
    "execution_instruction": {"0": "None", "2": "Include in EOD Volume Auction Uncross (removed)"},
    "order_sub_type": {"0": "Order (normal)", "50": "Pegged to Mid", "51": "Pegged to Bid", "52": "Pegged to Offer"},
    "order_book": {"1": "Regular"},
    "execution_type": {"0": "New (accepted)", "4": "Cancelled", "5": "Amended", "8": "Rejected", "9": "Suspended",
                       "C": "Expired", "F": "Trade", "G": "Trade Correct", "H": "Trade Cancel",
                       "D": "Restated", "L": "Triggered"},
    "order_status": {"0": "New", "1": "Partially Filled", "2": "Filled", "4": "Cancelled", "6": "Expired",
                     "8": "Rejected", "9": "Suspended"},
    "working_indicator": {"0": "Unset", "1": "Order is being worked", "2": "Not currently working (unelected stop)"},
    "liquidity_indicator": {"0": "Unset", "1": "Added liquidity (passive)", "2": "Removed liquidity (aggressive)", "4": "Auction"},
    "type_of_trade": {"0": "Visible passive", "1": "Hidden passive", "2": "Not specified (aggressive)", "3": "Pegged passive"},
    "indicator_flags": {"0": "Passive (both sides 0 in auctions)", "1": "This order was the aggressor"},
    "mass_cancel_request_type": {"3": "All firm orders for an instrument", "4": "All firm orders for a segment",
                                 "7": "All orders for this CompID", "8": "All orders for the firm",
                                 "9": "This CompID's orders for an instrument", "15": "This CompID's orders for a segment"},
    "mass_cancel_status": {"7": "Accepted", "0": "Rejected (reason in reject_code)"},
    "protocol_version": {"0": "System default", "1": "Version 1", "2": "Version 2 (needed for iceberg orders)",
                         "3": "Version 3 (needed for self-match prevention)"},
}

TABLE_DOCS = {
    "fact_message": "One row per distinct message of every type, in capture order. Filter on message_type (see dim_message_type). Start here for any question about what a CompID sent or received. is_rejection marks the messages that reject something; each code column has a _name column beside it with the code's meaning.",
    "fact_order": "One row per order, identified by the JSE order_id: how it was entered, what happened to it and how it ended. Built from execution reports, the linked New Order and the cancel and amend requests that name the order.",
    "fact_compid_day": "One row per CompID per day: number of distinct messages of each kind. Use it to find which days a CompID tested and what it did.",
    "dim_compid": "One row per CompID: first and last message, days active, totals.",
    "dim_date": "One row per calendar day from the first to the last message.",
    "dim_security": "One row per security_id (JSE numeric instrument ID) seen in the messages. Instrument names and segments are not in the exports.",
    "dim_message_type": "The meaning of each message_type code.",
    "dim_code": "The meaning of each code value, per column (side, order_type, time_in_force, execution_type, order_status, ...). Join on column_name and code. fact_message and fact_order already hold these meanings in their _name columns.",
    "dim_reject_code": "The meaning of every reject_code seen in the messages, from JSE Volume 10, and the message types it was seen on.",
}

COLUMN_DOCS = {
    "message_id": "Number of the message in fact_message, unique",
    "timestamp": "Vonnegut capture time, South African time (SAST)",
    "date": "Calendar day of timestamp; joins dim_date.date",
    "comp_id": "CompID of the client connection; joins dim_compid",
    "comp_id_filled": "true when comp_id was empty in the export and was filled from another message of the same order",
    "message_type": "Message type code; joins dim_message_type",
    "message_type_name": "Name of the message type, e.g. New Order",
    "is_rejection": "true when the message rejects something the client sent: every Reject (3) and Order Cancel Reject (9), an execution report with execution_type or order_status 8, a mass cancel report with status 0, a Logon Response with a reject_code other than 0 and 3. Use it to find or count rejections",
    "ref_message_type": "Reject (3) only: type of the client message that was rejected",
    "ref_message_type_name": "Reject (3) only: name of the client message type that was rejected",
    "client_order_id": "ID the client gave the request; the JSE does not check that it is unique",
    "orig_client_order_id": "Cancel and amend requests: client_order_id of the order to cancel or amend",
    "order_id": "JSE ID of the order, constant for the order's whole life; joins fact_order",
    "order_id_linked": "true when order_id was not in the request and was taken from the JSE reply captured within 1 second",
    "execution_id": "Execution report only: JSE ID of the report, unique",
    "public_order_id": "Equal to order_id except for iceberg orders",
    "security_id": "JSE numeric instrument ID; joins dim_security",
    "side": "1 Buy, 2 Sell; meaning in side_name",
    "order_type": "1 Market, 2 Limit, 3 Stop, 4 Stop Limit, ...; meaning in order_type_name",
    "order_sub_type": "Code; meaning in order_sub_type_name",
    "time_in_force": "0 DAY, 3 IOC, 4 FOK, 9 GFA, 10 ATC, ...; meaning in time_in_force_name",
    "order_quantity": "Shares ordered",
    "display_quantity": "Visible quantity (less than order_quantity for iceberg orders)",
    "minimum_quantity": "Minimum execution size; empty when not set",
    "limit_price": "Limit price in ZAC (South African cents); divide by 100 for Rand",
    "stop_price": "Stop price in ZAC; empty when not set",
    "account": "Client account",
    "capacity": "2 Principal, 3 Agency (July only); meaning in capacity_name",
    "cancel_on_disconnect": "Code; meaning in cancel_on_disconnect_name",
    "execution_instruction": "Code; meaning in execution_instruction_name",
    "order_book": "Code; meaning in order_book_name",
    "self_trade_prevention_key": "Key for self-match prevention (protocol version 3)",
    "execution_type": "Execution report: what happened, as a code. Empty in July exports; use report_event, which is filled in every month",
    "order_status": "Execution report: order state after the event, as a code. Empty in August exports; meaning in order_status_name",
    "report_event": "Execution report only: what happened to the order (New (accepted), Amended, Cancelled, Expired, Rejected, Trade, ...). From execution_type when it is filled; in July, where it is empty, worked out from order_status, executed_quantity and whether the report is the order's first",
    "working_indicator": "Code; meaning in working_indicator_name",
    "liquidity_indicator": "Trades only; meaning in liquidity_indicator_name",
    "type_of_trade": "Trades only; meaning in type_of_trade_name",
    "indicator_flags": "Trades only: 1 aggressor, 0 passive; meaning in indicator_flags_name",
    "leaves_quantity": "Quantity still open after the event",
    "executed_quantity": "Shares traded in this report; 0 when no trade",
    "executed_price": "Trade price in ZAC; 0 when no trade",
    "transact_time": "JSE event time in UTC (2 hours behind timestamp)",
    "reject_code": "Reject code (dim_reject_code); empty when the message has none. Also filled on Logon Responses that are not rejections: 0 logged in, 3 logged in but the new password does not meet the password policy. Use is_rejection to find rejections",
    "reject_reason": "Reject (3) only: field or reason named by the gateway",
    "partition_id": "Matching engine partition: 1 Equity, 2 Derivatives",
    "mass_cancel_request_type": "Code; meaning in mass_cancel_request_type_name",
    "mass_cancel_status": "Mass cancel report: 7 Accepted, 0 Rejected; meaning in mass_cancel_status_name",
    "logon_compid": "Logon only: CompID inside the Logon message",
    "protocol_version": "Logon only: code; meaning in protocol_version_name",
    "password_expiry": "Logon Response only: days until the password expires; empty when not applicable",
    "logout_reason": "Logout only: free text reason",
    "copies": "Number of rows in the Vonnegut export that are this one message",
    "source_file": "Excel export the message came from (month folder / file name)",
    "silver_table": "Name of this message type's combined table in bronze/combined/ (the column keeps its earlier name)",
}
for _column in [*CODES, "last_execution_type", "last_order_status"]:
    COLUMN_DOCS.setdefault(f"{_column}_name", f"Meaning of {_column.removeprefix('last_')} code in {_column}")

UNKNOWN_CODE = "Code not in the JSE list"


def code_name(column: str, code_column: str, alias: str) -> str:
    """SQL for the meaning of code_column, looked up in dim_code under column_name = column."""
    return (f"CASE WHEN {code_column} IS NULL THEN NULL ELSE coalesce((SELECT meaning FROM dim_code d "
            f"WHERE d.column_name = '{column}' AND d.code = {code_column}), '{UNKNOWN_CODE}') END AS {alias}")


def build(conn):
    # ---- the dimensions that fact_message looks codes up in ----
    conn.execute("CREATE TABLE dim_message_type (message_type VARCHAR, message_name VARCHAR, sent_by VARCHAR, silver_table VARCHAR)")
    conn.executemany("INSERT INTO dim_message_type VALUES (?, ?, ?, ?)", MESSAGE_TYPES)
    conn.execute("CREATE TABLE dim_code (column_name VARCHAR, code VARCHAR, meaning VARCHAR)")
    conn.executemany("INSERT INTO dim_code VALUES (?, ?, ?)", [(c, k, v) for c, vals in CODES.items() for k, v in vals.items()])

    # ---- fact_message: the silver table plus is_rejection, the _name columns and report_event ----
    silver_columns = [r[0] for r in conn.execute("DESCRIBE silver_message").fetchall()]
    added = {
        "message_type": ["message_type_name", "is_rejection"],
        "ref_message_type": ["ref_message_type_name"],
        "order_status": ["order_status_name", "report_event"],
        **{c: [f"{c}_name"] for c in CODES if c != "order_status"},
    }
    columns = [x for c in silver_columns for x in [c, *added.get(c, [])]]
    status_events = {"4": "Cancelled", "6": "Expired", "8": "Rejected", "9": "Suspended"}
    conn.execute(f"""
        CREATE TABLE fact_message AS
        WITH m AS (
            SELECT *, row_number() OVER (PARTITION BY message_type, order_id
                                         ORDER BY timestamp, transact_time, execution_id) = 1 AS first_of_order
            FROM silver_message)
        SELECT {', '.join(columns)} FROM (
            SELECT m.*,
                   (SELECT message_name FROM dim_message_type t WHERE t.message_type = m.message_type) AS message_type_name,
                   (SELECT message_name FROM dim_message_type t WHERE t.message_type = m.ref_message_type) AS ref_message_type_name,
                   CASE message_type
                        WHEN '3' THEN true
                        WHEN '9' THEN true
                        WHEN '8' THEN coalesce(execution_type = '8' OR order_status = '8', false)
                        WHEN 'r' THEN coalesce(mass_cancel_status = '0', false)
                        WHEN 'B' THEN coalesce(reject_code NOT IN ('0', '3'), false)
                        ELSE false END AS is_rejection,
                   CASE WHEN message_type <> '8' THEN NULL
                        WHEN execution_type IS NOT NULL THEN coalesce((SELECT meaning FROM dim_code d
                             WHERE d.column_name = 'execution_type' AND d.code = m.execution_type), '{UNKNOWN_CODE}')
                        WHEN executed_quantity > 0 THEN 'Trade'
                        WHEN order_status = '0' AND first_of_order THEN 'New (accepted)'
                        WHEN order_status = '0' THEN 'Amended'
                        WHEN order_status = '1' THEN 'Amended or Restated'
                        {' '.join(f"WHEN order_status = '{k}' THEN '{v}'" for k, v in status_events.items())}
                        END AS report_event,
                   {', '.join(code_name(c, f'm.{c}', f'{c}_name') for c in CODES)}
            FROM m)
        ORDER BY message_id""")

    # ---- fact_order ----
    conn.execute("""
        CREATE TABLE fact_order AS
        WITH er AS (
            SELECT *, {'t': timestamp, 'tt': transact_time, 'e': execution_id} AS seq FROM fact_message WHERE message_type = '8'),
        orders AS (
            SELECT order_id, any_value(comp_id) AS comp_id,
                   min(timestamp) AS first_report_at, max(timestamp) AS last_report_at, count(*) AS execution_reports,
                   arg_min(client_order_id, seq) AS first_client_order_id,
                   arg_min(coalesce(execution_type, order_status), seq) AS first_report_code,
                   bool_or(execution_type = '8' OR order_status = '8') AS rejected,
                   max(reject_code) FILTER (WHERE execution_type = '8' OR order_status = '8') AS reject_code,
                   count(*) FILTER (WHERE executed_quantity > 0) AS trades,
                   coalesce(sum(executed_quantity), 0) AS executed_quantity,
                   count(*) FILTER (WHERE execution_type = '5') AS amended_reports,
                   bool_or(execution_type = '4' OR order_status = '4') AS cancelled,
                   bool_or(execution_type = 'C' OR order_status = '6') AS expired,
                   bool_or(order_status = '2') AS filled_status,
                   arg_max(leaves_quantity, seq) AS last_leaves_quantity,
                   arg_max(execution_type, seq) AS last_execution_type,
                   arg_max(order_status, seq) AS last_order_status
            FROM er GROUP BY order_id),
        new_orders AS (
            SELECT order_id, arg_min(message_id, timestamp) AS new_order_message_id, min(timestamp) AS new_order_at,
                   arg_min(security_id, timestamp) AS security_id, arg_min(side, timestamp) AS side,
                   arg_min(order_type, timestamp) AS order_type, arg_min(time_in_force, timestamp) AS time_in_force,
                   arg_min(order_quantity, timestamp) AS order_quantity, arg_min(display_quantity, timestamp) AS display_quantity,
                   arg_min(limit_price, timestamp) AS limit_price
            FROM fact_message WHERE message_type = 'D' AND order_id IS NOT NULL GROUP BY order_id),
        requests AS (
            SELECT order_id,
                   count(*) FILTER (WHERE message_type = 'G') AS amend_requests,
                   count(*) FILTER (WHERE message_type = 'F') AS cancel_requests,
                   count(*) FILTER (WHERE message_type = '9') AS cancel_rejects
            FROM fact_message WHERE message_type IN ('F', 'G', '9') AND order_id IS NOT NULL GROUP BY order_id)
        SELECT o.order_id, o.comp_id, n.new_order_message_id, n.new_order_at, o.first_report_at, o.last_report_at,
               o.first_client_order_id, n.security_id, n.side, n.order_type, n.time_in_force, n.order_quantity,
               n.display_quantity, n.limit_price,
               CASE WHEN o.filled_status OR (o.trades > 0 AND o.last_leaves_quantity = 0) THEN 'Filled'
                    WHEN o.cancelled THEN 'Cancelled'
                    WHEN o.expired THEN 'Expired'
                    WHEN o.rejected THEN 'Rejected'
                    WHEN o.trades > 0 THEN 'Partly filled, no closing report'
                    ELSE 'Open, no closing report' END AS outcome,
               o.reject_code, o.execution_reports, o.trades, o.executed_quantity, o.amended_reports,
               coalesce(r.amend_requests, 0) AS amend_requests, coalesce(r.cancel_requests, 0) AS cancel_requests,
               coalesce(r.cancel_rejects, 0) AS cancel_rejects,
               o.last_execution_type, o.last_order_status, o.last_leaves_quantity
        FROM orders o LEFT JOIN new_orders n USING (order_id) LEFT JOIN requests r USING (order_id)
        ORDER BY o.comp_id, o.first_report_at""")
    names = {"side": "side", "order_type": "order_type", "time_in_force": "time_in_force",
             "last_execution_type": "execution_type", "last_order_status": "order_status"}
    order_columns = [r[0] for r in conn.execute("DESCRIBE fact_order").fetchall()]
    conn.execute(f"""
        CREATE TABLE fo AS SELECT {', '.join(x for c in order_columns for x in [c] + ([f'{c}_name'] if c in names else []))}
        FROM (SELECT o.*, {', '.join(code_name(code, f'o.{c}', f'{c}_name') for c, code in names.items())} FROM fact_order o)
        ORDER BY comp_id, first_report_at""")
    conn.execute("DROP TABLE fact_order; ALTER TABLE fo RENAME TO fact_order")

    # ---- fact_compid_day ----
    conn.execute("""
        CREATE TABLE fact_compid_day AS
        SELECT comp_id, date, min(timestamp) AS first_message_at, max(timestamp) AS last_message_at, count(*) AS messages,
               count(*) FILTER (WHERE message_type = 'A') AS logons,
               count(*) FILTER (WHERE message_type = 'B') AS logon_responses,
               count(*) FILTER (WHERE message_type = 'B' AND reject_code NOT IN ('0', '3')) AS logon_rejects,
               count(*) FILTER (WHERE message_type = '5') AS logouts,
               count(*) FILTER (WHERE message_type = 'D') AS new_orders,
               count(*) FILTER (WHERE message_type = 'G') AS amend_requests,
               count(*) FILTER (WHERE message_type = 'F') AS cancel_requests,
               count(*) FILTER (WHERE message_type = 'q') AS mass_cancel_requests,
               count(*) FILTER (WHERE message_type = '8') AS execution_reports,
               count(*) FILTER (WHERE message_type = '8' AND executed_quantity > 0) AS trades,
               count(*) FILTER (WHERE message_type = '8' AND (execution_type = '8' OR order_status = '8')) AS order_rejects,
               count(*) FILTER (WHERE message_type = '9') AS cancel_rejects,
               count(*) FILTER (WHERE message_type = 'r') AS mass_cancel_reports,
               count(*) FILTER (WHERE message_type = '3') AS gateway_rejects
        FROM fact_message WHERE comp_id IS NOT NULL GROUP BY comp_id, date ORDER BY comp_id, date""")

    # ---- dimensions ----
    conn.execute("""
        CREATE TABLE dim_compid AS
        SELECT comp_id, min(timestamp) AS first_message_at, max(timestamp) AS last_message_at,
               count(DISTINCT date) AS active_days, count(*) AS messages,
               count(*) FILTER (WHERE message_type = 'D') AS new_orders,
               string_agg(DISTINCT protocol_version, ', ' ORDER BY protocol_version) AS logon_protocol_versions
        FROM fact_message WHERE comp_id IS NOT NULL GROUP BY comp_id ORDER BY comp_id""")
    conn.execute("""
        CREATE TABLE dim_date AS
        SELECT CAST(d AS DATE) AS date, dayname(d) AS day_name, monthname(d) || '_' || year(d) AS month,
               dayofweek(d) IN (0, 6) AS is_weekend
        FROM range((SELECT min(date) FROM fact_message), (SELECT max(date) FROM fact_message) + INTERVAL 1 DAY, INTERVAL 1 DAY) t(d)""")
    conn.execute("""
        CREATE TABLE dim_security AS
        SELECT security_id, min(timestamp) AS first_message_at, max(timestamp) AS last_message_at,
               count(DISTINCT comp_id) AS compids, count(*) AS messages
        FROM fact_message WHERE security_id IS NOT NULL GROUP BY security_id ORDER BY security_id""")
    volume10 = json.loads((KNOWLEDGE_DIR / "reject_codes.json").read_text(encoding="utf-8"))["codes"]
    seen = conn.execute("""
        SELECT reject_code, string_agg(DISTINCT t.message_name, ', ' ORDER BY t.message_name) FROM fact_message
        JOIN dim_message_type t USING (message_type) WHERE reject_code IS NOT NULL GROUP BY 1 ORDER BY 1""").fetchall()
    rows = []
    for code, where in seen:
        entries = volume10.get(code.lstrip("0") or "0", [])
        # The exports come from the Native Trading Gateway, the Matching Engine and the AuthServer.
        native = [e for e in entries if any(s in e["system"].replace(" ", "") for s in ("Native", "MatchingEngine", "AuthServer", "ExchangeManager"))]
        meaning = " | ".join(f"{e['reason']} ({e['system']})" for e in (native or entries)) or "Not in Volume 10"
        if code == "0":
            meaning = "Logon Response: logged in (no rejection)"
        elif code == "3" and "Logon Response" in where:
            meaning = "Logon Response: logged in, but the new password does not meet the password policy | " + meaning
        rows.append((code, meaning, where))
    conn.execute("CREATE TABLE dim_reject_code (reject_code VARCHAR, meaning VARCHAR, seen_on VARCHAR)")
    conn.executemany("INSERT INTO dim_reject_code VALUES (?, ?, ?)", rows)


def profile(conn, table: str) -> list[dict]:
    """Per column: type, number of distinct values, number of empty values and the 8 most common values."""
    columns = []
    for name, ctype, *_ in conn.execute(f"DESCRIBE {table}").fetchall():
        distinct, empty = conn.execute(f'SELECT count(DISTINCT "{name}"), count(*) - count("{name}") FROM {table}').fetchone()
        top = conn.execute(f'SELECT CAST("{name}" AS VARCHAR), count(*) n FROM {table} WHERE "{name}" IS NOT NULL '
                           f'GROUP BY 1 ORDER BY n DESC, 1 LIMIT 8').fetchall()
        columns.append({"name": name, "type": ctype, "description": COLUMN_DOCS.get(name, ""),
                        "distinct_values": distinct, "empty_values": empty, "most_common": [[v, n] for v, n in top]})
    return columns


def main():
    with tempfile.TemporaryDirectory() as tmp:
        conn = duckdb.connect(str(Path(tmp) / "work.duckdb"))
        conn.execute("SET enable_progress_bar = false")
        path = Path(tmp) / "message.parquet"
        path.write_bytes(download("silver/message.parquet"))
        conn.execute(f"CREATE VIEW silver_message AS SELECT * FROM read_parquet('{path.as_posix()}')")
        build(conn)

        manifest = {"built_from": "silver", "tables": {}}
        for table in TABLE_DOCS:
            out = Path(tmp) / f"gold_{table}.parquet"
            conn.execute(f"COPY {table} TO '{out.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
            upload(f"gold/{table}.parquet", out.read_bytes())
            rows = conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            manifest["tables"][table] = {"description": TABLE_DOCS[table], "rows": rows, "columns": profile(conn, table)}
            print(f"{table:20} {rows:>10,} rows")
        conn.close()
    upload("gold/manifest.json", json.dumps(manifest, indent=1, default=str).encode())
    written = {f"gold/{t}.parquet" for t in TABLE_DOCS} | {"gold/manifest.json"}
    delete(sorted(set(list_files("gold")) - written))
    save_scripts()


if __name__ == "__main__":
    main()
