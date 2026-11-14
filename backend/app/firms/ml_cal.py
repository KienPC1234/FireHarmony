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
import hashlib
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

METHOD_ID = "hgb-log1p-v2"
SEED = 7
FEATURES = ["log_modis", "month_sin", "month_cos",
            "day_frac", "terra_frac", "log_modis_prev"]
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


def _monthly_pair_accumulator() -> dict:
    return {}


def _accumulate_pair(counts: dict, rec: dict) -> None:
    ym = _parse_year_month(rec)
    if ym is None:
        return
    year, month = ym
    if year < OVERLAP_START_YEAR:
        return
    inst = _norm_instrument(rec)
    if inst is None:
        return
    key = (year, month)
    slot = counts.setdefault(key, {"modis": 0, "viirs": 0,
                                   "day": 0, "night": 0,
                                   "terra": 0, "aqua": 0})
    if inst == "MODIS":
        slot["modis"] += 1
        dn = str(rec.get("daynight", "") or "").upper()
        if dn == "D":
            slot["day"] += 1
        elif dn == "N":
            slot["night"] += 1
        sat = str(rec.get("satellite", "") or "")
        if sat == "Terra":
            slot["terra"] += 1
        elif sat == "Aqua":
            slot["aqua"] += 1
    else:
        slot["viirs"] += 1


def _finalize_pairs(counts: dict) -> list[dict]:
    pairs = []
    for (y, m), v in counts.items():
        if v["modis"] > 0 and v["viirs"] > 0:
            dd = v["day"] + v["night"]
            tt = v["terra"] + v["aqua"]
            pairs.append({"year": y, "month": m, "modis": v["modis"], "viirs": v["viirs"],
                          "day_frac": v["day"] / dd if dd else 0.5,
                          "terra_frac": v["terra"] / tt if tt else 0.5})
    pairs.sort(key=lambda p: (p["year"], p["month"]))
    return pairs


class PairBuilder:
    """Streaming monthly-pair accumulator (no per-row storage)."""

    def __init__(self) -> None:
        self.counts: dict[tuple[int, int], dict[str, int]] = {}

    def add(self, rec: dict) -> None:
        if isinstance(rec, dict):
            _accumulate_pair(self.counts, rec)

    def finalize(self) -> list[dict]:
        return _finalize_pairs(self.counts)


def build_monthly_pairs(records: list[dict]) -> list[dict]:
    """Aggregate raw records by year-month (sum counts per instrument).

    Keeps only overlap-era months (year >= 2012) with both MODIS > 0
    and VIIRS > 0. Returns sorted [{year, month, modis, viirs,
    day_frac, terra_frac}, ...] where day_frac/terra_frac describe the
    MODIS detections (observable pre-2012 too): fraction daytime and
    fraction Terra (vs Aqua). 0.5 fallback when the split is unknown.
    """
    counts: dict[tuple[int, int], dict[str, int]] = {}
    for rec in records or []:
        if isinstance(rec, dict):
            _accumulate_pair(counts, rec)
    return _finalize_pairs(counts)


def build_monthly_pairs_iter(records) -> list[dict]:
    """Streaming variant: accepts an iterable, never materialises rows.

    Used for the 4.4M-row amazon pull, where `load_raw_merged` would exceed
    RAM. Returns the same structure as `build_monthly_pairs`.
    """
    counts: dict[tuple[int, int], dict[str, int]] = {}
    for rec in records or ():
        if isinstance(rec, dict):
            _accumulate_pair(counts, rec)
    return _finalize_pairs(counts)


def _prev_log(pairs: list[dict], i: int) -> float:
    """log1p(MODIS) of the previous consecutive month, else own value."""
    p = pairs[i]
    if i > 0:
        q = pairs[i - 1]
        if (p["year"] * 12 + p["month"]) - (q["year"] * 12 + q["month"]) == 1:
            return math.log1p(float(q["modis"]))
    return math.log1p(float(p["modis"]))


