"""Temporal Transformer v2 - log-ratio target, pooled multi-AOI, early stop.

Why v1 struggled: it predicted the absolute VIIRS level of the last month of a
12-month window. Absolute activity drifts 5x across years, so the model spent
capacity on year scale instead of sensor response, and it trained on a single
AOI (73 overlapping windows - tiny for attention).

v2 changes:
  1. TARGET = log ratio of the LAST month, log((viirs+1)/(modis+1)). Stationary
     across years; the MODIS count is multiplied back at prediction time.
  2. POOLED training over every AOI passed in, with a learned AOI embedding so
     the model can shift its ratio baseline per region (amazon vs australia).
  3. EARLY STOPPING on the last training year (never the holdout), plus two
     random seeds averaged - cheap variance control for a small model.
  4. SPATIAL TRANSFER is measurable: train on AOIs A+B, test on C, and report
     it separately from the temporal split.

Everything degrades to the statistical path when torch is missing.
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
except Exception:  # pragma: no cover
    torch = None  # type: ignore
    nn = None  # type: ignore
    _HAS_TORCH = False

METHOD_ID = "ts_logratio_pool_v2"
ALGORITHM_VERSION = "ts_logratio_pool_v2.1"
FEATURE_VERSION = "ts-features-v2"
SEED = 7
WIN = 12
D_MODEL = 32
NHEAD = 4
LAYERS = 2
DROPOUT = 0.1
SEEDS = (7, 17, 27, 37, 47)
AOIS = ("vietnam", "amazon", "australia")


def _features(modis: float, month: int) -> list[float]:
    return [math.log1p(max(float(modis), 0.0)),
            math.sin(2.0 * math.pi * month / 12.0),
            math.cos(2.0 * math.pi * month / 12.0)]


def build_windows(pairs: list[dict], aoi: str = "", win: int = WIN) -> list[dict]:
    """Sliding consecutive-month windows; target = last month's log ratio."""
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
        last = seg[-1]
        if float(last["modis"]) <= 0:
            continue
        X = np.array([_features(p["modis"], p["month"]) for p in seg], dtype=np.float32)
        y = math.log((float(last["viirs"]) + 1.0) / (float(last["modis"]) + 1.0))
        out.append({"X": X, "y": float(y), "year": last["year"],
                    "month": last["month"], "aoi": aoi,
                    "modis_last": float(last["modis"]),
                    "viirs_ref": float(last["viirs"])})
    return out


if _HAS_TORCH:
    class PooledSeasonTransformer(nn.Module):  # type: ignore[no-redef]
        def __init__(self, n_aoi: int = len(AOIS), d_model: int = D_MODEL,
                     nhead: int = NHEAD, layers: int = LAYERS,
                     dropout: float = DROPOUT):
            super().__init__()
            self.inp = nn.Linear(3, d_model)
            self.aoi_emb = nn.Embedding(n_aoi, d_model)
            self.pos = nn.Parameter(torch.randn(1, WIN, d_model) * 0.1)
            enc = nn.TransformerEncoderLayer(
                d_model=d_model, nhead=nhead, dim_feedforward=64,
                dropout=dropout, batch_first=True, activation="gelu")
            self.enc = nn.TransformerEncoder(enc, num_layers=layers)
            self.norm = nn.LayerNorm(d_model)
            self.head = nn.Linear(d_model, 1)

        def forward(self, x, aoi_idx):  # noqa: ANN001 - (B,12,3),(B,) -> (B,)
            h = self.inp(x) + self.pos[:, :x.size(1), :]
            h = h + self.aoi_emb(aoi_idx).unsqueeze(1)
            h = self.norm(self.enc(h))
            return self.head(h[:, -1, :]).squeeze(-1)
else:
    class PooledSeasonTransformer:  # type: ignore[no-redef]
        def __init__(self, *a, **k):
            raise RuntimeError("torch not installed")


def _encode_aoi(aoi: str) -> int:
    return AOIS.index(aoi) if aoi in AOIS else 0


def _to_counts(modis: np.ndarray, y_log_ratio: np.ndarray) -> np.ndarray:
    return np.clip(np.exp(y_log_ratio) * (modis + 1.0) - 1.0, 0.0, None)


