"""Build (or verify) a small COMMITTED real-data benchmark from local raw pulls.

- Build: python -m scripts.firms.make_benchmark  (needs backend/data/firms/raw/*.csv)
  writes backend/data/firms/benchmark/real_mini_{aoi}.csv (1500 rows/AOI,
  round-robin = representative) + BENCHMARK.json (sources, ranges, sha256)
  + expected_pairs.csv (monthly MODIS/VIIRS totals from the FULL raw set).
- Check (CI-safe, no key): python -m scripts.firms.make_benchmark --check
  recomputes monthly pairs from the fixture and diffs against expected_pairs.csv.

The fixture is genuine NASA FIRMS rows (open data), small enough to commit,
so judges can reproduce a real-data validation without a MAP_KEY.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import ml_cal, store  # noqa: E402

BENCH_DIR = BACKEND / "data" / "firms" / "benchmark"
AOIS = ("vietnam", "amazon", "australia")
N_PER_AOI = 1500


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def build() -> int:
    BENCH_DIR.mkdir(parents=True, exist_ok=True)
    meta: dict = {"aois": {}, "sources": sorted(
        {e.get("source", "?") for e in json.loads(
            (store.MANIFEST).read_text())} if store.MANIFEST.exists() else [])}
    all_pairs: list[dict] = []
    for aoi in AOIS:
        full = store.load_raw_merged(aoi)  # interleaved, deduped
        if not full:
            print(f"WARN: no raw rows for {aoi}, skipping")
            continue
        sample = full[:N_PER_AOI]
        out = BENCH_DIR / f"real_mini_{aoi}.csv"
        fields = sorted({k for r in sample for k in r.keys()})
        with out.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(sample)
        pairs = ml_cal.build_monthly_pairs(full)
        for p in pairs:
            all_pairs.append({"aoi": aoi, **p})
        dates = sorted(str(r.get("acq_date", ""))[:10] for r in full)
        meta["aois"][aoi] = {"fixture": out.name, "fixture_rows": len(sample),
                             "full_rows": len(full),
                             "fixture_sha256": _sha(out),
                             "date_range": [dates[0], dates[-1]]}
    exp = BENCH_DIR / "expected_pairs.csv"
    with exp.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["aoi", "year", "month", "modis", "viirs"])
        w.writeheader()
        w.writerows(all_pairs)
    meta["expected_pairs"] = {"file": exp.name, "rows": len(all_pairs),
                              "sha256": _sha(exp)}
    (BENCH_DIR / "BENCHMARK.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(json.dumps(meta, indent=1)[:1500])
    print("BENCHMARK BUILD OK")
    return 0


def check() -> int:
    exp = BENCH_DIR / "expected_pairs.csv"
    if not exp.exists():
        print("no benchmark fixture; run build first")
        return 2
    recomputed: list[dict] = []
    for aoi in AOIS:
        p = BENCH_DIR / f"real_mini_{aoi}.csv"
        if not p.exists():
            continue
        with p.open(encoding="utf-8") as fh:
            rows = [{k.lower(): v for k, v in r.items()} for r in csv.DictReader(fh)]
        for pr in ml_cal.build_monthly_pairs(rows):
            recomputed.append({"aoi": aoi, **pr})
    # fixture pairs must be a SUBSET of full-data expected pairs (same months,
    # counts <= full counts since fixture is a prefix sample)
    exp_rows = {}
    with exp.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            exp_rows[(r["aoi"], int(r["year"]), int(r["month"]))] = (int(r["modis"]), int(r["viirs"]))
    bad = 0
    for r in recomputed:
        key = (r["aoi"], r["year"], r["month"])
        if key not in exp_rows:
            print(f"UNEXPECTED month {key}")
            bad += 1
        elif r["modis"] > exp_rows[key][0] or r["viirs"] > exp_rows[key][1]:
            print(f"OVERSHOOT {key}: fixture {r['modis']}/{r['viirs']} > full {exp_rows[key]}")
            bad += 1
    print(f"fixture months: {len(recomputed)}, violations: {bad}")
    print("BENCHMARK CHECK " + ("OK" if bad == 0 else "FAILED"))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    raise SystemExit(check() if a.check else build())