class ModisCtxBuilder:
    """Streaming MODIS observing context (never stores per-row dicts)."""

    def __init__(self) -> None:
        self.acc: dict[str, dict] = {}

    def add(self, rec: dict) -> None:
        if not isinstance(rec, dict):
            return
        ym = _parse_year_month(rec)
        if ym is None or _norm_instrument(rec) != "MODIS":
            return
        key = f"{ym[0]}-{ym[1]:02d}"
        s = self.acc.setdefault(key, {"modis": 0, "day": 0, "night": 0,
                                      "terra": 0, "aqua": 0})
        s["modis"] += 1
        if str(rec.get("daynight", "") or "").upper() == "D":
            s["day"] += 1
        elif str(rec.get("daynight", "") or "").upper() == "N":
            s["night"] += 1
        if str(rec.get("satellite", "") or "") == "Terra":
            s["terra"] += 1
        elif str(rec.get("satellite", "") or "") == "Aqua":
            s["aqua"] += 1

    def modis_counts(self) -> dict[str, float]:
        return {k: float(v["modis"]) for k, v in self.acc.items()}

    def finalize(self) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for key in sorted(self.acc):
            s = self.acc[key]
            dd, tt = s["day"] + s["night"], s["terra"] + s["aqua"]
            y, m = int(key[:4]), int(key[5:7])
            py, pm = ((y, m - 1) if m > 1 else (y - 1, 12))
            pkey = f"{py}-{pm:02d}"
            out[key] = {"modis": float(s["modis"]),
                        "day_frac": s["day"] / dd if dd else 0.5,
                        "terra_frac": s["terra"] / tt if tt else 0.5,
                        "prev_modis": (float(self.acc[pkey]["modis"])
                                       if pkey in self.acc else float(s["modis"]))}
        return out


def monthly_modis_ctx(records: list[dict]) -> dict[str, dict]:
    """Per-month MODIS observing context for serving: {ym: {modis,
    day_frac, terra_frac, prev_modis}}. All years, MODIS-only months kept
    (serving targets pre-2012 months with no VIIRS at all)."""
    b = ModisCtxBuilder()
    for rec in records or []:
        b.add(rec)
    return b.finalize()


