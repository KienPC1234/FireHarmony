"""Temporal Transformer calibrator: VIIRS ~ 12-month MODIS window.

Why a Transformer (not just HGB): the HGB maps one month in isolation;
fire seasons have memory (fuel, drought carryover). This model reads a
12-month MODIS window and predicts the LAST month's VIIRS count, so the
same MODIS value maps differently in dry vs wet season context.

Data: sliding 12-month windows over overlap-era monthly pairs
(168 months/AOI -> ~157 windows; pooled 3 AOIs -> ~470). Temporal split by
window end-year. Tiny CPU model (~15k params), persisted .pt + JSON sidecar.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

try:
    import torch
    import torch.nn as nn

    _HAS_TORCH = True
except Exception:  # pragma: no cover - CPU torch expected on server
    torch = None  # type: ignore
    nn = None  # type: ignore
    _HAS_TORCH = False

METHOD_ID = "ts_win12_v1"
SEED = 7
WIN = 12
D_MODEL = 32
NHEAD = 4
LAYERS = 2


def _feat(modis: float, month: int) -> list[float]:
    return [math.log1p(max(float(modis), 0.0)),
            math.sin(2.0 * math.pi * month / 12.0),
            math.cos(2.0 * math.pi * month / 12.0)]


def build_windows(pairs: list[dict], win: int = WIN) -> list[dict]:
    """Sliding windows over CONSECUTIVE months. Each item: X (win,3), y, end year/month."""
    ps = sorted(pairs, key=lambda p: (p["year"], p["month"]))
    out = []
    for i in range(len(ps) - win + 1):
        seg = ps[i:i + win]
        ok = True
        for a, b in zip(seg, seg[1:]):
            if (b["year"] * 12 + b["month"]) - (a["year"] * 12 + a["month"]) != 1:
                ok = False
                break
        if not ok:
            continue
        X = np.array([_feat(p["modis"], p["month"]) for p in seg], dtype=np.float32)
        last = seg[-1]
        out.append({"X": X, "y": float(last["viirs"]),
                    "year": last["year"], "month": last["month"],
                    "modis_last": float(last["modis"])})
    return out


if _HAS_TORCH:
    class SeasonTransformer(nn.Module):  # type: ignore[no-redef]
        def __init__(self, d_model: int = D_MODEL, nhead: int = NHEAD,
                     layers: int = LAYERS):
            super().__init__()
            self.inp = nn.Linear(3, d_model)
            self.pos = nn.Parameter(torch.randn(1, WIN, d_model) * 0.1)
            enc = nn.TransformerEncoderLayer(d_model=d_model, nhead=nhead,
                                             dim_feedforward=64, batch_first=True)
            self.enc = nn.TransformerEncoder(enc, num_layers=layers)
            self.head = nn.Linear(d_model, 1)

        def forward(self, x):  # noqa: ANN001 - (B,12,3) -> (B,) log-viirs
            h = self.inp(x) + self.pos[:, :x.size(1), :]
            h = self.enc(h)
            return self.head(h[:, -1, :]).squeeze(-1)
else:
    class SeasonTransformer:  # type: ignore[no-redef]
        def __init__(self, *a, **k):
            raise RuntimeError("torch not installed")


def _count_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    err = y_pred - y_true
    denom = float(np.sum(y_true)) or 1.0
    return {"mae": float(np.mean(np.abs(err))),
            "wape": float(np.sum(np.abs(err)) / denom),
            "bias": float(np.mean(err))}


def train_holdout(windows: list[dict], test_years: int = 3,
                  epochs: int = 120, lr: float = 3e-3) -> dict:
    """Temporal split by window end-year. Returns metrics + model."""
    if not _HAS_TORCH:
        return {"trained": False, "reason": "torch-missing"}
    years = sorted({w["year"] for w in windows})
    test_set = set(years[-test_years:]) if test_years > 0 else set()
    train = [w for w in windows if w["year"] not in test_set]
    test = [w for w in windows if w["year"] in test_set]
    base = {"trained": False, "n_train": len(train), "n_test": len(test),
            "train_years": sorted({w["year"] for w in train}),
            "test_years": sorted(test_set)}
    if len(train) < 24 or not test:
        return {**base, "reason": "small_data_need_24_train_windows"}
    torch.manual_seed(SEED)
    rng = np.random.default_rng(SEED)
    log_tr = np.log1p([w["y"] for w in train])
    log_mean, log_std = float(np.mean(log_tr)), float(np.std(log_tr)) or 1.0
    Xtr = torch.tensor(np.stack([w["X"] for w in train]))
    ytr = torch.tensor(((log_tr - log_mean) / log_std).astype(np.float32))
    Xte = torch.tensor(np.stack([w["X"] for w in test]))
    y_true = np.array([w["y"] for w in test], dtype=float)
    mod_te = np.array([w["modis_last"] for w in test], dtype=float)

    model = SeasonTransformer()
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.MSELoss()
    model.train()
    for _ in range(epochs):
        idx = torch.tensor(rng.permutation(len(train)))
        opt.zero_grad()
        loss = loss_fn(model(Xtr[idx]), ytr[idx])
        loss.backward()
        opt.step()
    model.eval()
    with torch.no_grad():
        ts_pred = np.clip(np.expm1(model(Xte).numpy() * log_std + log_mean), 0.0, None)

    # Same baselines as ml_cal (train-period ratios), recomputed from windows.
    ratios = np.array([t["y"] / t["modis_last"] for t in train if t["modis_last"] > 0])
    b1 = float(np.median(ratios)) if ratios.size else 1.0
    by_m: dict[int, float] = {}
    for m in range(1, 13):
        r = np.array([t["y"] / t["modis_last"] for t in train
                      if t["month"] == m and t["modis_last"] > 0])
        if r.size:
            by_m[m] = float(np.median(r))
    b0 = mod_te.copy()
    b1p = mod_te * b1
    b2p = np.array([m_ * by_m.get(int(w["month"]), b1) for m_, w in zip(mod_te, test)])
    metrics = {"transformer": _count_metrics(y_true, ts_pred),
               "b0_raw_modis": _count_metrics(y_true, b0),
               "b1_global_ratio": _count_metrics(y_true, b1p),
               "b2_seasonal_ratio": _count_metrics(y_true, b2p)}
    params = sum(p.numel() for p in model.parameters())
    return {**base, "trained": True, "model": model, "metrics": metrics,
            "b1_ratio": b1, "method_id": METHOD_ID, "seed": SEED,
            "params": int(params), "win": WIN,
            "log_mean": log_mean, "log_std": log_std}


def predict_windows(model, X: np.ndarray, log_mean: float, log_std: float) -> np.ndarray:
    model.eval()
    with torch.no_grad():
        return np.clip(np.expm1(model(torch.tensor(X)).numpy() * log_std + log_mean), 0.0, None)


def save_artifact(model, meta: dict, aoi: str, model_dir, tag: str = "sample") -> dict:
    out = Path(model_dir)
    out.mkdir(parents=True, exist_ok=True)
    suffix = "" if tag == "sample" else f"_{tag}"
    mp, jp = out / f"ts_{aoi}{suffix}.pt", out / f"ts_{aoi}{suffix}.json"
    torch.save(model.state_dict(), mp)
    doc = {"method_id": meta.get("method_id", METHOD_ID), "seed": SEED,
           "aoi": aoi, "data_tag": tag,
           "train_years": meta.get("train_years", []),
           "test_years": meta.get("test_years", []),
           "n_train": meta.get("n_train", 0), "n_test": meta.get("n_test", 0),
           "metrics": meta.get("metrics", {}), "params": meta.get("params", 0),
           "win": WIN, "torch_version": torch.__version__,
           "log_mean": meta.get("log_mean", 0.0), "log_std": meta.get("log_std", 1.0),
           "training_source": meta.get("training_source", "synthetic-sample"),
           "dataset_sha256": meta.get("dataset_sha256"),
           "created_at": datetime.now(timezone.utc).isoformat()}
    jp.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    return {"model_path": str(mp), "meta_path": str(jp)}


def load_artifact(aoi: str, model_dir, tag: str = "sample"):
    out = Path(model_dir)
    suffix = "" if tag == "sample" else f"_{tag}"
    mp, jp = out / f"ts_{aoi}{suffix}.pt", out / f"ts_{aoi}{suffix}.json"
    if not (mp.exists() and jp.exists()):
        return None, None
    try:
        model = SeasonTransformer()
        model.load_state_dict(torch.load(mp, map_location="cpu", weights_only=True))
        model.eval()
        return model, json.loads(jp.read_text(encoding="utf-8"))
    except Exception:
        return None, None
