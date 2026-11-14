"""HGB cross-sensor calibrator v3 - log-ratio target + blocked CV tuning.

Two structural fixes over v2 (which lost to the seasonal baseline):

1. TARGET SPACE. v1/v2 predicted log1p(VIIRS) as a level. Absolute fire
   activity swings 5x between years, so a model fit on 2019 extrapolates
   badly to 2025 (measured: +50% bias). v3 predicts the log RATIO
   y = log((viirs+1)/(modis+1)), which is far more stationary across years,
   then multiplies back by the observed MODIS count:
       viirs_hat = exp(y_hat) * (modis + 1) - 1
   The MODIS count is never lost, only the sensor-offset ratio is learned.

2. HYPERPARAMETERS by blocked time-series CV, not hand-picked. A small grid
   is scored with expanding-window folds (each fold trains on all earlier
   years and scores the next), and the winner is refit on all train years.
   The holdout years are never used for selection.

Features (8): log_modis, log_modis_prev, month sin/cos, day_frac,
terra_frac, plus same-month train climatology (log-ratio median and
log_modis median) so the model knows whether this month is high or low
relative to its own seasonal norm.
"""
from __future__ import annotations

import math

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

METHOD_ID = "hgb-logratio-v3"
FEATURES = ["log_modis", "log_modis_prev", "month_sin", "month_cos",
            "day_frac", "terra_frac", "clim_log_ratio", "clim_log_modis"]

GRID = [
    {"max_depth": d, "min_samples_leaf": leaf, "l2_regularization": l2}
    for d in (1, 2, 3) for leaf in (5, 10, 20) for l2 in (0.0, 1.0, 10.0, 50.0)
]


def _climatology(pairs: list[dict]) -> tuple[dict[int, float], dict[int, float]]:
    """Same-month medians from TRAIN only: log-ratio and log-modis."""
    by_m: dict[int, list[float]] = {}
    by_m_logmodis: dict[int, list[float]] = {}
    for p in pairs:
        m = int(p["month"])
        modis = float(p["modis"])
        viirs = float(p["viirs"])
        if modis <= 0:
            continue
        by_m.setdefault(m, []).append(math.log((viirs + 1.0) / (modis + 1.0)))
        by_m_logmodis.setdefault(m, []).append(math.log1p(modis))
    clim_r = {m: float(np.median(v)) for m, v in by_m.items()}
    clim_m = {m: float(np.median(v)) for m, v in by_m_logmodis.items()}
    return clim_r, clim_m


def _prev_log(pairs: list[dict], i: int) -> float:
    p = pairs[i]
    if i > 0:
        q = pairs[i - 1]
        if (p["year"] * 12 + p["month"]) - (q["year"] * 12 + q["month"]) == 1:
            return math.log1p(float(q["modis"]))
    return math.log1p(float(p["modis"]))


def featurize(pairs: list[dict],
              clim_r: dict[int, float] | None = None,
              clim_m: dict[int, float] | None = None) -> np.ndarray:
    """X (n, 8). Climatology must come from TRAIN pairs only."""
    if clim_r is None or clim_m is None:
        clim_r, clim_m = _climatology(pairs)
    glob_r = float(np.median(list(clim_r.values()))) if clim_r else 0.0
    glob_m = float(np.median(list(clim_m.values()))) if clim_m else 0.0
    X = np.zeros((len(pairs), len(FEATURES)), dtype=float)
    for i, p in enumerate(pairs):
        m = int(p["month"])
        X[i, 0] = math.log1p(float(p["modis"]))
        X[i, 1] = _prev_log(pairs, i)
        X[i, 2] = math.sin(2.0 * math.pi * m / 12.0)
        X[i, 3] = math.cos(2.0 * math.pi * m / 12.0)
        X[i, 4] = float(p.get("day_frac", 0.5))
        X[i, 5] = float(p.get("terra_frac", 0.5))
        X[i, 6] = clim_r.get(m, glob_r)
        X[i, 7] = clim_m.get(m, glob_m)
    return X


def target_log_ratio(pairs: list[dict]) -> np.ndarray:
    return np.array([math.log((float(p["viirs"]) + 1.0) / (float(p["modis"]) + 1.0))
                     for p in pairs], dtype=float)


def to_counts(pairs: list[dict], y_log_ratio: np.ndarray) -> np.ndarray:
    modis = np.array([float(p["modis"]) for p in pairs], dtype=float)
    return np.clip(np.exp(y_log_ratio) * (modis + 1.0) - 1.0, 0.0, None)


def _fit(pairs: list[dict], params: dict, seed: int = 7):
    clim_r, clim_m = _climatology(pairs)
    X = featurize(pairs, clim_r, clim_m)
    y = target_log_ratio(pairs)
    model = HistGradientBoostingRegressor(
        max_iter=250, learning_rate=0.05, random_state=seed, **params)
    model.fit(X, y)
    model._clim_r = clim_r  # noqa: SLF001 - small metadata bundle
    model._clim_m = clim_m
    model._target = "log_ratio"
    model._params = dict(params)
    model._features = list(FEATURES)
    return model


def _metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    err = y_pred - y_true
    denom = float(np.sum(y_true)) or 1.0
    return {"mae": float(np.mean(np.abs(err))),
            "wape": float(np.sum(np.abs(err)) / denom),
            "bias": float(np.mean(err))}


def predict_counts(model, pairs: list[dict]) -> np.ndarray:
    """Predicted VIIRS counts for a list of monthly rows (needs modis/month/context)."""
    return to_counts(pairs, model.predict(
        featurize(pairs, model._clim_r, model._clim_m)))


