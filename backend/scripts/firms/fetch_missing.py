"""Fetch only the days that the manifest shows were never requested.

Unlike `fetch_full_month` (which re-requests whole months), this script diffs
the request ledger against every calendar day of the target range and fetches
just the missing intervals (max 5 days per API request). That is how the
historic day-31 gap and australia's missing windows get repaired without
re-downloading a million rows.

Usage:
  python -m scripts.firms.fetch_missing --aoi vietnam --bbox 104,10,109,16 \
      --start-year 2019 --end-year 2025 --sources MODIS_SP,VIIRS_SNPP_SP \
      --workers 2 --max-requests 300
  python -m scripts.firms.fetch_missing --aoi australia --bbox 113,-39,153,-12 \
      --start-year 2019 --end-year 2025 --workers 2
  python -m scripts.firms.fetch_missing --aoi all --dry-run
"""
from __future__ import annotations

import argparse
import calendar
import hashlib
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import coverage, store  # noqa: E402
from scripts.firms.fetch_firms import fetch_one, qa_bytes, _load_dotenv  # noqa: E402

LOCK = threading.Lock()
AOI_BBOX = {
    "vietnam": "104,10,109,16",
    "amazon": "-70,-12,-50,3",
    "australia": "113,-39,153,-12",
}
SOURCES = ("MODIS_SP", "VIIRS_SNPP_SP")


def intervals(missing: list[int], max_days: int = 5) -> list[tuple[int, int]]:
    """Group sorted day numbers into [(start, length), ...]."""
    out: list[tuple[int, int]] = []
    i = 0
    while i < len(missing):
        start = missing[i]
        last = start
        while i + 1 < len(missing) and missing[i + 1] == last + 1 and last - start + 1 < max_days:
            i += 1
            last = missing[i]
        out.append((start, last - start + 1))
        i += 1
    return out


def plan(aoi: str, start_year: int, end_year: int, sources: list[str]) -> list[dict]:
    manifest = coverage.load_manifest()
    requested = coverage.requested_days(aoi, manifest)
    jobs: list[dict] = []
    for y in range(start_year, end_year + 1):
        for m in range(1, 13):
            last = calendar.monthrange(y, m)[1]
            ym = f"{y}-{m:02d}"
            for src in sources:
                have = requested.get(ym, {}).get(src, set())
                missing = [d for d in range(1, last + 1) if d not in have]
                for start, ndays in intervals(missing):
                    jobs.append({"aoi": aoi, "source": src,
                                 "start": f"{y}-{m:02d}-{start:02d}",
                                 "days": ndays, "last": last})
    return jobs


