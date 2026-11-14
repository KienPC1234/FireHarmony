"""FIRMS harmonized burning-activity calendar API (NASA Space Apps 2026)."""
from __future__ import annotations

import csv
import io
import json
import logging
import math
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.firms import calendar as cal
from app.firms import (coverage as cov, dl, evaluation, explain as ex, harmonize,
                       llm, ml_cal, ml_v4, store, ts_v2 as tst)
from app.firms.schema import FirmsRecord

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(),
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("firms.api")

PROJECT_ROOT = Path(__file__).resolve().parents[1]

AOIS = {
    "vietnam": "Vietnam — Central Highlands / Mekong, dry Dec–Apr",
    "amazon": "Amazon — southern basin, dry Jul–Oct (2019 fire season)",
    "australia": "Australia — southeast, dry Dec–Feb (Black Summer 2019–20)",
}
REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = Path(__file__).resolve().parents[1] / "data" / "firms" / "models"

app = FastAPI(
    title="FIRMS Harmonized Fire Calendar API",
    description=("Harmonization of MODIS and VIIRS hot spots into one "
                 "burning-activity calendar. Upload FIRMS CSV -> harmonized "
                 "calendar + anomalies + CSV export."),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Admin-Token"],
    max_age=600,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

_STARTED = time.time()


def _sample_records(limit: int = 500, aoi: str = "vietnam") -> list[dict]:
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}; choose from {sorted(AOIS)}")
    try:
        return store.load_records(aoi, limit)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "firms-calendar",
            "uptime_s": round(time.time() - _STARTED, 1),
            "torch": dl.describe()["has_torch"],
            "methods_available": {"stat": True, "ml": True,
                                  "ts": bool(tst._HAS_TORCH)},  # noqa: SLF001
            "admin_gated": bool(os.getenv("ADMIN_TOKEN")) or
                           os.getenv("APP_ENV", "").lower() in ("production", "prod")}


@app.get("/api/firms/aois")
def firms_aois():
    return {"aois": [{"id": k, "label": v} for k, v in AOIS.items()]}


@app.get("/api/firms/schema")
def firms_schema():
    return {"fields": list(FirmsRecord.model_fields.keys()),
            "instruments": ["MODIS", "VIIRS"],
            "notes": "Field names match NASA FIRMS CSV headers (lowercased)."}


@app.get("/api/firms/sample")
def firms_sample(limit: int = Query(200, ge=1, le=2000),
                 aoi: str = Query("vietnam", description="preset region")):
    rows = _sample_records(limit, aoi)
    return {"count": len(rows), "records": rows}


@app.post("/api/firms/validate")
def firms_validate(payload: dict):
    """Validate raw FIRMS rows -> clean records + QA flags."""
    raw = payload.get("records", [])
    if not isinstance(raw, list) or len(raw) > 50000:
        raise HTTPException(400, "Provide records: list (max 50000)")
    clean, rejected = [], []
    for i, r in enumerate(raw):
        try:
            rec = FirmsRecord(**{k.lower(): v for k, v in dict(r).items()})
            d = rec.model_dump(mode="json")
            d["qa_flag"] = rec.qa()
            clean.append(d)
        except Exception as e:  # noqa: BLE001 - report per-row, don't fail batch
            rejected.append({"index": i, "error": str(e)[:200]})
    qa_counts: dict[str, int] = {}
    for c in clean:
        qa_counts[c["qa_flag"]] = qa_counts.get(c["qa_flag"], 0) + 1
    return {"clean": len(clean), "rejected": len(rejected),
            "qa_counts": qa_counts, "records": clean[:1000],
            "errors": rejected[:50]}


def _parse_bbox(raw: str | None) -> tuple[float, float, float, float] | None:
    """Parse 'minLon,minLat,maxLon,maxLat'. None = whole dataset."""
    if not raw:
        return None
    try:
        x0, y0, x1, y1 = (float(v) for v in raw.split(","))
    except ValueError:
        raise HTTPException(400, "bbox must be 'minLon,minLat,maxLon,maxLat'")
    if not (-180 <= x0 < x1 <= 180 and -90 <= y0 < y1 <= 90):
        raise HTTPException(400, "bbox out of range or inverted")
    return (x0, y0, x1, y1)


def _pairs_for(aoi: str, data: str) -> list[dict]:
    """Monthly pairs without materialising a multi-million-row raw pull."""
    if data == "raw":
        return ml_cal.build_monthly_pairs_iter(
            store.iter_raw_rows(aoi, limit=None))
    return ml_cal.build_monthly_pairs(_resolve_records(aoi, data, 100000))


def _resolve_records(aoi: str, data: str, limit: int,
                     dataset: str | None = None) -> list[dict]:
    """Sample CSV (stable demo), merged real downloads (data=raw),
    or a session upload (dataset=upload:<id>, P1-18)."""
    if dataset:
        try:
            return store.load_upload_dataset(dataset, limit)
        except ValueError as e:
            raise HTTPException(404, str(e))
    if data == "raw":
        if aoi not in store.AOIS and aoi != "custom":
            raise HTTPException(400, f"Unknown aoi {aoi!r}")
        return store.load_raw_merged(aoi, limit)
    return _sample_records(limit, aoi)


def _data_source_label(data: str, dataset: str | None = None) -> str:
    if dataset:
        return "user-uploaded session dataset (unverified source)"
    return ("synthetic demo (NOT observed — do not claim real events)"
            if data == "sample" else "NASA FIRMS observed")


def _require_admin(request: Request) -> None:
    """Gate write/train endpoints when ADMIN_TOKEN is set; open local dev otherwise.

    Audit P1-13: production must never silently run with write endpoints open.
    Set APP_ENV=production (and ADMIN_TOKEN) for any public deployment.
    """
    tok = os.getenv("ADMIN_TOKEN", "")
    production = os.getenv("APP_ENV", "").lower() in ("production", "prod")
    if tok and request.headers.get("X-Admin-Token") != tok:
        raise HTTPException(403, "Admin token required (X-Admin-Token)")
    if production and not tok:
        raise HTTPException(503, "ADMIN_TOKEN must be set when APP_ENV=production")


def _block_raw_ml_ts(method: str, data: str, aoi: str = "vietnam") -> None:
    """ML/TS on raw requires a compatible raw-trained artifact.

    Audit P0-13: file existence was the only check, so an artifact trained
    before a data repair kept serving. Now the artifact must declare the same
    data fingerprint, feature version and algorithm family as the code and
    the raw set currently on disk; otherwise the request fails loudly (409).
    """
    if method not in ("ml", "ts") or data != "raw":
        return
    if method == "ml":
        model, meta = ml_cal.load_artifact(aoi, MODEL_DIR, tag="raw")
        ok, why = ml_cal.artifact_compat(
            model, meta, expected_fingerprint=store.raw_fingerprint(aoi))
    else:
        models, meta = tst.load_artifact(aoi, MODEL_DIR, tag="raw")
        ok, why = tst.artifact_compat(
            models, meta,
            expected_fingerprint=store.pooled_fingerprint(store.AOIS))
    if meta is None:
        raise HTTPException(
            422, f"no raw-trained {method} artifact for aoi={aoi}; "
            "use method=stat for NASA observed, or POST /api/firms/"
            f"{'ml' if method == 'ml' else 'ts'}-train with data=raw "
            "on dense overlap data")
    if not ok:
        raise HTTPException(
            409, f"raw {method} artifact for aoi={aoi} is incompatible ({why}); "
            "retrain it against the current data (python -m scripts.firms."
            f"{'train_ml' if method == 'ml' else 'train_ts'} --aoi {aoi} --data raw)")


