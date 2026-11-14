"""Train SensorFormer Lite on committed monthly pairs.

    python -m scripts.firms.train_sf --data raw
    python -m scripts.firms.train_sf --data sample --epochs 160

Writes sf_lite_<tag>.pt + .json. This is the single served architecture:
SensorFormer = seasonal anchor + gated residual. The calendar serves the anchor
until the gate opens (>=2% mean gain and CI upper < 0), so a losing model is
never silently substituted for the anchor.
"""
from __future__ import annotations

import argparse
import json

from app.firms import sf_lite


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", choices=["raw", "sample"], default="raw")
    ap.add_argument("--epochs", type=int, default=200)
    a = ap.parse_args()
    meta = sf_lite.train(a.data, epochs=a.epochs)
    print(json.dumps({
        "method_id": meta["method_id"],
        "data": a.data,
        "n_train": meta["n_train"],
        "n_test": meta["n_test"],
        "params": meta["params"],
        "metrics": meta["metrics"],
        "b2_mae": meta["b2_mae"],
        "mean_gain_vs_b2": meta["mean_gain_vs_b2"],
        "deployed": meta["deployed"],
        "coverage80": meta["coverage80"],
        "ablation": meta["ablation"],
    }, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