def _metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    err = y_pred - y_true
    denom = float(np.sum(y_true)) or 1.0
    return {"mae": float(np.mean(np.abs(err))),
            "wape": float(np.sum(np.abs(err)) / denom),
            "bias": float(np.mean(err))}


def _train_one(train: list[dict], val: list[dict], seed: int,
               epochs: int = 200, lr: float = 3e-3, patience: int = 25,
               use_aoi_embedding: bool = True):
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    model = PooledSeasonTransformer(n_aoi=(len(AOIS) if use_aoi_embedding else 1))
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    loss_fn = nn.MSELoss()
    Xtr = torch.tensor(np.stack([w["X"] for w in train]))
    Atr = torch.tensor([_encode_aoi(w["aoi"]) if use_aoi_embedding else 0 for w in train])
    ytr = torch.tensor([w["y"] for w in train], dtype=torch.float32)
    Xva = torch.tensor(np.stack([w["X"] for w in val]))
    Ava = torch.tensor([_encode_aoi(w["aoi"]) if use_aoi_embedding else 0 for w in val])
    yva = torch.tensor([w["y"] for w in val], dtype=torch.float32)
    best, best_state, bad = float("inf"), None, 0
    for _ in range(epochs):
        model.train()
        idx = torch.tensor(rng.permutation(len(train)))
        opt.zero_grad()
        loss = loss_fn(model(Xtr[idx], Atr[idx]), ytr[idx])
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        model.eval()
        with torch.no_grad():
            v = float(loss_fn(model(Xva, Ava), yva))
        if v < best - 1e-5:
            best, bad = v, 0
            best_state = {k: t.detach().clone() for k, t in model.state_dict().items()}
        else:
            bad += 1
            if bad >= patience:
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    return model, best


def _predict(model, windows: list[dict], use_aoi_embedding: bool = True) -> np.ndarray:
    if not windows:
        return np.array([])
    X = torch.tensor(np.stack([w["X"] for w in windows]))
    A = torch.tensor([_encode_aoi(w["aoi"]) if use_aoi_embedding else 0 for w in windows])
    with torch.no_grad():
        y = model(X, A).numpy()
    modis = np.array([w["modis_last"] for w in windows], dtype=float)
    return _to_counts(modis, y)


def train_pooled(windows: list[dict], test_years: int = 2,
                 epochs: int = 200,
                 test_set: set[int] | None = None) -> dict:
    """Temporal split over pooled windows; early-stop year carved from train."""
    if not _HAS_TORCH:
        return {"trained": False, "reason": "torch-missing"}
    years = sorted({w["year"] for w in windows})
    if test_set is not None:
        test_set = {int(y) for y in test_set}
    else:
        test_set = set(years[-test_years:]) if test_years > 0 else set()
    if test_set:
        cutoff = min(test_set)
        rest = [w for w in windows if w["year"] < cutoff]
        test = [w for w in windows if w["year"] in test_set]
    else:
        rest, test = list(windows), []
    rest_years = sorted({w["year"] for w in rest})
    base = {"trained": False, "n_train": len(rest), "n_test": len(test),
            "train_years": rest_years, "test_years": sorted(test_set)}
    if len(rest_years) < 3 or len(rest) < 40 or not test:
        return {**base, "reason": "need_3_train_years_and_40_windows"}
    val_year = rest_years[-1]
    train = [w for w in rest if w["year"] != val_year]
    val = [w for w in rest if w["year"] == val_year]
    models = []
    for seed in SEEDS:
        model, _ = _train_one(train, val, seed, epochs=epochs)
        models.append(model)
    per_seed = [_predict(m, test) for m in models]
    preds = np.mean(per_seed, axis=0)
    y_true = np.array([w["viirs_ref"] for w in test], dtype=float)
    seed_maes = [float(np.mean(np.abs(p - y_true))) for p in per_seed]
    modis_te = np.array([w["modis_last"] for w in test], dtype=float)
    ratios = [math.log((w["viirs_ref"] + 1.0) / (w["modis_last"] + 1.0))
              for w in train if w["modis_last"] > 0]
    b1 = math.exp(float(np.median(ratios))) if ratios else 1.0
    by_m: dict[int, float] = {}
    for m in range(1, 13):
        rs = [math.log((w["viirs_ref"] + 1.0) / (w["modis_last"] + 1.0))
              for w in train if w["month"] == m and w["modis_last"] > 0]
        if rs:
            by_m[m] = math.exp(float(np.median(rs)))
    metrics = {
        "transformer": _metrics(y_true, preds),
        "b0_raw_modis": _metrics(y_true, modis_te),
        "b1_global_ratio": _metrics(y_true, modis_te * b1),
        "b2_seasonal_ratio": _metrics(
            y_true, np.array([m * by_m.get(int(w["month"]), b1)
                              for m, w in zip(modis_te, test)])),
    }
    params = sum(p.numel() for p in models[0].parameters())
    return {**base, "trained": True, "models": models, "metrics": metrics,
            "seed_maes": [round(x, 2) for x in seed_maes],
            "seed_mae_mean": round(float(np.mean(seed_maes)), 2),
            "seed_mae_range": [round(min(seed_maes), 2), round(max(seed_maes), 2)],
            "method_id": METHOD_ID, "seed": SEED, "seeds": list(SEEDS),
            "params": int(params), "win": WIN, "target": "log_ratio",
            "feature_version": FEATURE_VERSION,
            "algorithm_version": ALGORITHM_VERSION,
            "val_year": val_year, "aois": sorted({w["aoi"] for w in windows if w["aoi"]})}


