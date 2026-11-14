"""FIRMS harmonized burning-activity calendar API (NASA Space Apps 2026)."""
from __future__ import annotations

import csv
import hashlib
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
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.firms import calendar as cal
from app.firms import (coverage as cov, dl, evaluation, evidence as evd,
                       explain as ex, harmonize, hts, llm, ml_cal, ml_v4, sf_lite,
                       stan,
                       spatial, store, ts_v2 as tst)
from app.firms.schema import FirmsRecord

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(),
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("firms.api")

PROJECT_ROOT = Path(__file__).resolve().parents[1]

AOIS = {
    "vietnam": "Vietnam (Central Highlands / Mekong, dry Dec-Apr)",
    "amazon": "Amazon (Southern Basin, dry Jul-Oct 2019)",
    "australia": "Australia (Southeast, dry Dec-Feb Black Summer)",
}
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


def _artifact_availability() -> dict:
    """Report servable methods from torch + required artifact FILES, not import alone.

    Audit V6 P0-03/P1-11: torch import used to advertise `ts=true` even when
    the release ZIP shipped only JSON metadata and no weights.
    """
    def present(prefix: str, extensions: tuple[str, ...]) -> bool:
        return all(
            (MODEL_DIR / f"{prefix}_{aoi}{tag}.{ext}").exists()
            for aoi in AOIS for tag in ("", "_raw") for ext in extensions
        )

    ml_present = present("cal", ("json", "joblib"))
    ts_weights = present("ts", ("json", "pt"))
    sf_stat = sf_lite.artifact_status("raw", MODEL_DIR)
    sf_present = bool(sf_stat["weights_present"] and sf_stat["metadata_present"])
    ts_ok = bool(ts_weights and tst._HAS_TORCH)  # noqa: SLF001
    reason = None
    if not ts_weights:
        reason = "weights_missing"
    elif not tst._HAS_TORCH:  # noqa: SLF001
        reason = "torch_missing"
    return {
        "stat": True,
        "ml": ml_present,
        "ts": ts_ok,
        "ml_artifact_present": ml_present,
        "ts_artifact_present": ts_weights,
        "ts_reason": reason,
        "sf_artifact_present": sf_present,
        "sf_artifact_verified": bool(sf_stat["available"]),
        "sf_artifact_reason": sf_stat["reason"],
        "sf_experimental": True,
    }