def _round4(x):
    """Round every float in a nested metrics structure to 4 decimals."""
    if isinstance(x, float):
        return round(x, 4)
    if isinstance(x, dict):
        return {k: _round4(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_round4(v) for v in x]
    return x


def _forecast(calen: dict, latest_date: str | None) -> dict | None:
    """Seasonal-naive climatology outlook (NOT a prediction).

    P1-11: uses only year-months with observed coverage; baseline excludes the
    target year's own value via col history; n_years = covered years, and
    returns None when fewer than 3 covered years exist.
    """
    if not latest_date or not calen.get("years"):
        return None
    try:
        ly, lm = int(latest_date[:4]), int(latest_date[5:7])
    except ValueError:
        return None
    ty, tm = (ly + 1, 1) if lm == 12 else (ly, lm + 1)
    mi = tm - 1
    comp = calen.get("completeness", {})
    # Climatology only from months whose coverage is not verified-partial.
    col = [calen["matrix"][yi][mi] for yi in range(len(calen["years"]))
           if calen["matrix"][yi][mi] is not None
           and comp.get(f"{calen['years'][yi]}-{mi + 1:02d}", {}).get("partial") is not True]
    if len(col) < 3:
        return None
    col = sorted(col)
    n = len(col)
    q = lambda p: col[min(n - 1, int(p * n))]
    return {"year": ty, "month": tm, "median": round(col[n // 2], 2),
            "p25": round(q(0.25), 2), "p75": round(q(0.75), 2),
            "n_years": n, "method": "seasonal-naive climatology (same-month history, not a prediction)"}


def _in_bbox(r: dict, b: tuple[float, float, float, float] | None) -> bool:
    if b is None:
        return True
    try:
        return b[0] <= float(r["longitude"]) <= b[2] and b[1] <= float(r["latitude"]) <= b[3]
    except (KeyError, TypeError, ValueError):
        return False


def _harmonize_daily_ml(agg: dict, model, meta: dict | None,
                        clean: list[dict] | None = None,
                        ctx: dict | None = None) -> tuple[list[dict], dict]:
    """Monthly ML post-adjustment with conservation (method_id from artifact).

    Predict each month's VIIRS total from that month's MODIS total + observing
    context (day_frac, terra_frac, prev-month MODIS). Only rescales
    modis_upscaled_estimated cells, so the month total equals the prediction.

    Audit P0-01: inference dispatch goes through `ml_cal.predict_viirs`, which
    now recognises v4 `b2_residual`. Failures are counted and surfaced; the
    request is no longer allowed to claim ML while silently serving stat.
    """
    mid = (meta or {}).get("method_id", "ml_b2res_v4")
    residual_on = bool((meta or {}).get("residual_enabled", True))
    fallback = (meta or {}).get("fallback_baseline")
    served = mid if residual_on else f"stat:{fallback or 'baseline'}"
    ratios = harmonize.estimate_efficiency_ratio(agg, mode="fusion")
    stat = harmonize.harmonize_daily(agg, ratios)
    ctx = ctx if ctx is not None else ml_cal.monthly_modis_ctx(clean or [])
    factors: dict[str, float] = {}
    preds: dict[str, float] = {}
    failed: list[dict] = []
    below_observed: list[str] = []
    scored: list[str] = []
    for ym in sorted({str(c["date"])[:7] for c in stat}):
        mc = ctx.get(ym, {"modis": 0.0, "day_frac": 0.5,
                          "terra_frac": 0.5, "prev_modis": 0.0})
        try:
            pred = float(ml_cal.predict_viirs(model, mc["modis"], int(ym[5:7]),
                                              mc["day_frac"], mc["terra_frac"],
                                              mc["prev_modis"]))
        except Exception as e:  # noqa: BLE001 - counted, never silent
            failed.append({"month": ym, "error": f"{type(e).__name__}: {e}"[:180]})
            continue
        scored.append(ym)
        preds[ym] = pred
        stat_total = sum(c["harmonized_count"] for c in stat if str(c["date"])[:7] == ym)
        stat_modis_only = sum(c["harmonized_count"] for c in stat
                              if str(c["date"])[:7] == ym
                              and c.get("estimate_type") == "modis_upscaled_estimated")
        observed_part = stat_total - stat_modis_only
        target_est = pred - observed_part
        if stat_modis_only > 0 and target_est > 0:
            factors[ym] = target_est / stat_modis_only
        else:
            below_observed.append(ym)
    if failed and not scored:
        raise HTTPException(
            500, "ML inference failed for every month; refusing to serve the "
                 "statistical calendar under an ML label. First error: "
                 + failed[0]["error"])
    out = []
    for c in stat:
        ym = str(c["date"])[:7]
        if c.get("estimate_type") == "modis_upscaled_estimated" and ym in factors:
            c = {**c, "harmonized_count": round(c["harmonized_count"] * factors[ym], 3),
                 "estimate_type": "ml_predicted",
                 "method": served,
                 "effective_method": served,
                 "coverage_status": "unknown"}
        else:
            c = {**c, "effective_method": "stat:seasonal_ratio_v1"}
        out.append(c)
    conservation = []
    for ym in factors:
        total = sum(float(c["harmonized_count"]) for c in out if str(c["date"])[:7] == ym)
        conservation.append(abs(total - preds.get(ym, total)))
    diagnostics = {
        **(meta or {}),
        "requested_method": "ml",
        "effective_method": served,
        "model_method_id": mid,
        "target": (meta or {}).get("target"),
        "residual_enabled": residual_on,
        "fallback_baseline": fallback,
        "feature_version": (meta or {}).get("feature_version"),
        "months_requested": len({str(c["date"])[:7] for c in stat}),
        "months_scored": len(scored),
        "months_failed": len(failed),
        "failed_months": failed[:10],
        "months_corrected": len(factors),
        "months_prediction_below_observed": len(below_observed),
        "below_observed_examples": below_observed[:10],
        "conservation_max_abs_error": round(max(conservation), 4) if conservation else 0.0,
    }
    return out, diagnostics


def _harmonize_daily_ts(clean: list[dict] | None, daily_stat: list[dict], aoi: str,
                        data: str = "sample",
                        modis_counts: dict[str, float] | None = None) -> tuple[list[dict], dict]:
    """Monthly Transformer post-adjustment (ts_logratio_pool_v2).

    The pooled model predicts a month's VIIRS/MODIS log ratio from the trailing
    12-month MODIS window (+ AOI embedding). The predicted total only rescales
    MODIS-only cells of that month (VIIRS-observed cells are untouched).
    Months without 12 consecutive MODIS months keep the statistical value.

    Audit P1-19: those months are counted and exposed as `effective_method`,
    so the API cannot claim Transformer coverage for a month it never scored.
    """
    model, meta = tst.load_artifact(aoi, MODEL_DIR, tag=(data if data == "raw" else "sample"))
    if model is None or meta is None:
        raise HTTPException(404, f"No Transformer artifact for aoi={aoi}; POST /api/firms/ts-train first")
    modis_ym: dict[str, float] = dict(modis_counts or {})
    if not modis_ym:
        for r in clean or []:
            if str(r.get("instrument", "")).upper().startswith("VIIRS"):
                continue
            ym = str(r.get("acq_date", ""))[:7]
            modis_ym[ym] = modis_ym.get(ym, 0.0) + 1.0
    months = sorted({str(c["date"])[:7] for c in daily_stat})
    factors: dict[str, float] = {}
    preds: dict[str, float] = {}
    scored: list[str] = []
    missing_context: list[str] = []
    no_modis_only: list[str] = []
    for ym in months:
        y, m = int(ym[:4]), int(ym[5:7])
        seq = []
        ok = True
        for k in range(11, -1, -1):
            yy = y + (m - 1 - k) // 12
            mm = (m - 1 - k) % 12 + 1
            key = f"{yy}-{mm:02d}"
            if key not in modis_ym:
                ok = False
                break
            seq.append((modis_ym[key], mm))
        if not ok:
            missing_context.append(ym)
            continue
        import numpy as _np
        X = _np.array([[__import__("math").log1p(v),
                        __import__("math").sin(2 * __import__("math").pi * mm / 12.0),
                        __import__("math").cos(2 * __import__("math").pi * mm / 12.0)]
                       for v, mm in seq], dtype=_np.float32).reshape(1, 12, 3)
        pred = float(tst.predict_windows(model, X, aoi)[0])
        scored.append(ym)
        preds[ym] = pred
        stat_total = sum(c["harmonized_count"] for c in daily_stat if str(c["date"])[:7] == ym)
        stat_modis_only = sum(c["harmonized_count"] for c in daily_stat
                              if str(c["date"])[:7] == ym
                              and c.get("estimate_type") == "modis_upscaled_estimated")
        observed_part = stat_total - stat_modis_only
        target_est = pred - observed_part
        if stat_modis_only > 0 and target_est > 0:
            # rescale only the estimated part toward the predicted month total
            factors[ym] = target_est / stat_modis_only
        else:
            no_modis_only.append(ym)
    out = []
    for c in daily_stat:
        ym = str(c["date"])[:7]
        if c.get("estimate_type") == "modis_upscaled_estimated" and ym in factors:
            c = {**c, "harmonized_count": round(c["harmonized_count"] * factors[ym], 3),
                 "estimate_type": "ts_predicted",
                 "method": "ts_logratio_pool_v2",
                 "effective_method": "ts_logratio_pool_v2",
                 "coverage_status": "unknown"}
        else:
            c = {**c, "effective_method": "stat:seasonal_ratio_v1"}
        out.append(c)
    conservation = []
    for ym in factors:
        total = sum(float(c["harmonized_count"]) for c in out if str(c["date"])[:7] == ym)
        conservation.append(abs(total - preds.get(ym, total)))
    diagnostics = {
        **(meta or {}),
        "requested_method": "ts",
        "effective_method": "ts_logratio_pool_v2",
        "model_method_id": meta.get("method_id", "ts_logratio_pool_v2"),
        "target": meta.get("target"),
        "feature_version": meta.get("feature_version"),
        "seed_mae_range": meta.get("seed_mae_range"),
        "months_requested": len(months),
        "months_scored": len(scored),
        "months_missing_context": len(missing_context),
        "missing_context_examples": missing_context[:12],
        "months_corrected": len(factors),
        "months_without_modis_only_cells": len(no_modis_only),
        "conservation_max_abs_error": round(max(conservation), 4) if conservation else 0.0,
        "month_effective_method": {ym: ("ts" if ym in factors else "stat")
                                   for ym in months},
    }
    return out, diagnostics


def _latest_summary(calen: dict, daily: list[dict]) -> dict | None:
    """Latest COMPLETE month vs history.

    Partial months carry no verdict; instead of returning null when the newest
    NRT month is partial, we fall back to the newest month whose coverage is
    not verified-partial (audit P1-01).
    """
    if not daily or not calen.get("years"):
        return None
    by_month: dict[str, list[str]] = {}
    for c in daily:
        d = str(c["date"])[:10]
        by_month.setdefault(d[:7], []).append(d)
    comp = calen.get("completeness", {})
    for ym in sorted(by_month, reverse=True):
        if comp.get(ym, {}).get("partial") is True:
            continue
        latest_date = max(by_month[ym])
        m = int(ym[5:7])
        mi = m - 1
        ly = int(ym[:4])
        import statistics as _st
        col = [calen["matrix"][yi][mi] for yi, y in enumerate(calen["years"])
               if y != ly and calen["matrix"][yi][mi] is not None]
        cur = next((calen["matrix"][yi][mi] for yi, y in enumerate(calen["years"])
                    if y == ly), None)
        if cur is None or len(col) < 3:
            continue
        med = round(float(_st.median(col)), 2)
        return {"date": latest_date, "month": m, "month_total": round(cur, 2),
                "hist_median": med, "hist_years": len(col),
                "ratio": round(cur / med, 2) if med else None,
                "coverage_status": comp.get(ym, {}).get("coverage_status", "unknown"),
                "coverage_ratio": comp.get(ym, {}).get("coverage_ratio"),
                "verdict": ("above_history" if cur > 1.5 * med
                            else "below_history" if cur < 0.5 * med
                            else "near_history") if med else "no_history"}
    return None


def _harmonize_stream(aoi: str, data: str, bbox, method: str = "stat",
                      daily_cap: int = 2000) -> dict:
    """Memory-bounded pipeline for large raw pulls (1.4M+ rows).

    Validates, dedups and aggregates while streaming from disk; only the
    monthly ML context and the final daily cells are retained.
    """
    b = _parse_bbox(bbox) if isinstance(bbox, str) else bbox
    # Validating 1.4M rows costs ~90 s; the raw set is static between pulls, so
    # the finished result is cached on disk keyed by file fingerprint, method,
    # data version and model version (audit P0-08 / P1-20).
    fp = store.raw_fingerprint(aoi)
    ckey = (f"cal_{aoi}_{method}_{fp}_{bbox or 'all'}_{daily_cap}_"
            f"{ml_v4.ALGORITHM_VERSION}_{tst.ALGORITHM_VERSION}")
    hit = store.cache_get(ckey)
    if hit is not None:
        return hit
    ctx_builder = ml_cal.ModisCtxBuilder() if method in ("ts", "ml") else None
    if ctx_builder is not None:
        def keep(d):
            ctx_builder.add(d)
    else:
        keep = None
    def rows():
        for r in store.iter_raw_rows(aoi, limit=None):
            if b is not None and not _in_bbox(r, b):
                continue
            yield r
    agg, stats = harmonize.aggregate_iter(rows(), keep_clean=keep)
    if not agg:
        raise HTTPException(404, detail={
            "error_code": "no_raw_data",
            "message": f"No raw FIRMS rows available for aoi={aoi}. "
                       "Fetch a full month first (scripts/firms/fetch_full_month).",
            "aoi": aoi})
    ratios = harmonize.estimate_efficiency_ratio(agg)
    ml_meta = None
    if method == "ml":
        model, ml_meta = ml_cal.load_artifact(aoi, MODEL_DIR, tag="raw")
        if model is None:
            raise HTTPException(404, f"No raw ML artifact for aoi={aoi}")
        daily, ml_meta = _harmonize_daily_ml(
            agg, model, ml_meta, ctx=ctx_builder.finalize())
    elif method == "ts":
        model, ml_meta = tst.load_artifact(aoi, MODEL_DIR, tag="raw")
        if model is None:
            raise HTTPException(404, f"No raw Transformer artifact for aoi={aoi}")
        daily, ml_meta = _harmonize_daily_ts(
            None, harmonize.harmonize_daily(agg, ratios), aoi, data,
            modis_counts=ctx_builder.modis_counts())
    else:
        daily = harmonize.harmonize_daily(agg, ratios)
    covmap = cov.coverage_for_aoi(aoi)
    calen = cal.build_calendar(daily, coverage=covmap)
    crit = cal.critical_periods(calen)
    latest = _latest_summary(calen, daily)
    coverage_summary = cov.coverage_summary(aoi)
    calibration = {k: ratios.get(k) for k in (
        "_fallback", "_fallback_rel_iqr", "_n_months", "_mode",
        "_calibration_window", "_train_end", "_sensor_set", "_data_version",
        "_excluded_months")}
    out = {"daily_cells": len(daily), "ratios": ratios, "calendar": calen,
           "critical_periods": crit[:24], "latest": latest,
           "forecast": _forecast(calen, latest["date"] if latest else None),
           "data_source": _data_source_label(data),
           "method_id": {"stat": "seasonal_ratio_v1", "ml": "ml_b2res_v4",
                         "ts": "ts_logratio_pool_v2"}.get(method, "seasonal_ratio_v1"),
           "effective_method": (ml_meta or {}).get("effective_method",
                                                   "seasonal_ratio_v1"),
           "calibration": calibration,
           "qa": stats, "ml_meta": ml_meta,
           "coverage": coverage_summary,
           "daily": daily[:daily_cap] if daily_cap else []}
    store.cache_put(ckey, out)
    return out


def _harmonize_from_records(records: list[dict], daily_cap: int = 2000,
                              data: str = "sample", aoi: str = "vietnam",
                              method: str = "stat",
                              dataset: str | None = None) -> dict:
    """Validate -> QA -> dedup -> harmonize. Single path for sample/raw/upload (P0-07)."""
    _block_raw_ml_ts(method, data, aoi)
    clean: list[dict] = []
    rejected = 0
    qa_counts: dict[str, int] = {}
    for r in records:
        try:
            rec = FirmsRecord(**{k.lower(): v for k, v in dict(r).items()})
        except Exception:
            rejected += 1
            continue
        d = rec.model_dump(mode="json")
        q = rec.qa()
        d["qa_flag"] = q
        qa_counts[q] = qa_counts.get(q, 0) + 1
        if q in ("suspect_geometry", "anachronistic_platform"):
            rejected += 1
            continue
        clean.append(d)
    agg = harmonize.aggregate(clean)
    ratios = harmonize.estimate_efficiency_ratio(agg)
    ml_meta = None
    if method == "ml":
        ml_model, ml_meta = ml_cal.load_artifact(aoi, MODEL_DIR, tag=(data if data == 'raw' else 'sample'))
        if ml_model is None:
            raise HTTPException(404, f"No ML artifact for aoi={aoi}; POST /api/firms/ml-train first")
        daily, ml_meta = _harmonize_daily_ml(agg, ml_model, ml_meta, clean)
    elif method == "ts":
        daily, ml_meta = _harmonize_daily_ts(
            clean, harmonize.harmonize_daily(agg, ratios), aoi, data)
    else:
        daily = harmonize.harmonize_daily(agg, ratios)
    # Coverage is only verified for manifest-backed raw pulls. Sample/upload
    # months carry coverage_status=unknown rather than a fake "partial" flag
    # derived from detection days (audit P0-06).
    covmap = (cov.coverage_for_aoi(aoi) if (data == "raw" and not dataset) else None)
    calen = cal.build_calendar(daily, coverage=covmap)
    crit = cal.critical_periods(calen)
    latest = _latest_summary(calen, daily)
    calibration = {k: ratios.get(k) for k in (
        "_fallback", "_fallback_rel_iqr", "_n_months", "_mode",
        "_calibration_window", "_train_end", "_sensor_set", "_data_version",
        "_excluded_months")}
    return {"daily_cells": len(daily), "ratios": ratios,
            "calendar": calen, "critical_periods": crit[:24],
            "latest": latest,
            "forecast": _forecast(calen, latest["date"] if latest else None),
            "data_source": _data_source_label(data),
            "method_id": ({"ml": "ml_b2res_v4", "ts": "ts_logratio_pool_v2"}.get(method, "seasonal_ratio_v1")),
            "effective_method": (ml_meta or {}).get("effective_method",
                                                    "seasonal_ratio_v1"),
            "calibration": calibration,
            "ml_meta": ml_meta,
            "coverage": (cov.coverage_summary(aoi) if (data == "raw" and not dataset) else
                         {"verified": False, "reason": "sample_or_upload"}),
            "qa": {"clean": len(clean), "rejected": rejected, "qa_counts": qa_counts},
            "daily": daily[:daily_cap] if daily_cap else []}


@app.post("/api/firms/harmonize")
def firms_harmonize(payload: dict):
    raw = payload.get("records")
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "sample"))
    if data not in ("sample", "raw"):
        raise HTTPException(400, "data must be sample|raw")
    records = raw if isinstance(raw, list) and raw else _resolve_records(aoi, data, 2000000)
    if isinstance(raw, list) and raw:
        data = "upload"
    records = [r for r in records if _in_bbox(r, _parse_bbox(payload.get("bbox")))]
    if not records:
        raise HTTPException(404, "No records in this AOI; widen the bbox or POST records")
    t0 = time.perf_counter()
    method = str(payload.get("method", "stat"))
    if method not in ("stat", "ml", "ts"):
        raise HTTPException(400, "method must be stat|ml|ts")
    _block_raw_ml_ts(method, data, aoi)
    out = _harmonize_from_records(records, daily_cap=2000, data=data, aoi=aoi, method=method)
    out["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    out["method"] = ({"stat": "daily 0.05deg grid + monthly activity ratio + sensor-adjusted index "
                              "(hotspot detections, not fires; MODIS-only cells are estimates)",
                      "ml": "daily 0.05deg grid + B2-anchored residual HGB (ml_b2res_v4; abstains to the seasonal ratio when blocked CV shows no robust gain)",
                      "ts": "daily 0.05deg grid + pooled log-ratio Transformer (ts_logratio_pool_v2) monthly post-adjustment; months without 12-month context keep the statistical value"}[method])
    return JSONResponse(out)


