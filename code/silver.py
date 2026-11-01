"""Silver layer: one cleaned table of messages, with one row per message of every type.

Run: python code/silver.py   (after code/bronze.py)
Downloads the combined bronze tables (bronze/combined/<table>.parquet) and writes silver/message.parquet and
silver/manifest.json to the bucket.

Cleaning, done separately for the rows of each Excel file: column headers become lower-case names with underscores
("Client Order ID" -> client_order_id); spaces around values are removed and empty values become NULL; timestamps
are parsed; identifier and code columns are kept as text so leading zeros and letters survive; other columns that
hold only numbers become numbers.

The 11 message types are then put into one table, and these rules are applied:
- Repeated rows. Vonnegut records many messages more than once. An execution report is one row per execution_id
  (the JSE gives every execution report its own execution_id; copies of one report differ only in the capture time
  and in whether comp_id is filled in), timestamped with its earliest capture. Every other message type keeps one
  row per set of identical values, capture time included. copies is the number of bronze rows merged into the row.
- Missing CompIDs. Some JSE replies have no comp_id. It is filled from other messages with the same order_id, then
  from messages with the same client_order_id, only where that ID belongs to a single CompID. comp_id_filled
  marks the rows filled this way.
- Order links. New orders, cancels and amends that carry no order_id are given the order_id of the first execution
  report or order cancel reject with the same comp_id and client_order_id captured within 1 second after them.
  order_id_linked marks the rows linked this way.
- "Not set" placeholders (-1 in reject_code, minimum_quantity, stop_price, password_expiry) become empty (NULL).
- Network capture columns (source, destination, bytes, sequence_no, packet_id) and the always-empty columns
  expire_time and segment are left out; they are still in bronze.
"""

import json
import re
import tempfile
from pathlib import Path

import duckdb
import pandas as pd

from storage import delete, download, list_files, save_scripts, upload

BRONZE = "bronze/combined"

# Columns that hold identifiers or codes: kept as text so leading zeros and letters survive.
TEXT_COLUMN_PATTERN = re.compile(r"(_id$|^id$|code|type|indicator|status|side|key|instruction|flags|book|segment|account|time_in_force|capacity|cancel_on|protocol|reason)")

# Columns renamed so one column means the same thing in every message type.
RENAMES = {
    "order_cancel_replace_request": {"original_client_order_id": "orig_client_order_id"},
    "order_mass_cancel_request": {"orderbook": "order_book", "ordersubtype": "order_sub_type"},
    "order_mass_cancel_report": {"status": "mass_cancel_status"},
    "logon": {"compid": "logon_compid"},
    "logout": {"reason": "logout_reason"},
}
DROPPED = ["source", "destination", "bytes", "sequence_no", "packet_id", "expire_time", "segment"]

MESSAGE_COLUMNS = [
    "message_id", "timestamp", "date", "comp_id", "comp_id_filled", "message_type", "ref_message_type",
    "client_order_id", "orig_client_order_id", "order_id", "order_id_linked", "execution_id", "public_order_id",
    "security_id", "side", "order_type", "order_sub_type", "time_in_force", "order_quantity", "display_quantity",
    "minimum_quantity", "limit_price", "stop_price", "account", "capacity", "cancel_on_disconnect",
    "execution_instruction", "order_book", "self_trade_prevention_key", "execution_type", "order_status",
    "working_indicator", "liquidity_indicator", "type_of_trade", "indicator_flags", "leaves_quantity",
    "executed_quantity", "executed_price", "transact_time", "reject_code", "reject_reason", "partition_id",
    "mass_cancel_request_type", "mass_cancel_status", "logon_compid", "protocol_version", "password_expiry",
    "logout_reason", "copies", "source_file",
]


def to_column_name(header: str) -> str:
    name = re.sub(r"[^0-9a-zA-Z]+", "_", str(header)).strip("_").lower()
    if name == "typeoftrade":
        name = "type_of_trade"
    return name or "column"


def clean_frame(df: pd.DataFrame) -> pd.DataFrame:
    # Reject files have two columns headed "Message Type"; bronze stores the second as "Message Type.1". It is the
    # type of the message that was rejected (FIX tag 372, RefMsgType).
    names, seen = [], set()
    for header in df.columns:
        name = to_column_name(re.sub(r"\.\d+$", "", str(header)))
        if name in seen:
            name = "ref_" + name if name == "message_type" else f"{name}_2"
        seen.add(name)
        names.append(name)
    df.columns = names

    for col in df.columns:
        # Only spaces and tabs: some keys hold binary characters that Python would also count as spaces.
        values = df[col].astype("string").str.strip(" \t")
        values = values.mask(values == "")
        if col == "timestamp" or col.endswith("_time"):
            # Vonnegut writes 24-hour times followed by a redundant "am"/"pm", e.g. "2026-07-01 20:15:01.7941 pm"
            stripped = values.str.replace(r"\s*[ap]m$", "", regex=True)
            parsed = pd.to_datetime(stripped, errors="coerce", format="mixed")
            if parsed.notna().sum() >= values.notna().sum() * 0.95:
                df[col] = parsed
                continue
        if not TEXT_COLUMN_PATTERN.search(col):
            numeric = pd.to_numeric(values.str.replace(",", "", regex=False), errors="coerce")
            if values.notna().sum() > 0 and numeric.notna().sum() == values.notna().sum():
                df[col] = numeric
                continue
        df[col] = values
    return df