def evaluate_spatial(models: list, windows: list[dict], aoi: str) -> dict | None:
    """Score an already-trained model on a held-out AOI (no retraining).

    Kept for diagnostics, but the honest spatial protocol is
    `train_leave_one_out`, which never trains on the held-out AOI and does
    not use a learned AOI embedding for it (audit P1-18).
    """
    sub = [w for w in windows if w["aoi"] == aoi]
    if not sub:
        return None
    pred = np.mean([_predict(m, sub) for m in models], axis=0)
    y = np.array([w["viirs_ref"] for w in sub], dtype=float)
    modis = np.array([w["modis_last"] for w in sub], dtype=float)
    ratios = [math.log((w["viirs_ref"] + 1.0) / (w["modis_last"] + 1.0))
              for w in windows if w["aoi"] != aoi and w["modis_last"] > 0]
    b1 = math.exp(float(np.median(ratios))) if ratios else 1.0
    return {"aoi_held_out": aoi, "n": len(sub),
            "transformer": _metrics(y, pred),
            "b1_global_ratio": _metrics(y, modis * b1)}


def train_leave_one_out(windows: list[dict], held_out: str,
                        epochs: int = 120, seeds: tuple[int, ...] = (7, 17, 27)) -> dict:
    """True spatial transfer: train on the OTHER AOIs, score `held_out`.

    The held-out AOI never appears in training and the model has no AOI
    embedding at all, so there is no learned region prior to leak. Early
    stopping uses a slice of the training AOIs, never the held-out region.
    """
    if not _HAS_TORCH:
        return {"trained": False, "reason": "torch-missing"}
    train_all = [w for w in windows if w["aoi"] != held_out]
    test = [w for w in windows if w["aoi"] == held_out]
    if not train_all or not test:
        return {"trained": False, "reason": "missing_aoi_windows", "held_out": held_out}
    hold_val = sorted({w["aoi"] for w in train_all})[-1]
    train = [w for w in train_all if w["aoi"] != hold_val]
    val = [w for w in train_all if w["aoi"] == hold_val]
    if not train or not val:
        train, val = train_all, train_all
    models = []
    for seed in seeds:
        model, _ = _train_one(train, val, seed, epochs=epochs,
                              use_aoi_embedding=False)
        models.append(model)
    preds = np.mean([_predict(m, test, use_aoi_embedding=False) for m in models], axis=0)
    y = np.array([w["viirs_ref"] for w in test], dtype=float)
    modis = np.array([w["modis_last"] for w in test], dtype=float)
    ratios = [math.log((w["viirs_ref"] + 1.0) / (w["modis_last"] + 1.0))
              for w in train_all if w["modis_last"] > 0]
    b1 = math.exp(float(np.median(ratios))) if ratios else 1.0
    return {"trained": True, "held_out": held_out, "n": len(test),
            "train_aois": sorted({w["aoi"] for w in train_all}),
            "metrics": {"transformer": _metrics(y, preds),
                        "b0_raw_modis": _metrics(y, modis),
                        "b1_global_ratio": _metrics(y, modis * b1)},
            "models": models,
            "method_id": METHOD_ID, "algorithm_version": ALGORITHM_VERSION,
            "protocol": "leave-one-region-out, no AOI embedding",
            "seeds": list(seeds)}