@app.get("/api/firms/calendar")
def firms_calendar(limit: int = Query(2000, ge=1, le=2000000),
                   bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                   aoi: str = Query("vietnam", description="preset region"),
                   data: str = Query("sample", pattern="^(sample|raw)$"),
                   method: str = Query("stat", pattern="^(stat|ml|ts)$"),
                   dataset: str | None = Query(None, description="session upload id (upload:<hex>)")):
    # P0-06: aggregate the FULL filtered set, slice only the daily response.
    _block_raw_ml_ts(method, data, aoi)
    if data == "raw" and not dataset and not store.raw_ready(aoi):
        raise HTTPException(404, detail={
            "error_code": "no_raw_data",
            "message": f"No raw FIRMS data on this server for aoi={aoi}. "
                       "Use data=sample for the synthetic demo, or fetch a month first.",
            "aoi": aoi})
    if data == "raw" and not dataset:
        out = _harmonize_stream(aoi, data, bbox, method, daily_cap=min(limit, 5000))
    else:
        records = [r for r in _resolve_records(aoi, data, 2000000, dataset)
                   if _in_bbox(r, _parse_bbox(bbox))]
        if not records:
            raise HTTPException(404, f"No {data} data in this AOI")
        out = _harmonize_from_records(records, daily_cap=min(limit, 5000),
                                      data=data, aoi=aoi, method=method,
                                      dataset=dataset)
    out["bbox"] = bbox
    out["aoi"] = aoi
    out["data"] = data
    if dataset:
        out["dataset"] = dataset
        out["data_source"] = _data_source_label(data, dataset)
    return JSONResponse(out)


