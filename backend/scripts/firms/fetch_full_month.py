"""Full-month FIRMS pulls: stitch 5-day windows covering every day of a month.

The Area API caps a request at 5 days. The previous version hard-coded starts
(1, 6, 11, 16, 21, 26), which stops at day 30 and never asks for day 31 —
a real coverage defect that audit P0-03 caught. This version derives the
window list from `calendar.monthrange`, clamps the request length to the
month's last day, and records the exact requested interval in the manifest.

It also appends every outcome (success_rows / success_empty / failed) to
`request_ledger.jsonl`, so "we looked and saw nothing" is distinguishable
from "we never asked".

Usage:
  python -m scripts.firms.fetch_full_month --aoi vietnam --bbox 104,10,109,16 \
      --start-year 2019 --end-year 2025 --sources MODIS_SP,VIIRS_SNPP_SP --workers 4
"""
from __future__ import annotations

import argparse
import calendar
import hashlib
import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import coverage, store  # noqa: E402
from scripts.firms.fetch_firms import fetch_one, qa_bytes, _load_dotenv  # noqa: E402

LOCK = threading.Lock()
WINDOW_DAYS = 5


def windows_for_month(year: int, month: int) -> list[tuple[int, int]]:
    """[(start_day, actual_days), ...] covering 1..last_day exactly once."""
    last = calendar.monthrange(year, month)[1]
    out: list[tuple[int, int]] = []
    start = 1
    while start <= last:
        ndays = min(WINDOW_DAYS, last - start + 1)
        out.append((start, ndays))
        start += WINDOW_DAYS
    return out


def task(key: str, source: str, bbox: str, day: str, ndays: int, aoi: str) -> dict:
    content = fetch_one(key, source, bbox, ndays, day)
    full_digest = hashlib.sha256(content).hexdigest()
    digest = full_digest[:16]
    out = store.RAW_DIR / f"{aoi}_{source}_{day}_{ndays}d_{digest}.csv"
    if out.exists():
        _ensure_manifest_entry(out.name, aoi, source, bbox, day, ndays, digest, full_digest)
        return {"file": out.name, "skipped": True, "clean": 0, "status": "skipped"}
    out.write_bytes(content)
    rep = qa_bytes(content)
    y, m, d = (int(x) for x in day.split("-"))
    last = calendar.monthrange(y, m)[1]
    entry = {"file": out.name, "aoi": aoi, "source": source, "bbox": bbox,
             "days": ndays, "sha16": digest, "sha256": full_digest,
             "at": date.today().isoformat(),
             "start_day": d, "end_day": min(d + ndays - 1, last),
             "days_in_month": last,
             "full_month_window": (d + ndays - 1) >= last,
             **{k: v for k, v in rep.items() if k != "errors"}}
    with LOCK:
        manifest = []
        if store.MANIFEST.exists():
            try:
                manifest = json.loads(store.MANIFEST.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                manifest = []
        if not any(e.get("file") == entry["file"] for e in manifest):
            manifest.append(entry)
            store._atomic_write_json(store.MANIFEST, manifest)
        coverage.append_ledger({"aoi": aoi, "source": source, "start": day,
                                "days": ndays, "rows": int(rep.get("rows", 0)),
                                "status": "success_rows" if rep.get("rows", 0) else "success_empty",
                                "at": date.today().isoformat()})
    return {"file": out.name, "skipped": False, "status": "saved", **rep}


def _ensure_manifest_entry(fname: str, aoi: str, source: str, bbox: str,
                           day: str, ndays: int, digest: str, full_digest: str) -> None:
    """Self-heal: a re-run that finds the CSV but no manifest row must log it."""
    with LOCK:
        manifest = []
        if store.MANIFEST.exists():
            try:
                manifest = json.loads(store.MANIFEST.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                manifest = []
        if any(e.get("file") == fname for e in manifest):
            return
        y, m, d = (int(x) for x in day.split("-"))
        last = calendar.monthrange(y, m)[1]
        manifest.append({"file": fname, "aoi": aoi, "source": source,
                         "bbox": bbox, "days": ndays, "sha16": digest,
                         "sha256": full_digest, "at": date.today().isoformat(),
                         "start_day": d, "end_day": min(d + ndays - 1, last),
                         "days_in_month": last, "backfilled": True})
        store._atomic_write_json(store.MANIFEST, manifest)
        coverage.append_ledger({"aoi": aoi, "source": source, "start": day,
                                "days": ndays, "rows": 0,
                                "status": "success_empty", "backfilled": True,
                                "at": date.today().isoformat()})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", required=True)
    ap.add_argument("--bbox", required=True)
    ap.add_argument("--start-year", type=int, required=True)
    ap.add_argument("--end-year", type=int, required=True)
    ap.add_argument("--sources", default="MODIS_SP,VIIRS_SNPP_SP")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    _load_dotenv()
    import os
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        print("FIRMS_MAP_KEY missing", file=sys.stderr)
        return 2
    store.RAW_DIR.mkdir(parents=True, exist_ok=True)
    sources = [s.strip() for s in a.sources.split(",") if s.strip()]
    jobs = []
    for y in range(a.start_year, a.end_year + 1):
        for m in range(1, 13):
            for start, ndays in windows_for_month(y, m):
                day = f"{y}-{m:02d}-{start:02d}"
                for s in sources:
                    jobs.append((key, s, a.bbox, day, ndays, a.aoi))
    print(f"{len(jobs)} requests, {a.workers} workers")
    saved = rows = failed = 0
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = {ex.submit(task, *j): j for j in jobs}
        for i, f in enumerate(as_completed(futs), 1):
            try:
                r = f.result()
                if not r.get("skipped"):
                    saved += 1
                    rows += r.get("clean", 0)
            except Exception as e:  # noqa: BLE001 - report, ledger, continue
                failed += 1
                job = futs[f]
                coverage.append_ledger({"aoi": job[5], "source": job[1],
                                        "start": job[3], "days": job[4],
                                        "status": "failed", "error": str(e)[:200],
                                        "at": date.today().isoformat()})
                print(f"FAIL {job[1]} {job[3]}: {e}")
            if i % 100 == 0:
                print(f"  {i}/{len(jobs)} saved={saved} rows={rows} failed={failed}")
    print(f"DONE saved={saved} clean_rows={rows} failed={failed}")
    summary = coverage.coverage_summary(a.aoi)
    print(f"COVERAGE months={summary['months']} full={summary['full_months']} "
          f"partial={summary['partial_months']} missing_days={summary['missing_day_histogram']}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
