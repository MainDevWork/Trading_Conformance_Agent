import os
from pathlib import Path

from dotenv import load_dotenv

CODE_DIR = Path(__file__).resolve().parent
load_dotenv(CODE_DIR / ".env")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
MODEL = os.getenv("MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free")
# Folder holding the month folders of Vonnegut Excel exports, relative to the repository root.
DATA_DIR = (CODE_DIR.parent / os.getenv("DATA_DIR", "Trading_Conformance/Trading_FIX_Message_Data/Raw_Data")).resolve()
PORT = int(os.getenv("PORT", "8000"))

# Supabase project that holds the Parquet files for the web page. The service key can create buckets and
# upload files, so it is kept only in code/.env (excluded from git).
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "fix-data")
