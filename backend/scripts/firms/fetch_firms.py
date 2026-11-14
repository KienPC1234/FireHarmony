"""Download real FIRMS active-fire CSVs (needs FIRMS_MAP_KEY).

Usage:
  export FIRMS_MAP_KEY=<key>   # https://firms.modaps.eosdis.nasa.gov/api/area/
  python -m scripts.firms.fetch_firms --bbox 104,10,109,16 --days 7
  python -m scripts.firms.fetch_firms --bbox -70,-12,-50,3 --days 10 --sources VIIRS_SNPP_NRT,MODIS_NRT --aoi amazon

Saves backend/data/firms/raw/<aoi>_<source>_<date>_<days>d.csv + sha256,
prints a QA summary, appends to data/firms/ingest_manifest.json.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))
from app.firms.schema import FirmsRecord  # noqa: E402
from app.firms.store import MANIFEST, RAW_DIR  # noqa: E402

SOURCES = ("MODIS_NRT", "MODIS_SP", "VIIRS_SNPP_NRT", "VIIRS_SNPP_SP",
           "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT")


def fetch_one(key: str, source: str, bbox: str, days: int,
              day: str | None = None, retries: int = 4) -> bytes:
    # Exact shape per https://firms.modaps.eosdis.nasa.gov/api/area/ :
    #   /api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north]/[DAY_RANGE][/DATE]
    url = (f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
           f"{key}/{source}/{bbox}/{days}")
    if day:
        url += f"/{day}"
    last: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:  # noqa: S310 - official NASA endpoint
                return r.read()
        except Exception as e:  # noqa: BLE001 - retried below
            last = e
            time.sleep(2 ** attempt)
    raise SystemExit(f"download failed after {retries} tries: {last}\nURL: .../{source}/{bbox}/{days}")


def qa_bytes(content: bytes, cap_errors: int = 5) -> dict:
    lines = content.decode("utf-8", errors="replace").splitlines()
    reader = csv.DictReader(lines)
    clean = rejected = 0
    errors: list[str] = []
    by_inst: dict[str, int] = {}
    for row in reader:
        try:
            rec = FirmsRecord(**{k.lower(): v for k, v in dict(row).items()})
            clean += 1
            by_inst[rec.instrument] = by_inst.get(rec.instrument, 0) + 1
        except Exception as e:  # noqa: BLE001 - counted
            rejected += 1
            if len(errors) < cap_errors:
                errors.append(str(e)[:120])
    return {"rows": clean + rejected, "clean": clean, "rejected": rejected,
            "by_instrument": by_inst, "errors": errors}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", required=True, help="minLon,minLat,maxLon,maxLat")
    ap.add_argument("--days", type=int, default=5, help="FIRMS day range 1..5")
    ap.add_argument("--date", default=None,
                    help="start date YYYY-MM-DD for archive pull (default: most recent)")
    ap.add_argument("--sources", default="VIIRS_SNPP_NRT,MODIS_NRT",
                    help="comma-separated subset of: " + ",".join(SOURCES))
    ap.add_argument("--aoi", default="custom")
    args = ap.parse_args()

    key = __import__("os").environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        print("Set FIRMS_MAP_KEY first (https://firms.modaps.eosdis.nasa.gov/api/area/).",
              file=sys.stderr)
        sys.exit(2)
    if not 1 <= args.days <= 5:
        sys.exit("--days must be 1..5 (FIRMS Area API limit)")

    sources = [s.strip() for s in args.sources.split(",") if s.strip()]
    bad = [s for s in sources if s not in SOURCES]
    if bad:
        sys.exit(f"unknown sources {bad}; choose from {list(SOURCES)}")

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    if MANIFEST.exists():
        try:
            manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            manifest = []

    for source in sources:
        content = fetch_one(key, source, args.bbox, args.days, args.date)
        digest = hashlib.sha256(content).hexdigest()[:16]
        daytag = args.date or date.today().isoformat()
        out = RAW_DIR / f"{args.aoi}_{source}_{daytag}_{args.days}d_{digest}.csv"
        if out.exists():
            print(f"skip (exists): {out.name}")
            continue
        out.write_bytes(content)
        report = qa_bytes(content)
        print(f"saved {out.name} ({len(content)} bytes) clean={report['clean']} "
              f"rejected={report['rejected']} {report['by_instrument']}")
        manifest.append({"file": out.name, "aoi": args.aoi, "source": source,
                         "bbox": args.bbox, "days": args.days,
                         "sha16": digest, "at": date.today().isoformat(),
                         **{k: v for k, v in report.items() if k != "errors"}})
    MANIFEST.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(f"manifest: {len(manifest)} entries")


if __name__ == "__main__":
    main()