@app.get("/api/health")
def health():
    availability = _artifact_availability()
    return {"status": "ok", "service": "firms-calendar",
            "uptime_s": round(time.time() - _STARTED, 1),
            "torch": dl.describe()["has_torch"],
            "methods_available": {"stat": availability["stat"],
                                  "ml": availability["ml"],
                                  "ts": availability["ts"]},
            "methods_detail": availability,
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


def _evaluation_facts(aoi: str, data: str) -> dict:
    m = evaluation.load_manifest(data, MODEL_DIR)
    if not m:
        return {}
    per = (m.get("per_aoi") or {}).get(aoi) or {}
    return {
        "evaluation_version": m.get("evaluation_version"),
        "test_years": per.get("test_years") or m.get("test_years"),
        "n_eval": m.get("n_eval"),
        "eval_unit": m.get("eval_unit"),
        "pooled_metrics": (m.get("pooled") or {}).get("metrics", {}),
        "pooled_full_month": m.get("pooled_full_month"),
        "per_aoi": {aoi: per},
        "hgb_residual_enabled": per.get("hgb_residual_enabled"),
        "hgb_fallback_baseline": per.get("hgb_fallback_baseline"),
        "hgb_gate": per.get("hgb_gate"),
    }


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
    if dataset or data == "upload":
        return "user-uploaded session dataset (unverified source)"
    return ("synthetic demo (NOT observed: do not claim real events)"
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
    if method in ("hts", "stan"):
        if data != "raw":
            raise HTTPException(
                409, f"{method.upper()} requires raw NASA data; the synthetic "
                     "sample has no 1-degree tiles. Use method=stat for the sample.")
        check = ((MODEL_DIR / "hts_series_raw.json") if method == "hts"
                 else (MODEL_DIR / "stan_series_raw.json"))
        if not check.exists():
            hint = ("python -m scripts.firms.build_hts_series"
                    if method == "hts" else
                    "python -m scripts.firms.build_stan_series")
            raise HTTPException(422, f"no {method} series artifact; run {hint}")
        return
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


def _parse_geometry(raw: str | None) -> dict | None:
    """Parse a GeoJSON Polygon/MultiPolygon geometry (P0-03)."""
    if not raw:
        return None
    try:
        g = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        raise HTTPException(400, "geometry must be GeoJSON Polygon/MultiPolygon JSON")
    if not isinstance(g, dict):
        raise HTTPException(400, "geometry must be a GeoJSON object")
    if g.get("type") == "Feature":
        g = g.get("geometry") or {}
    if g.get("type") == "Polygon":
        rings = [g.get("coordinates") or []]
    elif g.get("type") == "MultiPolygon":
        rings = g.get("coordinates") or []
    else:
        raise HTTPException(400, "geometry type must be Polygon or MultiPolygon")
    out = []
    for poly in rings:
        if not poly or not isinstance(poly[0], list):
            raise HTTPException(400, "geometry has no rings")
        norm = []
        for ring in poly:
            pts = []
            for pt in ring:
                try:
                    lon, lat = float(pt[0]), float(pt[1])
                except (TypeError, ValueError, IndexError):
                    raise HTTPException(400, "geometry coordinates must be [lon, lat]")
                pts.append((lon, lat))
            if len(pts) < 3:
                raise HTTPException(400, "geometry ring needs at least 3 vertices")
            norm.append(pts)
        out.append(norm)
    if not out:
        raise HTTPException(400, "geometry is empty")
    return {"type": "MultiPolygon", "coordinates": out}


def _geometry_bbox(geom: dict) -> tuple[float, float, float, float]:
    xs = [pt[0] for poly in geom["coordinates"] for ring in poly for pt in ring]
    ys = [pt[1] for poly in geom["coordinates"] for ring in poly for pt in ring]
    return (min(xs), min(ys), max(xs), max(ys))


def _point_in_ring(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat):
            xint = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < xint:
                inside = not inside
        j = i
    return inside


def _point_in_geometry(lon: float, lat: float, geom: dict | None) -> bool:
    """Point-in-polygon with holes; bbox prefilter happens upstream."""
    if geom is None:
        return True
    for poly in geom["coordinates"]:
        if not poly or not _point_in_ring(lon, lat, poly[0]):
            continue
        if any(_point_in_ring(lon, lat, hole) for hole in poly[1:]):
            continue
        return True
    return False


def _geometry_hash(geom: dict | None) -> str:
    if not geom:
        return "none"
    blob = json.dumps(geom, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def _parse_date_range(from_date: str | None,
                      to_date: str | None) -> tuple[str | None, str | None]:
    """Validate ISO dates (YYYY-MM-DD) and return the inclusive day bounds."""
    out = []
    for raw in (from_date, to_date):
        if raw is None or raw == "":
            out.append(None)
            continue
        try:
            d = datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "from_date/to_date must be YYYY-MM-DD")
        out.append(d.isoformat())
    if out[0] and out[1] and out[0] > out[1]:
        raise HTTPException(400, "from_date must be <= to_date")
    return out[0], out[1]


def _in_dates(r: dict, lo: str | None, hi: str | None) -> bool:
    if not lo and not hi:
        return True
    d = str(r.get("acq_date", ""))[:10]
    if not d:
        return False
    if lo and d < lo:
        return False
    if hi and d > hi:
        return False
    return True


def _empty_month_slot() -> dict:
    return {"modis": 0.0, "viirs": 0.0, "harmonized": 0.0, "cells": 0,
            "paired_cells": 0, "modis_only_cells": 0, "viirs_only_cells": 0,
            "estimated_cells": 0}


def _slot_add(slot: dict, modis: float, viirs: float, harmonized: float,
              estimated: bool) -> None:
    slot["modis"] += float(modis or 0)
    slot["viirs"] += float(viirs or 0)
    slot["harmonized"] += round(float(harmonized or 0), 3)
    slot["cells"] += 1
    if modis and viirs:
        slot["paired_cells"] += 1
    elif modis:
        slot["modis_only_cells"] += 1
    elif viirs:
        slot["viirs_only_cells"] += 1
    if estimated:
        slot["estimated_cells"] += 1


def _activity_summary(out: dict, *, data: str, method: str, aoi: str,
                      bbox: str | None, qa_min: str, platform_set: str,
                      dataset: str | None, geom_hash: str = "none",
                      from_date: str | None = None,
                      to_date: str | None = None) -> dict:
    """P0-01: server-side totals over the FULL filtered set.

    Sensor detections are hotspot records, not fires. MODIS and VIIRS are
    reported separately; `sensor_detections_total` is their sum and must not be
    presented as a fire count.
    """
    monthly = out.get("monthly") or {}
    modis = viirs = harmonized = 0.0
    cells = paired = modis_only = viirs_only = estimated = 0
    for slot in monthly.values():
        modis += float(slot.get("modis", 0) or 0)
        viirs += float(slot.get("viirs", 0) or 0)
        harmonized += float(slot.get("harmonized", 0) or 0)
        cells += int(slot.get("cells", 0) or 0)
        paired += int(slot.get("paired_cells", 0) or 0)
        modis_only += int(slot.get("modis_only_cells", 0) or 0)
        viirs_only += int(slot.get("viirs_only_cells", 0) or 0)
        estimated += int(slot.get("estimated_cells", 0) or 0)
    months = sorted(monthly)
    if not months and out.get("calendar"):
        cyears = out["calendar"].get("years") or []
        if cyears:
            months = [f"{cyears[0]}-01", f"{cyears[-1]}-12"]
    n_total = int(out.get("daily_cells") or cells)
    n_returned = len(out.get("daily") or [])
    scope = ("nasa_firms_observed" if (data == "raw" and not dataset)
             else "user_upload_unverified" if dataset
             else "synthetic_demo_not_observed")
    filters = {"aoi": aoi, "bbox": bbox or "all", "data": data,
               "method": method, "qa_min": qa_min,
               "platform_set": platform_set, "dataset": dataset or "none",
               "geometry_hash": geom_hash,
               "from_date": from_date or "all", "to_date": to_date or "all"}
    return {
        "modis_detections": round(modis, 3),
        "viirs_detections": round(viirs, 3),
        "sensor_detections_total": round(modis + viirs, 3),
        "harmonized_total": round(harmonized, 3),
        "paired_cells": paired,
        "modis_only_cells": modis_only,
        "viirs_only_cells": viirs_only,
        "estimated_cells": estimated,
        "estimated_index": round(estimated / cells, 4) if cells else None,
        "n_daily_cells_total": n_total,
        "n_daily_cells_returned": n_returned,
        "period": {"from": months[0] if months else None,
                   "to": months[-1] if months else None},
        "source_scope": scope,
        "data_source": _data_source_label(data, dataset),
        "method": method,
        "method_id": out.get("method_id"),
        "effective_method": out.get("effective_method"),
        "filter_hash": hashlib.sha256(
            json.dumps(filters, sort_keys=True).encode()).hexdigest()[:16],
        "filters": filters,
        "note": ("Sensor detections are hotspot records, not fire counts. "
                 "MODIS and VIIRS are reported separately and are not additive "
                 "as real fires. estimated_index = share of grid cell-days "
                 "whose value is model-estimated (no same-day VIIRS detection)."),
    }


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
    month_totals: dict[str, list[float]] = {}
    for c in stat:
        ym = str(c["date"])[:7]
        slot = month_totals.setdefault(ym, [0.0, 0.0])
        slot[0] += float(c["harmonized_count"])
        if c.get("estimate_type") == "modis_upscaled_estimated":
            slot[1] += float(c["harmonized_count"])
    for ym in sorted(month_totals):
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
        stat_total, stat_modis_only = month_totals[ym]
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
    # Mutate in place: a second 633k-cell copy would double peak memory.
    for c in stat:
        ym = str(c["date"])[:7]
        if c.get("estimate_type") == "modis_upscaled_estimated" and ym in factors:
            c["harmonized_count"] = round(c["harmonized_count"] * factors[ym], 3)
            c["estimate_type"] = "ml_predicted"
            c["method"] = served
            c["effective_method"] = served
            c["coverage_status"] = "unknown"
        else:
            c["effective_method"] = "stat:seasonal_ratio_v1"
    conservation = []
    for ym in factors:
        total = sum(float(c["harmonized_count"]) for c in stat if str(c["date"])[:7] == ym)
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
    return stat, diagnostics


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
    month_totals: dict[str, list[float]] = {}
    for c in daily_stat:
        ym = str(c["date"])[:7]
        slot = month_totals.setdefault(ym, [0.0, 0.0])
        slot[0] += float(c["harmonized_count"])
        if c.get("estimate_type") == "modis_upscaled_estimated":
            slot[1] += float(c["harmonized_count"])
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
        stat_total, stat_modis_only = month_totals[ym]
        observed_part = stat_total - stat_modis_only
        target_est = pred - observed_part
        if stat_modis_only > 0 and target_est > 0:
            # rescale only the estimated part toward the predicted month total
            factors[ym] = target_est / stat_modis_only
        else:
            no_modis_only.append(ym)
    # Mutate in place (see _harmonize_daily_ml): no second 633k-cell copy.
    for c in daily_stat:
        ym = str(c["date"])[:7]
        if c.get("estimate_type") == "modis_upscaled_estimated" and ym in factors:
            c["harmonized_count"] = round(c["harmonized_count"] * factors[ym], 3)
            c["estimate_type"] = "ts_predicted"
            c["method"] = "ts_logratio_pool_v2"
            c["effective_method"] = "ts_logratio_pool_v2"
            c["coverage_status"] = "unknown"
        else:
            c["effective_method"] = "stat:seasonal_ratio_v1"
    conservation = []
    for ym in factors:
        total = sum(float(c["harmonized_count"]) for c in daily_stat if str(c["date"])[:7] == ym)
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
    return daily_stat, diagnostics


def _latest_summary(calen: dict, daily: list[dict],
                    month_latest: dict[str, str] | None = None) -> dict | None:
    """Latest COMPLETE month vs history.

    Partial months carry no verdict; instead of returning null when the newest
    NRT month is partial, we fall back to the newest month whose coverage is
    not verified-partial (audit P1-01). Streaming callers pass `month_latest`
    (newest detection date per YYYY-MM) instead of a full daily-cell list.
    """
    if not (daily or month_latest) or not calen.get("years"):
        return None
    by_month: dict[str, list[str]] = {}
    if month_latest:
        by_month = {ym: [d] for ym, d in month_latest.items()}
    else:
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
        excluded = set((calen.get("anomaly_eligibility") or {})
                       .get("excluded_months") or [])
        col = [calen["matrix"][yi][mi] for yi, y in enumerate(calen["years"])
               if y != ly and calen["matrix"][yi][mi] is not None
               and f"{y}-{m:02d}" not in excluded]
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


def _raw_agg(aoi: str, bbox=None, qa_min: str = "all",
             platform_set: str = "all", year: int | None = None,
             ym: str | None = None, geom: dict | None = None):
    """Aggregate raw rows for one AOI without materialising cell-day dicts."""
    b = _parse_bbox(bbox) if isinstance(bbox, str) else bbox

    def rows():
        for r in store.iter_raw_rows(aoi, limit=None, year=year, ym=ym):
            if b is not None and not _in_bbox(r, b):
                continue
            if geom is not None:
                try:
                    if not _point_in_geometry(float(r["longitude"]),
                                              float(r["latitude"]), geom):
                        continue
                except (KeyError, TypeError, ValueError):
                    continue
            yield r

    return harmonize.aggregate_iter(rows(), qa_min=qa_min,
                                    platform_set=platform_set)


def _harmonize_stream(aoi: str, data: str, bbox, method: str = "stat",
                      daily_cap: int = 2000, qa_min: str = "all",
                      platform_set: str = "all",
                      focus_ym: str | None = None,
                      simulate_year: int | None = None,
                      simulate_configs: list[dict] | None = None,
                      cache_result: bool = True,
                      geom: dict | None = None,
                      from_date: str | None = None,
                      to_date: str | None = None) -> dict:
    """Memory-bounded pipeline for large raw pulls (1.4M+ rows).

    Validates, dedups and aggregates while streaming from disk; only the
    monthly ML context and the final daily cells are retained.
    """
    b = _parse_bbox(bbox) if isinstance(bbox, str) else bbox
    # Validating 1.4M rows costs ~90 s; the raw set is static between pulls, so
    # the finished result is cached on disk keyed by file fingerprint, method,
    # data version and model version (audit P0-08 / P1-20).
    fp = store.raw_fingerprint(aoi)
    # One cache entry per (method, filters), not per `limit`: the frontend uses
    # 25k and other callers use 2k, which used to trigger duplicate 90 s runs.
    cache_cap = (daily_cap if (focus_ym or simulate_year or not cache_result)
                 else 5000)
    model_key = "none"
    if method in ("ml", "ts", "hts", "stan"):
        mp = MODEL_DIR / ({"ml": f"cal_{aoi}_raw.json",
                           "ts": f"ts_{aoi}_raw.json",
                           "hts": "hts_series_raw.json",
                           "stan": "stan_series_raw.json"}[method])
        if mp.exists():
            model_key = hashlib.sha256(mp.read_bytes()).hexdigest()[:10]
    manifest_key = "none"
    if store.MANIFEST.exists():
        mst = store.MANIFEST.stat()
        manifest_key = f"{mst.st_mtime_ns}_{mst.st_size}"
    sim_key = (hashlib.sha256(json.dumps(simulate_configs or [],
                                          sort_keys=True).encode()).hexdigest()[:8]
               if simulate_configs else "nosim")
    geom_key = _geometry_hash(geom)
    ckey = (f"cal_{aoi}_{method}_{fp}_{bbox or 'all'}_{cache_cap}_"
            f"{qa_min}_{platform_set}_{focus_ym or 'all'}_{simulate_year or 'nosim'}_"
            f"{model_key}_{manifest_key}_{sim_key}_{geom_key}_"
            f"{from_date or 'all'}_{to_date or 'all'}_sum-v1_"
            f"{harmonize.ALGORITHM_VERSION}_{ml_v4.ALGORITHM_VERSION}_"
            f"{tst.ALGORITHM_VERSION}_{stan.ALGORITHM_VERSION}")

    def _finish(d: dict) -> dict:
        cap = int(daily_cap or 0)
        if cap == 0:
            d = {**d, "daily": []}
        elif len(d.get("daily") or []) > cap:
            d = {**d, "daily": d["daily"][:cap]}
        d = {**d, "summary": _activity_summary(
            d, data=data, method=method, aoi=aoi, bbox=bbox,
            qa_min=qa_min, platform_set=platform_set, dataset=None,
            geom_hash=geom_key, from_date=from_date, to_date=to_date)}
        return d

    hit = store.cache_get(ckey) if cache_result else None
    if hit is not None:
        return _finish(hit)
    ctx_builder = ml_cal.ModisCtxBuilder() if method in ("ts", "ml") else None
    if ctx_builder is not None:
        def keep(d):
            ctx_builder.add(d)
    else:
        keep = None
    def rows():
        for r in store.iter_raw_rows(aoi, limit=None, year=simulate_year, ym=focus_ym):
            if b is not None and not _in_bbox(r, b):
                continue
            if geom is not None:
                try:
                    if not _point_in_geometry(float(r["longitude"]),
                                              float(r["latitude"]), geom):
                        continue
                except (KeyError, TypeError, ValueError):
                    continue
            yield r
    agg, stats = harmonize.aggregate_iter(rows(), keep_clean=keep,
                                          qa_min=qa_min,
                                          platform_set=platform_set)
    if not agg:
        raise HTTPException(404, detail={
            "error_code": "no_raw_data",
            "message": f"No raw FIRMS rows available for aoi={aoi}. "
                       "Fetch a full month first (scripts/firms/fetch_full_month).",
            "aoi": aoi})
    ratios = harmonize.estimate_efficiency_ratio(agg)
    # A focus-month request only parses that month's files (fast path), so its
    # month-k is identical but the cross-month dispersion (`_fallback_rel_iqr`)
    # is not. Reuse the full-run calibration cached by any earlier full request
    # so evidence cards and the calendar quote the same uncertainty.
    ratio_key = (f"ratios_{aoi}_{fp}_{harmonize.ALGORITHM_VERSION}_"
                 f"fusion_{qa_min}_{platform_set}")
    if focus_ym or simulate_year:
        cached_ratios = store.cache_get(ratio_key)
        if cached_ratios:
            ratios = cached_ratios
    else:
        store.cache_put(ratio_key, ratios)
    monthly: dict[str, dict] = {}
    month_days: dict[str, list[str]] = {}
    platform_year: dict[int, dict[str, float]] = {}
    retained: list[dict] = []
    n_cells = 0
    retain_all = cache_cap >= 2_000_000

    def _accumulate(c: dict) -> None:
        nonlocal n_cells
        day = str(c["date"])[:10]
        if not _in_dates({"acq_date": day}, from_date, to_date):
            return
        n_cells += 1
        ym = day[:7]
        slot = monthly.setdefault(ym, _empty_month_slot())
        _slot_add(slot, float(c.get("modis_count", 0) or 0),
                  float(c.get("viirs_count", 0) or 0),
                  float(c.get("harmonized_count", 0) or 0),
                  c.get("estimate_type") != "viirs_observed")
        month_days.setdefault(ym, []).append(day)
        try:
            y = int(day[:4])
        except ValueError:
            return
        bucket = platform_year.setdefault(y, {})
        for sat, n in (c.get("platform_counts") or {}).items():
            bucket[str(sat)] = bucket.get(str(sat), 0.0) + float(n or 0)

    def _retain(day: str) -> bool:
        if simulate_year:
            # The simulator re-reads every cell of the target year; never cap it.
            return day[:4] == str(simulate_year)
        if focus_ym:
            return day[:7] == focus_ym and len(retained) < cache_cap
        return retain_all or len(retained) < cache_cap

    ml_meta = None
    if method == "ml":
        model, ml_meta = ml_cal.load_artifact(aoi, MODEL_DIR, tag="raw")
        if model is None:
            raise HTTPException(404, f"No raw ML artifact for aoi={aoi}")
        cell_days, ml_meta = _harmonize_daily_ml(
            agg, model, ml_meta, ctx=ctx_builder.finalize())
        for c in cell_days:
            _accumulate(c)
            if _retain(str(c["date"])[:10]):
                retained.append(c)
    elif method == "ts":
        model, ml_meta = tst.load_artifact(aoi, MODEL_DIR, tag="raw")
        if model is None:
            raise HTTPException(404, f"No raw Transformer artifact for aoi={aoi}")
        cell_days, ml_meta = _harmonize_daily_ts(
            None, harmonize.harmonize_daily(agg, ratios), aoi, data,
            modis_counts=ctx_builder.modis_counts())
        for c in cell_days:
            _accumulate(c)
            if _retain(str(c["date"])[:10]):
                retained.append(c)
    elif method == "hts":
        targets = hts.targets(aoi, MODEL_DIR)
        if not targets:
            raise HTTPException(404, f"No HTS series for aoi={aoi}")
        cell_days, ml_meta = hts.apply_monthly(
            harmonize.harmonize_daily(agg, ratios), targets)
        for c in cell_days:
            _accumulate(c)
            if _retain(str(c["date"])[:10]):
                retained.append(c)
    elif method == "stan":
        targets = stan.targets(aoi)
        if not targets:
            raise HTTPException(404, f"No STAN series for aoi={aoi}")
        cell_days, ml_meta = hts.apply_monthly(
            harmonize.harmonize_daily(agg, ratios), targets,
            method_id="stan_safe_v1", requested="stan",
            candidate=False, gate_passed=True,
            method_by_month=stan.sources(aoi))
        for c in cell_days:
            _accumulate(c)
            if _retain(str(c["date"])[:10]):
                retained.append(c)
    else:
        rel_iqr = float(ratios.get("_fallback_rel_iqr", 0.0) or 0.0)
        calibrated = ratios.get("_calibration_status", "calibrated") == "calibrated"
        fallback = ratios["_fallback"]
        provenance = harmonize._provenance(ratios)
        for cell, day, per in harmonize.iter_cell_days(agg):
            if not _in_dates({"acq_date": day}, from_date, to_date):
                continue
            k = ratios.get(day[:7], fallback)
            mo, vi, h_count, h_frp, h_low, h_high, est, sensors = \
                harmonize.fuse_cell_day(per, k, rel_iqr, calibrated)
            n_cells += 1
            ym = day[:7]
            slot = monthly.setdefault(ym, _empty_month_slot())
            _slot_add(slot, float(mo.count), float(vi.count), float(h_count),
                      est != "viirs_observed")
            month_days.setdefault(ym, []).append(day)
            try:
                y = int(day[:4])
            except ValueError:
                y = None
            if y is not None:
                bucket = platform_year.setdefault(y, {})
                for src in (mo.platform_counts or {}), (vi.platform_counts or {}):
                    for sat, n in src.items():
                        bucket[str(sat)] = bucket.get(str(sat), 0.0) + float(n or 0)
            if simulate_year:
                keep = day[:4] == str(simulate_year)
            elif focus_ym:
                keep = day[:7] == focus_ym and len(retained) < cache_cap
            else:
                keep = retain_all or len(retained) < cache_cap
            if keep:
                retained.append(harmonize.daily_row(
                    cell, day, mo, vi, h_count, h_frp, h_low, h_high,
                    est, sensors, k, rel_iqr, provenance))
    daily = retained
    covmap = cov.coverage_for_aoi(aoi)
    calen = cal.build_calendar(daily, coverage=covmap, monthly=monthly,
                               month_days=month_days, platform_year=platform_year)
    crit = cal.critical_periods(calen)
    latest = _latest_summary(calen, daily,
                             {k: max(v) for k, v in month_days.items() if v})
    coverage_summary = cov.coverage_summary(aoi)
    simulations = None
    if simulate_year and simulate_configs:
        year_daily = [c for c in daily if str(c["date"])[:4] == str(simulate_year)]
        simulations = []
        all_cfg = next((c for c in simulate_configs
                        if c.get("label") == "all_sensors"), simulate_configs[0])
        _, all_meta = harmonize.reconfigure_daily(
            year_daily, all_cfg["platforms"], all_cfg.get("label", "all_sensors"))
        baseline_k = all_meta.get("k_by_month") or {}
        for cfg in simulate_configs:
            rd, smeta = harmonize.reconfigure_daily(
                year_daily, cfg["platforms"], cfg.get("label", "custom"),
                baseline_k=baseline_k)
            scal = cal.build_calendar(rd)
            ys = scal.get("years") or []
            total = scal["row_totals"][0] if scal["row_totals"] else 0.0
            obs = sum(1 for c in rd if c.get("estimate_type") == "viirs_observed")
            est = sum(1 for c in rd if c.get("estimate_type") == "modis_upscaled_estimated")
            simulations.append({
                **smeta,
                "year": int(simulate_year),
                "year_total": round(float(total), 3),
                "months": {str(m): scal["matrix"][0][m - 1]
                           for m in range(1, 13)} if scal.get("matrix") else {},
                "observed_cells": obs,
                "estimated_cells": est,
                "n_cells": len(rd),
                "calendar": scal,
            })
        base_total = next((s["year_total"] for s in simulations
                           if s["sensor_config"] == "all_sensors"), None)
        for s in simulations:
            s["delta_vs_all"] = (round(s["year_total"] - base_total, 3)
                                 if base_total is not None else None)
    calibration = {k: ratios.get(k) for k in (
        "_fallback", "_fallback_rel_iqr", "_n_months", "_calibration_status",
        "_calibration_min_months", "_clipped_months", "_clipped_fraction",
        "_mode", "_calibration_window", "_train_end", "_sensor_set",
        "_data_version", "_excluded_months")}
    out = {"daily_cells": n_cells, "ratios": ratios, "calendar": calen,
           "critical_periods": crit[:24], "latest": latest,
           "forecast": _forecast(calen, latest["date"] if latest else None),
           "data_source": _data_source_label(data),
           "method_id": {"stat": "seasonal_ratio_v1", "ml": "ml_b2res_v4",
                         "ts": "ts_logratio_pool_v2",
                         "hts": "hts_anchor_v1",
                         "stan": "stan_safe_v1"}.get(method, "seasonal_ratio_v1"),
           "effective_method": (ml_meta or {}).get("effective_method",
                                                   "seasonal_ratio_v1"),
           "calibration": calibration,
           "validation_unit": "aoi-month",
           "spatial_validation": "not_identified_from_monthly_pairs",
           "filters": {"qa_min": qa_min, "platform_set": platform_set},
           "qa": stats, "ml_meta": ml_meta,
           "coverage": coverage_summary,
           "simulations": simulations,
           "monthly": {k: {kk: round(vv, 3) if isinstance(vv, float) else vv
                           for kk, vv in v.items()}
                       for k, v in sorted(monthly.items())},
           "daily": ([c for c in daily if str(c["date"])[:7] == focus_ym][:cache_cap]
                     if focus_ym else (daily[:cache_cap] if cache_cap else []))}
    if cache_result:
        store.cache_put(ckey, out)
    return _finish(out)


def _harmonize_from_records(records: list[dict], daily_cap: int = 2000,
                              data: str = "sample", aoi: str = "vietnam",
                              method: str = "stat",
                              dataset: str | None = None,
                              qa_min: str = "all",
                              platform_set: str = "all",
                              geom: dict | None = None,
                              from_date: str | None = None,
                              to_date: str | None = None,
                              bbox: str | None = None) -> dict:
    """Validate -> QA -> dedup -> harmonize. Single path for sample/raw/upload (P0-07)."""
    _block_raw_ml_ts(method, data, aoi)
    if method in ("hts", "stan"):
        raise HTTPException(409, f"{method.upper()} is not available for uploaded "
                                 "datasets; use method=stat")
    clean: list[dict] = []
    rejected = 0
    qa_counts: dict[str, int] = {}
    filtered_low = filtered_conf = filtered_plat = 0
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
        if qa_min in ("nominal", "high") and q == "low_confidence":
            filtered_low += 1
            continue
        if qa_min == "high" and rec.confidence != "h":
            filtered_conf += 1
            continue
        if (platform_set == "snpp" and rec.instrument == "VIIRS"
                and rec.satellite != "NPP"):
            filtered_plat += 1
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
    if from_date or to_date:
        daily = [c for c in daily
                 if _in_dates({"acq_date": str(c.get("date", ""))},
                              from_date, to_date)]
    if geom is not None:
        daily = [c for c in daily
                 if _point_in_geometry(float(c.get("lon", 0) or 0),
                                       float(c.get("lat", 0) or 0), geom)]
    # Coverage is only verified for manifest-backed raw pulls. Sample/upload
    # months carry coverage_status=unknown rather than a fake "partial" flag
    # derived from detection days (audit P0-06).
    covmap = (cov.coverage_for_aoi(aoi) if (data == "raw" and not dataset) else None)
    calen = cal.build_calendar(daily, coverage=covmap)
    crit = cal.critical_periods(calen)
    latest = _latest_summary(calen, daily)
    calibration = {k: ratios.get(k) for k in (
        "_fallback", "_fallback_rel_iqr", "_n_months", "_calibration_status",
        "_calibration_min_months", "_clipped_months", "_clipped_fraction",
        "_mode", "_calibration_window", "_train_end", "_sensor_set",
        "_data_version", "_excluded_months")}
    monthly: dict[str, dict] = {}
    for c in daily:
        day = str(c.get("date", ""))[:10]
        if not day:
            continue
        slot = monthly.setdefault(day[:7], _empty_month_slot())
        _slot_add(slot, float(c.get("modis_count", 0) or 0),
                  float(c.get("viirs_count", 0) or 0),
                  float(c.get("harmonized_count", 0) or 0),
                  c.get("estimate_type") != "viirs_observed")
    out = {"daily_cells": len(daily), "ratios": ratios,
           "monthly": monthly,
            "calendar": calen, "critical_periods": crit[:24],
            "latest": latest,
            "forecast": _forecast(calen, latest["date"] if latest else None),
            "data_source": _data_source_label(data),
            "method_id": ({"ml": "ml_b2res_v4", "ts": "ts_logratio_pool_v2",
                           "hts": "hts_anchor_v1",
                           "stan": "stan_safe_v1"}.get(method, "seasonal_ratio_v1")),
            "effective_method": (ml_meta or {}).get("effective_method",
                                                    "seasonal_ratio_v1"),
            "calibration": calibration,
            "validation_unit": "aoi-month",
            "spatial_validation": "not_identified_from_monthly_pairs",
            "filters": {"qa_min": qa_min, "platform_set": platform_set},
            "ml_meta": ml_meta,
            "coverage": (cov.coverage_summary(aoi) if (data == "raw" and not dataset) else
                         {"verified": False, "reason": "sample_or_upload"}),
            "qa": {"clean": len(clean), "rejected": rejected,
                   "filtered_low_confidence": filtered_low,
                   "filtered_confidence": filtered_conf,
                   "filtered_platform": filtered_plat,
                   "qa_counts": qa_counts},
            "daily": daily[:daily_cap] if daily_cap else []}
    out["summary"] = _activity_summary(
        out, data=data, method=method, aoi=aoi, bbox=bbox,
        qa_min=qa_min, platform_set=platform_set, dataset=dataset,
        geom_hash=_geometry_hash(geom), from_date=from_date, to_date=to_date)
    return out


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
    if method not in ("stat", "ml", "ts", "hts", "stan"):
        raise HTTPException(400, "method must be stat|ml|ts|hts|stan")
    qa_min = str(payload.get("qa_min", "all"))
    platform_set = str(payload.get("platform_set", "all"))
    if qa_min not in ("all", "nominal", "high"):
        raise HTTPException(400, "qa_min must be all|nominal|high")
    if platform_set not in ("all", "snpp"):
        raise HTTPException(400, "platform_set must be all|snpp")
    _block_raw_ml_ts(method, data, aoi)
    out = _harmonize_from_records(records, daily_cap=2000, data=data, aoi=aoi,
                                  method=method, qa_min=qa_min,
                                  platform_set=platform_set)
    out["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    out["method"] = ({"stat": "daily 0.05deg grid + monthly activity ratio + sensor-adjusted index "
                              "(hotspot detections, not fires; MODIS-only cells are estimates)",
                      "ml": "daily 0.05deg grid + B2-anchored residual HGB (ml_b2res_v4; abstains to the seasonal ratio when blocked CV shows no robust gain)",
                      "ts": "daily 0.05deg grid + pooled log-ratio Transformer (ts_logratio_pool_v2) monthly post-adjustment; months without 12-month context keep the statistical value",
                      "hts": "daily 0.05deg grid + hierarchical 1-degree tile seasonal anchor (hts_anchor_v1, candidate); MODIS-only cells are rescaled to the tile target, VIIRS-observed cells are untouched",
                      "stan": "daily 0.05deg grid + STAN spatial-temporal negative-binomial model (stan_safe_v1, main); STAN targets for 2024+ with HTS fallback before 2024; VIIRS-observed cells are untouched"}[method])
    return JSONResponse(out)


@app.get("/api/firms/calendar")
def firms_calendar(limit: int = Query(2000, ge=1, le=2000000),
                   bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                   aoi: str = Query("vietnam", description="preset region"),
                   data: str = Query("sample", pattern="^(sample|raw)$"),
                   method: str = Query("stat", pattern="^(stat|ml|ts|hts|stan)$"),
                   qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                   platform_set: str = Query("all", pattern="^(all|snpp)$"),
                   dataset: str | None = Query(None, description="session upload id (upload:<hex>)"),
                   geometry: str | None = Query(None, description="GeoJSON Polygon/MultiPolygon"),
                   from_date: str | None = Query(None, description="inclusive YYYY-MM-DD"),
                   to_date: str | None = Query(None, description="inclusive YYYY-MM-DD")):
    # P0-06: aggregate the FULL filtered set, slice only the daily response.
    geom = _parse_geometry(geometry)
    from_date, to_date = _parse_date_range(from_date, to_date)
    if geom is not None and method in ("ml", "ts", "hts", "stan"):
        raise HTTPException(409, detail={
            "error_code": "geometry_requires_stat_method",
            "message": "Custom geometry uses method=stat: model targets are "
                       "AOI-level monthly totals and cannot be reallocated to an "
                       "arbitrary polygon without inventing numbers.",
            "method": method})
    _block_raw_ml_ts(method, data, aoi)
    if data == "raw" and not dataset and not store.raw_ready(aoi):
        raise HTTPException(404, detail={
            "error_code": "no_raw_data",
            "message": f"No raw FIRMS data on this server for aoi={aoi}. "
                       "Use data=sample for the synthetic demo, or fetch a month first.",
            "aoi": aoi})
    if data == "raw" and not dataset:
        out = _harmonize_stream(aoi, data, bbox, method, daily_cap=min(limit, 5000),
                                qa_min=qa_min, platform_set=platform_set,
                                geom=geom, from_date=from_date, to_date=to_date)
    else:
        records = [r for r in _resolve_records(aoi, data, 2000000, dataset)
                   if _in_bbox(r, _parse_bbox(bbox))]
        if not records:
            raise HTTPException(404, f"No {data} data in this AOI")
        out = _harmonize_from_records(records, daily_cap=min(limit, 5000),
                                      data=data, aoi=aoi, method=method,
                                      dataset=dataset, qa_min=qa_min,
                                      platform_set=platform_set, geom=geom,
                                      from_date=from_date, to_date=to_date,
                                      bbox=bbox)
    out["bbox"] = bbox
    out["aoi"] = aoi
    out["data"] = data
    out["from_date"] = from_date
    out["to_date"] = to_date
    out["geometry_hash"] = _geometry_hash(geom)
    if geom is not None:
        out["geometry"] = geom
    if dataset:
        out["dataset"] = dataset
        out["data_source"] = _data_source_label(data, dataset)
    return JSONResponse(out)


@app.get("/api/firms/map-cells")
def firms_map_cells(ym: str = Query(..., description="YYYY-MM"),
                    bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                    aoi: str = Query("vietnam"),
                    data: str = Query("sample", pattern="^(sample|raw)$"),
                    method: str = Query("stat", pattern="^(stat|ml|ts|hts|stan)$"),
                    qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                    platform_set: str = Query("all", pattern="^(all|snpp)$"),
                    dataset: str | None = Query(None),
                    geometry: str | None = Query(None),
                    from_date: str | None = Query(None),
                    to_date: str | None = Query(None),
                    zoom: int = Query(6, ge=1, le=18),
                    max_cells: int = Query(20000, ge=1, le=200000)):
    """P0-06: cells for one month, independent from the /calendar daily cap.

    Returns `returned` and `total` plus an explicit aggregation level, so the
    UI can say "preview N of M cells" instead of implying a complete map.
    """
    try:
        datetime.strptime(ym, "%Y-%m")
    except ValueError:
        raise HTTPException(400, "ym must be YYYY-MM")
    geom = _parse_geometry(geometry)
    from_date, to_date = _parse_date_range(from_date, to_date)
    if geom is not None and method in ("ml", "ts", "hts", "stan"):
        raise HTTPException(409, detail={
            "error_code": "geometry_requires_stat_method",
            "message": "Custom geometry map cells only support method=stat.",
            "method": method})
    _block_raw_ml_ts(method, data, aoi)
    if data == "raw" and not dataset and not store.raw_ready(aoi):
        raise HTTPException(404, detail={"error_code": "no_raw_data",
                                         "message": "No raw FIRMS data on this server.",
                                         "aoi": aoi})
    if data == "raw" and not dataset:
        out = _harmonize_stream(aoi, data, bbox, method, daily_cap=1000000,
                                qa_min=qa_min, platform_set=platform_set,
                                focus_ym=ym, cache_result=False, geom=geom,
                                from_date=from_date, to_date=to_date)
    else:
        records = [r for r in _resolve_records(aoi, data, 2000000, dataset)
                   if _in_bbox(r, _parse_bbox(bbox))]
        if not records:
            raise HTTPException(404, f"No {data} data in this AOI")
        out = _harmonize_from_records(records, daily_cap=2000000,
                                      data=data, aoi=aoi, method=method,
                                      dataset=dataset, qa_min=qa_min,
                                      platform_set=platform_set, geom=geom,
                                      from_date=from_date, to_date=to_date)
    agg_cells: dict[str, dict] = {}
    for c in out.get("daily") or []:
        if str(c.get("date", ""))[:7] != ym:
            continue
        key = str(c.get("cell_id") or f"{c.get('lat')}_{c.get('lon')}")
        slot = agg_cells.setdefault(key, {
            "cell_id": key, "lat": float(c.get("lat") or 0),
            "lon": float(c.get("lon") or 0),
            "modis_count": 0, "viirs_count": 0,
            "harmonized_count": 0.0, "days": 0,
            "estimate_types": set()})
        slot["modis_count"] += int(c.get("modis_count", 0) or 0)
        slot["viirs_count"] += int(c.get("viirs_count", 0) or 0)
        slot["harmonized_count"] += float(c.get("harmonized_count", 0) or 0)
        slot["days"] += 1
        slot["estimate_types"].add(str(c.get("estimate_type") or "unknown"))
    all_cells = sorted(agg_cells.values(),
                       key=lambda d: d["harmonized_count"], reverse=True)
    total = len(all_cells)
    capped = all_cells[:min(max_cells, 20000)]
    cells = [{**{k: v for k, v in c.items() if k != "estimate_types"},
              "harmonized_count": round(c["harmonized_count"], 3),
              "estimate_type": ("viirs_observed"
                                if c["estimate_types"] == {"viirs_observed"}
                                else sorted(c["estimate_types"])[0])}
             for c in capped]
    summary = out.get("summary") or {}
    return JSONResponse({
        "aoi": aoi, "data": data, "ym": ym, "zoom": zoom,
        "bbox": bbox, "geometry_hash": _geometry_hash(geom),
        "from_date": from_date, "to_date": to_date,
        "method_id": out.get("method_id"),
        "effective_method": out.get("effective_method"),
        "cells": cells,
        "returned": len(cells),
        "total": total,
        "preview": len(cells) < total,
        "aggregation_level": "0.05deg cell-month",
        "aggregation_note": ("One point per 0.05-degree grid cell, summed over "
                             "the month; detections are hotspot records, not fires."),
        "capped_at": min(max_cells, 20000),
        "filter_hash": summary.get("filter_hash"),
        "source_scope": summary.get("source_scope"),
    })


@app.get("/api/firms/export")
def firms_export(limit: int = Query(2000000, ge=100, le=2000000),
                 bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                 aoi: str = Query("vietnam", description="preset region"),
                 data: str = Query("sample", pattern="^(sample|raw)$"),
                 method: str = Query("stat", pattern="^(stat|ml|ts|hts|stan)$"),
                 qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                 platform_set: str = Query("all", pattern="^(all|snpp)$"),
                 dataset: str | None = Query(None, description="session upload id"),
                 geometry: str | None = Query(None, description="GeoJSON Polygon/MultiPolygon"),
                 from_date: str | None = Query(None),
                 to_date: str | None = Query(None)):
    # P0-06: export the FULL filtered set through the same harmonize path
    # as the dashboard so the CSV matches /calendar (P1-07: no silent cap).
    _block_raw_ml_ts(method, data, aoi)
    geom = _parse_geometry(geometry)
    from_date, to_date = _parse_date_range(from_date, to_date)
    if geom is not None and method in ("ml", "ts", "hts", "stan"):
        raise HTTPException(409, detail={
            "error_code": "geometry_requires_stat_method",
            "message": "Custom geometry exports only support method=stat.",
            "method": method})
    if data == "raw" and not dataset and not store.raw_ready(aoi):
        raise HTTPException(404, detail={"error_code": "no_raw_data",
                                         "message": "No raw FIRMS data on this server.",
                                         "aoi": aoi})
    stream_cells = None
    n_rows = 0
    if data == "raw" and not dataset and method == "stat":
        # Stream the CSV straight from the aggregate: retaining 1.4M cell dicts
        # only to write them out was the peak-memory path of the whole API.
        agg, _stats = _raw_agg(aoi, bbox, qa_min, platform_set, geom=geom)
        if not agg:
            raise HTTPException(404, f"No raw data in this AOI")
        ratios = harmonize.estimate_efficiency_ratio(agg)
        n_rows = sum(1 for _cell, day, _per in harmonize.iter_cell_days(agg)
                     if _in_dates({"acq_date": day}, from_date, to_date))
        stream_cells = (row for row in harmonize.iter_daily(agg, ratios)
                        if _in_dates({"acq_date": row.get("date", "")},
                                     from_date, to_date))
    elif data == "raw" and not dataset:
        full_daily = _harmonize_stream(aoi, data, bbox, method, daily_cap=2000000,
                                       qa_min=qa_min, platform_set=platform_set,
                                       cache_result=False, geom=geom,
                                       from_date=from_date, to_date=to_date)["daily"]
        n_rows = len(full_daily)
        stream_cells = iter(full_daily)
    else:
        records = [r for r in _resolve_records(aoi, data, limit, dataset)
                   if _in_bbox(r, _parse_bbox(bbox))]
        if not records:
            raise HTTPException(404, f"No {data} data in this AOI")
        full_daily = _harmonize_from_records(records, daily_cap=2000000,
                                             data=data, aoi=aoi, method=method,
                                             dataset=dataset, qa_min=qa_min,
                                             platform_set=platform_set, geom=geom,
                                             from_date=from_date, to_date=to_date,
                                             bbox=bbox)["daily"]
        n_rows = len(full_daily)
        stream_cells = iter(full_daily)
    fields = ["cell_id", "date", "lat", "lon",
              "modis_count", "viirs_count", "modis_frp", "viirs_frp",
              "harmonized_count", "harmonized_count_low",
              "harmonized_count_high", "harmonized_per_km2",
              "harmonized_frp", "cell_km2",
              "estimate_type", "sensors", "platforms",
              "platform_single", "coverage_status",
              "k_used", "uncertainty_rel",
              "ratio_mode", "calibration_window",
              "calibration_train_end", "calibration_months",
              "method", "effective_method",
              "algorithm_version", "data_source"]

    def _rows():
        # Stream rows instead of building the whole CSV in memory.
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=fields)
        w.writeheader()
        yield buf.getvalue()
        for c in stream_cells:
            buf.seek(0); buf.truncate(0)
            row = {**c, "data_source": _data_source_label(data, dataset)}
            if isinstance(row.get("calibration_window"), (list, tuple)):
                row["calibration_window"] = json.dumps(list(row["calibration_window"]))
            w.writerow({k: row.get(k) for k in fields})
            yield buf.getvalue()

    dtag = dataset.replace(":", "_") if dataset else f"{data}_{method}"
    filters = {"aoi": aoi, "bbox": bbox or "all", "data": data,
               "method": method, "qa_min": qa_min,
               "platform_set": platform_set, "dataset": dataset or "none",
               "geometry_hash": _geometry_hash(geom),
               "from_date": from_date or "all", "to_date": to_date or "all"}
    fhash = hashlib.sha256(json.dumps(filters, sort_keys=True).encode()).hexdigest()[:16]
    return StreamingResponse(
        _rows(), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="harmonized_hotspots_{aoi}_{dtag}.csv"',
                 "X-Row-Count": str(n_rows),
                 "X-Filter-Hash": fhash,
                 "X-From-Date": from_date or "",
                 "X-To-Date": to_date or "",
                 "X-Geometry-Hash": _geometry_hash(geom),
                 "X-Data-Source": _data_source_label(data).replace("\u2014", "-")})


