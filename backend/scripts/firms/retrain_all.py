"""Rebuild the whole served ML stack in dependency order.

The old workflow needed eight remembered commands in a specific order; getting
it wrong silently mixed artifacts from different data pulls. This script is the
one entry point:

    python -m scripts.firms.retrain_all                 # full rebuild
    python -m scripts.firms.retrain_all --skip-tiles    # reuse tile CSV
    python -m scripts.firms.retrain_all --with-sf       # also retrain the comparator

Order (each step reads the artifact of the previous one):

1. `build_tiles`            raw CSVs -> 1-degree tile-months
2. `evaluation.evaluate`    frozen sample IDs + B0/B1/B2/HGB/TS manifest
3. `make_benchmark`         training_pairs / evaluation_samples / fixtures
4. `evaluate_hts`           HTS anchor metrics (candidate/fallback)
5. `build_hts_series`       expanding HTS series (STAN's pre-2024 base)
6. `spatial_hgb`            retrospective comparator
7. `stan`                   primary model weights + metrics (+ LOO)
8. `build_stan_series`      served targets + calibrated band
9. `unify_eval`             join every method onto the same IDs
10. `make_benchmark`         refresh the committed sample CSV from the final manifest
11. `render_docs`            model card + README metrics block (+ --check)

Nothing is served until step 8; steps 9-11 only publish numbers.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import evaluation, spatial_hgb, stan  # noqa: E402
from scripts.firms import (build_hts_series, build_stan_series, build_tiles,  # noqa: E402
                           evaluate_hts, make_benchmark, render_docs,
                           unify_eval)


def _run(name: str, fn) -> None:
    t0 = time.perf_counter()
    print(f"\n=== {name} ===", flush=True)
    fn()
    print(f"--- {name}: {time.perf_counter() - t0:.1f}s", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-tiles", action="store_true")
    ap.add_argument("--skip-core-eval", action="store_true")
    ap.add_argument("--skip-hts", action="store_true")
    ap.add_argument("--skip-spatial", action="store_true")
    ap.add_argument("--skip-stan", action="store_true")
    ap.add_argument("--with-sf", action="store_true",
                    help="also retrain the SensorFormer comparator (slow, not served)")
    ap.add_argument("--with-archive", action="store_true",
                    help="also refresh archived HGB/TS raw artifacts (method=ml/ts)")
    a = ap.parse_args()

    if not a.skip_tiles:
        _run("1/11 build_tiles", lambda: build_tiles.build())
    if not a.skip_core_eval:
        _run("2/11 evaluate core methods",
             lambda: evaluation.evaluate(data="raw", test_years=2, epochs=140))
    _run("3/11 make_benchmark", lambda: make_benchmark.build())
    if not a.skip_hts:
        _run("4/11 evaluate_hts", lambda: evaluate_hts.main())
        _run("5/11 build_hts_series", lambda: build_hts_series.main())
    if not a.skip_spatial:
        _run("6/11 spatial_hgb", lambda: spatial_hgb.main())
    if not a.skip_stan:
        _run("7/11 stan (primary)", lambda: stan.main())
        _run("8/11 build_stan_series", lambda: build_stan_series.main())
    _run("9/11 unify_eval", lambda: unify_eval.run("both"))
    # Refresh the committed sample CSV from the FINAL manifest: the early build
    # necessarily carried stale artifact columns, which would fail --check.
    _run("10/11 make_benchmark (refresh)", lambda: make_benchmark.build())
    _run("11/11 render_docs", lambda: render_docs.run())
    if a.with_sf:
        from app.firms import sf_lite
        _run("optional: sf_lite comparator", lambda: sf_lite.train("raw"))
    if a.with_archive:
        from scripts.firms import train_ml, train_ts
        for aoi in ("vietnam", "amazon", "australia"):
            _run(f"optional: archive HGB {aoi}",
                 lambda aoi=aoi: train_ml.main(
                     ["--aoi", aoi, "--data", "raw", "--test-years", "2"]))
        _run("optional: archive TS",
             lambda: train_ts.main(["--data", "raw", "--test-years", "2"]))
    print("\nretrain_all: DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
