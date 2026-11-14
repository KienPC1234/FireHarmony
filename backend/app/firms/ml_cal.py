"""ML calibration: VIIRS ~ MODIS monthly-count mapping (overlap era >= 2012).

Pure sklearn + numpy module. No torch, no FastAPI. All functions importable.

Pipeline:
  records (raw FIRMS dict rows) -> build_monthly_pairs -> train_holdout
  -> save_artifact / load_artifact -> predict_viirs

Features per year-month pair: [log1p(modis_count), month_sin, month_cos].
Target: log1p(viirs_count). Metrics are reported in ORIGINAL count space.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np

try:
    import sklearn

    _SKLEARN_VERSION = sklearn.__version__
except Exception:  # pragma: no cover - sklearn required at train time
    _SKLEARN_VERSION = "unknown"

from sklearn.ensemble import HistGradientBoostingRegressor

METHOD_ID = "hgb-log1p-v1"
SEED = 7
FEATURES = ["log_modis", "month_sin", "month_cos"]
OVERLAP_START_YEAR = 2012


def _parse_year_month(rec: dict) -> tuple[int, int] | None:
    d = rec.get("acq_date", "")
    if hasattr(d, "year") and hasattr(d, "month"):
        try:
            return int(d.year), int(d.month)
        except (TypeError, ValueError):
            return None
    s = str(d or "").strip()[:10]
    try:
        year = int(s[0:4])
        month = int(s[5:7])
    except (ValueError, IndexError):
        return None
    if not (1 <= month <= 12):
        return None
    return year, month


def _norm_instrument(rec: dict) -> str | None:
    s = str(rec.get("instrument", "") or "").strip().upper()
    if s.startswith("VIIRS"):
        return "VIIRS"
    if s == "MODIS":
        return "MODIS"
    return None


def build_monthly_pairs(records: list[dict]) -> list[dict]:
    """Aggregate raw records by year-month (sum counts per instrument).

    Keeps only overlap-era months (year >= 2012) with both MODIS > 0
    and VIIRS > 0. Returns sorted [{year, month, modis, viirs}, ...].
    """
    counts: dict[tuple[int, int], dict[str, int]] = {}
    for rec in records or []:
        if not isinstance(rec, dict):
            continue
        ym = _parse_year_month(rec)
        if ym is None:
            continue
        year, month = ym
        if year < OVERLAP_START_YEAR:
            continue
        inst = _norm_instrument(rec)
        if inst is None:
            continue
        key = (year, month)
        slot = counts.setdefault(key, {"modis": 0, "viirs": 0})
        if inst == "MODIS":
            slot["modis"] += 1
        else:
            slot["viirs"] += 1
    pairs = [
        {"year": y, "month": m, "modis": v["modis"], "viirs": v["viirs"]}
        for (y, m), v in counts.items()
        if v["modis"] > 0 and v["viirs"] > 0
    ]
    pairs.sort(key=lambda p: (p["year"], p["month"]))
    return pairs


def featurize(pairs: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Feature matrix X (n,3) and log-space target y (n,)."""
    n = len(pairs)
    X = np.zeros((n, 3), dtype=float)
    y = np.zeros(n, dtype=float)
    for i, p in enumerate(pairs):
        m = int(p["month"])
        X[i, 0] = math.log1p(float(p["modis"]))
        X[i, 1] = math.sin(2.0 * math.pi * m / 12.0)
        X[i, 2] = math.cos(2.0 * math.pi * m / 12.0)
        y[i] = math.log1p(float(p["viirs"]))
    return X, y