@app.get("/api/firms/export")
def firms_export(limit: int = Query(2000000, ge=100, le=2000000),
                 bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                 aoi: str = Query("vietnam", description="preset region"),
                 data: str = Query("sample", pattern="^(sample|raw)$"),
                 method: str = Query("stat", pattern="^(stat|ml|ts)$"),
                 dataset: str | None = Query(None, description="session upload id")):
    # P0-06: export the FULL filtered set through the same harmonize path
    # as the dashboard so the CSV matches /calendar (P1-07: no silent cap).
    _block_raw_ml_ts(method, data, aoi)
    if data == "raw" and not dataset:
        full_daily = _harmonize_stream(aoi, data, bbox, method, daily_cap=2000000)["daily"]
    else:
        records = [r for r in _resolve_records(aoi, data, limit, dataset)
                   if _in_bbox(r, _parse_bbox(bbox))]
        if not records:
            raise HTTPException(404, f"No {data} data in this AOI")
        full_daily = _harmonize_from_records(records, daily_cap=2000000,
                                             data=data, aoi=aoi, method=method,
                                             dataset=dataset)["daily"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["cell_id", "date", "lat", "lon",
                                        "modis_count", "viirs_count",
                                        "modis_frp", "viirs_frp",
                                        "harmonized_count", "harmonized_count_low",
                                        "harmonized_count_high", "harmonized_per_km2",
                                        "harmonized_frp", "cell_km2",
                                        "estimate_type", "sensors", "platforms",
                                        "platform_single", "coverage_status",
                                        "k_used", "uncertainty_rel",
                                        "ratio_mode", "calibration_window",
                                        "calibration_train_end", "calibration_months",
                                        "method", "effective_method",
                                        "algorithm_version", "data_source"])
    w.writeheader()
    for c in full_daily:
        row = {**c, "data_source": _data_source_label(data, dataset)}
        if isinstance(row.get("calibration_window"), (list, tuple)):
            row["calibration_window"] = json.dumps(list(row["calibration_window"]))
        w.writerow({k: row.get(k) for k in w.fieldnames})
    dtag = dataset.replace(":", "_") if dataset else f"{data}_{method}"
    return PlainTextResponse(buf.getvalue(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="harmonized_hotspots_{aoi}_{dtag}.csv"',
                                      "X-Row-Count": str(len(full_daily)),
                                      "X-Data-Source": _data_source_label(data).replace("\u2014", "-")})


