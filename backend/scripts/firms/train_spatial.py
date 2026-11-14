"""CLI: leave-one-region-out spatial transfer test (no AOI embedding).

    python -m scripts.firms.train_spatial --data raw --epochs 120

Trains on two AOIs and scores the third. The held-out AOI never appears in
training and the model has no AOI embedding, so this measures transfer rather
than region memorisation. Results are written to
`data/firms/models/ts_spatial_{aoi}.json` and quoted in the model card.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import ml_cal, store, ts_v2  # noqa: E402

MODEL_DIR = BACKEND / "data" / "firms" / "models"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="raw", choices=("sample", "raw"))
    ap.add_argument("--epochs", type=int, default=120)
    ap.add_argument("--seeds", default="7,17,27")
    a = ap.parse_args()
    seeds = tuple(int(s) for s in a.seeds.split(",") if s.strip())
    windows: list[dict] = []
    for aoi in store.AOIS:
        rows = (store.load_raw_merged(aoi, 2000000) if a.data == "raw"
                else store.load_records(aoi, 100000))
        windows += ts_v2.build_windows(ml_cal.build_monthly_pairs(rows), aoi=aoi)
    out = {}
    for held in store.AOIS:
        res = ts_v2.train_leave_one_out(windows, held, epochs=a.epochs, seeds=seeds)
        if not res.get("trained"):
            print(held, res)
            continue
        payload = {k: v for k, v in res.items() if k != "models"}
        payload["training_source"] = ("nasa-firms-raw" if a.data == "raw"
                                      else "synthetic-sample")
        payload["data_fingerprint"] = (store.pooled_fingerprint(store.AOIS)
                                       if a.data == "raw"
                                       else store.pooled_fingerprint(store.AOIS, raw=False))
        payload["feature_version"] = ts_v2.FEATURE_VERSION
        payload["algorithm_version"] = ts_v2.ALGORITHM_VERSION
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        (MODEL_DIR / f"ts_spatial_{held}.json").write_text(
            json.dumps(payload, indent=1), encoding="utf-8")
        out[held] = {k: round(v["mae"], 1) for k, v in res["metrics"].items()}
        print(held, "n", res["n"], out[held])
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