@app.get("/api/firms/export-detections")
def firms_export_detections(bbox: str | None = Query(None),
                            aoi: str = Query("vietnam"),
                            data: str = Query("sample", pattern="^(sample|raw)$"),
                            dataset: str | None = Query(None),
                            qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                            platform_set: str = Query("all", pattern="^(all|snpp)$"),
                            geometry: str | None = Query(None),
                            from_date: str | None = Query(None),
                            to_date: str | None = Query(None),
                            limit: int = Query(2000000, ge=1, le=2000000)):
    """P1-09: original per-detection FIRMS rows, not the aggregated grid.

    This is the row-level view NASA distributes (one hotspot record per line).
    It is intentionally separate from /export, which serves the harmonized
    cell-day activity grid.
    """
    geom = _parse_geometry(geometry)
    from_date, to_date = _parse_date_range(from_date, to_date)
    b = _parse_bbox(bbox)
    if data == "raw" and not dataset and not store.raw_ready(aoi):
        raise HTTPException(404, detail={"error_code": "no_raw_data",
                                         "message": "No raw FIRMS data on this server.",
                                         "aoi": aoi})
    fields = ["latitude", "longitude", "brightness", "scan", "track",
              "acq_date", "acq_time", "satellite", "instrument", "confidence",
              "version", "bright_t31", "frp", "daynight", "type"]
    # Load every candidate row, then cap the CSV at `limit` after filtering:
    # a date/bbox filter must not be starved by the first N source rows.
    source = (_resolve_records(aoi, data, 2000000, dataset)
              if (dataset or data == "sample")
              else store.iter_raw_rows(aoi, limit=None))

    def _keep(r: dict) -> bool:
        if not _in_bbox(r, b) or not _in_dates(r, from_date, to_date):
            return False
        if geom is not None:
            try:
                if not _point_in_geometry(float(r["longitude"]),
                                          float(r["latitude"]), geom):
                    return False
            except (KeyError, TypeError, ValueError):
                return False
        conf = str(r.get("confidence", "")).lower()
        if qa_min in ("nominal", "high") and conf == "l":
            return False
        if qa_min == "high" and conf not in ("h", "n"):
            return False
        if (platform_set == "snpp" and str(r.get("instrument", "")).upper() == "VIIRS"
                and str(r.get("satellite", "")).upper() not in ("NPP", "SNPP")):
            return False
        return True

    def _rows():
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        yield buf.getvalue()
        n = 0
        for r in source:
            if n >= limit:
                break
            if not _keep(r):
                continue
            buf.seek(0); buf.truncate(0)
            w.writerow({k: r.get(k, "") for k in fields})
            n += 1
            yield buf.getvalue()

    dtag = dataset.replace(":", "_") if dataset else data
    return StreamingResponse(
        _rows(), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition":
                 f'attachment; filename="firms_detections_{aoi}_{dtag}.csv"',
                 "X-Data-Source": _data_source_label(data).replace("\u2014", "-"),
                 "X-Geometry-Hash": _geometry_hash(geom),
                 "X-From-Date": from_date or "",
                 "X-To-Date": to_date or "",
                 "X-Row-Kind": "original_detection"})


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
                method: str = Query("stat", pattern="^(stat|ml|ts|hts|stan)$"),
                qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                platform_set: str = Query("all", pattern="^(all|snpp)$"),
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
        out = _harmonize_stream(aoi, data, bbox, method, daily_cap=0,
                                qa_min=qa_min, platform_set=platform_set)
    else:
        records = [r for r in _resolve_records(aoi, data, 2000000, dataset)
                   if _in_bbox(r, _parse_bbox(bbox))]
        if not records:
            raise HTTPException(404, f"No {data} data in this AOI")
        out = _harmonize_from_records(records, daily_cap=0, data=data, aoi=aoi,
                                      method=method, dataset=dataset,
                                      qa_min=qa_min, platform_set=platform_set)
    c, ys = out["calendar"], out["calendar"]["years"]
    L, F = out["latest"], out["forecast"]
    src = _data_source_label(data, dataset)
    eff = out.get("effective_method") or out.get("method_id")
    lines = [
        f"# Fire-activity brief: {aoi}{f' ({bbox})' if bbox else ''}",
        f"_Source: NASA FIRMS ({data}): {src}._",
        f"_Method: requested `{method}` → effective `{eff}`._",
        f"_Filters: QA≥{qa_min}, platform_set={platform_set}._",
        f"_Units: hotspot detections / sensor-adjusted activity index (NOT confirmed fires)._",
        "",
        f"- Period: {ys[0]} to {ys[-1]} ({len(ys)} years, {out['daily_cells']} daily cells)",
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
        lines.append("- Coverage: UNKNOWN (sample/upload: not a manifest-backed pull).")
    if L:
        lines.append(f"- Latest {L['date']}: {L['month_total']} vs same-month median {L['hist_median']} "
                     f"(x{L['ratio']}, baseline {L['hist_years']} yrs excl. current year): {L['verdict']}.")
    if F:
        lines.append(f"- Climatology outlook {F['year']}-{F['month']:02d}: median {F['median']} "
                     f"(P25-P75 {F['p25']} to {F['p75']}, n={F['n_years']}). NOT a prediction.")
    lines += ["", "## Limits & safety",
              "- MODIS-only cells are 1/k upscaled ESTIMATES (coverage unknown).",
              "- harmonized_frp is null for upscaled cells (count ratio never rescales FRP).",
              "- Overpass-time and cloud/smoke bias reduced, not removed.",
              "- Platform mix (SNPP / NOAA-20 / NOAA-21) is reported, not fully corrected.",
              "- Outlook is climatology, not a forecast: check FIRMS NRT for nowcasts.",
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


@app.get("/api/firms/sf-status")
def firms_sf_status(aoi: str = Query("vietnam"),
                    data: str = Query("sample", pattern="^(sample|raw)$")):
    """SensorFormer Lite experimental comparator (never the served default).

    Audit-2 P1: separate the *model artifact* from *live NASA data*. A trained
    artifact must not imply that the raw calendar can be served on this host.
    """
    status = sf_lite.artifact_status(data, MODEL_DIR)
    live = True if data == "sample" else store.raw_ready(aoi)
    head = {"method_id": sf_lite.METHOD_ID,
            "algorithm_version": sf_lite.ALGORITHM_VERSION,
            "feature_version": sf_lite.FEATURE_VERSION,
            "aoi": aoi, "data": data,
            "model_artifact_available": bool(status["available"]),
            "live_data_available": bool(live),
            "artifact": status}
    if not status["available"]:
        return {"trained": False, **head,
                "hint": ("python -m scripts.firms.train_sf --data " + data
                         if status["reason"] == "artifact_missing"
                         else "artifact present but rejected: " + str(status["reason"]))}
    models, meta = sf_lite.load_artifact(data, MODEL_DIR)
    return {"trained": bool(meta), "runtime_available": bool(models), **head,
            **{k: v for k, v in (meta or {}).items() if k != "predictions"}}


def _stan_meta(kind: str = "safe") -> dict | None:
    import json as _json
    name = "stan_safe_raw.json" if kind == "safe" else "stan_retro_raw.json"
    p = MODEL_DIR / name
    if not p.exists():
        return None
    try:
        return _json.loads(p.read_text(encoding="utf-8"))
    except (OSError, _json.JSONDecodeError):
        return None


@app.get("/api/firms/stan-status")
def firms_stan_status():
    """STAN: tuned spatial-temporal NB model. Safe variant is not retrospective."""
    safe, retro = _stan_meta("safe"), _stan_meta("retro")
    if not safe and not retro:
        return {"trained": False, "method_id": "stan_v1",
                "hint": "python -m app.firms.stan"}
    return {"trained": True, "candidate": False, "served": True,
            "role": "main",
            "safe": {k: v for k, v in (safe or {}).items() if k != "predictions"},
            "retrospective": {k: v for k, v in (retro or {}).items()
                              if k != "predictions"}}


def _spatial_meta() -> dict | None:
    import json as _json
    p = MODEL_DIR / "spatial_hgb_raw.json"
    if not p.exists():
        return None
    try:
        return _json.loads(p.read_text(encoding="utf-8"))
    except (OSError, _json.JSONDecodeError):
        return None


@app.get("/api/firms/spatial-status")
def firms_spatial_status():
    """Retrospective spatial HGB. Requires neighbouring VIIRS; not a forecast."""
    meta = _spatial_meta()
    if not meta:
        return {"trained": False, "method_id": "spatial_hgb_v1",
                "hint": "python -m app.firms.spatial_hgb"}
    return {"trained": True, "candidate": True, "served": False,
            **{k: v for k, v in meta.items() if k != "predictions"}}


@app.get("/api/firms/hts-status")
def firms_hts_status():
    """Hierarchical tile-seasonal anchor: candidate, never silently served."""
    p = MODEL_DIR / "hts_anchor_raw.json"
    if not p.exists():
        return {"trained": False, "method_id": "hts_anchor_v1",
                "hint": "python -m scripts.firms.evaluate_hts"}
    import json as _json
    meta = _json.loads(p.read_text(encoding="utf-8"))
    return {"trained": True, "candidate": True, "served": False,
            "series": hts.status(MODEL_DIR),
            **{k: v for k, v in meta.items() if k != "predictions"}}


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
    sf_models, sf_meta = sf_lite.load_artifact(data, MODEL_DIR)
    sf_preds = (sf_meta or {}).get("predictions") or {}
    hts_meta = None
    if data == "raw":
        import json as _json
        hp = MODEL_DIR / "hts_anchor_raw.json"
        if hp.exists():
            try:
                hts_meta = _json.loads(hp.read_text(encoding="utf-8"))
            except (OSError, _json.JSONDecodeError):
                hts_meta = None
    hts_row = ((hts_meta or {}).get("per_aoi") or {}).get(aoi)
    spatial_meta = _spatial_meta()
    spatial_row = (((spatial_meta or {}).get("per_aoi") or {}).get(aoi) or {}).get("spatial")
    stan_meta = _stan_meta("safe")
    stan_row = (((stan_meta or {}).get("official", {}).get("per_aoi") or {}).get(aoi) or {}).get("stan")
    rows = []
    for s in samples:
        sid = f"{aoi}:{int(s['year'])}-{int(s['month']):02d}"
        sfp = sf_preds.get(sid) or {}
        rows.append({"year": s["year"], "month": s["month"],
                     "modis": s["modis"], "viirs_ref": s["viirs_ref"],
                     "ml_pred": s.get("hgb_b2res_v4"),
                     "ts_pred": s.get("ts_logratio_pool_v2"),
                     "sf_pred": sfp.get("mid"),
                     "b2_pred": s.get("b2_seasonal_ratio")})
    return {
        "aoi": aoi, "data": data,
        "data_source": manifest.get("data_source"),
        "evaluation_version": manifest.get("evaluation_version"),
        "eval_unit": manifest.get("eval_unit"),
        "dataset_sha256": manifest.get("dataset_sha256"),
        "metrics": {**(per.get("metrics", {})),
                    **({"sf_lite_v1": (sf_meta.get("per_aoi") or {}).get(aoi)}
                       if sf_meta and (sf_meta.get("per_aoi") or {}).get(aoi)
                       else {}),
                    **({"hts_anchor_v1": hts_row} if hts_row else {}),
                    **({"spatial_hgb_v1": spatial_row} if spatial_row else {}),
                    **({"stan_safe_v1": stan_row} if stan_row else {})},
        "sf_lite": sf_meta,
        "sf_lite_comparison": (sf_meta or {}).get("comparisons", {}).get("sf_vs_b2"),
        "sf_lite_deployed": bool((sf_meta or {}).get("deployed")),
        "hts": hts_meta,
        "hts_comparison": (hts_meta or {}).get("comparisons", {}).get("hts_vs_b2"),
        "hts_candidate": bool(hts_meta) and not bool((hts_meta or {}).get("gate", {}).get("passed")),
        "spatial": _spatial_meta(),
        "spatial_comparison": (_spatial_meta() or {}).get("comparisons", {}).get("spatial_vs_b2"),
        "spatial_retrospective": bool((_spatial_meta() or {}).get("retrospective")),
        "stan": stan_meta,
        "stan_official": (stan_meta or {}).get("official"),
        "stan_candidate": bool(stan_meta),
        "hgb_full_test": per.get("hgb_full_test"),
        "hgb_residual_enabled": per.get("hgb_residual_enabled"),
        "hgb_fallback_baseline": per.get("hgb_fallback_baseline"),
        "hgb_gate": per.get("hgb_gate"),
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
        # Training a new ensemble here would update evaluation_raw.json but NOT
        # the persisted cal_*/ts_* artifacts, so /calendar could keep serving
        # the old model under new metrics (audit V5 P0). The offline CLI is the
        # only path that retrains and stamps both.
        raise HTTPException(409, detail={
            "error_code": "refresh_requires_offline_pipeline",
            "message": ("Rebuild with scripts.firms.train_ml + train_ts + "
                        "evaluate (and stamp_artifacts), then restart; this GET "
                        "does not train or mutate artifacts."),
        })
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
        # P1-12: stream 1.4M+ rows; monthly summary avoids returning 600k cells.
        cal_out = _harmonize_stream(aoi, data, None, "stat", daily_cap=0)
        by_ym: dict[tuple[int, int], dict] = {}
        for ym, v in (cal_out.get("monthly") or {}).items():
            key = (int(ym[:4]), int(ym[5:7]))
            by_ym[key] = {"modis": v["modis"], "viirs": v["viirs"]}
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
    metrics = dict(per.get("metrics") or {}) if per else {}
    if data == "raw":
        hp = MODEL_DIR / "hts_anchor_raw.json"
        if hp.exists():
            try:
                _hm = json.loads(hp.read_text(encoding="utf-8"))
                _row = ((_hm.get("per_aoi") or {}).get(aoi))
                if _row:
                    metrics["hts_anchor_v1"] = {k: v for k, v in _row.items()
                                                if k in ("mae", "wape", "bias", "n")}
            except (OSError, json.JSONDecodeError):
                pass
        _sm = _spatial_meta()
        _srow = (((_sm or {}).get("per_aoi") or {}).get(aoi) or {}).get("spatial")
        if _srow:
            metrics["spatial_hgb_v1"] = _srow
        _stm = _stan_meta("safe")
        _strow = (((_stm or {}).get("official", {}).get("per_aoi") or {}).get(aoi) or {}).get("stan")
        if _strow:
            metrics["stan_safe_v1"] = _strow
    metrics = metrics or None
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


def _analysis_for_evidence(aoi: str, data: str, method: str, bbox, qa_min: str,
                           platform_set: str, focus_ym: str | None = None) -> dict:
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


@app.get("/api/firms/simulate")
def firms_simulate(aoi: str = Query("vietnam"),
                   data: str = Query("raw", pattern="^(sample|raw)$"),
                   year: int = Query(2025, ge=2000, le=2100),
                   qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                   platform_set: str = Query("all", pattern="^(all|snpp)$"),
                   sensors: str | None = Query(None, description="comma list, e.g. MODIS,SNPP")):
    """Satellite Mission Simulator: recompute the calendar for sensor subsets.

    One streaming pass for all sensors; each scenario recombines per-platform
    counts already attached to the cells. It never re-runs a separate formula.
    """
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    configs = [
        {"label": "all_sensors", "platforms": ["MODIS", "NPP", "NOAA-20", "NOAA-21"]},
        {"label": "modis_only", "platforms": ["MODIS"]},
        {"label": "snpp_only", "platforms": ["MODIS", "NPP"]},
        {"label": "no_noaa20", "platforms": ["MODIS", "NPP", "NOAA-21"]},
        {"label": "no_noaa21", "platforms": ["MODIS", "NPP", "NOAA-20"]},
    ]
    if sensors:
        alias = {"SNPP": "NPP", "NPP": "NPP", "NOAA-20": "NOAA-20",
                 "NOAA20": "NOAA-20", "NOAA-21": "NOAA-21",
                 "NOAA21": "NOAA-21", "MODIS": "MODIS"}
        custom = []
        for s in str(sensors).split(","):
            k = alias.get(s.strip().upper())
            if k and k not in custom:
                custom.append(k)
        if custom:
            configs.append({"label": "custom", "platforms": custom})
    if data == "raw":
        out = _harmonize_stream(aoi, data, None, "stat", daily_cap=0,
                                qa_min=qa_min, platform_set=platform_set,
                                simulate_year=year, simulate_configs=configs)
        sims = out.get("simulations") or []
        coverage = out.get("coverage")
    else:
        records = _resolve_records(aoi, data, 2000000)
        out = _harmonize_from_records(records, daily_cap=2000000, data=data,
                                      aoi=aoi, qa_min=qa_min,
                                      platform_set=platform_set)
        year_daily = [c for c in out["daily"] if str(c["date"])[:4] == str(year)]
        sims = []
        all_cfg = next((c for c in configs if c["label"] == "all_sensors"), configs[0])
        _, all_meta = harmonize.reconfigure_daily(
            year_daily, all_cfg["platforms"], all_cfg["label"])
        baseline_k = all_meta.get("k_by_month") or {}
        for cfg in configs:
            rd, smeta = harmonize.reconfigure_daily(
                year_daily, cfg["platforms"], cfg["label"],
                baseline_k=baseline_k)
            scal = cal.build_calendar(rd)
            total = scal["row_totals"][0] if scal["row_totals"] else 0.0
            sims.append({**smeta, "year": year, "year_total": round(float(total), 3),
                         "months": {str(m): scal["matrix"][0][m - 1]
                                    for m in range(1, 13)} if scal.get("matrix") else {},
                         "observed_cells": sum(1 for c in rd if c.get("estimate_type") == "viirs_observed"),
                         "estimated_cells": sum(1 for c in rd if c.get("estimate_type") == "modis_upscaled_estimated"),
                         "n_cells": len(rd), "calendar": scal})
        base = next((s["year_total"] for s in sims if s["sensor_config"] == "all_sensors"), None)
        for s in sims:
            s["delta_vs_all"] = round(s["year_total"] - base, 3) if base is not None else None
        coverage = out.get("coverage")
    mix = ((out.get("calendar") or {}).get("platform_mix") or {}).get(str(year), {})
    return JSONResponse({
        "aoi": aoi, "data": data, "year": year,
        "validation_unit": "aoi-month; simulated sensor subsets are descriptive, not forecasts",
        "note": ("A sensor subset changes what was observed, not the true fire count. "
                 "A missing detection is not evidence of no fire. "
                 "Identical totals across sensor configs mean this pull does not "
                 "contain that platform, not that the platform adds no signal."),
        "platforms_present": sorted(mix),
        "coverage": coverage,
        "simulations": sims,
    })


@app.get("/api/firms/blind-spots")
def firms_blind_spots(aoi: str = Query("vietnam"),
                      data: str = Query("raw", pattern="^(sample|raw)$"),
                      year: int = Query(2025, ge=2000, le=2100),
                      month: int = Query(1, ge=1, le=12),
                      qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                      platform_set: str = Query("all", pattern="^(all|snpp)$")):
    """Sensor Blind Spot Explorer: day × sensor request/detection states.

    `unknown` means the request ledger has no evidence that the sensor looked;
    it is never rendered as `no fire`. `observed_empty` means requested but no
    hotspot row was returned (still not proof of no fire, because clouds/smoke
    and sub-pixel fires remain).
    """
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    ym = f"{year}-{month:02d}"
    per_source = cov.requested_days(aoi) if data == "raw" else {}
    fam_days: dict[str, set[int]] = {"MODIS": set(), "VIIRS": set()}
    for src, days in (per_source.get(ym) or {}).items():
        fam = "MODIS" if src.upper().startswith("MODIS") else (
            "VIIRS" if src.upper().startswith("VIIRS") else "OTHER")
        fam_days.setdefault(fam, set()).update(days)
    if data == "raw":
        out = _harmonize_stream(aoi, data, None, "stat", daily_cap=2000000,
                                qa_min=qa_min, platform_set=platform_set,
                                focus_ym=ym)
        cells = out.get("daily") or []
        comp = (out.get("calendar", {}).get("completeness") or {}).get(ym, {})
    else:
        records = _resolve_records(aoi, data, 2000000)
        out = _harmonize_from_records(records, daily_cap=2000000, data=data,
                                      aoi=aoi, qa_min=qa_min,
                                      platform_set=platform_set)
        cells = [c for c in out["daily"] if str(c["date"])[:7] == ym]
        comp = (out["calendar"].get("completeness") or {}).get(ym, {})
    by_day: dict[int, dict[str, int]] = {}
    for c in cells:
        try:
            d = int(str(c["date"])[8:10])
        except (ValueError, IndexError):
            continue
        slot = by_day.setdefault(d, {"MODIS": 0, "VIIRS": 0})
        slot["MODIS"] += int(c.get("modis_count", 0) or 0)
        slot["VIIRS"] += int(c.get("viirs_count", 0) or 0)
    import calendar as _cal
    last = _cal.monthrange(year, month)[1]
    rows = []
    for d in range(1, last + 1):
        modis_req = d in fam_days.get("MODIS", set()) if data == "raw" else None
        viirs_req = d in fam_days.get("VIIRS", set()) if data == "raw" else None
        got = by_day.get(d, {"MODIS": 0, "VIIRS": 0})
        if data != "raw":
            status = "unknown_coverage"
        elif not modis_req and not viirs_req:
            status = "not_requested"
        elif got["MODIS"] or got["VIIRS"]:
            status = "detected"
        else:
            status = "requested_no_hotspot_record"
        rows.append({"day": d, "date": f"{year}-{month:02d}-{d:02d}",
                     "modis_requested": modis_req, "viirs_requested": viirs_req,
                     "modis_detections": got["MODIS"],
                     "viirs_detections": got["VIIRS"],
                     "clear_sky_verified": False,
                     "status": status})
    status_counts: dict[str, int] = {}
    for r in rows:
        status_counts[r["status"]] = status_counts.get(r["status"], 0) + 1
    return JSONResponse({
        "aoi": aoi, "data": data, "ym": ym,
        "coverage": comp,
        "coverage_class": comp.get("coverage_class", "unknown"),
        "paired_coverage_ratio": comp.get("coverage_ratio"),
        "coverage_metric": "paired_request_coverage",
        "observation_footprint": "unknown",
        "eligibility_threshold": cov.PARTIAL_THRESHOLD,
        "status_counts": status_counts,
        "days": rows,
        "note": ("unknown/not_requested is not zero fire. observed_empty means only "
                 "'data requested, no detection row returned'; it is not proof of "
                 "cloud-free observation or of no fire. A per-cell footprint mask "
                 "would be required for that claim."),
    })


@app.post("/api/firms/cross-validate")
def firms_cross_validate(payload: dict):
    """Correlate the harmonized activity index with a user-supplied series.

    The bundled project has no MCD64A1 product; the endpoint accepts a
    monthly burned-area series (year, month, burned_area) and returns a
    cross-dataset consistency check, explicitly not ground-truth validation.
    """
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "raw"))
    series = payload.get("series")
    if aoi not in AOIS or data not in ("sample", "raw"):
        raise HTTPException(400, "valid aoi and data=sample|raw required")
    if not isinstance(series, list) or len(series) < 6:
        return JSONResponse({
            "available": False,
            "reason": "no_series",
            "required": "series: [{year, month, burned_area}] (e.g. MCD64A1 monthly totals)",
            "note": ("No MCD64A1 product is bundled. Upload/derive a monthly "
                     "burned-area series to run this consistency check."),
        })
    if data == "raw":
        out = _harmonize_stream(aoi, data, None, "stat", daily_cap=0)
        monthly = out.get("monthly") or {}
    else:
        records = _resolve_records(aoi, data, 2000000)
        out = _harmonize_from_records(records, daily_cap=2000000, data=data, aoi=aoi)
        monthly = {}
        for c in out["daily"]:
            ym = str(c["date"])[:7]
            monthly.setdefault(ym, {"harmonized": 0.0})["harmonized"] += float(
                c.get("harmonized_count", 0) or 0)
    xs, ys = [], []
    joined = []
    for r in series:
        try:
            ym = f"{int(r['year'])}-{int(r['month']):02d}"
            v = float(r["burned_area"])
        except (KeyError, TypeError, ValueError):
            continue
        if ym not in monthly:
            continue
        a = float(monthly[ym]["harmonized"])
        xs.append(a)
        ys.append(v)
        joined.append({"ym": ym, "activity_index": round(a, 2), "burned_area": v})
    if len(xs) < 6:
        return JSONResponse({"available": False, "reason": "insufficient_join",
                             "n": len(xs), "joined": joined})
    pear = spatial._pearson(xs, ys)  # noqa: SLF001 - internal helper
    spear = spatial._spearman(xs, ys)  # noqa: SLF001
    return JSONResponse({
        "available": True, "aoi": aoi, "data": data, "n": len(xs),
        "pearson": None if pear is None else round(pear, 3),
        "spearman": None if spear is None else round(spear, 3),
        "joined": joined,
        "caveat": ("Burned area and hotspot detections are different quantities; "
                   "MCD64A1 itself uses active-fire information, so a correlation "
                   "is a consistency check, not independent ground truth."),
    })


@app.get("/api/firms/spatial-check")
def firms_spatial_check(aoi: str = Query("vietnam"),
                        data: str = Query("raw", pattern="^(sample|raw)$"),
                        year: int = Query(2025, ge=2000, le=2100),
                        month: int = Query(1, ge=1, le=12),
                        res_deg: float = Query(0.25, ge=0.05, le=1.0)):
    """Coarse co-observation consistency; explicitly NOT a spatial holdout."""
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    ym = f"{year}-{month:02d}"
    if data == "raw":
        out = _harmonize_stream(aoi, data, None, "stat", daily_cap=2000000,
                                focus_ym=ym)
        daily = out.get("daily") or []
    else:
        records = _resolve_records(aoi, data, 2000000)
        out = _harmonize_from_records(records, daily_cap=2000000, data=data,
                                      aoi=aoi)
        daily = out["daily"]
    return JSONResponse(spatial.coobservation(daily, year, month, res_deg))


@app.get("/api/firms/evidence")
def firms_evidence(aoi: str = Query("vietnam"),
                   data: str = Query("raw", pattern="^(sample|raw)$"),
                   method: str = Query("stat", pattern="^(stat|ml|ts|hts|stan)$"),
                   year: int = Query(2025, ge=2000, le=2100),
                   month: int = Query(1, ge=1, le=12),
                   bbox: str | None = Query(None),
                   qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                   platform_set: str = Query("all", pattern="^(all|snpp)$")):
    """Evidence card for one AOI-month, from the same cells as /calendar."""
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    _block_raw_ml_ts(method, data, aoi)
    out = _analysis_for_evidence(aoi, data, method, bbox, qa_min, platform_set,
                                 focus_ym=f"{year}-{month:02d}")
    ev = evd.build_evidence(out, out.get("daily") or [], aoi, data, method,
                            year, month)
    return JSONResponse(ev)


@app.post("/api/firms/explain-month")
def firms_explain_month(payload: dict):
    """LLM/rule explanation of one AOI-month, grounded on an evidence card."""
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "raw"))
    method = str(payload.get("method", "stat"))
    year = int(payload.get("year", 2025))
    month = int(payload.get("month", 1))
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    if data not in ("sample", "raw") or method not in ("stat", "ml", "ts", "hts", "stan"):
        raise HTTPException(400, "data must be sample|raw and method stat|ml|ts|hts|stan")
    if not (2000 <= year <= 2100 and 1 <= month <= 12):
        raise HTTPException(400, "year/month out of range")
    qa_min = str(payload.get("qa_min", "all"))
    platform_set = str(payload.get("platform_set", "all"))
    _block_raw_ml_ts(method, data, aoi)
    out = _analysis_for_evidence(aoi, data, method, payload.get("bbox"),
                                 qa_min, platform_set,
                                 focus_ym=f"{year}-{month:02d}")
    ev = evd.build_evidence(out, out.get("daily") or [], aoi, data, method,
                            year, month)
    question = str(payload.get("question") or
                   f"Giải thích tháng {year}-{month:02d} của {aoi}").strip()
    vi = ex.is_vietnamese(question)
    rule = evd.answer_month(ev, vi)
    if payload.get("use_llm", True):
        res = llm.ask_llm(question, ev, rule)
    else:
        res = {"answer": rule, "llm_used": False,
               "reason": "use_llm=false; rule-based evidence answer"}
    return JSONResponse({**res, "evidence": ev,
                         "suggestions": [
                             "Vì sao tổng tháng này cao/thấp?",
                             "Bao nhiêu ô là ước lượng?",
                             "Coverage tháng này có đủ không?",
                             "Nền tảng vệ tinh nào đóng góp?",
                         ]})