def featurize(pairs: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Feature matrix X (n,6) and log-space target y (n,)."""
    n = len(pairs)
    X = np.zeros((n, 6), dtype=float)
    y = np.zeros(n, dtype=float)
    for i, p in enumerate(pairs):
        m = int(p["month"])
        X[i, 0] = math.log1p(float(p["modis"]))
        X[i, 1] = math.sin(2.0 * math.pi * m / 12.0)
        X[i, 2] = math.cos(2.0 * math.pi * m / 12.0)
        X[i, 3] = float(p.get("day_frac", 0.5))
        X[i, 4] = float(p.get("terra_frac", 0.5))
        X[i, 5] = _prev_log(pairs, i)
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
    # Small data (tens of months) -> strong regularization, or the trees
    # memorize train-year quirks and explode on new years (measured).
    model = HistGradientBoostingRegressor(
        max_iter=150, max_depth=2, min_samples_leaf=10,
        l2_regularization=10.0, random_state=SEED
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


def save_artifact(model, meta: dict, aoi: str, model_dir, tag: str = "sample") -> dict:
    """Dump model + JSON sidecar. tag=sample|raw keeps real-trained apart."""
    out = Path(model_dir)
    out.mkdir(parents=True, exist_ok=True)
    suffix = "" if tag == "sample" else f"_{tag}"
    model_path = out / f"cal_{aoi}{suffix}.joblib"
    meta_path = out / f"cal_{aoi}{suffix}.json"
    joblib.dump(model, model_path)
    meta = dict(meta or {})
    doc = {
        "method_id": meta.get("method_id", getattr(model, "_method_id", METHOD_ID)),
        "seed": meta.get("seed", SEED),
        "aoi": aoi,
        "data_tag": tag,
        "training_source": meta.get("training_source", "synthetic-sample"),
        "dataset_sha256": meta.get("dataset_sha256", ""),
        "train_years": meta.get("train_years", []),
        "test_years": meta.get("test_years", []),
        "n_train": meta.get("n_train", 0),
        "n_test": meta.get("n_test", 0),
        "metrics": meta.get("metrics", {}),
        "features": meta.get("features", list(FEATURES)),
        "sklearn_version": _SKLEARN_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    for extra in ("b1_ratio", "b2_ratios", "b2_log_ratios", "b1_log_ratio",
                  "params", "target", "cv", "selected_by",
                  "residual_enabled", "residual_gate", "fallback_baseline",
                  "residual_mean", "residual_abs_mean",
                  "feature_version", "algorithm_version", "data_fingerprint",
                  "dataset_sha256", "eval_manifest_id", "notes", "unified_eval"):
        if extra in meta:
            doc[extra] = meta[extra]
    meta_path.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    return {"model_path": str(model_path), "meta_path": str(meta_path),
            "model_sha256": hashlib.sha256(model_path.read_bytes()).hexdigest()[:16],
            "meta_sha256": hashlib.sha256(meta_path.read_bytes()).hexdigest()[:16]}


def artifact_compat(model, meta: dict, expected_fingerprint: str | None = None) -> tuple[bool, str]:
    """Validate that an artifact belongs to the data/model version on disk.

    Audit P0-13: existence was the only check, so an artifact trained before a
    data repair could keep serving. Returns (ok, reason).
    """
    if model is None or meta is None:
        return False, "artifact_missing"
    target = getattr(model, "_target", meta.get("target"))
    if target == "b2_residual":
        from app.firms import ml_v4
        fv = meta.get("feature_version") or getattr(model, "_feature_version", None)
        if fv and fv != ml_v4.FEATURE_VERSION:
            return False, f"feature_version_mismatch:{fv}!={ml_v4.FEATURE_VERSION}"
    fp = meta.get("data_fingerprint")
    if expected_fingerprint is not None:
        if not fp:
            return False, "artifact_missing_data_fingerprint"
        if fp != expected_fingerprint:
            return False, f"data_fingerprint_mismatch:{fp}!={expected_fingerprint}"
    return True, "ok"


def load_artifact(aoi: str, model_dir, tag: str = "sample"):
    """Load (model, meta) or (None, None) when files are missing."""
    out = Path(model_dir)
    suffix = "" if tag == "sample" else f"_{tag}"
    model_path = out / f"cal_{aoi}{suffix}.joblib"
    meta_path = out / f"cal_{aoi}{suffix}.json"
    if not (model_path.exists() and meta_path.exists()):
        return None, None
    try:
        model = joblib.load(model_path)
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None, None
    return model, meta


def predict_viirs(model, modis_count: float, month: int,
                  day_frac: float = 0.5, terra_frac: float = 0.5,
                  prev_modis: float | None = None) -> float:
    """Predict VIIRS count; dispatches on the artifact's declared target.

    Audit P0-01: v4 artifacts declare `_target='b2_residual'` and need 7
    features. The previous version fell through to the legacy 6-feature path,
    raised ValueError inside the request handler, and the caller swallowed it,
    so `?method=ml` silently served the statistical calendar. Every branch now
    dispatches explicitly and unknown targets raise instead of guessing.
    """
    target = getattr(model, "_target", None)
    if target == "b2_residual":
        from app.firms import ml_v4
        return float(ml_v4.predict_one(model, modis_count, month,
                                       day_frac, terra_frac, prev_modis))
    if target == "log_ratio":
        from app.firms import ml_v3
        return float(ml_v3.predict_one(model, modis_count, month,
                                       day_frac, terra_frac, prev_modis))
    if target == "level_log1p":
        pass  # legacy artifact: handled below
    elif target is not None:
        raise ValueError(f"Unsupported ML target {target!r} in artifact")

    m = int(month)
    if not 1 <= m <= 12:
        raise ValueError(f"month must be 1..12, got {month!r}")
    lm = math.log1p(max(float(modis_count), 0.0))
    lp = math.log1p(max(float(prev_modis), 0.0)) if prev_modis is not None else lm
    n_feat = int(getattr(model, "n_features_in_", 6))
    row = [lm,
           math.sin(2.0 * math.pi * m / 12.0),
           math.cos(2.0 * math.pi * m / 12.0),
           float(day_frac), float(terra_frac), lp]
    if n_feat > len(row):
        raise ValueError(f"Artifact expects {n_feat} features; adapter provides "
                         f"{len(row)}. Refusing to guess (retrain the artifact).")
    x = np.array([row[:n_feat]], dtype=float)
    pred = float(np.expm1(model.predict(x))[0])
    return max(pred, 0.0)
