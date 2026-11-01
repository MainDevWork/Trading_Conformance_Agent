"""Silver layer: combines the bronze Excel files into one Parquet table per FIX message type.

Run: python code/silver.py   (after code/bronze.py)
Downloads every Excel file under bronze/ in the bucket, cleans each one, combines the rows of every month into one
table per message type, and writes silver/<table>.parquet and silver/manifest.json to the bucket.

Cleaning: column headers become lower-case names with underscores ("Client Order ID" -> client_order_id); empty
cells become NULL; timestamps are parsed; identifier and code columns are kept as text so leading zeros and letters
survive; other columns that hold only numbers become numbers. Two columns, source_month and source_file, record the
Excel file each row came from. A file's table is chosen from its message_type column, not from its file name.
"""

import io
import json
import re
import tempfile
from pathlib import Path

import duckdb
import pandas as pd

from storage import delete, download, list_files, save_scripts, upload

# FIX MsgType (tag 35) value -> table name
MSG_TYPE_TABLES = {
    "A": "logon",
    "B": "logon_response",
    "5": "logout",
    "D": "new_order_single",
    "F": "order_cancel_request",
    "G": "order_cancel_replace_request",
    "8": "execution_report",
    "9": "order_cancel_reject",
    "3": "reject",
    "q": "order_mass_cancel_request",
    "r": "order_mass_cancel_report",
}

# Columns that hold identifiers or codes: kept as text so leading zeros and letters survive.
TEXT_COLUMN_PATTERN = re.compile(r"(_id$|^id$|code|type|indicator|status|side|key|instruction|flags|book|segment|account|time_in_force|capacity|cancel_on|protocol|reason)")


def to_column_name(header: str) -> str:
    name = re.sub(r"[^0-9a-zA-Z]+", "_", str(header)).strip("_").lower()
    if name == "typeoftrade":
        name = "type_of_trade"
    return name or "column"


def clean_frame(df: pd.DataFrame) -> pd.DataFrame:
    # Reject files repeat the header "Message Type": the second one is the type of the message
    # that was rejected (FIX tag 372, RefMsgType).
    names, seen = [], set()
    for header in df.columns:
        name = to_column_name(re.sub(r"\.\d+$", "", str(header)))
        if name in seen:
            name = "ref_" + name if name == "message_type" else f"{name}_2"
        seen.add(name)
        names.append(name)
    df.columns = names

    for col in df.columns:
        values = df[col]
        if values.dtype == object:
            values = values.map(lambda v: None if v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == "" else str(v).strip())
        if col == "timestamp" or col.endswith("_time"):
            # Vonnegut writes 24-hour times followed by a redundant "am"/"pm", e.g. "2026-07-01 20:15:01.7941 pm"
            stripped = values.astype("string").str.replace(r"\s*[ap]m$", "", regex=True)
            parsed = pd.to_datetime(stripped, errors="coerce", format="mixed")
            if parsed.notna().sum() >= values.notna().sum() * 0.95:
                df[col] = parsed
                continue
        if not TEXT_COLUMN_PATTERN.search(col):
            numeric = pd.to_numeric(values.astype("string").str.replace(",", "", regex=False), errors="coerce")
            if values.notna().sum() > 0 and numeric.notna().sum() == values.notna().sum():
                df[col] = numeric
                continue
        df[col] = values.astype("string")
    return df


def main():
    original_names = json.loads(download("bronze/files.json"))
    conn = duckdb.connect(":memory:")
    conn.execute("SET enable_progress_bar = false")
    files, by_table = [], {}

    for stored, rel in sorted(original_names.items(), key=lambda kv: kv[1]):
        df = clean_frame(pd.read_excel(io.BytesIO(download(stored)), engine="calamine"))
        month = rel.split("/")[0] if "/" in rel else ""
        msg_types = df["message_type"].dropna().astype(str).value_counts() if "message_type" in df else pd.Series(dtype=int)
        table = MSG_TYPE_TABLES.get(msg_types.index[0] if len(msg_types) else None,
                                    "other_" + re.sub(r"[^0-9a-zA-Z]+", "_", rel).strip("_").lower())
        df.insert(0, "source_month", month)
        df.insert(1, "source_file", rel)
        name = f"f{len(files)}"
        conn.register(name, df)
        by_table.setdefault(table, []).append(name)
        files.append({"file": rel, "month": month, "rows": len(df), "table": table, "message_types": msg_types.to_dict()})
        print(f"{rel:55} {len(df):>9,} rows -> {table}")

    tables = {}
    with tempfile.TemporaryDirectory() as tmp:
        for table, members in by_table.items():
            selects = []
            for m in members:
                # Make code columns text in every month, so a column has one type after combining months.
                to_text = [c for c, t in conn.execute(f"SELECT column_name, column_type FROM (DESCRIBE {m})").fetchall()
                           if TEXT_COLUMN_PATTERN.search(c) and t != "VARCHAR" and c != "timestamp" and not c.endswith("_time")]
                replace = f" REPLACE ({', '.join(f'CAST({c} AS VARCHAR) AS {c}' for c in to_text)})" if to_text else ""
                selects.append(f"SELECT *{replace} FROM {m}")
            conn.execute(f'CREATE TABLE "{table}" AS ' + " UNION ALL BY NAME ".join(selects))
            out = Path(tmp) / f"{table}.parquet"
            conn.execute(f"COPY \"{table}\" TO '{out.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
            upload(f"silver/{table}.parquet", out.read_bytes())
            tables[table] = {
                "rows": conn.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0],
                "columns": [c[0] for c in conn.execute(f'DESCRIBE "{table}"').fetchall()],
                "source_files": [f["file"] for f in files if f["table"] == table],
            }

    manifest = {"built_from": "bronze", "tables": tables, "files": files}
    upload("silver/manifest.json", json.dumps(manifest, indent=1, default=str).encode())
    written = {f"silver/{t}.parquet" for t in tables} | {"silver/manifest.json"}
    delete(sorted(set(list_files("silver")) - written))
    save_scripts()


if __name__ == "__main__":
    main()
