"""HGB v4 — residual (stacked) model ON TOP of the seasonal-ratio baseline.

Diagnosis from v1–v3 on real full-month data: predicting the seasonal ratio
from features loses to the plain per-month median ratio (B2). The network
spends capacity re-learning a table it could simply be given, and on
high-activity months it is slightly worse every single month.

v4 fixes the architecture rather than tuning harder:

    prediction = modis * b2_ratio[month] * exp(residual)

The model only learns `residual` = log(viirs/modis) − log(b2_ratio[month]),
i.e. "how wrong is the seasonal baseline this month, and why". b2_ratio is
computed from TRAIN months only (never the holdout). Because the residual is
centred near zero, regularisation shrinks it toward 0, giving B2 parity as a
guaranteed floor, and any learned signal is a measured improvement.

Residual features (7): relative activity log(modis / train_clim_modis), day
fraction, Terra fraction, previous-month log MODIS relative to climatology,
month sin/cos, and log(modis) so the correction can depend on fire size.
"""
from __future__ import annotations

import math

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

METHOD_ID = "hgb-b2residual-v4"
ALGORITHM_VERSION = "ml_b2res_v4.1"   # gate + log-space fix (P0-02)
FEATURE_VERSION = "features-v4.1"
FEATURES = ["log_modis", "rel_activity", "day_frac", "terra_frac",
            "prev_rel_activity", "month_sin", "month_cos"]

GRID = [
    {"max_depth": d, "min_samples_leaf": leaf, "l2_regularization": l2}
    for d in (1, 2) for leaf in (10, 20, 40) for l2 in (1.0, 10.0, 50.0, 200.0)
]


def _log_ratio(p: dict) -> float:
    return math.log((float(p["viirs"]) + 1.0) / (float(p["modis"]) + 1.0))


def seasonal_ratios(pairs: list[dict]) -> tuple[dict[int, float], float]:
    """Per-month median LOG ratio (B2) + global median LOG ratio (B1).

    Returned in LOG space on purpose: callers do exp(base) exactly once, so
    there is no double-exponentiation trap (a bug v4 shipped with once).
    """
    logr = [_log_ratio(p) for p in pairs if float(p["modis"]) > 0]
    glob = float(np.median(logr)) if logr else 0.0
    by_m: dict[int, float] = {}
    for m in range(1, 13):
        rs = [_log_ratio(p) for p in pairs if int(p["month"]) == m and float(p["modis"]) > 0]
        if rs:
            by_m[m] = float(np.median(rs))
    return by_m, glob


def _clim_log_modis(pairs: list[dict]) -> tuple[dict[int, float], float]:
    by_m: dict[int, list[float]] = {}
    for p in pairs:
        by_m.setdefault(int(p["month"]), []).append(math.log1p(float(p["modis"])))
    clim = {m: float(np.median(v)) for m, v in by_m.items()}
    glob = float(np.median(list(clim.values()))) if clim else 0.0
    return clim, glob


def _prev_rel(pairs: list[dict], i: int, clim: dict[int, float], glob: float) -> float:
    p = pairs[i]
    if i > 0:
        q = pairs[i - 1]
        if (p["year"] * 12 + p["month"]) - (q["year"] * 12 + q["month"]) == 1:
            return math.log1p(float(q["modis"])) - clim.get(int(q["month"]), glob)
    return 0.0


def featurize(pairs: list[dict], clim: dict[int, float], glob: float) -> np.ndarray:
    X = np.zeros((len(pairs), len(FEATURES)), dtype=float)
    for i, p in enumerate(pairs):
        m = int(p["month"])
        lm = math.log1p(float(p["modis"]))
        X[i, 0] = lm
        X[i, 1] = lm - clim.get(m, glob)
        X[i, 2] = float(p.get("day_frac", 0.5))
        X[i, 3] = float(p.get("terra_frac", 0.5))
        X[i, 4] = _prev_rel(pairs, i, clim, glob)
        X[i, 5] = math.sin(2.0 * math.pi * m / 12.0)
        X[i, 6] = math.cos(2.0 * math.pi * m / 12.0)
    return X


def _residual_target(pairs: list[dict], by_m: dict[int, float], glob: float) -> np.ndarray:
    out = np.zeros(len(pairs), dtype=float)
    for i, p in enumerate(pairs):
        base = by_m.get(int(p["month"]), glob)
        out[i] = _log_ratio(p) - base
    return out


def _fit(train: list[dict], params: dict, seed: int = 7):
    by_m, glob = seasonal_ratios(train)
    clim, cglob = _clim_log_modis(train)
    X = featurize(train, clim, cglob)
    y = _residual_target(train, by_m, glob)
    model = HistGradientBoostingRegressor(
        max_iter=200, learning_rate=0.05, random_state=seed, **params)
    model.fit(X, y)
    model._by_m = by_m
    model._glob = glob
    model._clim = clim
    model._cglob = cglob
    model._target = "b2_residual"
    model._params = dict(params)
    model._features = list(FEATURES)
    model._feature_version = FEATURE_VERSION
    model._algorithm_version = ALGORITHM_VERSION
    return model


