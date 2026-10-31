"""Loads the Vonnegut FIX message exports (.xlsx) into DuckDB tables the agent can query.

Opening the Excel files is slow (the largest takes about 20 seconds), so each file is
converted once to a Parquet file in code/.cache and only re-converted when the Excel file changes.
Rows from every month are combined into one table per FIX message type.
"""

import json
import os
import re
import threading
from pathlib import Path

import duckdb
import pandas as pd

CODE_DIR = Path(__file__).resolve().parent
CACHE_DIR = CODE_DIR / ".cache"

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


class DataStore:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.status = {"state": "starting", "done": 0, "total": 0, "current": None, "error": None}
        self.files: list[dict] = []  # one entry per Excel file
        self.tables: dict[str, dict] = {}
        self.conn: duckdb.DuckDBPyConnection | None = None
        self._lock = threading.Lock()

    # ---------- loading ----------

    def load_in_background(self):
        threading.Thread(target=self._load, daemon=True).start()

    def _load(self):
        try:
            excel_files = sorted(p for p in self.data_dir.rglob("*.xlsx") if not p.name.startswith("~$"))
            self.status.update(state="converting", total=len(excel_files))
            CACHE_DIR.mkdir(exist_ok=True)
            files = []
            for i, path in enumerate(excel_files):
                self.status.update(current=str(path.relative_to(self.data_dir)), done=i)
                files.append(self._convert(path))
            self.status.update(done=len(excel_files), current=None, state="indexing")
            self._build_database(files)
            self.files = files
            self.status["state"] = "ready"
        except Exception as exc:  # shown in the web page so the user knows why nothing loaded
            self.status.update(state="error", error=f"{type(exc).__name__}: {exc}")
            raise

    def _convert(self, path: Path) -> dict:
        rel = path.relative_to(self.data_dir)
        stat = path.stat()
        key = re.sub(r"[^0-9a-zA-Z]+", "_", str(rel.with_suffix(""))).strip("_").lower()
        parquet = CACHE_DIR / f"{key}.parquet"
        meta_path = CACHE_DIR / f"{key}.json"
        signature = {"size": stat.st_size, "mtime": stat.st_mtime}

        if parquet.exists() and meta_path.exists():
            meta = json.loads(meta_path.read_text())
            if meta.get("signature") == signature:
                return meta

        df = clean_frame(pd.read_excel(path, engine="calamine"))
        month = rel.parts[0] if len(rel.parts) > 1 else ""
        msg_types = df["message_type"].dropna().astype(str).value_counts() if "message_type" in df else pd.Series(dtype=int)
        main_type = msg_types.index[0] if len(msg_types) else None
        df.insert(0, "source_month", month)
        df.insert(1, "source_file", str(rel).replace("\\", "/"))
        df.to_parquet(parquet, index=False)

        meta = {
            "signature": signature,
            "parquet": parquet.name,
            "file": str(rel).replace("\\", "/"),
            "month": month,
            "rows": len(df),
            "message_types": msg_types.to_dict(),
            "table": MSG_TYPE_TABLES.get(main_type, f"other_{key}"),
        }
        meta_path.write_text(json.dumps(meta, indent=1))
        return meta

    def _build_database(self, files: list[dict]):
        conn = duckdb.connect(":memory:")
        conn.execute("SET enable_progress_bar = false")
        by_table: dict[str, list[dict]] = {}
        for f in files:
            by_table.setdefault(f["table"], []).append(f)

        for table, members in by_table.items():
            selects = []
            for m in members:
                source = f"read_parquet('{(CACHE_DIR / m['parquet']).as_posix()}')"
                # Make code columns text in every month, so a column has one type after combining months.
                to_text = [c for c, t in conn.execute(f"SELECT column_name, column_type FROM (DESCRIBE SELECT * FROM {source})").fetchall()
                           if TEXT_COLUMN_PATTERN.search(c) and t != "VARCHAR" and c != "timestamp" and not c.endswith("_time")]
                replace = f" REPLACE ({', '.join(f'CAST({c} AS VARCHAR) AS {c}' for c in to_text)})" if to_text else ""
                selects.append(f"SELECT *{replace} FROM {source}")
            sources = " UNION ALL BY NAME ".join(selects)
            conn.execute(f'CREATE TABLE "{table}" AS {sources}')

        common = ["source_month", "source_file", "timestamp", "comp_id", "message_type", "client_order_id"]
        selects = []
        for table in by_table:
            cols = {r[0] for r in conn.execute(f'DESCRIBE "{table}"').fetchall()}
            parts = [c if c in cols else f"NULL AS {c}" for c in common]
            selects.append(f"SELECT '{table}' AS table_name, {', '.join(parts)} FROM \"{table}\"")
        conn.execute("CREATE VIEW all_messages AS " + " UNION ALL BY NAME ".join(selects))

        # The agent's SQL may only read the tables above: no file, network or settings access.
        conn.execute("SET enable_external_access = false")
        conn.execute("SET lock_configuration = true")

        tables = {}
        for table, members in by_table.items():
            columns = conn.execute(f'DESCRIBE "{table}"').fetchall()
            tables[table] = {
                "rows": conn.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0],
                "columns": [{"name": c[0], "type": c[1]} for c in columns],
                "source_files": [m["file"] for m in members],
            }
        with self._lock:
            self.conn = conn
            self.tables = tables

    # ---------- queries used by the agent's tools ----------

    def ready(self) -> bool:
        return self.status["state"] == "ready"

    def list_tables(self) -> dict:
        return {
            "tables": {
                name: {"rows": t["rows"], "columns": [c["name"] for c in t["columns"]], "source_files": t["source_files"]}
                for name, t in self.tables.items()
            },
            "views": {"all_messages": "table_name, source_month, source_file, timestamp, comp_id, message_type, client_order_id for every row of every table"},
            "files": [{k: f[k] for k in ("file", "month", "rows", "table", "message_types")} for f in self.files],
        }

    def describe_table(self, table: str) -> dict:
        if table not in self.tables:
            return {"error": f"Unknown table '{table}'. Known tables: {', '.join(self.tables)}"}
        cur = self.conn.cursor()
        columns = []
        for col in self.tables[table]["columns"]:
            name = col["name"]
            distinct, nulls = cur.execute(f'SELECT count(DISTINCT "{name}"), count(*) - count("{name}") FROM "{table}"').fetchone()
            top = cur.execute(
                f'SELECT "{name}", count(*) n FROM "{table}" WHERE "{name}" IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 8'
            ).fetchall()
            columns.append({**col, "distinct_values": distinct, "empty_values": nulls,
                            "most_common": [[str(v), n] for v, n in top]})
        sample = cur.execute(f'SELECT * FROM "{table}" LIMIT 5').df()
        return {"table": table, "rows": self.tables[table]["rows"], "columns": columns,
                "sample_rows": json.loads(sample.to_json(orient="records", date_format="iso"))}

    def run_sql(self, sql: str, max_rows: int = 200) -> dict:
        statements = duckdb.extract_statements(sql)
        if len(statements) != 1 or statements[0].type != duckdb.StatementType.SELECT:
            return {"error": "Only a single SELECT (or WITH ... SELECT) statement is allowed."}
        cur = self.conn.cursor()
        try:
            result = cur.execute(sql)
            columns = [d[0] for d in result.description]
            rows = result.fetchmany(max_rows + 1)
        except duckdb.Error as exc:
            return {"error": str(exc)}
        truncated = len(rows) > max_rows
        rows = [[v.isoformat() if hasattr(v, "isoformat") else v for v in r] for r in rows[:max_rows]]
        return {"columns": columns, "rows": rows, "row_count": len(rows), "truncated": truncated,
                "note": f"Only the first {max_rows} rows are shown; aggregate or add LIMIT." if truncated else None}


if __name__ == "__main__":
    # `python code/data_store.py` builds the cache ahead of time and prints what was loaded.
    from config import DATA_DIR

    store = DataStore(DATA_DIR)
    store._load()
    for name, t in store.tables.items():
        print(f"{name:32} {t['rows']:>9,} rows  from {len(t['source_files'])} file(s)")
