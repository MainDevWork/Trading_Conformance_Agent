"""Bronze layer: the Vonnegut Excel exports, unchanged except for the CompIDs, and the same rows combined into one
table per message type.

Run: python code/bronze.py                  (uploads the Excel files, then combines them)
     python code/bronze.py --combine-only   (combines the Excel files already in the bucket)

Step 1, upload. Reads every .xlsx file under DATA_DIR (Trading_FIX_Messages/) and writes it to
bronze/<month folder>/<file name> in the bucket. The folder layout and file names are kept, except that
Supabase does not accept square brackets in a file name, so "[" and "]" are stored as "(" and ")".
bronze/files.json lists each stored path with the original path under DATA_DIR.

An .xlsx file is a zip archive of XML files. Vonnegut stores every text cell, including the CompIDs, in the
archive's list of text values (xl/sharedStrings.xml). This script replaces each real CompID in that list with its
fictitious CompID from COMPID_KEY and copies every other part of the archive byte for byte. It then checks that no
real CompID is left anywhere in the archive, and stops without uploading if one is.

Step 2, combine. Downloads the Excel files from bronze/ and writes bronze/combined/<table>.parquet, one table per
message type with the rows of every month, and bronze/combined/manifest.json. Every value is kept as text as
Vonnegut wrote it ("6,065.0000", "-1", "2026-07-01 20:15:01.7941 pm"); a cell Excel holds as a number is written as
that number ("100"). Empty cells are NULL. Column names are the Excel headers. Reject files have two columns headed
"Message Type"; a table cannot have two columns with one name, so the second, the type of the rejected message, is
stored as "Message Type.1". The column source_file gives the Excel file each row came from. A file's table is chosen
from its Message Type column, not from its file name.
"""

import io
import json
import re
import sys
import tempfile
import zipfile
from pathlib import Path

import duckdb
import pandas as pd

from config import COMPID_KEY, DATA_DIR
from storage import delete, download, ensure_bucket, list_files, save_scripts, upload

SHARED_STRINGS = "xl/sharedStrings.xml"
COMBINED = "bronze/combined"

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


def load_key() -> dict[str, str]:
    key = pd.read_excel(COMPID_KEY, engine="calamine", dtype=str)
    mapping = dict(zip(key["Real CompID"].str.strip(), key["Fictitious CompID"].str.strip()))
    if set(mapping) & set(mapping.values()):
        raise SystemExit(f"{COMPID_KEY.name}: a fictitious CompID is also a real CompID")
    return mapping


def anonymise(xlsx: bytes, mapping: dict[str, str]) -> tuple[bytes, int]:
    """Returns the file with real CompIDs replaced, and the number of text values replaced."""
    names = "|".join(map(re.escape, sorted(mapping, key=len, reverse=True)))
    # A text value is <t>...</t> or <t xml:space="preserve">...</t>; only whole values are replaced.
    cell = re.compile(rf"(<t(?:\s[^>]*)?>)({names})(</t>)".encode())
    anywhere = re.compile(names.encode())

    source = zipfile.ZipFile(io.BytesIO(xlsx))
    out = io.BytesIO()
    replaced = 0
    with zipfile.ZipFile(out, "w") as target:
        for info in source.infolist():
            data = source.read(info)
            if info.filename == SHARED_STRINGS:
                data, replaced = cell.subn(lambda m: m[1] + mapping[m[2].decode()].encode() + m[3], data)
            if anywhere.search(data):
                raise SystemExit(f"A real CompID is still in {info.filename} after replacement; nothing was uploaded")
            target.writestr(info, data, compress_type=info.compress_type)
    return out.getvalue(), replaced


def storage_name(rel: str) -> str:
    return rel.replace("[", "(").replace("]", ")")


def upload_excel() -> list[str]:
    """Step 1. Returns the paths written."""
    mapping = load_key()
    ensure_bucket()
    excel_files = sorted(p for p in DATA_DIR.rglob("*.xlsx") if not p.name.startswith("~$"))
    original_names = {}
    for path in excel_files:
        rel = path.relative_to(DATA_DIR).as_posix()
        stored = f"bronze/{storage_name(rel)}"
        content, replaced = anonymise(path.read_bytes(), mapping)
        print(f"{rel:55} {replaced:3} CompIDs replaced")
        upload(stored, content)
        original_names[stored] = rel
    upload("bronze/files.json", json.dumps(original_names, indent=1).encode())
    return [*original_names, "bronze/files.json"]


def combine() -> list[str]:
    """Step 2. Returns the paths written."""
    original_names = json.loads(download("bronze/files.json"))
    conn = duckdb.connect(":memory:")
    conn.execute("SET enable_progress_bar = false")
    files, by_table = [], {}

    for stored, rel in sorted(original_names.items(), key=lambda kv: kv[1]):
        df = pd.read_excel(io.BytesIO(download(stored)), engine="calamine", dtype=str)
        msg_types = df["Message Type"].dropna().value_counts() if "Message Type" in df else pd.Series(dtype=int)
        table = MSG_TYPE_TABLES.get(msg_types.index[0] if len(msg_types) else None,
                                    "other_" + re.sub(r"[^0-9a-zA-Z]+", "_", rel).strip("_").lower())
        columns = list(df.columns)
        df["source_file"] = rel
        df = df.astype(object).where(df.notna(), None)
        name = f"f{len(files)}"
        # Cast, because a column that is empty in every row would otherwise not be stored as text.
        conn.execute(f"CREATE TABLE {name} AS SELECT COLUMNS(*)::VARCHAR FROM df")
        by_table.setdefault(table, []).append(name)
        files.append({"file": rel, "rows": len(df), "table": table, "message_types": msg_types.to_dict(), "columns": columns})
        print(f"{rel:55} {len(df):>9,} rows -> {table}")

    tables = {}
    with tempfile.TemporaryDirectory() as tmp:
        for table, members in by_table.items():
            conn.execute(f'CREATE TABLE "{table}" AS ' + " UNION ALL BY NAME ".join(f"SELECT * FROM {m}" for m in members))
            out = Path(tmp) / f"{table}.parquet"
            conn.execute(f"COPY \"{table}\" TO '{out.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
            upload(f"{COMBINED}/{table}.parquet", out.read_bytes())
            tables[table] = {
                "rows": conn.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0],
                "columns": [c[0] for c in conn.execute(f'DESCRIBE "{table}"').fetchall()],
                "source_files": [f["file"] for f in files if f["table"] == table],
            }

    manifest = {"built_from": "bronze Excel files", "tables": tables, "files": files}
    upload(f"{COMBINED}/manifest.json", json.dumps(manifest, indent=1, default=str).encode())
    return [*(f"{COMBINED}/{t}.parquet" for t in tables), f"{COMBINED}/manifest.json"]


def main():
    if "--combine-only" in sys.argv:
        written = [*json.loads(download("bronze/files.json")), "bronze/files.json", *combine()]
    else:
        written = [*upload_excel(), *combine()]
    # Files that were not written by this run (Excel files removed from DATA_DIR, old tables) are removed from the bucket.
    delete(sorted(set(list_files("bronze")) - set(written)))
    save_scripts()


if __name__ == "__main__":
    main()
