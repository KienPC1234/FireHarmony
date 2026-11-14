"""CLI: train the pooled log-ratio Transformer (ts_logratio_pool_v2).

Pools windows from every AOI that has data, with an AOI embedding, so the
model sees ~220 windows instead of ~73. Early stopping uses the last training
year (never the holdout).

Usage:
    python -m scripts.firms.train_ts --aoi vietnam --data raw --test-years 2
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import ml_cal, store, ts_v2  # noqa: E402

MODEL_DIR = BACKEND / "data" / "firms" / "models"
AOIS = ("vietnam", "amazon", "australia")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="vietnam")
    ap.add_argument("--test-years", type=int, default=2)
    ap.add_argument("--epochs", type=int, default=180)
    ap.add_argument("--data", default="sample", choices=("sample", "raw"))
    ap.add_argument("--single-aoi", action="store_true",
                    help="no pooling (ablation / spatial-transfer baseline)")
    a = ap.parse_args(argv)
    wins: list[dict] = []
    pooled: list[str] = []
    targets = [a.aoi] if a.single_aoi else list(AOIS)
    for name in targets:
        if a.data == "raw":
            from app.firms import coverage
            pairs = ml_cal.build_monthly_pairs_iter(
                store.iter_raw_rows(name, limit=None))
            eligible = coverage.eligible_pair_months(name)
            if len(eligible) >= 24:
                pairs = [p for p in pairs
                         if f"{p['year']}-{p['month']:02d}" in eligible]
        else:
            pairs = ml_cal.build_monthly_pairs(store.load_records(name, 100000))
        w = ts_v2.build_windows(pairs, aoi=name)
        if w:
            wins += w
            pooled.append(name)
    res = ts_v2.train_pooled(wins, test_years=a.test_years, epochs=a.epochs)
    tag = "sample" if a.data == "sample" else "raw"
    res["training_source"] = ("synthetic-sample" if tag == "sample" else "nasa-firms-raw")
    res["data_fingerprint"] = (store.pooled_fingerprint(store.AOIS) if tag == "raw"
                               else store.pooled_fingerprint(store.AOIS, raw=False))
    res["feature_version"] = ts_v2.FEATURE_VERSION
    res["algorithm_version"] = ts_v2.ALGORITHM_VERSION
    res["dataset_sha256"] = hashlib.sha256(
        json.dumps([{k: w[k] for k in ("year", "month", "aoi", "y")} for w in wins],
                   sort_keys=True).encode()).hexdigest()
    out = {k: v for k, v in res.items() if k not in ("models",)}
    out["aoi"] = a.aoi
    out["pooled_aois"] = pooled
    if not res.get("trained"):
        print(json.dumps(out, indent=1))
        return 2
    # A pooled model is one set of weights for every AOI it trained on; save a
    # per-AOI sidecar so /ts-status and _block_raw_ml_ts work for each region
    # instead of only the --aoi passed on the command line.
    paths = []
    for name in (pooled or [a.aoi]):
        paths.append(ts_v2.save_artifact(res["models"], res, name, MODEL_DIR, tag=tag))
    out["saved"] = paths
    if paths:
        out.update(paths[0])
    print(json.dumps(out, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
