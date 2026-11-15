"""FIRMS harmonized burning-activity calendar API (NASA Space Apps 2026)."""
from __future__ import annotations

import hmac
import json
import logging
import os
import re
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from app.firms import calendar as cal
from app.firms import (coverage as cov, dl, evaluation, evidence as evd,
                       explain as ex, harmonize, hts, llm, ml_cal, registry,
                       stan, spatial, store)
# CLAIM-013 de-frag: geo/filter helpers live in firms.spatial, activity
# helpers in firms.service. Re-imported here so `from app.main import ...`
# callers keep working.
from app.firms.service import (_activity_summary, _empty_month_slot,
                               _forecast, _latest_summary, _round4, _slot_add)
from app.firms.spatial import (_geometry_bbox, _geometry_hash, _in_bbox,
                               _in_dates, _norm_confidence_filter,
                               _norm_satellite_filter, _parse_bbox,
                               _parse_date_range, _parse_geometry,
                               _point_in_geometry, _point_in_ring,
                               _row_in_scope)
from app.firms.schema import FirmsRecord
# CLAIM-019: pipeline owns the harmonize/record helpers; re-exported here so
# `from app.main import _harmonize_stream` callers keep working.
from app.firms.pipeline import (_artifact_availability, _block_raw_ml_ts,
                                _covered_targets, _data_source_label,
                                _evaluation_facts, _harmonize_from_records,
                                _harmonize_stream, _pairs_for, _raw_agg,
                                _require_aoi, _resolve_records,
                                _sample_records)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(),
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")

_PROGRESS_LOCK = threading.Lock()
_PROGRESS_STATE: dict[str, dict] = {}


def _progress_file(aoi: str, data: str) -> Path:
    safe_aoi = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(aoi or "unknown"))
    safe_data = "raw" if data == "raw" else "sample"
    return store.CACHE_DIR / f".progress_{safe_aoi}_{safe_data}.json"


def _set_progress(aoi: str, data: str, stage: str, percent: int, detail: str) -> None:
    payload = {
        "aoi": aoi,
        "data": data,
        "stage": stage,
        "percent": max(0, min(100, int(percent))),
        "detail": detail,
        "updated_at": time.time(),
    }
    with _PROGRESS_LOCK:
        _PROGRESS_STATE[f"{aoi}:{data}"] = payload
    try:
        store.CACHE_DIR.mkdir(parents=True, exist_ok=True)
        pf = _progress_file(aoi, data)
        tmp = pf.with_name(f".tmp_{pf.name}_{os.getpid()}")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(pf)
    except OSError:
        pass
logger = logging.getLogger("firms.api")

PROJECT_ROOT = Path(__file__).resolve().parents[1]

# AOI presets live in backend/data/firms/aois.json (store.aoi_registry);
# manifest-backed custom AOIs join automatically. No hardcoded AOI map here.


REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = Path(__file__).resolve().parents[1] / "data" / "firms" / "models"