def task(key: str, job: dict, bbox: str) -> dict:
    content = fetch_one(key, job["source"], bbox, job["days"], job["start"])
    full_digest = hashlib.sha256(content).hexdigest()
    digest = full_digest[:16]
    name = f"{job['aoi']}_{job['source']}_{job['start']}_{job['days']}d_{digest}.csv"
    out = store.RAW_DIR / name
    if out.exists():
        with LOCK:
            manifest = []
            if store.MANIFEST.exists():
                try:
                    manifest = json.loads(store.MANIFEST.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    manifest = []
            if not any(e.get("file") == name for e in manifest):
                y, m, d = (int(x) for x in job["start"].split("-"))
                manifest.append({"file": name, "aoi": job["aoi"],
                                 "source": job["source"], "bbox": bbox,
                                 "days": job["days"], "sha16": digest,
                                 "sha256": full_digest,
                                 "rows": 0, "clean": 0, "rejected": 0,
                                 "start_day": d,
                                 "end_day": min(d + job["days"] - 1, job["last"]),
                                 "days_in_month": job["last"],
                                 "at": date.today().isoformat(),
                                 "backfill": True})
                store._atomic_write_json(store.MANIFEST, manifest)
        return {"file": name, "skipped": True, "status": "skipped", "rows": 0}
    out.write_bytes(content)
    rep = qa_bytes(content)
    y, m, d = (int(x) for x in job["start"].split("-"))
    entry = {"file": name, "aoi": job["aoi"], "source": job["source"],
             "bbox": bbox, "days": job["days"], "sha16": digest,
             "sha256": full_digest,
             "rows": rep.get("rows", 0), "clean": rep.get("clean", 0),
             "rejected": rep.get("rejected", 0),
             "start_day": d, "end_day": min(d + job["days"] - 1, job["last"]),
             "days_in_month": job["last"],
             "full_month_window": (d + job["days"] - 1) >= job["last"],
             "at": date.today().isoformat(), "backfill": True}
    with LOCK:
        manifest = []
        if store.MANIFEST.exists():
            try:
                manifest = json.loads(store.MANIFEST.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                manifest = []
        manifest.append(entry)
        store._atomic_write_json(store.MANIFEST, manifest)
        coverage.append_ledger({"aoi": job["aoi"], "source": job["source"],
                                "start": job["start"], "days": job["days"],
                                "rows": rep.get("rows", 0),
                                "status": ("success_rows" if rep.get("rows", 0)
                                           else "success_empty"),
                                "backfill": True,
                                "at": date.today().isoformat()})
    return {"file": name, "skipped": False, "status": "saved",
            "rows": rep.get("rows", 0), **rep}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="vietnam")
    ap.add_argument("--bbox")
    ap.add_argument("--start-year", type=int, default=2019)
    ap.add_argument("--end-year", type=int, default=2025)
    ap.add_argument("--sources", default=",".join(SOURCES))
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--max-requests", type=int, default=0)
    ap.add_argument("--delay", type=float, default=0.15)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    sources = [s.strip() for s in a.sources.split(",") if s.strip()]
    aois = list(AOI_BBOX) if a.aoi == "all" else [a.aoi]
    all_jobs = []
    for aoi in aois:
        bbox = a.bbox or AOI_BBOX.get(aoi)
        if not bbox:
            print(f"need --bbox for {aoi}", file=sys.stderr)
            return 2
        jobs = plan(aoi, a.start_year, a.end_year, sources)
        print(f"{aoi}: {len(jobs)} missing intervals")
        all_jobs += [(aoi, bbox, j) for j in jobs]
    if a.max_requests and len(all_jobs) > a.max_requests:
        print(f"limiting to {a.max_requests} requests this run")
        all_jobs = all_jobs[:a.max_requests]
    if a.dry_run:
        for aoi, bbox, j in all_jobs[:50]:
            print(aoi, j["source"], j["start"], j["days"])
        print(f"dry-run: {len(all_jobs)} requests")
        return 0
    _load_dotenv()
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        print("FIRMS_MAP_KEY missing", file=sys.stderr)
        return 2
    store.RAW_DIR.mkdir(parents=True, exist_ok=True)
    failed = saved = rows = 0

    def guarded(aoi: str, bbox: str, job: dict) -> dict:
        if a.delay:
            time.sleep(a.delay)
        return task(key, job, bbox)

    with ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex:
        futs = {ex.submit(guarded, aoi, bbox, job): (aoi, job)
                for aoi, bbox, job in all_jobs}
        for i, f in enumerate(as_completed(futs), 1):
            aoi, job = futs[f]
            try:
                r = f.result()
                saved += 0 if r.get("skipped") else 1
                rows += r.get("rows", 0)
            except Exception as e:  # noqa: BLE001
                failed += 1
                coverage.append_ledger({"aoi": aoi, "source": job["source"],
                                        "start": job["start"], "days": job["days"],
                                        "status": "failed", "error": str(e)[:200],
                                        "backfill": True,
                                        "at": date.today().isoformat()})
                print(f"FAIL {aoi} {job['source']} {job['start']}: {e}")
            if i % 50 == 0:
                print(f"  {i}/{len(all_jobs)} saved={saved} rows={rows} failed={failed}")
    print(f"DONE saved={saved} rows={rows} failed={failed}")
    for aoi in aois:
        s = coverage.coverage_summary(aoi)
        print(f"{aoi}: months={s['months']} full={s['full_months']} "
              f"partial={s['partial_months']} missing={s['missing_day_histogram']}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
