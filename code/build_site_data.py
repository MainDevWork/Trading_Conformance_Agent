"""Exports the FIX message tables to data/ for the GitHub Pages site.

Run: python code/build_site_data.py
Writes one Parquet file per table plus manifest.json, which lists the tables, their columns and source files.
The web page loads these files into DuckDB-WASM (the version of DuckDB that runs inside a web browser).
Re-run it and commit data/ whenever the Excel files change.
"""

import json
from pathlib import Path

from config import DATA_DIR
from data_store import CODE_DIR, DataStore

SITE_DATA_DIR = CODE_DIR.parent / "data"


def main():
    store = DataStore(DATA_DIR)
    store._load()
    SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    for old in SITE_DATA_DIR.glob("*.parquet"):
        old.unlink()

    # The store's connection cannot write files (external access is switched off), so pandas writes them.
    conn = store.conn
    for table in store.tables:
        out = (SITE_DATA_DIR / f"{table}.parquet").as_posix()
        df = conn.execute(f'SELECT * FROM "{table}"').df()
        df.to_parquet(out, index=False, compression="zstd")
        print(f"{table:32} {len(df):>9,} rows  {Path(out).stat().st_size / 1e6:6.1f} MB")

    manifest = store.list_tables()
    manifest["built_from"] = Path(DATA_DIR).relative_to(CODE_DIR.parent).as_posix()
    (SITE_DATA_DIR / "manifest.json").write_text(json.dumps(manifest, indent=1, default=str))


if __name__ == "__main__":
    main()