def build(conn, bronze_manifest: dict):
    # ---- clean each Excel file's rows, then combine the files of each message type ----
    parts = []
    for table, info in bronze_manifest["tables"].items():
        members = []
        for f in (f for f in bronze_manifest["files"] if f["table"] == table):
            cols = ", ".join(f'"{c}"' for c in f["columns"])
            df = clean_frame(conn.execute(f'SELECT {cols} FROM "b_{table}" WHERE source_file = ?', [f["file"]]).df())
            df.insert(0, "source_file", f["file"])
            name = f"f{len(members)}_{table}"
            conn.register("cleaned", df)
            # Code columns are text in every file, so a column has one type after the files are combined.
            to_text = [c for c, t in conn.execute("SELECT column_name, column_type FROM (DESCRIBE cleaned)").fetchall()
                       if TEXT_COLUMN_PATTERN.search(c) and t != "VARCHAR" and c != "timestamp" and not c.endswith("_time")]
            replace = f" REPLACE ({', '.join(f'CAST({c} AS VARCHAR) AS {c}' for c in to_text)})" if to_text else ""
            conn.execute(f"CREATE TABLE {name} AS SELECT *{replace} FROM cleaned")
            conn.unregister("cleaned")
            members.append(name)
            print(f"{f['file']:55} {len(df):>9,} rows cleaned")
        conn.execute(f'CREATE TABLE "c_{table}" AS ' + " UNION ALL BY NAME ".join(f"SELECT * FROM {m}" for m in members))
        for m in members:
            conn.execute(f"DROP TABLE {m}")

        # ---- one row per message ----
        cols = {r[0] for r in conn.execute(f'DESCRIBE "c_{table}"').fetchall()}
        drop = [c for c in DROPPED if c in cols]
        renames = RENAMES.get(table, {})
        select = (f"SELECT *" + (f" EXCLUDE ({', '.join(drop)})" if drop else "")
                  + (f" RENAME ({', '.join(f'{a} AS {b}' for a, b in renames.items())})" if renames else ""))
        source = f'({select} FROM "c_{table}")'
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

    others = [c for c in MESSAGE_COLUMNS if c not in ("message_id", "date")]
    conn.execute(f"""
        CREATE TABLE message AS
        SELECT row_number() OVER (ORDER BY comp_id NULLS LAST, timestamp, message_type, execution_id) AS message_id,
               CAST(timestamp AS DATE) AS date, {', '.join(others)}
        FROM msg""")
    conn.execute(f"CREATE TABLE m2 AS SELECT {', '.join(MESSAGE_COLUMNS)} FROM message ORDER BY message_id")
    conn.execute("DROP TABLE message; ALTER TABLE m2 RENAME TO message; DROP TABLE msg")


def main():
    bronze_manifest = json.loads(download(f"{BRONZE}/manifest.json"))
    with tempfile.TemporaryDirectory() as tmp:
        conn = duckdb.connect(str(Path(tmp) / "work.duckdb"))
        conn.execute("SET enable_progress_bar = false")
        for table in bronze_manifest["tables"]:
            path = Path(tmp) / f"{table}.parquet"
            path.write_bytes(download(f"{BRONZE}/{table}.parquet"))
            conn.execute(f"CREATE VIEW \"b_{table}\" AS SELECT * FROM read_parquet('{path.as_posix()}')")
        build(conn, bronze_manifest)

        out = Path(tmp) / "message.parquet"
        conn.execute(f"COPY message TO '{out.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
        upload("silver/message.parquet", out.read_bytes())
        manifest = {"built_from": BRONZE, "tables": {"message": {
            "rows": conn.execute("SELECT count(*) FROM message").fetchone()[0],
            "columns": [{"name": n, "type": t} for n, t, *_ in conn.execute("DESCRIBE message").fetchall()],
            "rows_per_message_type": dict(conn.execute("SELECT message_type, count(*) FROM message GROUP BY 1 ORDER BY 1").fetchall()),
        }}}
        conn.close()
    upload("silver/manifest.json", json.dumps(manifest, indent=1, default=str).encode())
    written = {"silver/message.parquet", "silver/manifest.json"}
    delete(sorted(set(list_files("silver")) - written))
    save_scripts()


if __name__ == "__main__":
    main()