def _metrics_single(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    err = y_pred - y_true
    mae = float(np.mean(np.abs(err))) if y_true.size else 0.0
    denom = float(np.sum(y_true))
    wape = float(np.sum(np.abs(err)) / denom) if denom > 0 else 0.0
    bias = float(np.mean(err)) if y_true.size else 0.0
    return {"mae": mae, "wape": wape, "bias": bias}


def train_holdout(pairs: list[dict], test_years: int = 3) -> dict:
    """Temporal split: last `test_years` distinct years as holdout.

    Trains HistGradientBoostingRegressor(max_iter=200, max_depth=3,
    random_state=7) on log1p target; baselines B0/B1/B2 in count space.
    Returns dict with metrics + model + sizes. Small data (<12 train
    pairs) returns {"trained": False, ...}.
    """
    pairs = sorted(list(pairs or []), key=lambda p: (p["year"], p["month"]))
    years = sorted({int(p["year"]) for p in pairs})
    n_test = max(int(test_years), 0)
    test_ylist = years[-n_test:] if n_test > 0 else []
    test_set = set(test_ylist)
    train = [p for p in pairs if int(p["year"]) not in test_set]
    test = [p for p in pairs if int(p["year"]) in test_set]
    train_years = sorted({int(p["year"]) for p in train})

    base = {
        "trained": False,
        "n_train": len(train),
        "n_test": len(test),
        "train_years": train_years,
        "test_years": list(test_ylist),
        "test_year_count": n_test,
    }
    if len(train) < 12 or len(test) == 0:
        return {**base, "reason": "small_data_need_12_train_pairs_and_nonempty_test"}

    # Baselines from train only.
    ratios = np.array(
        [float(p["viirs"]) / float(p["modis"]) for p in train
         if float(p["modis"]) > 0],
        dtype=float,
    )
    global_ratio = float(np.median(ratios)) if ratios.size else 1.0
    by_month: dict[int, float] = {}
    for m in range(1, 13):
        r = np.array(
            [float(p["viirs"]) / float(p["modis"]) for p in train
             if int(p["month"]) == m and float(p["modis"]) > 0],
            dtype=float,
        )
        if r.size:
            by_month[m] = float(np.median(r))

    Xtr, ytr = featurize(train)
    Xte, _ = featurize(test)
    model = HistGradientBoostingRegressor(
        max_iter=200, max_depth=3, random_state=SEED
    )
    model.fit(Xtr, ytr)
    ml_pred = np.expm1(model.predict(Xte))
    ml_pred = np.clip(ml_pred, 0.0, None)

    y_true = np.array([float(p["viirs"]) for p in test], dtype=float)
    modis_te = np.array([float(p["modis"]) for p in test], dtype=float)
    b0_pred = modis_te.copy()
    b1_pred = modis_te * global_ratio
    b2_pred = np.array(
        [m * by_month.get(int(p["month"]), global_ratio) for m, p in
         zip(modis_te, test)],
        dtype=float,
    )

    metrics = {
        "ml": _metrics_single(y_true, ml_pred),
        "b0_raw_modis": _metrics_single(y_true, b0_pred),
        "b1_global_ratio": _metrics_single(y_true, b1_pred),
        "b2_seasonal_ratio": _metrics_single(y_true, b2_pred),
    }
    return {
        **base,
        "trained": True,
        "model": model,
        "metrics": metrics,
        "b1_ratio": global_ratio,
        "b2_ratios": {str(k): v for k, v in sorted(by_month.items())},
        "method_id": METHOD_ID,
        "seed": SEED,
        "features": list(FEATURES),
    }


def save_artifact(model, meta: dict, aoi: str, model_dir) -> dict:
    """Dump model + JSON sidecar. Returns {"model_path", "meta_path"}."""
    out = Path(model_dir)
    out.mkdir(parents=True, exist_ok=True)
    model_path = out / f"cal_{aoi}.joblib"
    meta_path = out / f"cal_{aoi}.json"
    joblib.dump(model, model_path)
    meta = dict(meta or {})
    doc = {
        "method_id": meta.get("method_id", METHOD_ID),
        "seed": meta.get("seed", SEED),
        "aoi": aoi,
        "train_years": meta.get("train_years", []),
        "test_years": meta.get("test_years", []),
        "n_train": meta.get("n_train", 0),
        "n_test": meta.get("n_test", 0),
        "metrics": meta.get("metrics", {}),
        "features": meta.get("features", list(FEATURES)),
        "sklearn_version": _SKLEARN_VERSION,
        "training_source": meta.get("training_source", "synthetic-sample"),
        "dataset_sha256": meta.get("dataset_sha256"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    for extra in ("b1_ratio", "b2_ratios"):
        if extra in meta:
            doc[extra] = meta[extra]
    meta_path.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    return {"model_path": str(model_path), "meta_path": str(meta_path)}


def load_artifact(aoi: str, model_dir):
    """Load (model, meta) or (None, None) when files are missing."""
    out = Path(model_dir)
    model_path = out / f"cal_{aoi}.joblib"
    meta_path = out / f"cal_{aoi}.json"
    if not (model_path.exists() and meta_path.exists()):
        return None, None
    try:
        model = joblib.load(model_path)
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None, None
    return model, meta


def predict_viirs(model, modis_count: float, month: int) -> float:
    """Predict VIIRS count from MODIS count + month. Returns float >= 0."""
    m = int(month)
    if not 1 <= m <= 12:
        raise ValueError(f"month must be 1..12, got {month!r}")
    x = np.array(
        [[math.log1p(max(float(modis_count), 0.0)),
          math.sin(2.0 * math.pi * m / 12.0),
          math.cos(2.0 * math.pi * m / 12.0)]],
        dtype=float,
    )
    pred = float(np.expm1(model.predict(x))[0])
    return max(pred, 0.0)
