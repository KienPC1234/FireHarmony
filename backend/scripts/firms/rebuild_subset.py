"""Rebuild the audited raw subset end to end (audit V6 P0-04).

Reads the 16 unmodified FIRMS CSVs in ``data/firms/raw_subset/vietnam_2025-01``,
checks their SHA-256, then runs the same validate -> dedup -> aggregate ->
ratio -> harmonize -> calendar path the API uses. The resulting month total,
cell counts and calibration state must equal ``expected.json``.

    python -m scripts.firms.rebuild_subset          # verify
    python -m scripts.firms.rebuild_subset --write  # refresh expected.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
SUBSET = BACKEND / "data" / "firms" / "raw_subset" / "vietnam_2025-01"
EXPECTED = SUBSET / "expected.json"
AOI = "vietnam"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check_checksums() -> None:
    manifest = SUBSET / "CHECKSUMS.sha256"
    if not manifest.exists():
        raise SystemExit(f"missing {manifest}")
    bad = []
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        digest, name = line.split(None, 1)
        path = SUBSET / name.strip()
        if not path.exists() or _sha256(path) != digest:
            bad.append(name.strip())
    if bad:
        raise SystemExit(f"checksum mismatch: {bad}")
    print(f"CHECKSUMS OK ({len(manifest.read_text().splitlines())} files)")


def build() -> dict:
    from app.firms import calendar as cal
    from app.firms import harmonize, store

    agg, stats = harmonize.aggregate_iter(
        store.iter_raw_rows(AOI, raw_dir=SUBSET))
    ratios = harmonize.estimate_efficiency_ratio(agg)
    daily = harmonize.harmonize_daily(agg, ratios)
    calen = cal.build_calendar(daily)
    years = calen["years"]
    yi, mi = years.index(2025), 0
    observed = sum(1 for c in daily if c.get("estimate_type") == "viirs_observed")
    estimated = sum(1 for c in daily
                    if c.get("estimate_type") == "modis_upscaled_estimated")
    return {
        "aoi": AOI,
        "month": "2025-01",
        "source": "NASA FIRMS Area API (MODIS C6.1 SP + VIIRS SNPP 375 m SP)",
        "files": len(list(SUBSET.glob("*.csv"))),
        "rows_clean": stats["clean"],
        "rows_rejected": stats["rejected"],
        "daily_cells": len(daily),
        "observed_cells": observed,
        "estimated_cells": estimated,
        "month_total": calen["matrix"][yi][mi],
        "k_used": ratios.get("2025-01"),
        "effective_k": ratios.get("2025-01", ratios.get("_fallback")),
        "fallback_k": ratios.get("_fallback"),
        "calibration_months": ratios.get("_n_months"),
        "calibration_status": ratios.get("_calibration_status"),
        "algorithm_version": harmonize.ALGORITHM_VERSION,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="refresh expected.json")
    a = ap.parse_args()
    check_checksums()
    got = build()
    if a.write:
        EXPECTED.write_text(json.dumps(got, indent=1) + "\n", encoding="utf-8")
        print("WROTE", EXPECTED)
        return 0
    want = json.loads(EXPECTED.read_text(encoding="utf-8"))
    diffs = {k: (want.get(k), v) for k, v in got.items()
             if k in want and want.get(k) != v}
    # Ignore new keys; every recorded field must match exactly.
    if diffs:
        for k, (old, new) in diffs.items():
            print(f"MISMATCH {k}: expected {old!r} got {new!r}")
        return 1
    print("SUBSET REBUILD OK", json.dumps(got, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
