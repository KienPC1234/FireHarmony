"""Validation-only sweep for the Seasonal-Residual Former variants."""
from __future__ import annotations

import json

import numpy as np

from app.firms import srf


def lam_by_aoi(rows, deltas):
    lam = {}
    for aoi in srf.AOIS:
        idx = [i for i, r in enumerate(rows) if r["aoi"] == aoi]
        if not idx:
            lam[aoi] = 0.0
            continue
        best = (float("inf"), 0.0)
        for L in np.linspace(0.0, 1.0, 11):
            err = np.mean([abs(srf._counts(rows[i], L * deltas[i]) - rows[i]["viirs"])
                           for i in idx])
            if err < best[0]:
                best = (float(err), float(L))
        lam[aoi] = best[1]
    return lam


def val_mae(rows, deltas, lam):
    return float(np.mean([abs(srf._counts(r, lam[r["aoi"]] * d) - r["viirs"])
                          for r, d in zip(rows, deltas)]))


def test_eval(rows, deltas, lam):
    pred = np.array([srf._counts(r, lam[r["aoi"]] * d) for r, d in zip(rows, deltas)])
    y = np.array([r["viirs"] for r in rows])
    b2 = np.array([srf._counts(r, 0.0) for r in rows])
    from app.firms.evaluation import _metrics, _delta_ci
    samples = [{"id": r["id"], "aoi": r["aoi"], "year": r["year"],
                "month": r["month"], "viirs_ref": r["viirs"], "srf": float(p),
                "b2_seasonal_ratio": float(b)} for r, p, b in zip(rows, pred, b2)]
    return {"mae": round(float(np.mean(np.abs(pred - y))), 2),
            "b2_mae": round(float(np.mean(np.abs(b2 - y))), 2),
            "ci": _delta_ci(samples, "srf", "b2_seasonal_ratio"),
            "per_aoi": {aoi: {
                "mae": round(float(np.mean(np.abs(pred[[i for i, r in enumerate(rows)
                                                        if r["aoi"] == aoi]] -
                                             y[[i for i, r in enumerate(rows)
                                                if r["aoi"] == aoi]]))), 2),
                "b2_mae": round(float(np.mean(np.abs(b2[[i for i, r in enumerate(rows)
                                                         if r["aoi"] == aoi]] -
                                              y[[i for i, r in enumerate(rows)
                                                 if r["aoi"] == aoi]]))), 2),
                "lambda": lam[aoi]} for aoi in srf.AOIS}}


def main() -> int:
    pairs = srf.load_pairs("raw")
    train_pairs = [p for p in pairs if p["year"] < 2024]
    ratios = srf.b2_by_aoi(train_pairs)
    variants = {
        "w12_gate-4": {"d": 32, "win": 12, "lr": 2e-3, "epochs": 180},
        "w12_gate0": {"d": 32, "win": 12, "lr": 2e-3, "epochs": 180,
                      "gate_init": 0.0},
        "w12_head": {"d": 32, "win": 12, "lr": 2e-3, "epochs": 180,
                     "per_aoi_head": True},
        "w9_gate-4": {"d": 32, "win": 9, "lr": 2e-3, "epochs": 180},
        "w9_gate0": {"d": 32, "win": 9, "lr": 2e-3, "epochs": 180,
                     "gate_init": 0.0},
        "w9_head": {"d": 32, "win": 9, "lr": 2e-3, "epochs": 180,
                    "per_aoi_head": True},
        "w9_balanced": {"d": 32, "win": 9, "lr": 2e-3, "epochs": 180,
                        "balanced": True},
    }
    results = {}
    for name, cfg in variants.items():
        rows = srf.build_samples(pairs, ratios, win=cfg["win"])
        tr = [r for r in rows if r["year"] < 2023]
        va = [r for r in rows if r["year"] == 2023]
        models = [srf._train_one(tr, va, s, cfg) for s in srf.SEEDS]
        d = srf._deltas(models, va)
        lam = lam_by_aoi(va, d)
        results[name] = {"val_mae": round(val_mae(va, d, lam), 2),
                         "lambda": lam, "cfg": cfg}
        print(name, json.dumps(results[name]))
    best = min(results, key=lambda k: results[k]["val_mae"])
    print("BEST", best)
    cfg = variants[best]
    rows = srf.build_samples(pairs, ratios, win=cfg["win"])
    tr = [r for r in rows if r["year"] < 2023]
    va = [r for r in rows if r["year"] == 2023]
    te = [r for r in rows if r["year"] >= 2024]
    models = [srf._train_one(tr, va, s, cfg) for s in srf.SEEDS]
    dv = srf._deltas(models, va)
    lam = lam_by_aoi(va, dv)
    dt = srf._deltas(models, te)
    out = {"best": best, "cfg": cfg, "lambda": lam,
           "holdout": test_eval(te, dt, lam)}
    print("HOLDOUT", json.dumps(out, indent=1))
    from pathlib import Path
    Path(__file__).resolve().parents[2].joinpath(
        "data/firms/models/srf_diagnose.json").write_text(
        json.dumps({"validation": results, "holdout": out}, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
