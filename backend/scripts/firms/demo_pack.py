"""Build / verify / install the small checksum-pinned FIRMS demo pack.

The full raw pull is hundreds of MB and is not committed.  A submission ZIP
therefore ships a *demo pack*: a contiguous month range for one AOI, copied
from an existing raw pull, with SHA-256 hashes and row counts in
``manifest.json``.  This is a real NASA FIRMS subset, not the synthetic sample,
so the calendar / map / evidence / export journey can be exercised end to end.

Commands
--------
    python -m scripts.firms.demo_pack build --aoi vietnam \
        --from 2024-01 --to 2025-12
    python -m scripts.firms.demo_pack verify
    python -m scripts.firms.demo_pack install [--force]

``install`` copies the pack files into ``backend/data/firms/raw/``; the API
then reports ``dataset_ready=true`` for months covered by the pack.  Request
coverage (the manifest ledger) is deliberately not inferred from the pack.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data" / "firms"
RAW_DIR = DATA_DIR / "raw"
PACK_DIR = DATA_DIR / "demo_pack"
PACK_RAW = PACK_DIR / "raw"
MANIFEST = PACK_DIR / "manifest.json"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _rows(path: Path) -> int:
    with path.open(encoding="utf-8", errors="replace") as fh:
        return max(sum(1 for _ in fh) - 1, 0)


def _month(name: str) -> str | None:
    # vietnam_MODIS_SP_2024-01-01_5d_<hash>.csv
    parts = name.split("_")
    for part in parts:
        if len(part) >= 7 and part[4] == "-" and part[:4].isdigit():
            return part[:7]
    return None


def build(aoi: str, start: str, end: str, force: bool) -> int:
    if not RAW_DIR.exists():
        print(f"No raw directory at {RAW_DIR}; fetch a month first.", file=sys.stderr)
        return 2
    files = []
    for p in sorted(RAW_DIR.glob(f"{aoi}_*.csv")):
        ym = _month(p.name)
        if ym and start <= ym <= end:
            files.append(p)
    if not files:
        print(f"No raw files for {aoi} in {start}..{end}.", file=sys.stderr)
        return 2
    if PACK_RAW.exists():
        if not force:
            print(f"{PACK_RAW} already exists; pass --force to rebuild.", file=sys.stderr)
            return 2
        shutil.rmtree(PACK_RAW)
    PACK_RAW.mkdir(parents=True, exist_ok=True)

    entries = []
    for src in files:
        dst = PACK_RAW / src.name
        shutil.copy2(src, dst)
        entries.append({"name": src.name, "sha256": _sha256(dst),
                        "bytes": dst.stat().st_size, "rows": _rows(dst),
                        "month": _month(dst.name)})
    months = sorted({e["month"] for e in entries if e["month"]})
    total = sum(e["bytes"] for e in entries)
    combined = hashlib.sha256(
        "".join(e["sha256"] for e in sorted(entries, key=lambda x: x["name"])).encode()
    ).hexdigest()
    manifest = {
        "dataset_id": f"{aoi}-{months[0]}_{months[-1]}",
        "aoi": aoi,
        "from_month": months[0],
        "to_month": months[-1],
        "months": len(months),
        "files": len(entries),
        "rows": sum(e["rows"] for e in entries),
        "bytes": total,
        "source": ("NASA FIRMS active-fire CSV subset (public domain). "
                   "Hotspot records are not individual fires."),
        "dataset_ready": True,
        "request_coverage": "not inferred from this pack; see /api/firms/coverage",
        "observation_coverage": "unknown (no cloud/footprint product in this pack)",
        "built_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "checksum_sha256": combined,
        "entries": entries,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"demo pack {manifest['dataset_id']}: {len(entries)} files, "
          f"{manifest['rows']} rows, {total / 1e6:.1f} MB, sha256 {combined[:16]}")
    return 0


def verify() -> int:
    if not MANIFEST.exists():
        print(f"Missing {MANIFEST}", file=sys.stderr)
        return 2
    m = json.loads(MANIFEST.read_text(encoding="utf-8"))
    bad = []
    for e in m.get("entries", []):
        p = PACK_RAW / e["name"]
        if not p.exists():
            bad.append(f"{e['name']}: missing")
            continue
        if p.stat().st_size != e["bytes"]:
            bad.append(f"{e['name']}: size changed")
        if _sha256(p) != e["sha256"]:
            bad.append(f"{e['name']}: sha256 mismatch")
    combined = hashlib.sha256(
        "".join(e["sha256"] for e in sorted(m.get("entries", []),
                                             key=lambda x: x["name"])).encode()
    ).hexdigest()
    if combined != m.get("checksum_sha256"):
        bad.append("combined checksum mismatch")
    if bad:
        print("DEMO PACK VERIFY FAILED", file=sys.stderr)
        for b in bad[:20]:
            print(" -", b, file=sys.stderr)
        return 1
    print(f"DEMO PACK VERIFY OK ({m['months']} months, {m['files']} files, "
          f"{m['rows']} rows, sha256 {combined[:16]})")
    return 0


def install(force: bool) -> int:
    if verify() != 0:
        return 1
    m = json.loads(MANIFEST.read_text(encoding="utf-8"))
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    copied = 0
    for e in m["entries"]:
        dst = RAW_DIR / e["name"]
        if dst.exists() and not force:
            continue
        shutil.copy2(PACK_RAW / e["name"], dst)
        copied += 1
    print(f"Installed {copied} demo files into {RAW_DIR} "
          f"(dataset_ready=true for {m['from_month']}..{m['to_month']}).")
    print("Request coverage is unchanged: this pack is data, not a ledger.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--aoi", default="vietnam")
    b.add_argument("--from", dest="start", required=True)
    b.add_argument("--to", dest="end", required=True)
    b.add_argument("--force", action="store_true")
    sub.add_parser("verify")
    i = sub.add_parser("install")
    i.add_argument("--force", action="store_true")
    args = ap.parse_args()
    if args.cmd == "build":
        return build(args.aoi, args.start, args.end, args.force)
    if args.cmd == "verify":
        return verify()
    return install(args.force)


if __name__ == "__main__":
    raise SystemExit(main())
