"""Diagnose the pooled Transformer: data balance + hyperparameter sweep.

All tuning uses rolling validation years 2021/2022/2023 (train strictly before
the fold). The 2024-2025 holdout is touched once, for the best validation
configuration. Run:

    python -m scripts.firms.ts_diagnose
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from app.firms import sf_lite, ts_v2

BACKEND = Path(__file__).resolve().parents[2]
SEEDS = (7, 17, 27)


def windows(win: int = 12) -> list[dict]:
    pairs = sf_lite.load_pairs("raw")
    out = []
    for aoi in ("vietnam", "amazon", "australia"):
        out += ts_v2.build_windows([p for p in pairs if p["aoi"] == aoi],
                                   aoi=aoi, win=win)
    return out


def b2_baseline(wins: list[dict], train_pairs: list[dict]) -> dict[str, float]:
    """Per-AOI B2 log-ratio, fit on train pairs only."""
    from app.firms.evaluation import ratios_from_train
    out = {}
    for aoi in ("vietnam", "amazon", "australia"):
        _b1, b2 = ratios_from_train([p for p in train_pairs if p["aoi"] == aoi])
        out[aoi] = b2
    return out


def b2_counts(w: dict, b2: dict[str, dict[int, float]]) -> float:
    lr = b2[w["aoi"]].get(int(w["month"]), math.log(1.0))
    return max(math.exp(lr) * (w["modis_last"] + 1.0) - 1.0, 0.0)


def mae(y, p) -> float:
    return float(np.mean(np.abs(np.asarray(p) - np.asarray(y))))


def train_one(train, val, cfg, seed):
    import torch
    import torch.nn as nn

    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    model = ts_v2.PooledSeasonTransformer(
        d_model=cfg["d"], nhead=4, layers=cfg["layers"], dropout=cfg["dropout"])
    opt = torch.optim.AdamW(model.parameters(), lr=cfg["lr"],
                            weight_decay=cfg.get("wd", 0.01))
    Xtr = torch.tensor(np.stack([w["X"] for w in train]))
    Atr = torch.tensor([ts_v2._encode_aoi(w["aoi"]) for w in train])
    ytr = torch.tensor([w["y"] for w in train], dtype=torch.float32)
    if cfg.get("balanced"):
        counts: dict[str, int] = {}
        for w in train:
            counts[w["aoi"]] = counts.get(w["aoi"], 0) + 1
        wtr = torch.tensor([1.0 / counts[w["aoi"]] for w in train],
                           dtype=torch.float32)
        wtr = wtr / wtr.mean()
    else:
        wtr = torch.ones(len(train))
    Xva = torch.tensor(np.stack([w["X"] for w in val]))
    Ava = torch.tensor([ts_v2._encode_aoi(w["aoi"]) for w in val])
    yva = torch.tensor([w["y"] for w in val], dtype=torch.float32)
    best, best_state, bad = float("inf"), None, 0
    for _ in range(cfg.get("epochs", 240)):
        model.train()
        idx = torch.tensor(rng.permutation(len(train)))
        opt.zero_grad()
        pred = model(Xtr[idx], Atr[idx])
        loss = torch.mean(wtr[idx] * (pred - ytr[idx]) ** 2)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        model.eval()
        with torch.no_grad():
            v = float(torch.mean((model(Xva, Ava) - yva) ** 2))
        if v < best - 1e-6:
            best, bad = v, 0
            best_state = {k: t.detach().clone() for k, t in model.state_dict().items()}
        else:
            bad += 1
            if bad >= cfg.get("patience", 30):
                break
    if best_state:
        model.load_state_dict(best_state)
    model.eval()
    return model


def predict(models, wins):
    import torch
    X = torch.tensor(np.stack([w["X"] for w in wins]))
    A = torch.tensor([ts_v2._encode_aoi(w["aoi"]) for w in wins])
    out = []
    for m in models:
        with torch.no_grad():
            out.append(m(X, A).numpy())
    return np.mean(out, axis=0)


def fold_eval(wins, pairs, fold_year, cfg):
    train_w = [w for w in wins if w["year"] < fold_year]
    val_w = [w for w in wins if w["year"] == fold_year]
    train_pairs = [p for p in pairs if p["year"] < fold_year]
    b2 = b2_baseline(wins, train_pairs)
    models = [train_one(train_w, val_w, cfg, s) for s in SEEDS]
    raw = predict(models, val_w)
    counts = np.clip(np.exp(raw) * np.array([w["modis_last"] + 1 for w in val_w]) - 1, 0, None)
    y = np.array([w["viirs_ref"] for w in val_w])
    b2v = np.array([b2_counts(w, b2) for w in val_w])
    return {"n": len(val_w), "model_mae": mae(y, counts),
            "b2_mae": mae(y, b2v)}


def main() -> int:
    import torch  # noqa: F401

    pairs = sf_lite.load_pairs("raw")
    wins12 = windows(12)
    wins6 = windows(6)
    configs = {
        "base_d32_l2": {"d": 32, "layers": 2, "lr": 3e-3, "dropout": 0.1},
        "d16_l1": {"d": 16, "layers": 1, "lr": 3e-3, "dropout": 0.1},
        "d64_l2": {"d": 64, "layers": 2, "lr": 2e-3, "dropout": 0.1},
        "lr1e-3": {"d": 32, "layers": 2, "lr": 1e-3, "dropout": 0.1, "epochs": 400},
        "dropout0.3": {"d": 32, "layers": 2, "lr": 3e-3, "dropout": 0.3},
        "win6_d32": {"d": 32, "layers": 2, "lr": 3e-3, "dropout": 0.1},
        "balanced_d32": {"d": 32, "layers": 2, "lr": 3e-3, "dropout": 0.1,
                         "balanced": True},
    }
    results = {}
    for name, cfg in configs.items():
        wset = wins6 if name == "win6_d32" else wins12
        rows = [fold_eval(wset, pairs, y, cfg) for y in (2021, 2022, 2023)]
        results[name] = {
            "folds": rows,
            "model_mae": round(float(np.mean([r["model_mae"] for r in rows])), 2),
            "b2_mae": round(float(np.mean([r["b2_mae"] for r in rows])), 2),
        }
        print(name, json.dumps(results[name]))

    best = min(results, key=lambda k: results[k]["model_mae"])
    print("BEST", best)
    cfg = configs[best]
    wset = wins6 if best == "win6_d32" else wins12
    train_w = [w for w in wset if w["year"] < 2024]
    val_w = [w for w in wset if w["year"] == 2023]
    test_w = [w for w in wset if w["year"] >= 2024]
    train_pairs = [p for p in pairs if p["year"] < 2024]
    b2 = b2_baseline(wset, train_pairs)
    models = [train_one(train_w, val_w, cfg, s) for s in (7, 17, 27, 37, 47)]
    raw = predict(models, test_w)
    counts = np.clip(np.exp(raw) * np.array([w["modis_last"] + 1 for w in test_w]) - 1, 0, None)
    y = np.array([w["viirs_ref"] for w in test_w])
    b2t = np.array([b2_counts(w, b2) for w in test_w])
    out = {"best": best, "config": cfg,
           "test_model_mae": round(mae(y, counts), 2),
           "test_b2_mae": round(mae(y, b2t), 2),
           "test_n": len(test_w),
           "per_aoi": {}}
    for aoi in ("vietnam", "amazon", "australia"):
        idx = [i for i, w in enumerate(test_w) if w["aoi"] == aoi]
        out["per_aoi"][aoi] = {
            "model_mae": round(mae(y[idx], counts[idx]), 2),
            "b2_mae": round(mae(y[idx], b2t[idx]), 2),
            "n": len(idx)}
    print("HOLDOUT", json.dumps(out, indent=1))
    Path(BACKEND / "data" / "firms" / "models" / "ts_diagnose.json").write_text(
        json.dumps({"validation": results, "holdout": out}, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
