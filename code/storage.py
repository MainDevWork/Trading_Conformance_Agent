"""Reads and writes files in the private Supabase Storage bucket that holds the bronze, silver and gold layers.

Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in code/.env. The service key can create buckets and write files,
so it is used only by these scripts, never by the web page.
"""

from pathlib import Path
from urllib.parse import quote

import requests

from config import CODE_DIR, SUPABASE_BUCKET, SUPABASE_SERVICE_KEY, SUPABASE_URL

# The scripts that build the layers, copied to scripts/ in the bucket by save_scripts().
SCRIPTS = ["config.py", "storage.py", "bronze.py", "silver.py", "gold.py", "requirements.txt"]

STORAGE = f"{SUPABASE_URL}/storage/v1"


def _headers() -> dict:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY in code/.env")
    return {"apikey": SUPABASE_SERVICE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"}


def ensure_bucket():
    r = requests.get(f"{STORAGE}/bucket", headers=_headers(), timeout=30)
    r.raise_for_status()
    if SUPABASE_BUCKET not in {b["id"] for b in r.json()}:
        r = requests.post(f"{STORAGE}/bucket", headers=_headers(), timeout=30,
                          json={"id": SUPABASE_BUCKET, "name": SUPABASE_BUCKET, "public": False})
        r.raise_for_status()
        print(f"Created private bucket {SUPABASE_BUCKET}")


def list_files(prefix: str) -> list[str]:
    """Paths of every file under prefix (e.g. "bronze"), searching sub-folders."""
    found = []
    r = requests.post(f"{STORAGE}/object/list/{SUPABASE_BUCKET}", headers=_headers(), timeout=30,
                      json={"prefix": prefix, "limit": 1000, "sortBy": {"column": "name", "order": "asc"}})
    r.raise_for_status()
    for item in r.json():
        path = f"{prefix}/{item['name']}"
        # Supabase lists a sub-folder as an entry with no id.
        found += list_files(path) if item.get("id") is None else [path]
    return found


def download(path: str) -> bytes:
    r = requests.get(f"{STORAGE}/object/{SUPABASE_BUCKET}/{quote(path)}", headers=_headers(), timeout=600)
    if not r.ok:
        raise SystemExit(f"{path}: Supabase returned {r.status_code}: {r.text[:300]}")
    return r.content


def upload(path: str, content: bytes):
    """Writes content to path in the bucket, replacing any file already there."""
    content_type = {".json": "application/json", ".py": "text/plain", ".txt": "text/plain", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
    r = requests.post(f"{STORAGE}/object/{SUPABASE_BUCKET}/{quote(path)}", data=content, timeout=600,
                      headers={**_headers(), "x-upsert": "true",
                               "Content-Type": content_type.get(Path(path).suffix, "application/octet-stream")})
    if not r.ok:
        raise SystemExit(f"{path}: Supabase returned {r.status_code}: {r.text[:300]}")
    print(f"uploaded {path:60} {len(content) / 1e6:6.1f} MB")


def delete(paths: list[str]):
    if paths:
        r = requests.delete(f"{STORAGE}/object/{SUPABASE_BUCKET}", headers=_headers(), timeout=60, json={"prefixes": paths})
        r.raise_for_status()


def save_scripts():
    """Copies the layer-building scripts to scripts/ in the bucket, so the bucket shows how each layer was made."""
    for name in SCRIPTS:
        if (CODE_DIR / name).exists():
            upload(f"scripts/{name}", (CODE_DIR / name).read_bytes())