def _baseline_log(model, month: int) -> float:
    """The one place the seasonal baseline is chosen (gate off + B1/B2)."""
    if (not getattr(model, "_use_residual", True)
            and getattr(model, "_fallback", "") == "b1_global_ratio"):
        return float(model._glob)
    return float(model._by_m.get(int(month), model._glob))


def _counts_from_log_ratio(modis: float, log_ratio: float) -> float:
    """Inverse transform used by BOTH batch and single-row inference.

    P0-02: predict_counts and predict_one previously used different inverse
    formulas (modis*x vs (modis+1)*x-1), so the reported metric and the served
    value disagreed. This is now the only inverse path.
    """
    return max(math.exp(float(log_ratio)) * (max(float(modis), 0.0) + 1.0) - 1.0, 0.0)


def predict_counts(model, pairs: list[dict]) -> np.ndarray:
    if not getattr(model, "_use_residual", True):
        return np.array([
            _counts_from_log_ratio(p["modis"], _baseline_log(model, int(p["month"])))
            for p in pairs], dtype=float)
    X = featurize(pairs, model._clim, model._cglob)
    resid = model.predict(X)
    return np.array([
        _counts_from_log_ratio(p["modis"],
                               _baseline_log(model, int(p["month"])) + float(resid[i]))
        for i, p in enumerate(pairs)], dtype=float)


def predict_one(model, modis: float, month: int, day_frac: float = 0.5,
                terra_frac: float = 0.5, prev_modis: float | None = None) -> float:
    m = int(month)
    if not 1 <= m <= 12:
        raise ValueError(f"month must be 1..12, got {month!r}")
    modis = max(float(modis), 0.0)
    lm = math.log1p(modis)
    clim_m = model._clim.get(m, model._cglob)
    prev_rel = 0.0
    if prev_modis is not None:
        pm = (m - 1) or 12
        prev_rel = math.log1p(max(float(prev_modis), 0.0)) - model._clim.get(pm, model._cglob)
    x = np.array([[lm, lm - clim_m, float(day_frac), float(terra_frac), prev_rel,
                   math.sin(2.0 * math.pi * m / 12.0),
                   math.cos(2.0 * math.pi * m / 12.0)]], dtype=float)
    base = _baseline_log(model, m)
    if not getattr(model, "_use_residual", True):
        return _counts_from_log_ratio(modis, base)
    resid = float(model.predict(x)[0])
    return _counts_from_log_ratio(modis, base + resid)


def _metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    err = y_pred - y_true
    denom = float(np.sum(y_true)) or 1.0
    return {"mae": float(np.mean(np.abs(err))),
            "wape": float(np.sum(np.abs(err)) / denom),
            "bias": float(np.mean(err))}


def blocked_cv_compare(pairs: list[dict], min_train_years: int = 3) -> dict:
    """Score plain B2 and B2+residual on identical blocked folds.

    This is the gate that decides whether the learned correction is allowed
    to touch the output at all. If the residual does not beat the plain
    seasonal ratio out-of-sample, the served model IS the seasonal ratio
    (residual_enabled=False) rather than a worse model with a nicer name.
    """
    years = sorted({int(p["year"]) for p in pairs})
    if len(years) < min_train_years + 1:
        return {"enabled": False, "reason": "not_enough_years"}
    b2_mae, res_mae, b1_mae, folds = [], [], [], []
    for k in range(min_train_years, len(years)):
        tr = [p for p in pairs if int(p["year"]) in set(years[:k])]
        te = [p for p in pairs if int(p["year"]) == years[k]]
        if not tr or not te:
            continue
        y = np.array([float(p["viirs"]) for p in te])
        bm, g = seasonal_ratios(tr)
        b2 = np.array([p["modis"] * math.exp(bm.get(int(p["month"]), g)) for p in te])
        b1 = np.array([p["modis"] * math.exp(g) for p in te])
        params = {"max_depth": 1, "min_samples_leaf": 20, "l2_regularization": 200.0}
        model = _fit(tr, params)
        res = predict_counts(model, te)
        b2_mae.append(float(np.mean(np.abs(b2 - y))))
        res_mae.append(float(np.mean(np.abs(res - y))))
        b1_mae.append(float(np.mean(np.abs(b1 - y))))
        folds.append({"test_year": years[k],
                      "b1_mae": round(b1_mae[-1], 2),
                      "b2_mae": round(b2_mae[-1], 2),
                      "residual_mae": round(res_mae[-1], 2)})
    m_b2 = float(np.mean(b2_mae))
    m_res = float(np.mean(res_mae))
    wins = sum(1 for b, r in zip(b2_mae, res_mae) if r < b)
    latest_ok = (res_mae[-1] <= b2_mae[-1] * 1.05) if b2_mae else False
    # Three conditions, because a single lucky fold is how v3 fooled itself:
    #   (1) >=2% better on average, (2) wins the majority of folds,
    #   (3) no blow-up on the most recent fold (the one closest to holdout).
    enabled = (m_res < m_b2 * 0.98) and (wins * 2 > len(b2_mae)) and latest_ok
    why = []
    if m_res >= m_b2 * 0.98:
        why.append(f"mean gain only {(1 - m_res / m_b2) * 100:.1f}% (<2%)")
    if wins * 2 <= len(b2_mae):
        why.append(f"won {wins}/{len(b2_mae)} folds")
    if not latest_ok:
        why.append("regressed on the most recent fold")
    m_b1 = float(np.mean(b1_mae)) if b1_mae else float("inf")
    fallback = "b1_global_ratio" if m_b1 < m_b2 else "b2_seasonal_ratio"
    return {"enabled": enabled, "folds": folds,
            "cv_b1_mae": m_b1, "cv_b2_mae": m_b2, "cv_residual_mae": m_res,
            "fold_wins": wins, "n_folds": len(b2_mae),
            "fallback_baseline": fallback,
            "reason": ("residual beats both baselines on the vote" if enabled
                       else "no robust gain; serving " + fallback
                       + " (" + "; ".join(why) + ")")}


