"""Focused follow-up: window-6 variants, 5 seeds, bootstrap CI vs B2."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from app.firms import evaluation, sf_lite, ts_v2
from scripts.firms.ts_diagnose import (BACKEND, b2_baseline, b2_counts,
                                       train_one, windows)

SEEDS = (7, 17, 27, 37, 47)


def count_pred(raw, wins):
    return np.clip(np.exp(raw) * np.array([w["modis_last"] + 1 for w in wins]) - 1,
                   0, None)


def run(name, cfg, win, pairs, holdout=True):
    wset = windows(win)
    train_w = [w for w in wset if w["year"] < 2024]
    val_w = [w for w in wset if w["year"] == 2023]
    test_w = [w for w in wset if w["year"] >= 2024]
    models = [train_one(train_w, val_w, cfg, s) for s in SEEDS]
    raw = predict_models(models, test_w)
    counts = count_pred(raw, test_w)
    y = np.array([w["viirs_ref"] for w in test_w])
    b2 = b2_baseline(wset, [p for p in pairs if p["year"] < 2024])
    b2c = np.array([b2_counts(w, b2) for w in test_w])
    samples = [{"id": w["id"] if "id" in w else f"{w['aoi']}:{w['year']}-{w['month']:02d}",
                "aoi": w["aoi"], "year": w["year"], "month": w["month"],
                "viirs_ref": w["viirs_ref"], name: float(c),
                "b2_seasonal_ratio": float(b)} for w, c, b in zip(test_w, counts, b2c)]
    ci = evaluation._delta_ci(samples, name, "b2_seasonal_ratio")
    out = {"name": name, "win": win, "config": cfg,
           "mae": round(float(np.mean(np.abs(counts - y))), 2),
           "b2_mae": round(float(np.mean(np.abs(b2c - y))), 2),
           "ci": ci, "per_aoi": {}}
    for aoi in ("vietnam", "amazon", "australia"):
        idx = [i for i, w in enumerate(test_w) if w["aoi"] == aoi]
        out["per_aoi"][aoi] = {
            "mae": round(float(np.mean(np.abs(counts[idx] - y[idx]))), 2),
            "b2_mae": round(float(np.mean(np.abs(b2c[idx] - y[idx]))), 2)}
    print(name, json.dumps(out))
    return out, (test_w, raw)


def predict_models(models, wins):
    import torch
    X = torch.tensor(np.stack([w["X"] for w in wins]))
    A = torch.tensor([ts_v2._encode_aoi(w["aoi"]) for w in wins])
    vals = []
    for m in models:
        with torch.no_grad():
            vals.append(m(X, A).numpy())
    return np.mean(vals, axis=0)


def main() -> int:
    pairs = sf_lite.load_pairs("raw")
    base = {"d": 32, "layers": 2, "lr": 3e-3, "dropout": 0.1}
    variants = {
        "win6_base": (base, 6),
        "win6_d64": ({"d": 64, "layers": 2, "lr": 2e-3, "dropout": 0.1}, 6),
        "win6_balanced": ({**base, "balanced": True}, 6),
        "win6_lr1e3": ({**base, "lr": 1e-3, "epochs": 400}, 6),
        "win9_base": (base, 9),
        "win3_base": (base, 3),
        "win12_base": (base, 12),
    }
    results = {}
    preds = {}
    for name, (cfg, win) in variants.items():
        results[name], preds[name] = run(name, cfg, win, pairs)
    # Ensemble 6+12 (average log-ratio prediction)
    w6, r6 = preds["win6_base"]
    w12, r12 = preds["win12_base"]
    if len(w6) == len(w12):
        ens = (r6 + r12) / 2
        counts = count_pred(ens, w6)
        y = np.array([w["viirs_ref"] for w in w6])
        b2 = b2_baseline(w6, [p for p in pairs if p["year"] < 2024])
        b2c = np.array([b2_counts(w, b2) for w in w6])
        name = "ens_6_12"
        samples = [{"id": f"{w['aoi']}:{w['year']}-{w['month']:02d}",
                    "aoi": w["aoi"], "year": w["year"], "month": w["month"],
                    "viirs_ref": w["viirs_ref"], name: float(c),
                    "b2_seasonal_ratio": float(b)} for w, c, b in zip(w6, counts, b2c)]
        ens_out = {"name": name, "mae": round(float(np.mean(np.abs(counts - y))), 2),
                   "b2_mae": round(float(np.mean(np.abs(b2c - y))), 2),
                   "ci": evaluation._delta_ci(samples, name, "b2_seasonal_ratio")}
        print(name, json.dumps(ens_out))
        results[name] = ens_out
    Path(BACKEND / "data" / "firms" / "models" / "ts_diagnose_focus.json").write_text(
        json.dumps(results, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
