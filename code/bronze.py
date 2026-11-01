"""Bronze layer: copies the Vonnegut Excel exports to Supabase unchanged except for the CompIDs.

Run: python code/bronze.py
Reads every .xlsx file under DATA_DIR (Trading_FIX_Messages/) and writes it to bronze/<month folder>/<file name>
in the bucket. The folder layout and file names are kept, except that
Supabase does not accept square brackets in a file name, so "[" and "]" are stored as "(" and ")".
bronze/files.json lists each stored path with the original path under DATA_DIR.

An .xlsx file is a zip archive of XML files. Vonnegut stores every text cell, including the CompIDs, in the
archive's list of text values (xl/sharedStrings.xml). This script replaces each real CompID in that list with its
fictitious CompID from COMPID_KEY and copies every other part of the archive byte for byte. It then checks that no
real CompID is left anywhere in the archive, and stops without uploading if one is.
"""

import io
import json
import re
import zipfile

import pandas as pd

from config import COMPID_KEY, DATA_DIR
from storage import delete, ensure_bucket, list_files, save_scripts, upload

SHARED_STRINGS = "xl/sharedStrings.xml"


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


def main():
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
    files_json = json.dumps(original_names, indent=1).encode()
    upload("bronze/files.json", files_json)
    written = [*original_names, "bronze/files.json"]
    # Files removed from DATA_DIR since the last run are removed from the bucket too.
    delete(sorted(set(list_files("bronze")) - set(written)))
    save_scripts()


if __name__ == "__main__":
    main()