def blocked_cv(pairs: list[dict], min_train_years: int = 3) -> dict:
    years = sorted({int(p["year"]) for p in pairs})
    if len(years) < min_train_years + 1:
        return {"cv_mae": {}, "folds": [], "best": None}
    scores: dict[str, list[float]] = {str(g): [] for g in GRID}
    folds = []
    for k in range(min_train_years, len(years)):
        tr = [p for p in pairs if int(p["year"]) in set(years[:k])]
        te = [p for p in pairs if int(p["year"]) == years[k]]
        if not tr or not te:
            continue
        y_true = np.array([float(p["viirs"]) for p in te])
        folds.append({"test_year": years[k], "n_train": len(tr), "n_test": len(te)})
        for g in GRID:
            model = _fit(tr, g)
            scores[str(g)].append(float(np.mean(np.abs(predict_counts(model, te) - y_true))))
    cv = {k: float(np.mean(v)) for k, v in scores.items() if v}
    return {"cv_mae": cv, "folds": folds,
            "best": min(cv, key=cv.get) if cv else None,
            "n_configs": len(cv)}


def train_holdout(pairs: list[dict], test_years: int = 2, tune: bool = True) -> dict:
    pairs = sorted(pairs, key=lambda p: (p["year"], p["month"]))
    years = sorted({int(p["year"]) for p in pairs})
    test_set = set(years[-test_years:]) if test_years > 0 else set()
    train = [p for p in pairs if int(p["year"]) not in test_set]
    test = [p for p in pairs if int(p["year"]) in test_set]
    base = {"trained": False, "n_train": len(train), "n_test": len(test),
            "train_years": sorted({int(p["year"]) for p in train}),
            "test_years": sorted(test_set), "test_year_count": test_years}
    if len(train) < 24 or not test:
        return {**base, "reason": "small_data_need_24_train_pairs"}
    cv = blocked_cv(train) if tune else {"best": None, "cv_mae": {}, "folds": [], "n_configs": 0}
    params = eval(cv["best"]) if cv.get("best") else {
        "max_depth": 1, "min_samples_leaf": 20, "l2_regularization": 50.0}
    gate = blocked_cv_compare(train)
    model = _fit(train, params)
    model._use_residual = bool(gate.get("enabled"))
    model._fallback = gate.get("fallback_baseline", "b2_seasonal_ratio")
    y_true = np.array([float(p["viirs"]) for p in test], dtype=float)
    modis_te = np.array([float(p["modis"]) for p in test], dtype=float)
    by_m, glob = seasonal_ratios(train)
    ml_pred = predict_counts(model, test)
    metrics = {
        "ml": _metrics(y_true, ml_pred),
        "b0_raw_modis": _metrics(y_true, modis_te),
        "b1_global_ratio": _metrics(y_true, modis_te * math.exp(glob)),
        "b2_seasonal_ratio": _metrics(
            y_true, np.array([m * math.exp(by_m.get(int(p["month"]), glob))
                              for m, p in zip(modis_te, test)])),
    }
    # how much of the correction survives? (0 = pure B2 parity)
    resid = model.predict(featurize(test, model._clim, model._cglob))
    return {**base, "trained": True, "model": model, "metrics": metrics,
            "b1_ratio": math.exp(glob),
            "b2_ratios": {str(k): math.exp(v) for k, v in sorted(by_m.items())},
            "b2_log_ratios": {str(k): v for k, v in sorted(by_m.items())},
            "b1_log_ratio": glob,
            "method_id": METHOD_ID, "seed": 7, "target": "b2_residual",
            "features": list(FEATURES), "params": params,
            "feature_version": FEATURE_VERSION,
            "algorithm_version": ALGORITHM_VERSION,
            "selected_by": "blocked_time_series_cv" if tune else "default",
            "residual_mean": float(np.mean(resid)),
            "residual_abs_mean": float(np.mean(np.abs(resid))),
            "residual_enabled": bool(gate.get("enabled")),
            "fallback_baseline": gate.get("fallback_baseline"),
            "residual_gate": gate,
            "cv": cv}