@app.get("/api/firms/dl-info")
def firms_dl_info():
    return dl.describe()


@app.get("/api/firms/data-status")
def firms_data_status():
    """What datasets are on disk (samples + ingested raw + cache stats)."""
    return store.data_status()


@app.get("/api/firms/coverage")
def firms_coverage(aoi: str = Query("vietnam"),
                   data: str = Query("raw", pattern="^(sample|raw)$")):
    """Request ledger: which days were actually requested, and which failed."""
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    if data == "raw":
        return {"aoi": aoi, "data": data,
                "raw_ready": store.raw_ready(aoi),
                **cov.coverage_summary(aoi),
                "ledger": cov.ledger_status(aoi)}
    return {"aoi": aoi, "data": data, "verified": False,
            "reason": "sample data has no request ledger"}


@app.get("/api/firms/platform-series")
def firms_platform_series(aoi: str = Query("vietnam"),
                          data: str = Query("raw", pattern="^(sample|raw)$")):
    """Platform mix per year + a single-platform comparable series.

    Audit P0-12: SNPP/NOAA-20/NOAA-21 are different overpasses; a combined
    count can rise simply because a new platform was added. This endpoint
    exposes the mix and the SNPP-only total, which is the comparable series.
    """
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    rows = (store.iter_raw_rows(aoi, limit=2000000) if data == "raw"
            else store.load_records(aoi, 100000))
    per_year: dict[int, dict[str, int]] = {}
    alias = {"N20": "NOAA-20", "N21": "NOAA-21", "NPP": "SNPP",
             "NOAA20": "NOAA-20", "NOAA21": "NOAA-21"}
    for r in rows:
        d = str(r.get("acq_date", ""))[:10]
        try:
            y = int(d[:4])
        except ValueError:
            continue
        sat = str(r.get("satellite", "UNKNOWN") or "UNKNOWN").strip()
        sat = alias.get(sat, sat)
        slot = per_year.setdefault(y, {})
        slot[sat] = slot.get(sat, 0) + 1
    series = []
    for y in sorted(per_year):
        mix = per_year[y]
        series.append({"year": y, "by_platform": dict(sorted(mix.items())),
                       "all_platforms": sum(mix.values()),
                       "snpp_only": mix.get("SNPP", 0),
                       "n_platforms": len(mix)})
    return {"aoi": aoi, "data": data,
            "note": ("all_platforms adds new overpasses over time; snpp_only is "
                     "the comparable single-platform series. Difference is sensor "
                     "mix, not proven fire change."),
            "series": series}


@app.post("/api/firms/ingest")
async def firms_ingest(request: Request,
                       aoi: str = Query("vietnam"), source: str = Query("upload"),
                       file: UploadFile = File(...)):
    """Upload a real FIRMS CSV: validated in chunks, stored, QA report back."""
    _require_admin(request)
    max_bytes = 50 * 1024 * 1024
    chunks: list[bytes] = []
    size = 0
    while True:
        ch = await file.read(1024 * 1024)
        if not ch:
            break
        size += len(ch)
        if size > max_bytes:
            raise HTTPException(413, "File too large (max 50 MB)")
        chunks.append(ch)
    content = b"".join(chunks)
    if not content:
        raise HTTPException(400, "Empty file")
    try:
        return store.ingest_upload(file.filename or "upload.csv", content, aoi, source)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/firms/upload-dataset")
async def firms_upload_dataset(request: Request, file: UploadFile = File(...)):
    """Session upload (P1-18): streamed with a 10 MB cap, validated, returns
    dataset_id for /calendar?dataset=upload:<id>. Gated when ADMIN_TOKEN set."""
    _require_admin(request)
    import hashlib as _hl
    import time as _t
    max_bytes = 10 * 1024 * 1024
    store.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    tmp = store.UPLOAD_DIR / f"tmp_{int(_t.time() * 1000)}.part"
    digest, size = _hl.sha256(), 0
    try:
        with tmp.open("wb") as fh:
            while True:
                ch = await file.read(1024 * 1024)
                if not ch:
                    break
                size += len(ch)
                if size > max_bytes:
                    raise ValueError("File too large (>10 MB session cap)")
                digest.update(ch)
                fh.write(ch)
        report = store.register_upload_file(
            tmp, file.filename or "upload.csv", size, digest.hexdigest())
        return JSONResponse({**report, "calendar_url": f"/calendar?dataset={report['dataset_id']}"})
    except ValueError as e:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, str(e))


