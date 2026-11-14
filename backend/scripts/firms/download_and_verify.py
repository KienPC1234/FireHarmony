"""Reconstruct (or verify) a full-month FIRMS pull from URLs + checksums.

Audit P0-10: the zip cannot contain 650 MB of raw CSVs, so this script is the
documented path from a fresh MAP_KEY to the exact files the models used.

  python -m scripts.firms.download_and_verify --aoi vietnam \
      --bbox 104,10,109,16 --start-year 2019 --end-year 2025 --workers 4
  python -m scripts.firms.download_and_verify --verify-only --aoi vietnam

Every file is named `{aoi}_{source}_{start}_{days}d_{sha16}.csv`; the script
checks the sha16 in the filename and the manifest. It also prints the
manifest-derived coverage, including the historic day-31 gap.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import coverage, store  # noqa: E402
from scripts.firms.fetch_firms import fetch_one, qa_bytes, _load_dotenv  # noqa: E402
from scripts.firms.fetch_full_month import windows_for_month  # noqa: E402

SOURCES = ("MODIS_SP", "VIIRS_SNPP_SP")
LOCK = threading.Lock()


def _sha16(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()[:16]


def verify(aoi: str) -> dict:
    files = sorted(store.RAW_DIR.glob(f"{aoi}_*.csv")) if store.RAW_DIR.exists() else []
    manifest = {}
    if store.MANIFEST.exists():
        for e in json.loads(store.MANIFEST.read_text(encoding="utf-8")):
            if e.get("aoi") == aoi:
                manifest[e["file"]] = e
    bad = []
    checked = 0
    for f in files:
        content = f.read_bytes()
        digest = _sha16(content)
        checked += 1
        if digest not in f.name:
            bad.append({"file": f.name, "reason": "sha16_not_in_filename",
                        "actual": digest})
        elif f.name in manifest and manifest[f.name].get("sha16") != digest:
            bad.append({"file": f.name, "reason": "manifest_sha_mismatch"})
    cov = coverage.coverage_summary(aoi)
    return {"aoi": aoi, "files": checked, "bad": bad,
            "coverage": {k: cov[k] for k in ("months", "full_months",
                                             "partial_months", "missing_day_histogram")},
            "ledger": coverage.ledger_status(aoi, limit=5)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", required=True)
    ap.add_argument("--bbox")
    ap.add_argument("--start-year", type=int)
    ap.add_argument("--end-year", type=int)
    ap.add_argument("--sources", default=",".join(SOURCES))
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--verify-only", action="store_true")
    a = ap.parse_args()
    report = verify(a.aoi)
    if a.verify_only:
        print(json.dumps(report, indent=1)[:3000])
        return 0 if not report["bad"] else 1
    if not (a.bbox and a.start_year and a.end_year):
        print("need --bbox --start-year --end-year to download", file=sys.stderr)
        return 2
    _load_dotenv()
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        print("FIRMS_MAP_KEY missing", file=sys.stderr)
        return 2
    sources = [s.strip() for s in a.sources.split(",") if s.strip()]
    store.RAW_DIR.mkdir(parents=True, exist_ok=True)
    jobs = []
    for y in range(a.start_year, a.end_year + 1):
        for m in range(1, 13):
            for start, ndays in windows_for_month(y, m):
                day = f"{y}-{m:02d}-{start:02d}"
                for s in sources:
                    jobs.append((s, day, ndays))
    print(f"{len(jobs)} requests, {a.workers} workers")

    def task(source: str, day: str, ndays: int) -> str:
        content = fetch_one(key, source, a.bbox, ndays, day)
        digest = _sha16(content)
        out = store.RAW_DIR / f"{a.aoi}_{source}_{day}_{ndays}d_{digest}.csv"
        if out.exists():
            return "exists"
        out.write_bytes(content)
        y, m, d = (int(x) for x in day.split("-"))
        last = __import__("calendar").monthrange(y, m)[1]
        entry = {"file": out.name, "aoi": a.aoi, "source": source, "bbox": a.bbox,
                 "days": ndays, "sha16": digest, "rows": qa_bytes(content).get("rows", 0),
                 "start_day": d, "end_day": min(d + ndays - 1, last),
                 "days_in_month": last, "full_month_window": (d + ndays - 1) >= last}
        coverage.append_ledger({"aoi": a.aoi, "source": source, "start": day,
                                "days": ndays, "rows": entry["rows"],
                                "status": "success_rows" if entry["rows"] else "success_empty"})
        manifest = []
        with LOCK:
            if store.MANIFEST.exists():
                manifest = json.loads(store.MANIFEST.read_text(encoding="utf-8"))
            manifest.append(entry)
            store.MANIFEST.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
        return "saved"

    failed = 0
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = {ex.submit(task, *j): j for j in jobs}
        for f in as_completed(futs):
            try:
                f.result()
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"FAIL {futs[f]}: {e}")
    report = verify(a.aoi)
    print(json.dumps(report, indent=1)[:3000])
    return 0 if not report["bad"] and failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
