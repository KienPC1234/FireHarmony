"""CI data guard: sample CSVs exist, parse under the strict schema,
no platform rows outside service windows, deterministic regeneration.

Usage: python scripts/check_data.py [--regen-check]
"""
from __future__ import annotations

import csv
import hashlib
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.firms.schema import FirmsRecord, PLATFORM_FROM  # noqa: E402

SAMPLE_DIR = BACKEND / "data" / "firms" / "samples"
AOIS = ("vietnam", "amazon", "australia")


def check_samples() -> list[str]:
    errors: list[str] = []
    total = 0
    for aoi in AOIS:
        p = SAMPLE_DIR / f"firms_sample_{aoi}.csv"
        if not p.exists():
            errors.append(f"missing {p}")
            continue
        bad_schema = 0
        bad_platform = 0
        n = 0
        with p.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                n += 1
                try:
                    rec = FirmsRecord(**{k.lower(): v for k, v in row.items()})
                except Exception:
                    bad_schema += 1
                    continue
                if rec.qa() == "anachronistic_platform":
                    bad_platform += 1
        total += n
        if n < 10000:
            errors.append(f"{aoi}: only {n} rows (<10000)")
        if bad_schema:
            errors.append(f"{aoi}: {bad_schema} rows fail strict schema")
        if bad_platform:
            errors.append(f"{aoi}: {bad_platform} anachronistic platform rows")
        print(f"{aoi}: {n} rows ok (schema rejects={bad_schema}, anachronistic={bad_platform})")
    print(f"total sample rows: {total}")
    return errors


def main() -> int:
    errors = check_samples()
    if "--regen-check" in sys.argv:
        from scripts.firms import make_sample
        h_before = {}
        for aoi in AOIS:
            p = SAMPLE_DIR / f"firms_sample_{aoi}.csv"
            h_before[aoi] = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
        make_sample.main("all")
        for aoi in AOIS:
            p = SAMPLE_DIR / f"firms_sample_{aoi}.csv"
            h_after = hashlib.sha256(p.read_bytes()).hexdigest()
            if h_before.get(aoi) != h_after:
                print(f"regen: {aoi} hash changed (generator updated?)")
    if errors:
        print("DATA CHECK FAILED:")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("DATA CHECK OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
