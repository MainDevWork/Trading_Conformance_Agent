"""Gold layer: rebuilds the silver tables as a star schema for the chat agent.

Run: python code/gold.py   (after code/silver.py)
Downloads silver/*.parquet from the bucket and writes gold/<table>.parquet and gold/manifest.json.

A star schema is a central table of events (a fact table) whose code and ID columns are looked up in small
descriptive tables (dimension tables). Here:

  fact_message     one row per distinct message of every type (the 11 silver tables in one table)
  fact_order       one row per order (JSE order_id), summarising its execution reports and requests
  fact_compid_day  one row per CompID per day, counting each kind of message
  dim_compid, dim_date, dim_security, dim_message_type, dim_code, dim_reject_code   descriptions of the codes

Rules applied when building fact_message:
- Repeated rows. Vonnegut records many messages more than once. An execution report is one row per execution_id
  (the JSE gives every execution report its own execution_id; copies of one report differ only in the capture time
  and in whether comp_id is filled in), timestamped with its earliest capture. Every other message type keeps one
  row per set of identical values, capture time included. copies is the number of silver rows merged into the row.
- Missing CompIDs. Some JSE replies have no comp_id. It is filled from other messages with the same order_id, then
  from messages with the same client_order_id, only where that ID belongs to a single CompID. comp_id_filled
  marks the rows filled this way.
- Order links. New orders, cancels and amends that carry no order_id are given the order_id of the first execution
  report or order cancel reject with the same comp_id and client_order_id captured within 1 second after them.
  order_id_linked marks the rows linked this way.
- "Not set" placeholders (-1 in reject_code, minimum_quantity, stop_price, password_expiry) become empty (NULL).
- Network capture columns (source, destination, bytes, sequence_no, packet_id) and the always-empty columns
  expire_time and segment are left out; they are still in silver.
"""

import json
import tempfile
from pathlib import Path

import duckdb

from storage import CODE_DIR, delete, download, list_files, save_scripts, upload

KNOWLEDGE_DIR = CODE_DIR.parent / "web" / "knowledge"

SILVER_TABLES = ["logon", "logon_response", "logout", "new_order_single", "order_cancel_request",
                 "order_cancel_replace_request", "order_mass_cancel_request", "execution_report",
                 "order_cancel_reject", "order_mass_cancel_report", "reject"]

# Silver columns renamed so one column means the same thing in every message type.
RENAMES = {
    "order_cancel_replace_request": {"original_client_order_id": "orig_client_order_id"},
    "order_mass_cancel_request": {"orderbook": "order_book", "ordersubtype": "order_sub_type"},
    "order_mass_cancel_report": {"status": "mass_cancel_status"},
    "logon": {"compid": "logon_compid"},
    "logout": {"reason": "logout_reason"},
}
DROPPED = ["source_month", "source", "destination", "bytes", "sequence_no", "packet_id", "expire_time", "segment"]

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
    "fact_message": "One row per distinct message of every type, in capture order. Filter on message_type (see dim_message_type). Start here for any question about what a CompID sent or received.",
    "fact_order": "One row per order, identified by the JSE order_id: how it was entered, what happened to it and how it ended. Built from execution reports, the linked New Order and the cancel and amend requests that name the order.",
    "fact_compid_day": "One row per CompID per day: number of distinct messages of each kind. Use it to find which days a CompID tested and what it did.",
    "dim_compid": "One row per CompID: first and last message, days active, totals.",
    "dim_date": "One row per calendar day from the first to the last message.",
    "dim_security": "One row per security_id (JSE numeric instrument ID) seen in the messages. Instrument names and segments are not in the exports.",
    "dim_message_type": "The meaning of each message_type code.",
    "dim_code": "The meaning of each code value, per column (side, order_type, time_in_force, execution_type, order_status, ...). Join on column_name and code.",
    "dim_reject_code": "The meaning of every reject_code seen in the messages, from JSE Volume 10, and the message types it was seen on.",
}

