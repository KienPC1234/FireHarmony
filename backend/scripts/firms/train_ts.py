"""Train the temporal Transformer calibrator for one AOI and persist it.

Usage: python -m scripts.firms.train_ts --aoi vietnam --test-years 3
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import ml_cal, store, ts_transformer as tst  # noqa: E402

MODEL_DIR = BACKEND / "data" / "firms" / "models"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="vietnam")
    ap.add_argument("--test-years", type=int, default=3)
    ap.add_argument("--epochs", type=int, default=120)
    a = ap.parse_args()
    records = store.load_records(a.aoi, 100000)
    pairs = ml_cal.build_monthly_pairs(records)
    wins = tst.build_windows(pairs)
    res = tst.train_holdout(wins, test_years=a.test_years, epochs=a.epochs)
    res["training_source"] = "synthetic-sample"
    res["dataset_sha256"] = hashlib.sha256(
        json.dumps(pairs, sort_keys=True).encode("utf-8")).hexdigest()
    if not res.get("trained"):
        print(json.dumps({"trained": False, **{k: v for k, v in res.items() if k != 'model'}}, indent=1))
        return 2
    model = res.pop("model")
    paths = tst.save_artifact(model, res, a.aoi, MODEL_DIR)
    print(json.dumps({**{k: v for k, v in res.items()}, **paths}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