def predict_one(model, modis: float, month: int, day_frac: float = 0.5,
                terra_frac: float = 0.5, prev_modis: float | None = None) -> float:
    """Single-month prediction from MODIS count + observing context."""
    m = int(month)
    if not 1 <= m <= 12:
        raise ValueError(f"month must be 1..12, got {month!r}")
    glob_r = float(np.median(list(model._clim_r.values()))) if model._clim_r else 0.0
    glob_m = float(np.median(list(model._clim_m.values()))) if model._clim_m else 0.0
    lm = math.log1p(max(float(modis), 0.0))
    lp = math.log1p(max(float(prev_modis), 0.0)) if prev_modis is not None else lm
    x = np.array([[lm, lp,
                   math.sin(2.0 * math.pi * m / 12.0),
                   math.cos(2.0 * math.pi * m / 12.0),
                   float(day_frac), float(terra_frac),
                   model._clim_r.get(m, glob_r), model._clim_m.get(m, glob_m)]],
                 dtype=float)
    y = float(model.predict(x)[0])
    return max(math.exp(y) * (max(float(modis), 0.0) + 1.0) - 1.0, 0.0)


def blocked_cv(pairs: list[dict], min_train_years: int = 3) -> dict:
    """Expanding-window CV over years; scores in count space.

    Fold k: train on years[0:k], score year k. Configs are ranked by mean
    MAE across folds. No holdout year is ever in a scoring fold.
    """
    years = sorted({int(p["year"]) for p in pairs})
    if len(years) < min_train_years + 1:
        return {"cv_mae": {}, "folds": []}
    scores: dict[str, list[float]] = {str(g): [] for g in GRID}
    folds = []
    for k in range(min_train_years, len(years)):
        tr_years = set(years[:k])
        te_year = years[k]
        tr = [p for p in pairs if int(p["year"]) in tr_years]
        te = [p for p in pairs if int(p["year"]) == te_year]
        if not tr or not te:
            continue
        y_true = np.array([float(p["viirs"]) for p in te])
        folds.append({"train_years": sorted(tr_years), "test_year": te_year,
                      "n_train": len(tr), "n_test": len(te)})
        for g in GRID:
            model = _fit(tr, g)
            pred = to_counts(te, model.predict(featurize(
                te, model._clim_r, model._clim_m)))
            scores[str(g)].append(float(np.mean(np.abs(pred - y_true))))
    cv_mae = {k: float(np.mean(v)) for k, v in scores.items() if v}
    return {"cv_mae": cv_mae, "folds": folds,
            "best": min(cv_mae, key=cv_mae.get) if cv_mae else None,
            "n_configs": len(cv_mae)}


def train_holdout(pairs: list[dict], test_years: int = 2, tune: bool = True) -> dict:
    """Blocked-CV tuned HGB on log-ratio target, then a temporal holdout."""
    pairs = sorted(pairs, key=lambda p: (p["year"], p["month"]))
    years = sorted({int(p["year"]) for p in pairs})
    test_set = set(years[-test_years:]) if test_years > 0 else set()
    train = [p for p in pairs if int(p["year"]) not in test_set]
    test = [p for p in pairs if int(p["year"]) in test_set]
    base = {"trained": False, "n_train": len(train), "n_test": len(test),
            "train_years": sorted({int(p["year"]) for p in train}),
            "test_years": sorted(test_set), "test_year_count": test_years}
    if len(train) < 24 or not test:
        return {**base, "reason": "small_data_need_24_train_pairs_and_nonempty_test"}

    cv = blocked_cv(train) if tune else {"cv_mae": {}, "best": None, "folds": []}
    params = eval(cv["best"]) if cv.get("best") else {
        "max_depth": 2, "min_samples_leaf": 10, "l2_regularization": 10.0}

    # baselines (train-only, ratio space)
    log_ratios = [math.log((float(p["viirs"]) + 1) / (float(p["modis"]) + 1))
                  for p in train if float(p["modis"]) > 0]
    glob_ratio = math.exp(float(np.median(log_ratios))) if log_ratios else 1.0
    by_m: dict[int, float] = {}
    for m in range(1, 13):
        rs = [math.log((float(p["viirs"]) + 1) / (float(p["modis"]) + 1))
              for p in train if int(p["month"]) == m and float(p["modis"]) > 0]
        if rs:
            by_m[m] = math.exp(float(np.median(rs)))

    model = _fit(train, params)
    y_true = np.array([float(p["viirs"]) for p in test], dtype=float)
    mod_te = np.array([float(p["modis"]) for p in test], dtype=float)
    ml_pred = to_counts(test, model.predict(featurize(test, model._clim_r, model._clim_m)))
    metrics = {
        "ml": _metrics(y_true, ml_pred),
        "b0_raw_modis": _metrics(y_true, mod_te),
        "b1_global_ratio": _metrics(y_true, mod_te * glob_ratio),
        "b2_seasonal_ratio": _metrics(
            y_true, np.array([m * by_m.get(int(p["month"]), glob_ratio)
                              for m, p in zip(mod_te, test)])),
    }
    return {**base, "trained": True, "model": model, "metrics": metrics,
            "b1_ratio": glob_ratio,
            "b2_ratios": {str(k): v for k, v in sorted(by_m.items())},
            "method_id": METHOD_ID, "seed": 7, "target": "log_ratio",
            "features": list(FEATURES), "params": params,
            "selected_by": "blocked_time_series_cv" if tune else "default",
            "cv": {"best": cv.get("best"), "cv_mae": cv.get("cv_mae", {}),
                   "folds": cv.get("folds", []), "n_configs": cv.get("n_configs", 0)}}