@app.get("/api/firms/qa-summary")
def firms_qa_summary(aoi: str = Query("vietnam"),
                     data: str = Query("raw", pattern="^(sample|raw)$"),
                     limit: int = Query(200000, ge=1000, le=2000000)):
    """Confidence/platform mix for a bounded prefix (filter sensitivity)."""
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    rows = (store.iter_raw_rows(aoi, limit=limit) if data == "raw"
            else store.load_records(aoi, limit))
    by_conf: dict[str, int] = {}
    by_sat: dict[str, int] = {}
    by_inst: dict[str, int] = {}
    by_qa: dict[str, int] = {}
    total = 0
    for r in rows:
        try:
            rec = FirmsRecord(**{k.lower(): v for k, v in dict(r).items()})
        except Exception:
            continue
        total += 1
        by_conf[rec.confidence] = by_conf.get(rec.confidence, 0) + 1
        by_sat[rec.satellite] = by_sat.get(rec.satellite, 0) + 1
        by_inst[rec.instrument] = by_inst.get(rec.instrument, 0) + 1
        q = rec.qa()
        by_qa[q] = by_qa.get(q, 0) + 1
    low = by_conf.get("l", 0)
    warnings = []
    total_safe = total or 1
    retained = {
        "qa_all": 1.0,
        "qa_nominal": round((by_conf.get("n", 0) + by_conf.get("h", 0)) / total_safe, 4),
        "qa_high": round(by_conf.get("h", 0) / total_safe, 4),
        "platform_snpp": round((by_inst.get("MODIS", 0) + by_sat.get("NPP", 0)) / total_safe, 4),
    }
    if total and low / total > 0.2:
        warnings.append(f"{round(low / total * 100)}% low-confidence; consider qa_min=nominal")
    if len(by_sat) > 2:
        warnings.append("multiple VIIRS platforms: use platform_set=snpp for a comparable series")
    return {"aoi": aoi, "data": data, "sampled_rows": total,
            "by_confidence": by_conf, "by_satellite": by_sat,
            "by_instrument": by_inst, "by_qa": by_qa,
            "retained_fraction": retained,
            "warnings": warnings,
            "note": "bounded prefix; use /coverage for the full request ledger"}


