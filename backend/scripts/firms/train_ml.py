"""CLI: train the v3 log-ratio HGB calibrator for one AOI.

Usage:
    python -m scripts.firms.train_ml --aoi vietnam --data raw --test-years 2
    python -m scripts.firms.train_ml --aoi vietnam            # synthetic sample
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_DIR = BACKEND_DIR / "data" / "firms" / "models"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Train ML cross-sensor calibration")
    ap.add_argument("--aoi", default="vietnam")
    ap.add_argument("--test-years", dest="test_years", type=int, default=2)
    ap.add_argument("--model-dir", dest="model_dir", default=str(DEFAULT_MODEL_DIR))
    ap.add_argument("--limit", type=int, default=25000)
    ap.add_argument("--data", default="sample", choices=("sample", "raw"))
    ap.add_argument("--no-tune", dest="tune", action="store_false",
                    help="skip blocked CV (faster, default params)")
    args = ap.parse_args(argv)

    from app.firms import ml_cal, ml_v4, store
    from app.firms.store import load_records

    if args.data == "raw":
        pairs = ml_cal.build_monthly_pairs_iter(store.iter_raw_rows(args.aoi, limit=None))
    else:
        pairs = ml_cal.build_monthly_pairs(load_records(args.aoi, limit=args.limit))
    result = ml_v4.train_holdout(pairs, test_years=args.test_years, tune=args.tune)
    tag = "sample" if args.data == "sample" else "raw"
    result["training_source"] = ("synthetic-sample" if tag == "sample"
                                 else "nasa-firms-raw")
    result["data_fingerprint"] = (store.raw_fingerprint(args.aoi) if tag == "raw"
                                  else store.sample_fingerprint(args.aoi))
    result["feature_version"] = ml_v4.FEATURE_VERSION
    result["algorithm_version"] = ml_v4.ALGORITHM_VERSION
    result["dataset_sha256"] = hashlib.sha256(
        json.dumps(pairs, sort_keys=True).encode("utf-8")).hexdigest()
    out = {
        "aoi": args.aoi, "trained": bool(result.get("trained")),
        "n_pairs": len(pairs), "n_train": result.get("n_train"),
        "n_test": result.get("n_test"), "train_years": result.get("train_years"),
        "test_years": result.get("test_years"), "metrics": result.get("metrics", {}),
        "params": result.get("params"), "cv_best": (result.get("cv") or {}).get("best"),
        "residual_enabled": result.get("residual_enabled"),
        "residual_gate": result.get("residual_gate"),
    }
    if not result.get("trained"):
        out["reason"] = result.get("reason", "not_trained")
        print(json.dumps(out, indent=1))
        return 2
    # persist model + meta through ml_cal (joblib + JSON sidecar)
    meta = {k: v for k, v in result.items() if k != "model"}
    saved = ml_cal.save_artifact(result["model"], meta, args.aoi, args.model_dir, tag=tag)
    out.update(saved)
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