def save_artifact(models: list, meta: dict, aoi: str, model_dir,
                  tag: str = "sample") -> dict:
    out = Path(model_dir)
    out.mkdir(parents=True, exist_ok=True)
    suffix = "" if tag == "sample" else f"_{tag}"
    mp = out / f"ts_{aoi}{suffix}.pt"
    jp = out / f"ts_{aoi}{suffix}.json"
    torch.save({"models": [m.state_dict() for m in models],
                "config": {"d_model": D_MODEL, "nhead": NHEAD,
                           "layers": LAYERS, "dropout": DROPOUT,
                           "win": WIN, "n_aoi": len(AOIS)}}, mp)
    doc = {"method_id": meta.get("method_id", METHOD_ID), "seed": SEED,
           "aoi": aoi, "data_tag": tag,
           "training_source": meta.get("training_source", "synthetic-sample"),
           "dataset_sha256": meta.get("dataset_sha256"),
           "train_years": meta.get("train_years", []),
           "test_years": meta.get("test_years", []),
           "val_year": meta.get("val_year"),
           "n_train": meta.get("n_train", 0), "n_test": meta.get("n_test", 0),
           "metrics": meta.get("metrics", {}),
           "params": meta.get("params", 0), "win": WIN,
           "weights_file": mp.name,
           "weights_sha256": __import__("hashlib").sha256(mp.read_bytes()).hexdigest(),
           "target": "log_ratio",
           "torch_version": torch.__version__,
           "created_at": datetime.now(timezone.utc).isoformat()}
    for extra in ("spatial_transfer", "aois", "seed_maes", "seed_mae_mean",
                  "seed_mae_range", "target", "feature_version",
                  "algorithm_version", "data_fingerprint", "eval_manifest_id",
                  "unified_eval", "coverage", "coverage_partial"):
        if extra in meta:
            doc[extra] = meta[extra]
    jp.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    return {"model_path": str(mp), "meta_path": str(jp),
            "model_sha256": __import__("hashlib").sha256(mp.read_bytes()).hexdigest()[:16]}


def artifact_compat(models, meta: dict, expected_fingerprint: str | None = None) -> tuple[bool, str]:
    """Validate a Transformer artifact against the data on disk (P0-13)."""
    if not models or meta is None:
        return False, "artifact_missing"
    if meta.get("feature_version") and meta["feature_version"] != FEATURE_VERSION:
        return False, f"feature_version_mismatch:{meta['feature_version']}!={FEATURE_VERSION}"
    if meta.get("algorithm_version") and meta["algorithm_version"] != ALGORITHM_VERSION:
        return False, f"algorithm_version_mismatch:{meta['algorithm_version']}!={ALGORITHM_VERSION}"
    fp = meta.get("data_fingerprint")
    if expected_fingerprint is not None:
        if not fp:
            return False, "artifact_missing_data_fingerprint"
        if fp != expected_fingerprint:
            return False, f"data_fingerprint_mismatch:{fp}!={expected_fingerprint}"
    return True, "ok"


def load_artifact(aoi: str, model_dir, tag: str = "sample"):
    out = Path(model_dir)
    suffix = "" if tag == "sample" else f"_{tag}"
    mp, jp = out / f"ts_{aoi}{suffix}.pt", out / f"ts_{aoi}{suffix}.json"
    if not (mp.exists() and jp.exists()):
        return None, None
    try:
        blob = torch.load(mp, map_location="cpu", weights_only=True)
        models = []
        for sd in blob["models"]:
            m = PooledSeasonTransformer()
            m.load_state_dict(sd)
            m.eval()
            models.append(m)
        return models, json.loads(jp.read_text(encoding="utf-8"))
    except Exception:
        return None, None


def predict_windows(models, X: np.ndarray, aoi: str = "vietnam") -> np.ndarray:
    """Single-window convenience used by the calendar post-adjustment."""
    w = {"X": np.asarray(X, dtype=np.float32).reshape(WIN, 3), "aoi": aoi,
         "modis_last": float(np.expm1(np.asarray(X, dtype=float).reshape(WIN, 3)[-1, 0]))}
    return np.mean([_predict(m, [w]) for m in models], axis=0)