@app.get("/api/firms/dedup-sensitivity")
def firms_dedup_sensitivity(aoi: str = Query("vietnam"),
                            data: str = Query("raw", pattern="^(sample|raw)$"),
                            limit: int = Query(200000, ge=1000, le=1000000)):
    """Exact vs pixel-day dedup collision bound (audit P1-08)."""
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    rows = (store.iter_raw_rows(aoi, limit=limit) if data == "raw"
            else store.load_records(aoi, limit))
    validated = []
    for r in rows:
        try:
            rec = FirmsRecord(**{k.lower(): v for k, v in dict(r).items()})
        except Exception:
            continue
        validated.append(rec.model_dump(mode="json"))
        if len(validated) >= limit:
            break
    out = harmonize.dedup_sensitivity(validated, limit=limit)
    out.update({"aoi": aoi, "data": data})
    return out


@app.post("/api/firms/investigate")
def firms_investigate(payload: dict):
    """AI Scientific Investigator: deterministic tools first, LLM explains.

    The response lists the tools that actually ran and the limitations. The
    LLM never computes MAE/coverage; it receives the tool outputs and the
    evidence card, and the grounding guard rejects invented large numbers.
    """
    q = str(payload.get("question", "")).strip()
    if not q or len(q) > 1000:
        raise HTTPException(400, "Provide question (1-1000 chars)")
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "raw"))
    method = str(payload.get("method", "stat"))
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    if data not in ("sample", "raw") or method not in ("stat", "ml", "ts", "hts", "stan"):
        raise HTTPException(400, "data must be sample|raw and method stat|ml|ts|hts|stan")
    year = payload.get("year")
    month = payload.get("month")
    focus = (f"{int(year)}-{int(month):02d}"
             if year and month and 1 <= int(month) <= 12 else None)
    out = _analysis_for_evidence(aoi, data, method, payload.get("bbox"),
                                 str(payload.get("qa_min", "all")),
                                 str(payload.get("platform_set", "all")),
                                 focus_ym=focus)
    facts = ex.gather_facts(out["calendar"], out["daily_cells"], out["ratios"],
                            out.get("qa", {}).get("clean", 0),
                            payload.get("bbox"), method=out.get("method_id"),
                            evaluation=_evaluation_facts(aoi, data),
                            coverage=out.get("coverage"),
                            filters=out.get("filters"))
    facts["data_source"] = _data_source_label(data)
    facts["latest"] = out["latest"]
    evidence = None
    if focus:
        evidence = evd.build_evidence(out, out.get("daily") or [], aoi, data,
                                      method, int(year), int(month))
    tools_used = ["calendar", "evaluation", "coverage"]
    if evidence:
        tools_used.append("evidence")
    if any(w in q.lower() for w in ("sensor", "modis", "viirs", "platform", "cảm biến", "cam bien")):
        tools_used.append("sensor_context")
    rule = ex.answer(q, facts, out["critical_periods"], out["latest"], dl.describe())
    llm_facts = {**facts, "evidence": evidence,
                 "top_months": out["critical_periods"][:5],
                 "tools_used": tools_used,
                 "limitations": [
                     "AOI-month MAE against a VIIRS reference, not fire ground truth.",
                     "A missing detection is not proof of no fire (cloud/smoke/sub-pixel).",
                     "Australia remains a sparse 5-day-window series.",
                     "Cell-day estimates are not spatially validated.",
                 ]}
    if payload.get("use_llm", True):
        res = llm.ask_llm(q, llm_facts, rule["answer"])
    else:
        res = {"answer": rule["answer"], "llm_used": False,
               "reason": "use_llm=false; deterministic tool answer"}
    return JSONResponse({
        **res,
        "tools_used": tools_used,
        "evidence": evidence,
        "facts": facts,
        "suggestions": rule["suggestions"],
        "limitations": llm_facts["limitations"],
        "citations": (evidence or {}).get("citations", []),
    })


