"""CLI: train monthly MODIS->VIIRS calibration for one AOI.

Usage:
    python -m scripts.firms.train_ml --aoi vietnam --test-years 3
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
    ap.add_argument("--test-years", dest="test_years", type=int, default=3)
    ap.add_argument("--model-dir", dest="model_dir", default=str(DEFAULT_MODEL_DIR))
    ap.add_argument("--limit", type=int, default=25000)
    args = ap.parse_args(argv)

    from app.firms import ml_cal
    from app.firms.store import load_records

    records = load_records(args.aoi, limit=args.limit)
    pairs = ml_cal.build_monthly_pairs(records)
    result = ml_cal.train_holdout(pairs, test_years=args.test_years)
    result["training_source"] = "synthetic-sample"
    result["dataset_sha256"] = hashlib.sha256(
        json.dumps(pairs, sort_keys=True).encode("utf-8")).hexdigest()
    out = {
        "aoi": args.aoi,
        "trained": bool(result.get("trained")),
        "n_pairs": len(pairs),
        "n_train": result.get("n_train"),
        "n_test": result.get("n_test"),
        "train_years": result.get("train_years"),
        "test_years": result.get("test_years"),
        "metrics": result.get("metrics", {}),
    }
    if not result.get("trained"):
        out["reason"] = result.get("reason", "not_trained")
        print(json.dumps(out, indent=1))
        return 2
    saved = ml_cal.save_artifact(result["model"], result, args.aoi, args.model_dir)
    out.update(saved)
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
