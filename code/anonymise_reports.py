"""Copies the client conformance test reports in Clients_Conformance_Tests/ to Clients_Conformance_Tests/Fictitious_CompIDs/,
with every real CompID replaced by its fictitious CompID from COMPID_KEY.

Run it from the repository root with: python code/anonymise_reports.py

Only Excel files (.xlsx) are copied. A CompID is replaced wherever it appears as a whole word: in cell text, in cell
comments and in the file name. The script stops without writing a copy when the CompID column of a report holds a
CompID that is not in COMPID_KEY, or when a real CompID is still in the copy after replacement.
"""

import io
import re
import sys
import zipfile
from pathlib import Path

from bronze import load_key
from config import CODE_DIR

SOURCE_DIR = CODE_DIR.parent / "Clients_Conformance_Tests"
TARGET_DIR = SOURCE_DIR / "Fictitious_CompIDs"

# A CompID in these reports is four capital letters and two digits, e.g. a value of the column
# "Client Interface User ID (CompID)".
COMPID_PATTERN = re.compile(rb"(?<![A-Za-z0-9])[A-Z]{4}\d{2}(?![A-Za-z0-9])")


def replace_compids(xlsx: bytes, mapping: dict[str, str]) -> tuple[bytes, dict[str, int]]:
    """Returns the file with real CompIDs replaced, and how many times each real CompID was replaced."""
    names = "|".join(map(re.escape, sorted(mapping, key=len, reverse=True)))
    whole_word = re.compile(rf"(?<![A-Za-z0-9])({names})(?![A-Za-z0-9])".encode())
    anywhere = re.compile(names.encode())
    fictitious = {v.encode() for v in mapping.values()}
    counts: dict[str, int] = {}

    def swap(m: re.Match) -> bytes:
        real = m[1].decode()
        counts[real] = counts.get(real, 0) + 1
        return mapping[real].encode()

    source = zipfile.ZipFile(io.BytesIO(xlsx))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as target:
        for info in source.infolist():
            data = source.read(info)
            if info.filename.endswith((".xml", ".vml", ".rels")):
                data = whole_word.sub(swap, data)
                unknown = {t.decode() for t in COMPID_PATTERN.findall(data)} - {f.decode() for f in fictitious}
                if info.filename in ("xl/sharedStrings.xml",) and unknown:
                    raise SystemExit(f"{info.filename}: {', '.join(sorted(unknown))} look like CompIDs but are not in the key. "
                                     "Add them to the key, then run this again; no copy was written.")
            if anywhere.search(data):
                raise SystemExit(f"A real CompID is still in {info.filename} after replacement; no copy was written")
            target.writestr(info, data, compress_type=info.compress_type)
    return out.getvalue(), counts


def copy_name(name: str, mapping: dict[str, str], counts: dict[str, int]) -> str:
    """The copy's file name: real CompIDs in the name are replaced. A name with no CompID may hold another client
    identifier, such as a firm code, so that copy is named after the CompID used most in the report instead."""
    stem = Path(name).stem
    replaced = re.sub(r"(?<![A-Za-z0-9])[A-Z]{4}\d{2}(?![A-Za-z0-9])", lambda m: mapping.get(m[0], m[0]), stem)
    if replaced == stem:
        main = max(counts, key=counts.get) if counts else "no CompID"
        replaced = f"Volume 202 - Conformance Test Report - {mapping.get(main, main)}"
    return replaced + ".xlsx"


def main():
    mapping = load_key()
    TARGET_DIR.mkdir(exist_ok=True)
    files = sorted(p for p in SOURCE_DIR.glob("*.xlsx") if not p.name.startswith("~$"))
    if not files:
        sys.exit(f"No .xlsx files in {SOURCE_DIR}")
    for path in files:
        content, counts = replace_compids(path.read_bytes(), mapping)
        target = TARGET_DIR / copy_name(path.name, mapping, counts)
        target.write_bytes(content)
        replaced = ", ".join(f"{real} -> {mapping[real]} ({n})" for real, n in sorted(counts.items())) or "none"
        print(f"{path.name}\n  -> {target.name}\n  replaced: {replaced}")


if __name__ == "__main__":
    main()