COLUMN_DOCS = {
    "message_id": "Number of the message in fact_message, unique",
    "timestamp": "Vonnegut capture time, South African time (SAST)",
    "date": "Calendar day of timestamp; joins dim_date.date",
    "comp_id": "CompID of the client connection; joins dim_compid",
    "comp_id_filled": "true when comp_id was empty in the export and was filled from another message of the same order",
    "message_type": "Message type code; joins dim_message_type",
    "ref_message_type": "Reject (3) only: type of the client message that was rejected",
    "client_order_id": "ID the client gave the request; the JSE does not check that it is unique",
    "orig_client_order_id": "Cancel and amend requests: client_order_id of the order to cancel or amend",
    "order_id": "JSE ID of the order, constant for the order's whole life; joins fact_order",
    "order_id_linked": "true when order_id was not in the request and was taken from the JSE reply captured within 1 second",
    "execution_id": "Execution report only: JSE ID of the report, unique",
    "public_order_id": "Equal to order_id except for iceberg orders",
    "security_id": "JSE numeric instrument ID; joins dim_security",
    "side": "1 Buy, 2 Sell (dim_code)",
    "order_type": "dim_code: 1 Market, 2 Limit, 3 Stop, 4 Stop Limit, ...",
    "order_sub_type": "dim_code",
    "time_in_force": "dim_code: 0 DAY, 3 IOC, 4 FOK, 9 GFA, 10 ATC, ...",
    "order_quantity": "Shares ordered",
    "display_quantity": "Visible quantity (less than order_quantity for iceberg orders)",
    "minimum_quantity": "Minimum execution size; empty when not set",
    "limit_price": "Limit price in ZAC (South African cents); divide by 100 for Rand",
    "stop_price": "Stop price in ZAC; empty when not set",
    "account": "Client account",
    "capacity": "dim_code: 2 Principal, 3 Agency (July only)",
    "cancel_on_disconnect": "dim_code",
    "execution_instruction": "dim_code",
    "order_book": "dim_code",
    "self_trade_prevention_key": "Key for self-match prevention (protocol version 3)",
    "execution_type": "Execution report: what happened (dim_code). Empty in July exports",
    "order_status": "Execution report: order state after the event (dim_code). Empty in August exports",
    "working_indicator": "dim_code",
    "liquidity_indicator": "Trades only, dim_code",
    "type_of_trade": "Trades only, dim_code",
    "indicator_flags": "Trades only: 1 aggressor, 0 passive",
    "leaves_quantity": "Quantity still open after the event",
    "executed_quantity": "Shares traded in this report; 0 when no trade",
    "executed_price": "Trade price in ZAC; 0 when no trade",
    "transact_time": "JSE event time in UTC (2 hours behind timestamp)",
    "reject_code": "Reject code (dim_reject_code); empty when there was no rejection. Logon Response: 0 logged in",
    "reject_reason": "Reject (3) only: field or reason named by the gateway",
    "partition_id": "Matching engine partition: 1 Equity, 2 Derivatives",
    "mass_cancel_request_type": "dim_code",
    "mass_cancel_status": "Mass cancel report: 7 Accepted, 0 Rejected",
    "logon_compid": "Logon only: CompID inside the Logon message",
    "protocol_version": "Logon only: dim_code",
    "password_expiry": "Logon Response only: days until the password expires; empty when not applicable",
    "logout_reason": "Logout only: free text reason",
    "copies": "Number of rows in the Vonnegut export that are this one message",
    "source_file": "Excel export the message came from (month folder / file name)",
}

FACT_MESSAGE_COLUMNS = list(COLUMN_DOCS)