@app.get("/api/firms/brief")
def firms_brief(aoi: str = Query("vietnam", description="preset region"),
                bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                data: str = Query("sample", pattern="^(sample|raw)$"),
                method: str = Query("stat", pattern="^(stat|ml|ts)$"),
                dataset: str | None = Query(None, description="session upload id")):
    """One-page Markdown brief (hotspot-detection activity, not fire counts).

    Uses the SAME full dataset + method as /calendar (no 100k-row cap, no
    hard-coded stat path) so the brief and the dashboard cannot disagree.
    """
    _block_raw_ml_ts(method, data, aoi)
    if data == "raw" and not dataset:
        if not store.raw_ready(aoi):
            raise HTTPException(404, detail={"error_code": "no_raw_data",
                                             "message": f"No raw data for {aoi}"})
        out = _harmonize_stream(aoi, data, bbox, method, daily_cap=0)
    else:
        records = [r for r in _resolve_records(aoi, data, 2000000, dataset)
                   if _in_bbox(r, _parse_bbox(bbox))]
        if not records:
            raise HTTPException(404, f"No {data} data in this AOI")
        out = _harmonize_from_records(records, daily_cap=0, data=data, aoi=aoi,
                                      method=method, dataset=dataset)
    c, ys = out["calendar"], out["calendar"]["years"]
    L, F = out["latest"], out["forecast"]
    src = _data_source_label(data, dataset)
    eff = out.get("effective_method") or out.get("method_id")
    lines = [
        f"# Fire-activity brief — {aoi}{f' ({bbox})' if bbox else ''}",
        f"_Source: NASA FIRMS ({data}) — {src}._",
        f"_Method: requested `{method}` → effective `{eff}`._",
        f"_Units: hotspot detections / sensor-adjusted activity index (NOT confirmed fires)._",
        "",
        f"- Period: {ys[0]}–{ys[-1]} ({len(ys)} years, {out['daily_cells']} daily cells)",
        f"- Yearly mean: {round(sum(c['row_totals']) / len(ys), 1)} detections/yr; "
        f"peak year {ys[c['row_totals'].index(max(c['row_totals']))]}",
        "- Top anomalous months (|z|>=2, MAD units): " + (
            "; ".join(f"{p['year']}-{p['month']:02d} (z={p['z']}, coverage={p.get('coverage_status')})"
                      for p in out["critical_periods"][:5]) or "none"),
    ]
    cov = out.get("coverage") or {}
    if cov.get("verified"):
        lines.append(f"- Coverage (request ledger): {cov['full_months']}/{cov['months']} months "
                     f"≥90% of days requested; missing-day histogram "
                     f"{cov.get('missing_day_histogram', {})}.")
    else:
        lines.append("- Coverage: UNKNOWN (sample/upload — not a manifest-backed pull).")
    if L:
        lines.append(f"- Latest {L['date']}: {L['month_total']} vs same-month median {L['hist_median']} "
                     f"(x{L['ratio']}, baseline {L['hist_years']} yrs excl. current year) — {L['verdict']}.")
    if F:
        lines.append(f"- Climatology outlook {F['year']}-{F['month']:02d}: median {F['median']} "
                     f"(P25–P75 {F['p25']}–{F['p75']}, n={F['n_years']}). NOT a prediction.")
    lines += ["", "## Limits & safety",
              "- MODIS-only cells are 1/k upscaled ESTIMATES (coverage unknown).",
              "- harmonized_frp is null for upscaled cells (count ratio never rescales FRP).",
              "- Overpass-time and cloud/smoke bias reduced, not removed.",
              "- Platform mix (SNPP / NOAA-20 / NOAA-21) is reported, not fully corrected.",
              "- Outlook is climatology, not a forecast — check FIRMS NRT for nowcasts.",
              "- FIRMS active-fire data must NOT be the sole basis for life/property decisions."]
    return PlainTextResponse("\n".join(lines), media_type="text/markdown; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="brief_{aoi}.md"'})


@app.post("/api/firms/train-calibrator")
def firms_train(request: Request, payload: dict):
    """Experimental offline calibrator (NOT used by /calendar). Rate-limited."""
    _require_admin(request)
    pairs = payload.get("pairs", [])
    if not isinstance(pairs, list):
        raise HTTPException(400, "Provide pairs: list")
    if len(pairs) > 5000:
        raise HTTPException(413, "Max 5000 pairs (offline experiment only)")
    out = dl.train_calibrator(pairs)
    out["note"] = ("experimental: checkpoint is NOT persisted and /calendar does not use it; "
                   "use /api/firms/ml-train for the persisted HGB calibrator. "
                   "see docs/FIRMS_MODEL_CARD.md")
    return out


@app.post("/api/firms/ml-train")
def firms_ml_train(request: Request, payload: dict):
    """Train the PERSISTED HGB calibrator for an AOI (temporal holdout).

    Body: {aoi, data=sample|raw, test_years=3}. Saves joblib+JSON to models/.
    """
    _require_admin(request)
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "sample"))
    test_years = int(payload.get("test_years", 3))
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    if data not in ("sample", "raw"):
        raise HTTPException(400, "data must be sample|raw")
    if not 1 <= test_years <= 6:
        raise HTTPException(400, "test_years must be 1..6")
    pairs = _pairs_for(aoi, data)
    res = ml_v4.train_holdout(pairs, test_years=test_years)
    if not res.get("trained"):
        raise HTTPException(422, f"Not enough overlap data: {res.get('reason')} "
                                 f"(n_train={res.get('n_train')}, n_test={res.get('n_test')})")
    model = res.pop("model")
    res["data_fingerprint"] = (store.raw_fingerprint(aoi) if data == "raw"
                               else store.sample_fingerprint(aoi))
    res["feature_version"] = ml_v4.FEATURE_VERSION
    res["algorithm_version"] = ml_v4.ALGORITHM_VERSION
    paths = ml_cal.save_artifact(model, res, aoi, MODEL_DIR, tag=(data if data == 'raw' else 'sample'))
    return JSONResponse({**res, **paths, "data_source": _data_source_label(data)})


@app.post("/api/firms/ts-train")
def firms_ts_train(request: Request, payload: dict):
    """Train the PERSISTED temporal Transformer for an AOI (temporal holdout).

    Body: {aoi, data=sample|raw, test_years=3, epochs=120}. Saves .pt+JSON.
    """
    _require_admin(request)
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "sample"))
    test_years = int(payload.get("test_years", 3))
    epochs = min(int(payload.get("epochs", 120)), 300)
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    if data not in ("sample", "raw"):
        raise HTTPException(400, "data must be sample|raw")
    if not 1 <= test_years <= 6:
        raise HTTPException(400, "test_years must be 1..6")
    # Pooled training: every AOI the caller has data for contributes windows,
    # with an AOI embedding so the model can shift its ratio baseline per region.
    wins: list[dict] = []
    pooled: list[str] = []
    for other in AOIS:
        if data == "raw" and not store.raw_ready(other):
            continue
        w = tst.build_windows(_pairs_for(other, data), aoi=other)
        if w:
            wins += w
            pooled.append(other)
    res = tst.train_pooled(wins, test_years=test_years, epochs=epochs)
    if not res.get("trained"):
        raise HTTPException(422, f"Not enough window data: {res.get('reason')} "
                                 f"(n_train={res.get('n_train')}, n_test={res.get('n_test')})")
    models = res.pop("models")
    res["aois"] = pooled
    res["data_fingerprint"] = (store.pooled_fingerprint(store.AOIS) if data == "raw"
                               else store.pooled_fingerprint(store.AOIS, raw=False))
    res["feature_version"] = tst.FEATURE_VERSION
    res["algorithm_version"] = tst.ALGORITHM_VERSION
    paths = tst.save_artifact(models, res, aoi, MODEL_DIR,
                              tag=(data if data == 'raw' else 'sample'))
    return JSONResponse({**{k: v for k, v in res.items() if k != "metrics"},
                         "metrics": res.get("metrics", {}),
                         "pooled_aois": pooled, **paths,
                         "data_source": _data_source_label(data)})


