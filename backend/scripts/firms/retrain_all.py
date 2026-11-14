"""Rebuild the served ML stack in dependency order.

Only three methods exist after the 2026-11-13 consolidation: STAN (primary),
B2 (baseline) and HTS (fallback/diagnostic). Archived/retrospective models and
their training scripts were removed.

    python -m scripts.firms.retrain_all            # full rebuild
    python -m scripts.firms.retrain_all --skip-tiles

Order:

1. `build_tiles`            raw CSVs -> 1-degree tile-months
2. `evaluation.evaluate`    frozen sample IDs + B0/B1/B2 manifest
3. `make_benchmark`         training_pairs / evaluation_samples / fixtures
4. `evaluate_hts`           HTS anchor metrics
5. `build_hts_series`       expanding HTS series (STAN's pre-2024 base)
6. `stan`                   primary weights + metrics (+ LOO)
7. `build_stan_series`      served targets + calibrated band
8. `unify_eval`             join STAN/HTS onto the same IDs
9. `make_benchmark`         refresh the committed sample CSV
10. `render_docs`           model card + README metrics block
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import evaluation, stan  # noqa: E402
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
    ap.add_argument("--skip-stan", action="store_true")
    a = ap.parse_args()

    if not a.skip_tiles:
        _run("1/10 build_tiles", lambda: build_tiles.build())
    if not a.skip_core_eval:
        _run("2/10 evaluate baselines",
             lambda: evaluation.evaluate(data="raw", test_years=2))
    _run("3/10 make_benchmark", lambda: make_benchmark.build())
    if not a.skip_hts:
        _run("4/10 evaluate_hts", lambda: evaluate_hts.main())
        _run("5/10 build_hts_series", lambda: build_hts_series.main())
    if not a.skip_stan:
        _run("6/10 stan (primary)", lambda: stan.main())
        _run("7/10 build_stan_series", lambda: build_stan_series.main())
    _run("8/10 unify_eval", lambda: unify_eval.run("both"))
    _run("9/10 make_benchmark (refresh)", lambda: make_benchmark.build())
    _run("10/10 render_docs", lambda: render_docs.run())
    print("\nretrain_all: DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