def build(conn):
    # ---- fact_message ----
    parts = []
    for table in SILVER_TABLES:
        cols = {r[0] for r in conn.execute(f"DESCRIBE s_{table}").fetchall()}
        drop = [c for c in DROPPED if c in cols]
        renames = RENAMES.get(table, {})
        select = f"SELECT * EXCLUDE ({', '.join(drop)})" + (f" RENAME ({', '.join(f'{a} AS {b}' for a, b in renames.items())})" if renames else "")
        source = f"({select} FROM s_{table})"
        if table == "execution_report":
            parts.append(f"SELECT * EXCLUDE (timestamp, comp_id, source_file), min(timestamp) AS timestamp, "
                         f"any_value(comp_id) AS comp_id, count(*) AS copies, min(source_file) AS source_file FROM {source} GROUP BY ALL")
        else:
            parts.append(f"SELECT * EXCLUDE (source_file), count(*) AS copies, min(source_file) AS source_file FROM {source} GROUP BY ALL")
    conn.execute("CREATE TABLE msg AS " + " UNION ALL BY NAME ".join(parts))

    reports, ids = conn.execute("SELECT count(*), count(DISTINCT execution_id) FROM msg WHERE message_type = '8'").fetchone()
    if reports != ids:
        raise SystemExit(f"Execution reports sharing an execution_id differ in more than time and CompID ({reports} rows, {ids} IDs)")

    conn.execute("""
        UPDATE msg SET reject_code = NULLIF(reject_code, '-1'), minimum_quantity = NULLIF(minimum_quantity, -1),
                       stop_price = NULLIF(stop_price, -1), password_expiry = NULLIF(password_expiry, -1)""")
    conn.execute("ALTER TABLE msg ADD COLUMN comp_id_filled BOOLEAN DEFAULT false")
    conn.execute("ALTER TABLE msg ADD COLUMN order_id_linked BOOLEAN DEFAULT false")
    for key in ["order_id", "client_order_id"]:
        conn.execute(f"""
            UPDATE msg SET comp_id = m.comp_id, comp_id_filled = true
            FROM (SELECT {key}, any_value(comp_id) AS comp_id FROM msg
                  WHERE comp_id IS NOT NULL AND {key} IS NOT NULL AND {key} <> 'NONE'
                  GROUP BY 1 HAVING count(DISTINCT comp_id) = 1) m
            WHERE msg.comp_id IS NULL AND msg.{key} = m.{key}""")

    conn.execute("ALTER TABLE msg ADD COLUMN row_no BIGINT")
    conn.execute("UPDATE msg SET row_no = r.n FROM (SELECT rowid AS id, row_number() OVER () AS n FROM msg) r WHERE msg.rowid = r.id")
    conn.execute("""
        UPDATE msg SET order_id = l.order_id, order_id_linked = true
        FROM (SELECT q.row_no, p.order_id
              FROM (SELECT row_no, comp_id, client_order_id, timestamp FROM msg
                    WHERE message_type IN ('D', 'F', 'G') AND order_id IS NULL AND comp_id IS NOT NULL) q
              ASOF JOIN (SELECT comp_id, client_order_id, timestamp, order_id FROM msg
                         WHERE message_type IN ('8', '9') AND order_id IS NOT NULL AND order_id <> 'NONE' AND comp_id IS NOT NULL) p
                ON p.comp_id = q.comp_id AND p.client_order_id = q.client_order_id AND p.timestamp >= q.timestamp
              WHERE p.timestamp - q.timestamp <= INTERVAL 1 SECOND) l
        WHERE msg.row_no = l.row_no""")

    others = [c for c in FACT_MESSAGE_COLUMNS if c not in ("message_id", "date")]
    conn.execute(f"""
        CREATE TABLE fact_message AS
        SELECT row_number() OVER (ORDER BY comp_id NULLS LAST, timestamp, message_type, execution_id) AS message_id,
               CAST(timestamp AS DATE) AS date, {', '.join(others)}
        FROM msg ORDER BY message_id""")
    conn.execute(f"CREATE TABLE fm AS SELECT {', '.join(FACT_MESSAGE_COLUMNS)} FROM fact_message ORDER BY message_id")
    conn.execute("DROP TABLE fact_message; ALTER TABLE fm RENAME TO fact_message; DROP TABLE msg")

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
    conn.execute("CREATE TABLE dim_message_type (message_type VARCHAR, message_name VARCHAR, sent_by VARCHAR, silver_table VARCHAR)")
    conn.executemany("INSERT INTO dim_message_type VALUES (?, ?, ?, ?)", MESSAGE_TYPES)
    conn.execute("CREATE TABLE dim_code (column_name VARCHAR, code VARCHAR, meaning VARCHAR)")
    conn.executemany("INSERT INTO dim_code VALUES (?, ?, ?)", [(c, k, v) for c, vals in CODES.items() for k, v in vals.items()])

    volume10 = json.loads((KNOWLEDGE_DIR / "reject_codes.json").read_text(encoding="utf-8"))["codes"]
    seen = conn.execute("""
        SELECT reject_code, string_agg(DISTINCT t.message_name, ', ') FROM fact_message
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
        conn = duckdb.connect(":memory:")
        conn.execute("SET enable_progress_bar = false")
        for table in SILVER_TABLES:
            path = Path(tmp) / f"{table}.parquet"
            path.write_bytes(download(f"silver/{table}.parquet"))
            conn.execute(f"CREATE VIEW s_{table} AS SELECT * FROM read_parquet('{path.as_posix()}')")
        build(conn)

        manifest = {"built_from": "silver", "tables": {}}
        for table in TABLE_DOCS:
            out = Path(tmp) / f"gold_{table}.parquet"
            conn.execute(f"COPY {table} TO '{out.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
            upload(f"gold/{table}.parquet", out.read_bytes())
            rows = conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            manifest["tables"][table] = {"description": TABLE_DOCS[table], "rows": rows, "columns": profile(conn, table)}
            print(f"{table:20} {rows:>10,} rows")
    upload("gold/manifest.json", json.dumps(manifest, indent=1, default=str).encode())
    written = {f"gold/{t}.parquet" for t in TABLE_DOCS} | {"gold/manifest.json"}
    delete(sorted(set(list_files("gold")) - written))
    save_scripts()


if __name__ == "__main__":
    main()
