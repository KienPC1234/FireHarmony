"""Train the Seasonal-Residual Former (experimental transformer).

    python -m scripts.firms.train_srf --data raw

The artifact is diagnostics-only; `srf.train` never marks it deployed unless it
passes the same gate as the served models.
"""
from __future__ import annotations

import argparse
import json

from app.firms import srf


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", choices=["raw", "sample"], default="raw")
    ap.add_argument("--epochs", type=int, default=180)
    a = ap.parse_args()
    meta = srf.train(a.data, epochs=a.epochs)
    print(json.dumps({k: meta[k] for k in (
        "method_id", "data_tag", "n_train", "n_test", "params", "metrics",
        "per_aoi", "b2_mae", "mean_gain_vs_b2", "deployed", "coverage80",
        "lambda_by_aoi")}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
