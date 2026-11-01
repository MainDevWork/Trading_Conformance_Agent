import os
from pathlib import Path

from dotenv import load_dotenv

CODE_DIR = Path(__file__).resolve().parent
load_dotenv(CODE_DIR / ".env")

# Folder holding the month folders of Vonnegut Excel exports, relative to the repository root.
DATA_DIR = (CODE_DIR.parent / os.getenv("DATA_DIR", "Trading_FIX_Messages")).resolve()

# Excel file with columns "Real CompID" and "Fictitious CompID". Every real CompID is replaced with its
# fictitious one before any file leaves this computer.
COMPID_KEY = (CODE_DIR.parent / os.getenv("COMPID_KEY", "CompID_Key.xlsx")).resolve()

# Supabase project that holds the Parquet files for the web page. The service key can create buckets and
# upload files, so it is kept only in code/.env (excluded from git).
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "fix-data")