app = FastAPI(
    title="FireHarmony API - NASA FIRMS MODIS/VIIRS harmonization",
    description=("FireHarmony: harmonization of NASA FIRMS MODIS and VIIRS hot spots "
                 "into one burning-activity calendar, with coverage audit and "
                 "evidence-grounded explanations."),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Admin-Token", "X-Turnstile-Token"],
    expose_headers=[
        "X-Elapsed-Ms",
        "X-Request-Id",
        "X-Filter-Hash",
        "X-Row-Count",
        "X-From-Date",
        "X-To-Date",
        "X-Geometry-Hash",
        "X-Data-Source",
        "X-Row-Kind",
    ],
    max_age=600,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def _elapsed_header(request: Request, call_next):
    """P1-08: make request cost measurable (X-Elapsed-Ms) for P50/P95 reports."""
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Elapsed-Ms"] = str(int((time.perf_counter() - t0) * 1000))
    return response


# Upload paths where Starlette parses the multipart body *before* the route
# handler runs (50 MB cap) — check the captcha header first so unverified
# bots never get to spool a file to disk. `turnstile.enforce` memoizes the
# result on `request.state`, so the handler's second call does not re-verify a
# single-use token.
_TURNSTILE_EARLY_PATHS = frozenset({
    "/api/firms/upload-dataset",
    "/api/firms/ingest",
})


@app.middleware("http")
async def _turnstile_before_upload(request: Request, call_next):
    if request.method == "POST" and request.url.path.rstrip("/") in _TURNSTILE_EARLY_PATHS:
        from app.firms import turnstile

        try:
            await run_in_threadpool(turnstile.enforce, request)
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    return await call_next(request)


_STARTED = time.time()


def _require_admin(request: Request) -> None:
    """Gate write/train endpoints when ADMIN_TOKEN is set; open local dev otherwise.

    Audit P1-13: production must never silently run with write endpoints open.
    Set APP_ENV=production (and ADMIN_TOKEN) for any public deployment.
    """
    tok = os.getenv("ADMIN_TOKEN", "")
    production = os.getenv("APP_ENV", "").lower() in ("production", "prod")
    if tok and not hmac.compare_digest(
            request.headers.get("X-Admin-Token", ""), tok):
        raise HTTPException(403, "Admin token required (X-Admin-Token)")
    if production and not tok:
        raise HTTPException(503, "ADMIN_TOKEN must be set when APP_ENV=production")


_JSON_META_CACHE: dict[str, tuple[float, dict]] = {}


def _read_cached_meta(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    cached = _JSON_META_CACHE.get(str(path))
    if cached is not None and cached[0] == mtime:
        return cached[1]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        _JSON_META_CACHE[str(path)] = (mtime, data)
        return data
    except (OSError, json.JSONDecodeError):
        return None


def _stan_meta(kind: str = "safe") -> dict | None:
    name = "stan_safe_raw.json" if kind == "safe" else "stan_retro_raw.json"
    return _read_cached_meta(MODEL_DIR / name)


def _backtest_from_manifest(manifest: dict, aoi: str, data: str,
                            test_years: int) -> dict:
    per = (manifest.get("per_aoi") or {}).get(aoi) or {}
    samples = [s for s in manifest.get("samples", []) if s.get("aoi") == aoi]
    # The unified manifest is the source of truth for published metrics and
    # predictions. Model-sidecar predictions use a separate training protocol.
    stan_meta = _stan_meta("safe") if data == "raw" else None
    hts_meta = _read_cached_meta(MODEL_DIR / "hts_anchor_raw.json") if data == "raw" else None
    official = evaluation.official_summary(manifest) if data == "raw" else None
    manifest_predictions = {
        f"{sample['aoi']}:{int(sample['year'])}-{int(sample['month']):02d}": {
            "stan": sample.get("stan_safe_v1"),
            "hts": sample.get("hts_anchor_v1"),
            "viirs_ref": sample.get("viirs_ref"),
            "b2": sample.get("b2_seasonal_ratio"),
        }
        for sample in manifest.get("samples", [])
    }
    if stan_meta is not None and official is not None:
        stan_meta = {
            **stan_meta,
            "official": official,
            "training_comparisons": stan_meta.get("comparisons") or {},
            "comparisons": official.get("comparisons") or {},
            "predictions": {
                key: {k: v for k, v in value.items() if k in ("stan", "hts", "viirs_ref")}
                for key, value in manifest_predictions.items()
            },
        }
    if hts_meta is not None and official is not None:
        hts_metrics = official.get("hts_metrics") or {}
        b2_metrics = official.get("b2_metrics") or {}
        hts_mae, b2_mae = hts_metrics.get("mae"), b2_metrics.get("mae")
        per_aoi_summary = official.get("per_aoi") or {}
        hts_meta = {
            **hts_meta,
            "metrics": hts_metrics,
            "b2_metrics": b2_metrics,
            "hts_mae": hts_mae,
            "b2_mae": b2_mae,
            "mean_gain_vs_b2": (
                (b2_mae - hts_mae) / b2_mae
                if hts_mae is not None and b2_mae not in (None, 0) else None
            ),
            "headline": official.get("hts_headline"),
            "per_aoi": {
                name: {
                    **(info.get("hts") or {}),
                    "hts_mae": (info.get("hts") or {}).get("mae"),
                    "b2_mae": (info.get("b2") or {}).get("mae"),
                }
                for name, info in per_aoi_summary.items()
                if info.get("hts")
            },
            "training_comparisons": hts_meta.get("comparisons") or {},
            "comparisons": {
                "hts_vs_b2": (official.get("comparisons") or {}).get("hts_vs_b2"),
            },
            "predictions": {
                key: {k: v for k, v in value.items() if k in ("hts", "b2", "viirs_ref")}
                for key, value in manifest_predictions.items()
            },
        }
    rows = []
    for sample in samples:
        rows.append({"year": sample["year"], "month": sample["month"],
                     "modis": sample["modis"], "viirs_ref": sample["viirs_ref"],
                     "stan_pred": sample.get("stan_safe_v1"),
                     "hts_pred": sample.get("hts_anchor_v1"),
                     "b2_pred": sample.get("b2_seasonal_ratio")})
    return {
        "aoi": aoi, "data": data,
        "data_source": manifest.get("data_source"),
        "evaluation_version": manifest.get("evaluation_version"),
        "eval_unit": manifest.get("eval_unit"),
        "dataset_sha256": manifest.get("dataset_sha256"),
        "metrics": per.get("metrics") or {},
        "primary_method_id": registry.PRIMARY,
        "primary_gate": evaluation.primary_status(data, MODEL_DIR),
        "hts": hts_meta,
        "stan": stan_meta,
        "stan_official": official if stan_meta is not None else None,
        "pooled_metrics": (manifest.get("pooled") or {}).get("metrics", {}),
        "pooled_full_month": manifest.get("pooled_full_month"),
        "headline": manifest.get("headline"),
        "comparisons": manifest.get("comparisons"),
        "scored_years": manifest.get("scored_years"),
        "candidate_holdout_years": manifest.get("candidate_holdout_years"),
        "excluded_months": manifest.get("excluded_months"),
        "coverage_class": per.get("coverage_class"),
        "coverage": per.get("coverage"),
        "n_eval": per.get("n_eval") or 0,
        "n_test_full": per.get("n_test"),
        "n_eval_intersection": manifest.get("n_eval"),
        "train_years": per.get("train_years", []),
        "test_years": per.get("test_years", sorted({s["year"] for s in samples})),
        "note": manifest.get("note"),
        "months": rows,
    }


def _analysis_for_evidence(aoi: str, data: str, method: str, bbox, qa_min: str,
                           platform_set: str, focus_ym: str | None = None,
                           dataset: str | None = None) -> dict:
    if dataset:
        records = [r for r in _resolve_records(aoi, data, 2000000, dataset)
                   if _in_bbox(r, _parse_bbox(bbox))]
        if not records:
            raise HTTPException(404, f"No {data} data in this AOI")
        return _harmonize_from_records(records, daily_cap=2000000, data=data, aoi=aoi,
                                       method=method, dataset=dataset, qa_min=qa_min,
                                       platform_set=platform_set)
    if data == "raw":
        if not store.raw_ready(aoi):
            raise HTTPException(404, detail={"error_code": "no_raw_data",
                                             "message": f"No raw data for {aoi}"})
        return _harmonize_stream(aoi, data, bbox, method, daily_cap=2000000,
                                 qa_min=qa_min, platform_set=platform_set,
                                 focus_ym=focus_ym)
    records = [r for r in _resolve_records(aoi, data, 2000000)
               if _in_bbox(r, _parse_bbox(bbox))]
    if not records:
        raise HTTPException(404, f"No {data} data in this AOI")
    return _harmonize_from_records(records, daily_cap=2000000, data=data, aoi=aoi,
                                   method=method, qa_min=qa_min,
                                   platform_set=platform_set)


_SENSOR_KW = ("sensor", "modis", "viirs", "platform", "2012", "transition", "surge", "cảm biến", "cam bien", "ảo ảnh")


def _sensor_context_facts(aoi: str, facts: dict) -> dict:
    years = facts.get("years") or []
    has_2012 = bool(years and min(years) <= 2012 <= max(years))
    return {
        "modis_resolution_m": 1000,
        "modis_start_year": 2000,
        "viirs_resolution_m": 375,
        "viirs_launch_year": 2012,
        "pixel_area_advantage": 7,
        "active_aoi": aoi,
        "active_aoi_years": years,
        "active_aoi_covers_2012": has_2012,
        "transition_mechanism": (
            "In 2012, Suomi NPP VIIRS (375 m I-band, ~14 ha pixel) joined MODIS (1 km, ~100 ha pixel). "
            "Uncalibrated raw hotspot counts surge after 2012 largely because VIIRS resolves small sub-pixel fires "
            "that MODIS misses, creating a sensor-transition step rather than pure wildfire expansion. "
            "FireHarmony harmonizes MODIS to the VIIRS reference scale using STAN (with HTS/B2 fallback)."
        ),
        "archive_note": (
            f"Active AOI '{aoi}' covers years {years}."
            if has_2012
            else f"Active AOI '{aoi}' only covers years {years} in this archive (no 2012 local rows); switch AOI to 'vietnam' to inspect the 2001-2025 transition directly."
        ),
    }


# CLAIM-016: routes live in app.routers (calendar/models/system); wiring only.
from app.routers import calendar as _calendar_router
from app.routers import models as _models_router
from app.routers import system as _system_router

app.include_router(_calendar_router.router)
app.include_router(_models_router.router)
app.include_router(_system_router.router)


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