@app.get("/api/firms/ts-status")
def firms_ts_status(aoi: str = Query("vietnam"),
                    data: str = Query("sample", pattern="^(sample|raw)$")):
    """Persisted Transformer artifact metadata (or not-trained)."""
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    _, meta = tst.load_artifact(aoi, MODEL_DIR, tag=(data if data == "raw" else "sample"))
    if meta is None:
        return {"trained": False, "aoi": aoi, "data": data,
                "data_ready": store.raw_ready(aoi) if data == "raw" else True,
                "hint": "POST /api/firms/ts-train to train"}
    ok, why = tst.artifact_compat(
        *tst.load_artifact(aoi, MODEL_DIR, tag=(data if data == "raw" else "sample")),
        expected_fingerprint=(store.pooled_fingerprint(store.AOIS) if data == "raw"
                              else None))
    return {"trained": True, "aoi": aoi, "data": data,
            "data_ready": store.raw_ready(aoi) if data == "raw" else True,
            "artifact_compatible": ok, "artifact_compat_reason": why,
            **meta}


@app.get("/api/firms/ml-status")
def firms_ml_status(aoi: str = Query("vietnam"),
                    data: str = Query("sample", pattern="^(sample|raw)$")):
    """Persisted HGB artifact metadata (or not-trained)."""
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    _, meta = ml_cal.load_artifact(aoi, MODEL_DIR, tag=(data if data == "raw" else "sample"))
    if meta is None:
        return {"trained": False, "aoi": aoi, "data": data,
                "data_ready": store.raw_ready(aoi) if data == "raw" else True,
                "hint": "POST /api/firms/ml-train to train"}
    ok, why = ml_cal.artifact_compat(
        *ml_cal.load_artifact(aoi, MODEL_DIR, tag=(data if data == "raw" else "sample")),
        expected_fingerprint=(store.raw_fingerprint(aoi) if data == "raw" else None))
    return {"trained": True, "aoi": aoi, "data": data,
            "data_ready": store.raw_ready(aoi) if data == "raw" else True,
            "artifact_compatible": ok, "artifact_compat_reason": why,
            **meta}


def _backtest_from_manifest(manifest: dict, aoi: str, data: str,
                            test_years: int) -> dict:
    per = (manifest.get("per_aoi") or {}).get(aoi) or {}
    samples = [s for s in manifest.get("samples", []) if s.get("aoi") == aoi]
    rows = []
    for s in samples:
        rows.append({"year": s["year"], "month": s["month"],
                     "modis": s["modis"], "viirs_ref": s["viirs_ref"],
                     "ml_pred": s.get("hgb_b2res_v4"),
                     "ts_pred": s.get("ts_logratio_pool_v2"),
                     "b2_pred": s.get("b2_seasonal_ratio")})
    return {
        "aoi": aoi, "data": data,
        "data_source": manifest.get("data_source"),
        "evaluation_version": manifest.get("evaluation_version"),
        "eval_unit": manifest.get("eval_unit"),
        "dataset_sha256": manifest.get("dataset_sha256"),
        "metrics": per.get("metrics", {}),
        "hgb_full_test": per.get("hgb_full_test"),
        "hgb_residual_enabled": per.get("hgb_residual_enabled"),
        "hgb_fallback_baseline": per.get("hgb_fallback_baseline"),
        "hgb_gate": per.get("hgb_gate"),
        "pooled_metrics": (manifest.get("pooled") or {}).get("metrics", {}),
        "pooled_full_month": manifest.get("pooled_full_month"),
        "coverage_class": per.get("coverage_class"),
        "coverage": per.get("coverage"),
        "n_eval": per.get("n_eval") or 0,
        "n_test_full": per.get("n_test"),
        "n_eval_intersection": manifest.get("n_eval"),
        "ts_context_covered_months": per.get("ts_context_covered_months"),
        "ts_months_missing_context": per.get("ts_months_missing_context"),
        "train_years": per.get("train_years", []),
        "test_years": per.get("test_years", sorted({s["year"] for s in samples})),
        "method_id": {"hgb": "ml_b2res_v4", "ts": "ts_logratio_pool_v2"},
        "models": {"hgb": ml_v4.ALGORITHM_VERSION,
                   "ts": tst.ALGORITHM_VERSION,
                   "evaluation": manifest.get("evaluation_version")},
        "note": manifest.get("note"),
        "months": rows,
    }


@app.get("/api/firms/backtest")
def firms_backtest(request: Request,
                   aoi: str = Query("vietnam"),
                   data: str = Query("sample", pattern="^(sample|raw)$"),
                   test_years: int = Query(2, ge=1, le=6),
                   refresh: int = Query(0)):
    """Unified time-travel backtest: one frozen sample set for every method.

    Audit P0-07/P0-08/P0-09: the old endpoint trained the legacy HGB, cached
    by AOI/data/test-years only, and could serve a stale version. This endpoint
    reads `evaluation_{data}.json` (built offline by
    `python -m scripts.firms.evaluate`), verifies the cache identity, and
    refuses to train heavy ensembles on a public GET.
    """
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    if refresh:
        _require_admin(request)
        res = evaluation.evaluate(data=data, test_years=test_years)
        if not res.get("trained"):
            raise HTTPException(422, f"Evaluation failed: {res.get('reason')}")
    manifest = evaluation.load_manifest(data, MODEL_DIR)
    if manifest is None:
        raise HTTPException(503, detail={
            "error_code": "evaluation_not_built",
            "message": "No frozen evaluation manifest. Run "
                       "`python -m scripts.firms.evaluate --data "
                       f"{data} --test-years {test_years}` (admin/offline), then retry.",
        })
    if int(manifest.get("test_year_count", -1)) != int(test_years):
        raise HTTPException(409, detail={
            "error_code": "evaluation_split_mismatch",
            "message": f"Evaluation manifest was built with test_years="
                       f"{manifest.get('test_year_count')}; request is {test_years}. "
                       "Rebuild the manifest for this split.",
        })
    payload = _backtest_from_manifest(manifest, aoi, data, test_years)
    key = evaluation.cache_key(aoi, data, test_years,
                               extra=str(manifest.get("dataset_sha256")))
    payload["_cache_key"] = key
    cache_path = MODEL_DIR / f"backtest_{aoi}_{data}_t{test_years}_{key}.json"
    try:
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(payload), encoding="utf-8")
    except OSError:
        logger.warning("backtest cache write failed for %s/%s", aoi, data)
    return JSONResponse(payload)


