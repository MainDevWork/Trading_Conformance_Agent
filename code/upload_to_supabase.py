"""Uploads data/*.parquet and data/manifest.json to a private Supabase Storage bucket.

Run: python code/upload_to_supabase.py
Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in code/.env. Creates the bucket if it does not exist,
and replaces any file already uploaded under the same name.
"""

import requests

from config import CODE_DIR, SUPABASE_BUCKET, SUPABASE_SERVICE_KEY, SUPABASE_URL

SITE_DATA_DIR = CODE_DIR.parent / "data"


def main():
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY in code/.env")
    headers = {"apikey": SUPABASE_SERVICE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"}
    storage = f"{SUPABASE_URL}/storage/v1"

    buckets = requests.get(f"{storage}/bucket", headers=headers, timeout=30)
    buckets.raise_for_status()
    if SUPABASE_BUCKET not in {b["id"] for b in buckets.json()}:
        r = requests.post(f"{storage}/bucket", headers=headers, timeout=30,
                          json={"id": SUPABASE_BUCKET, "name": SUPABASE_BUCKET, "public": False})
        r.raise_for_status()
        print(f"Created private bucket {SUPABASE_BUCKET}")

    files = sorted(SITE_DATA_DIR.glob("*.parquet")) + [SITE_DATA_DIR / "manifest.json"]
    for path in files:
        content_type = "application/json" if path.suffix == ".json" else "application/octet-stream"
        r = requests.post(f"{storage}/object/{SUPABASE_BUCKET}/{path.name}", data=path.read_bytes(), timeout=300,
                          headers={**headers, "Content-Type": content_type, "x-upsert": "true"})
        if not r.ok:
            raise SystemExit(f"{path.name}: Supabase returned {r.status_code}: {r.text}")
        print(f"{path.name:40} {path.stat().st_size / 1e6:6.1f} MB uploaded")


if __name__ == "__main__":
    main()