@app.post("/api/firms/investigate-stream")
def firms_investigate_stream(payload: dict):
    """Streaming endpoint for AI Scientific Investigator."""
    q = str(payload.get("question", "")).strip()
    if not q or len(q) > 1000:
        raise HTTPException(400, "Provide question (1-1000 chars)")
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "sample"))
    method = str(payload.get("method", "stat"))
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    if data not in ("sample", "raw") or method not in ("stat", "ml", "ts", "hts", "stan"):
        raise HTTPException(400, "data must be sample|raw and method stat|ml|ts|hts|stan")
    year = payload.get("year")
    month = payload.get("month")
    focus = (f"{int(year)}-{int(month):02d}"
             if year and month and 1 <= int(month) <= 12 else None)
    out = _analysis_for_evidence(aoi, data, method, payload.get("bbox"),
                                 str(payload.get("qa_min", "all")),
                                 str(payload.get("platform_set", "all")),
                                 focus_ym=focus)
    facts = ex.gather_facts(out["calendar"], out["daily_cells"], out["ratios"],
                            out.get("qa", {}).get("clean", 0),
                            payload.get("bbox"), method=out.get("method_id"),
                            evaluation=_evaluation_facts(aoi, data),
                            coverage=out.get("coverage"),
                            filters=out.get("filters"))
    facts["data_source"] = _data_source_label(data)
    facts["latest"] = out["latest"]
    evidence = None
    if focus:
        evidence = evd.build_evidence(out, out.get("daily") or [], aoi, data,
                                      method, int(year), int(month))
    tools_used = ["calendar", "evaluation", "coverage"]
    if evidence:
        tools_used.append("evidence")
    if any(w in q.lower() for w in ("sensor", "modis", "viirs", "platform", "cảm biến", "cam bien")):
        tools_used.append("sensor_context")
    rule = ex.answer(q, facts, out["critical_periods"], out["latest"], dl.describe())
    llm_facts = {**facts, "evidence": evidence,
                 "top_months": out["critical_periods"][:5],
                 "tools_used": tools_used,
                 "limitations": [
                     "AOI-month MAE against a VIIRS reference, not fire ground truth.",
                     "A missing detection is not proof of no fire (cloud/smoke/sub-pixel).",
                     "Australia remains a sparse 5-day-window series.",
                     "Cell-day estimates are not spatially validated.",
                 ]}

    def event_stream():
        meta = {
            "tools_used": tools_used,
            "evidence": evidence,
            "facts": facts,
            "suggestions": rule["suggestions"],
            "limitations": llm_facts["limitations"],
            "citations": (evidence or {}).get("citations", []),
        }
        yield f"event: meta\ndata: {json.dumps(meta, ensure_ascii=False)}\n\n"
        use_llm = payload.get("use_llm", True)
        full_text = []
        if use_llm:
            for item in llm.stream_llm(q, llm_facts, rule["answer"]):
                full_text.append(item.get("delta", ""))
                yield f"event: delta\ndata: {json.dumps(item, ensure_ascii=False)}\n\n"
        else:
            words = rule["answer"].split(" ")
            for i, word in enumerate(words):
                token = word if i == 0 else " " + word
                full_text.append(token)
                yield f"event: delta\ndata: {json.dumps({'delta': token, 'llm_used': False}, ensure_ascii=False)}\n\n"
                time.sleep(0.012)
        done_payload = {"full_answer": "".join(full_text), "status": "completed"}
        yield f"event: done\ndata: {json.dumps(done_payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")



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
    method = str(payload.get("method", "stat"))
    if method not in ("stat", "ml", "ts", "hts", "stan"):
        raise HTTPException(400, "method must be stat|ml|ts|hts|stan")
    qa_min = str(payload.get("qa_min", "all"))
    platform_set = str(payload.get("platform_set", "all"))
    _block_raw_ml_ts(method, data, aoi)
    if data == "raw":
        out = _harmonize_stream(aoi, data, payload.get("bbox") or bbox, method,
                                daily_cap=2000, qa_min=qa_min,
                                platform_set=platform_set)
        n_records = out.get("qa", {}).get("clean", 0)
    else:
        records = [r for r in _resolve_records(aoi, data, 100000) if _in_bbox(r, bbox)]
        if not records:
            raise HTTPException(404, "No sample data in this AOI")
        out = _harmonize_from_records(records, data=data, aoi=aoi, method=method,
                                      qa_min=qa_min, platform_set=platform_set)
        n_records = len(records)
    facts = ex.gather_facts(out["calendar"], out["daily_cells"],
                            out["ratios"], n_records, payload.get("bbox"),
                            method=out.get("method_id"),
                            evaluation=_evaluation_facts(aoi, data),
                            coverage=out.get("coverage"),
                            filters=out.get("filters"))
    facts["data_source"] = _data_source_label(data)
    facts["latest"] = out["latest"]
    facts["method_summary"] = (
        "4 steps on a daily 0.05° grid: (1) standardize FIRMS rows to one schema with QA flags "
        f"(filters qa_min={out.get('filters', {}).get('qa_min')}, platform_set={out.get('filters', {}).get('platform_set')}); "
        f"(2) k = MODIS/VIIRS = {out['ratios'].get('_fallback')} from monthly AOI totals "
        f"({out['ratios'].get('_n_months', 0)} measured months; mode={out['ratios'].get('_mode')}); "
        "(3) sensor-adjusted activity index in hotspot detections (NOT fires): keep VIIRS where >=1 VIIRS "
        "detection, upscale MODIS-only cells by 1/k as ESTIMATES (coverage unknown, upscaled FRP=null); "
        f"(4) month×year calendar, z anomaly in {out['calendar'].get('z_unit', 'robust MAD units')}. "
        f"Requested method `{method}` → effective `{out.get('effective_method')}`. "
        f"Coverage verified: {(out.get('coverage') or {}).get('verified')}.")
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
    method = str(payload.get("method", "stat"))
    if method not in ("stat", "ml", "ts", "hts", "stan"):
        raise HTTPException(400, "method must be stat|ml|ts|hts|stan")
    qa_min = str(payload.get("qa_min", "all"))
    platform_set = str(payload.get("platform_set", "all"))
    _block_raw_ml_ts(method, data, aoi)
    if data == "raw":
        out = _harmonize_stream(aoi, data, payload.get("bbox") or bbox, method,
                                daily_cap=2000, qa_min=qa_min,
                                platform_set=platform_set)
        n_records = out.get("qa", {}).get("clean", 0)
    else:
        records = [r for r in _resolve_records(aoi, data, 100000) if _in_bbox(r, bbox)]
        if not records:
            raise HTTPException(404, "No sample data in this AOI")
        out = _harmonize_from_records(records, data=data, aoi=aoi, method=method,
                                      qa_min=qa_min, platform_set=platform_set)
        n_records = len(records)
    facts = ex.gather_facts(out["calendar"], out["daily_cells"],
                            out["ratios"], n_records, payload.get("bbox"),
                            method=out.get("method_id"),
                            evaluation=_evaluation_facts(aoi, data),
                            coverage=out.get("coverage"),
                            filters=out.get("filters"))
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