@app.get("/api/firms/xray")
def firms_xray(aoi: str = Query("vietnam"),
               data: str = Query("sample", pattern="^(sample|raw)$")):
    """Sensor Bias X-Ray: per-month MODIS raw vs VIIRS reference vs adjusted.

    Audit P0-09: this used to train the legacy model and load the sample
    artifact even for data=raw. It now reads the unified evaluation manifest
    and the artifact with the correct data tag.
    """
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    if data == "raw":
        # P1-12: stream 1.4M rows instead of materialising them in RAM.
        cal_out = _harmonize_stream(aoi, data, None, "stat",
                                    daily_cap=2000000)
        daily_cells = cal_out["daily"]
        by_ym: dict[tuple[int, int], dict] = {}
        for c in daily_cells:
            d = str(c["date"])[:10]
            key = (int(d[:4]), int(d[5:7]))
            slot = by_ym.setdefault(key, {"modis": 0.0, "viirs": 0.0})
            slot["modis"] += float(c.get("modis_count", 0) or 0)
            slot["viirs"] += float(c.get("viirs_count", 0) or 0)
        pairs = [{"year": y, "month": m, "modis": v["modis"], "viirs": v["viirs"]}
                 for (y, m), v in sorted(by_ym.items()) if v["viirs"] > 0]
    else:
        records = _resolve_records(aoi, data, 2000000)
        pairs = ml_cal.build_monthly_pairs(records)
        cal_out = _harmonize_from_records(records, daily_cap=0, data=data,
                                          aoi=aoi, method="stat")
        by_ym = {(p["year"], p["month"]): {"modis": p["modis"], "viirs": p["viirs"]}
                 for p in pairs}
    cal_by_ym: dict[tuple[int, int], float] = {}
    for _yi, _y in enumerate(cal_out["calendar"]["years"]):
        for _mi in range(12):
            _v = cal_out["calendar"]["matrix"][_yi][_mi]
            if _v is not None:
                cal_by_ym[(_y, _mi + 1)] = _v
    manifest = evaluation.load_manifest(data, MODEL_DIR)
    per = ((manifest or {}).get("per_aoi") or {}).get(aoi) or {}
    if per.get("b2_log_ratios"):
        b2_log = {int(k): float(v) for k, v in per["b2_log_ratios"].items()}
        b1_log = float(per.get("b1_log_ratio", 0.0))
        ratio_source = "train_only (evaluation manifest)"
    else:
        b1_log, b2_log = evaluation.ratios_from_train(pairs)
        ratio_source = "in_sample fallback (no manifest)"
    metrics = per.get("metrics") if per else None
    _ml_model, ml_meta = ml_cal.load_artifact(aoi, MODEL_DIR,
                                              tag=(data if data == "raw" else "sample"))
    _, ts_meta = tst.load_artifact(aoi, MODEL_DIR,
                                   tag=(data if data == "raw" else "sample"))
    ml_ok, ml_why = ml_cal.artifact_compat(
        _ml_model, ml_meta,
        expected_fingerprint=(store.raw_fingerprint(aoi) if data == "raw" else None))
    months = []
    for (y, m), v in sorted(by_ym.items()):
        log_r = b2_log.get(m, b1_log)
        adjusted = evaluation._counts(v["modis"], log_r)  # noqa: SLF001
        months.append({"year": y, "month": m,
                       "modis_raw": v["modis"], "viirs_ref": v["viirs"],
                       "adjusted_stat": round(adjusted, 2),
                       "adjusted_calendar": cal_by_ym.get((y, m)),
                       "k_used": round(math.exp(log_r), 4),
                       "ratio_source": ratio_source})
    return JSONResponse({"aoi": aoi, "data": data,
                         "data_source": _data_source_label(data),
                         "units": "hotspot detections per month (NOT fires)",
                         "evaluation_version": (manifest or {}).get("evaluation_version"),
                         "eval_unit": (manifest or {}).get("eval_unit"),
                         "backtest_metrics": metrics,
                         "hgb_full_test": per.get("hgb_full_test"),
                         "hgb_residual_enabled": per.get("hgb_residual_enabled"),
                         "hgb_fallback_baseline": per.get("hgb_fallback_baseline"),
                         "effective_ml_method": (
                             "ml_b2res_v4" if per.get("hgb_residual_enabled")
                             else f"stat:{per.get('hgb_fallback_baseline') or 'baseline'}"),
                         "ml_compatible": ml_ok, "ml_compat_reason": ml_why,
                         "ml_trained": ml_meta is not None,
                         "ts_trained": ts_meta is not None,
                         "ts_meta": ts_meta,
                         "months": months})


@app.get("/api/firms/llm-status")
def firms_llm_status():
    return llm.available()


@app.post("/api/firms/ask-llm")
def firms_ask_llm(payload: dict):
    """LLM explainer grounded on verified facts (falls back honestly offline)."""
    q = str(payload.get("question", "")).strip()
    if not q or len(q) > 1000:
        raise HTTPException(400, "Provide question (1-1000 chars)")
    bbox = _parse_bbox(payload.get("bbox"))
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "sample"))
    if data not in ("sample", "raw"):
        raise HTTPException(400, "data must be sample|raw")
    records = [r for r in _resolve_records(aoi, data, 100000) if _in_bbox(r, bbox)]
    if not records:
        raise HTTPException(404, "No sample data in this AOI")
    out = _harmonize_from_records(records, data=data, aoi=aoi)
    facts = ex.gather_facts(out["calendar"], out["daily_cells"],
                            out["ratios"], len(records), payload.get("bbox"))
    facts["data_source"] = _data_source_label(data)
    facts["latest"] = out["latest"]
    facts["method_summary"] = (
        "4 steps on a daily 0.05° grid: (1) standardize FIRMS rows to one schema with QA flags; "
        f"(2) k = MODIS/VIIRS = {out['ratios'].get('_fallback')} from monthly AOI totals "
        f"({out['ratios'].get('_n_months', 0)} measured months; empirical activity ratio, not a validated calibration); "
        "(3) sensor-adjusted activity index in hotspot detections (NOT fires): keep VIIRS where >=1 VIIRS "
        "detection, upscale MODIS-only cells by 1/k as ESTIMATES (coverage unknown, upscaled FRP=null); "
        f"(4) month×year calendar, z anomaly in {out['calendar'].get('z_unit', 'robust MAD units')}. "
        f"Calibration method for this response: {out.get('method_id')}.")
    rule = ex.answer(q, facts, out["critical_periods"], out["latest"], dl.describe())
    res = llm.ask_llm(q, {**facts, "top_months": out["critical_periods"][:5]},
                      rule["answer"])
    return JSONResponse({**res, "facts": facts, "suggestions": rule["suggestions"]})


@app.post("/api/firms/ask")
def firms_ask(payload: dict):
    """Offline assistant: explains algorithm/data/accuracy from live numbers."""
    q = str(payload.get("question", "")).strip()
    if not q or len(q) > 1000:
        raise HTTPException(400, "Provide question (1-1000 chars)")
    bbox = _parse_bbox(payload.get("bbox"))
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "sample"))
    if data not in ("sample", "raw"):
        raise HTTPException(400, "data must be sample|raw")
    records = [r for r in _resolve_records(aoi, data, 100000) if _in_bbox(r, bbox)]
    if not records:
        raise HTTPException(404, "No sample data in this AOI")
    out = _harmonize_from_records(records, data=data)
    facts = ex.gather_facts(out["calendar"], out["daily_cells"],
                            out["ratios"], len(records), payload.get("bbox"))
    facts["data_source"] = _data_source_label(data)
    return JSONResponse(ex.answer(q, facts, out["critical_periods"],
                                  out["latest"], dl.describe()))


@app.middleware("http")
async def _req_id(request, call_next):  # noqa: ANN001
    rid = uuid.uuid4().hex[:12]
    try:
        resp = await call_next(request)
    except Exception:
        logger.exception("request failed id=%s", rid)
        raise
    resp.headers["X-Request-Id"] = rid
    return resp


_DIST = REPO_ROOT / "frontend" / "dist"


# P0-08: serve bundled JS/CSS before the SPA catch-all so they are never
# swallowed by index.html (the catch-all below only sees non-/assets paths).
if _DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="assets")


@app.get("/{full_path:path}")
def _spa_fallback(full_path: str):
    """Serve bundled files with real MIME types, else index.html for SPA routes.

    Audit P1-23: the old catch-all was registered before the static mount, so
    /logo.svg and /manifest.webmanifest could be swallowed by index.html.
    API 404s stay JSON; path traversal is rejected.
    """
    if full_path.startswith("api/"):
        raise HTTPException(404, f"Unknown API path /{full_path}")
    from fastapi.responses import FileResponse
    dist = _DIST.resolve()
    candidate = (dist / full_path).resolve()
    if _DIST.is_dir() and str(candidate).startswith(str(dist)) and candidate.is_file():
        return FileResponse(str(candidate))
    index = _DIST / "index.html"
    if _DIST.is_dir() and index.exists():
        return FileResponse(str(index), media_type="text/html")
    raise HTTPException(404, "Dashboard not built (run make demo)")
