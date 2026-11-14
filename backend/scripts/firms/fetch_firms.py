"""Fetch real FIRMS active-fire CSV for an AOI (needs MAP_KEY).

Usage:
  export FIRMS_MAP_KEY=<key from https://firms.modaps.eosdis.nasa.gov/api/area/>
  python -m scripts.firms.fetch_firms --source VIIRS_SNPP_NRT --bbox 104,10,109,16 --days 7

Writes backend/data/firms/raw/<source>_<date>.csv with original FIRMS headers.
Then validate with POST /api/firms/validate.
"""
from __future__ import annotations

import argparse
import os
import sys
import urllib.request
from datetime import date
from pathlib import Path

SOURCES = ("MODIS_NRT", "MODIS_SP", "VIIRS_SNPP_NRT", "VIIRS_SNPP_SP",
           "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="VIIRS_SNPP_NRT", choices=SOURCES)
    ap.add_argument("--bbox", default="104,10,109,16",
                    help="minLon,minLat,maxLon,maxLat")
    ap.add_argument("--days", type=int, default=7)
    args = ap.parse_args()

    key = os.getenv("FIRMS_MAP_KEY", "").strip()
    if not key:
        print("Set FIRMS_MAP_KEY first (https://firms.modaps.eosdis.nasa.gov/api/area/).",
              file=sys.stderr)
        sys.exit(2)
    url = (f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/"
           f"{args.source}/{args.bbox}/{args.days}")
    out = (Path(__file__).resolve().parents[2] / "data" / "firms" / "raw"
           / f"{args.source}_{date.today().isoformat()}.csv")
    out.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, out)  # noqa: S310 - official NASA endpoint
    print(f"saved -> {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
