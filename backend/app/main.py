"""FIRMS harmonized burning-activity calendar API (NASA Space Apps 2026)."""
from __future__ import annotations

import csv
import io
import json
import logging
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
from app.firms import dl, explain as ex, harmonize, llm, ml_cal, store, ts_transformer as tst
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
            "torch": dl.describe()["has_torch"]}


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


def _resolve_records(aoi: str, data: str, limit: int) -> list[dict]:
    """Sample CSV (stable demo) or merged real downloads (data=raw)."""
    if data == "raw":
        if aoi not in store.AOIS and aoi != "custom":
            raise HTTPException(400, f"Unknown aoi {aoi!r}")
        return store.load_raw_merged(aoi, limit)
    return _sample_records(limit, aoi)


def _data_source_label(data: str) -> str:
    return ("synthetic demo (NOT observed — do not claim real events)"
            if data == "sample" else "NASA FIRMS observed")


def _require_admin(request: Request) -> None:
    """Gate write/train endpoints when ADMIN_TOKEN is set; open local dev otherwise."""
    tok = os.getenv("ADMIN_TOKEN", "")
    if tok and request.headers.get("X-Admin-Token") != tok:
        raise HTTPException(403, "Admin token required (X-Admin-Token)")


def _block_raw_ml_ts(method: str, data: str) -> None:
    """ML/TS artifacts are trained on synthetic samples — never serve them as observed."""
    if method in ("ml", "ts") and data == "raw":
        raise HTTPException(
            422, "artifact trained on synthetic sample; "
            "use method=stat for NASA observed or train on dense real data")


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
    # P0-10: climatology only from full months; partial months are skipped.
    col = [calen["matrix"][yi][mi] for yi in range(len(calen["years"]))
           if calen["matrix"][yi][mi] is not None
           and not comp.get(f"{calen['years'][yi]}-{mi + 1:02d}", {}).get("partial")]
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


def _harmonize_daily_ml(agg: dict, model) -> list[dict]:
    """Monthly ML post-adjustment (ml_hgb_v1) with conservation.

    Predict each month's VIIRS total from that month's MODIS total via
    ml_cal.predict_viirs (seasonal context is already inside the model:
    features are log_modis + month sin/cos, so one prediction per month).
    The prediction only rescales the modis_upscaled_estimated cells of that
    month (VIIRS-observed cells are untouched), so the month total equals
    the prediction by construction.
    """
    ratios = harmonize.estimate_efficiency_ratio(agg)
    stat = harmonize.harmonize_daily(agg, ratios)
    modis_ym: dict[str, float] = {}
    for (cell, day, inst), a in agg.items():
        if inst == "MODIS":
            ym = str(day)[:7]
            modis_ym[ym] = modis_ym.get(ym, 0.0) + a.count
    factors: dict[str, float] = {}
    for ym in sorted({str(c["date"])[:7] for c in stat}):
        try:
            pred = float(ml_cal.predict_viirs(model, modis_ym.get(ym, 0.0), int(ym[5:7])))
        except Exception:
            continue
        stat_total = sum(c["harmonized_count"] for c in stat if str(c["date"])[:7] == ym)
        stat_modis_only = sum(c["harmonized_count"] for c in stat
                              if str(c["date"])[:7] == ym
                              and c.get("estimate_type") == "modis_upscaled_estimated")
        if stat_modis_only > 0:
            # rescale only the estimated part toward the predicted month total
            target_est = max(pred - (stat_total - stat_modis_only), 0.0)
            factors[ym] = target_est / stat_modis_only
    out = []
    for c in stat:
        if c.get("estimate_type") == "modis_upscaled_estimated" and str(c["date"])[:7] in factors:
            c = {**c, "harmonized_count": round(c["harmonized_count"] * factors[str(c["date"])[:7]], 3),
                 "estimate_type": "ml_predicted",
                 "method": "ml_hgb_v1",
                 "coverage_status": "unknown"}
        out.append(c)
    return out


def _harmonize_daily_ts(clean: list[dict], daily_stat: list[dict], aoi: str) -> list[dict]:
    """Monthly Transformer post-adjustment (ts_win12_v1).

    The transformer predicts a month's VIIRS total from the trailing 12-month
    MODIS window. The predicted total only rescales MODIS-only cells of that
    month (VIIRS-observed cells are untouched). Months without 12 consecutive
    MODIS months keep the statistical value.
    """
    model, meta = tst.load_artifact(aoi, MODEL_DIR)
    if model is None or meta is None:
        raise HTTPException(404, f"No Transformer artifact for aoi={aoi}; POST /api/firms/ts-train first")
    lm, ls = float(meta.get("log_mean", 0.0)), float(meta.get("log_std", 1.0)) or 1.0
    modis_ym: dict[str, float] = {}
    for r in clean:
        if str(r.get("instrument", "")).upper().startswith("VIIRS"):
            continue
        ym = str(r.get("acq_date", ""))[:7]
        modis_ym[ym] = modis_ym.get(ym, 0.0) + 1.0
    # calendar months present in the stat output
    months = sorted({str(c["date"])[:7] for c in daily_stat})
    factors: dict[str, float] = {}
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
            continue
        import numpy as _np
        X = _np.array([[__import__("math").log1p(v),
                        __import__("math").sin(2 * __import__("math").pi * mm / 12.0),
                        __import__("math").cos(2 * __import__("math").pi * mm / 12.0)] for v, mm in seq],
                      dtype=_np.float32).reshape(1, 12, 3)
        pred = float(tst.predict_windows(model, X, lm, ls)[0])
        stat_total = sum(c["harmonized_count"] for c in daily_stat if str(c["date"])[:7] == ym)
        stat_modis_only = sum(c["harmonized_count"] for c in daily_stat
                              if str(c["date"])[:7] == ym and c.get("estimate_type") == "modis_upscaled_estimated")
        if stat_total > 0 and stat_modis_only > 0:
            # rescale only the estimated part toward the predicted month total
            target_est = max(pred - (stat_total - stat_modis_only), 0.0)
            factors[ym] = target_est / stat_modis_only
    out = []
    for c in daily_stat:
        if c.get("estimate_type") == "modis_upscaled_estimated" and str(c["date"])[:7] in factors:
            c = {**c, "harmonized_count": round(c["harmonized_count"] * factors[str(c["date"])[:7]], 3),
                 "estimate_type": "ts_predicted", "method": "ts_win12_v1",
                 "coverage_status": "unknown"}
        out.append(c)
    return out


def _harmonize_from_records(records: list[dict], daily_cap: int = 2000,
                              data: str = "sample", aoi: str = "vietnam",
                              method: str = "stat") -> dict:
    """Validate -> QA -> dedup -> harmonize. Single path for sample/raw/upload (P0-07)."""
    _block_raw_ml_ts(method, data)
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
        ml_model, ml_meta = ml_cal.load_artifact(aoi, MODEL_DIR)
        if ml_model is None:
            raise HTTPException(404, f"No ML artifact for aoi={aoi}; POST /api/firms/ml-train first")
    if method == "ml":
        daily = _harmonize_daily_ml(agg, ml_model)
    elif method == "ts":
        daily = _harmonize_daily_ts(clean, harmonize.harmonize_daily(agg, ratios), aoi)
        ts_model, ml_meta = tst.load_artifact(aoi, MODEL_DIR)
    else:
        daily = harmonize.harmonize_daily(agg, ratios)
    calen = cal.build_calendar(daily)
    crit = cal.critical_periods(calen)
    latest_date = max((c["date"] for c in daily), default=None)
    latest = None
    # P0-10: a partial latest month carries no verdict (frontend handles null).
    _latest_ym = str(latest_date)[:7] if latest_date else ""
    if latest_date and calen.get("years") and not calen.get(
            "completeness", {}).get(_latest_ym, {}).get("partial"):
        m = int(latest_date[5:7])
        mi = m - 1
        # P1-10: baseline excludes the target year itself (no leakage).
        ly = int(latest_date[:4])
        col = [calen["matrix"][yi][mi] for yi, y in enumerate(calen["years"])
               if y != ly and calen["matrix"][yi][mi] is not None]
        cur = next((calen["matrix"][yi][mi] for yi, y in enumerate(calen["years"])
                    if y == ly), None)
        if cur is not None and col:
            import statistics as _st
            med = round(float(_st.median(col)), 2)
            latest = {"date": latest_date, "month": m,
                      "month_total": round(cur, 2),
                      "hist_median": med,
                      "hist_years": len(col),
                      "ratio": round(cur / med, 2) if med else None,
                      "verdict": ("above_history" if cur > 1.5 * med
                                  else "below_history" if cur < 0.5 * med
                                  else "near_history") if med else "no_history"}
    return {"daily_cells": len(daily), "ratios": ratios,
            "calendar": calen, "critical_periods": crit[:24],
            "latest": latest,
            "forecast": _forecast(calen, latest_date),
            "data_source": _data_source_label(data),
            "method_id": ({"ml": "ml_hgb_v1", "ts": "ts_win12_v1"}.get(method, "seasonal_ratio_v1")),
            "ml_meta": ml_meta,
            "qa": {"clean": len(clean), "rejected": rejected, "qa_counts": qa_counts},
            "daily": daily[:daily_cap] if daily_cap else []}


@app.post("/api/firms/harmonize")
def firms_harmonize(payload: dict):
    raw = payload.get("records")
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "sample"))
    if data not in ("sample", "raw"):
        raise HTTPException(400, "data must be sample|raw")
    records = raw if isinstance(raw, list) and raw else _resolve_records(aoi, data, 500000)
    if isinstance(raw, list) and raw:
        data = "upload"
    records = [r for r in records if _in_bbox(r, _parse_bbox(payload.get("bbox")))]
    if not records:
        raise HTTPException(404, "No records in this AOI; widen the bbox or POST records")
    t0 = time.perf_counter()
    method = str(payload.get("method", "stat"))
    if method not in ("stat", "ml", "ts"):
        raise HTTPException(400, "method must be stat|ml|ts")
    _block_raw_ml_ts(method, data)
    out = _harmonize_from_records(records, daily_cap=2000, data=data, aoi=aoi, method=method)
    out["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    out["method"] = ({"stat": "daily 0.05deg grid + monthly activity ratio + sensor-adjusted index "
                              "(hotspot detections, not fires; MODIS-only cells are estimates)",
                      "ml": "daily 0.05deg grid + HGB ML calibrator (ml_hgb_v1) for MODIS-only cells",
                      "ts": "daily 0.05deg grid + temporal Transformer (ts_win12_v1) monthly post-adjustment"}[method])
    return JSONResponse(out)


@app.get("/api/firms/calendar")
def firms_calendar(limit: int = Query(2000, ge=1, le=500000),
                   bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                   aoi: str = Query("vietnam", description="preset region"),
                   data: str = Query("sample", pattern="^(sample|raw)$"),
                   method: str = Query("stat", pattern="^(stat|ml|ts)$")):
    # P0-06: aggregate the FULL filtered set, slice only the daily response.
    _block_raw_ml_ts(method, data)
    records = [r for r in _resolve_records(aoi, data, 500000) if _in_bbox(r, _parse_bbox(bbox))]
    if not records:
        raise HTTPException(404, f"No {data} data in this AOI")
    out = _harmonize_from_records(records, daily_cap=min(limit, 5000),
                                  data=data, aoi=aoi, method=method)
    out["bbox"] = bbox
    out["aoi"] = aoi
    out["data"] = data
    return JSONResponse(out)


@app.get("/api/firms/export")
def firms_export(limit: int = Query(25000, ge=100, le=500000),
                 bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                 aoi: str = Query("vietnam", description="preset region"),
                 data: str = Query("sample", pattern="^(sample|raw)$"),
                 method: str = Query("stat", pattern="^(stat|ml|ts)$")):
    # P0-06: export the FULL filtered set through the same harmonize path
    # as the dashboard so the CSV matches /calendar (P1-07: no silent cap).
    _block_raw_ml_ts(method, data)
    records = [r for r in _resolve_records(aoi, data, limit) if _in_bbox(r, _parse_bbox(bbox))]
    if not records:
        raise HTTPException(404, f"No {data} data in this AOI")
    full_daily = _harmonize_from_records(records, daily_cap=1000000,
                                         data=data, aoi=aoi, method=method)["daily"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["cell_id", "date", "lat", "lon",
                                        "modis_count", "viirs_count",
                                        "modis_frp", "viirs_frp",
                                        "harmonized_count", "harmonized_frp",
                                        "estimate_type", "sensors", "platforms",
                                        "coverage_status", "k_used",
                                        "method", "algorithm_version",
                                        "data_source"])
    w.writeheader()
    for c in full_daily:
        row = {**c, "data_source": _data_source_label(data)}
        w.writerow({k: row.get(k) for k in w.fieldnames})
    return PlainTextResponse(buf.getvalue(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="harmonized_hotspots_{aoi}.csv"',
                                      "X-Row-Count": str(len(full_daily)),
                                      "X-Data-Source": _data_source_label(data).replace("\u2014", "-")})


@app.get("/api/firms/dl-info")
def firms_dl_info():
    return dl.describe()


@app.get("/api/firms/data-status")
def firms_data_status():
    """What datasets are on disk (samples + ingested raw + cache stats)."""
    return store.data_status()


@app.post("/api/firms/ingest")
async def firms_ingest(request: Request,
                       aoi: str = Query("vietnam"), source: str = Query("upload"),
                       file: UploadFile = File(...)):
    """Upload a real FIRMS CSV: validated in chunks, stored, QA report back."""
    _require_admin(request)
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 50 MB)")
    if not content:
        raise HTTPException(400, "Empty file")
    try:
        return store.ingest_upload(file.filename or "upload.csv", content, aoi, source)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/firms/brief")
def firms_brief(aoi: str = Query("vietnam", description="preset region"),
                bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                data: str = Query("sample", pattern="^(sample|raw)$")):
    """One-page Markdown brief (hotspot-detection activity, not fire counts)."""
    records = [r for r in _resolve_records(aoi, data, 100000) if _in_bbox(r, _parse_bbox(bbox))]
    if not records:
        raise HTTPException(404, f"No {data} data in this AOI")
    out = _harmonize_from_records(records, daily_cap=0, data=data)
    c, ys = out["calendar"], out["calendar"]["years"]
    L, F = out["latest"], out["forecast"]
    src = _data_source_label(data)
    lines = [
        f"# Fire-activity brief — {aoi}{f' ({bbox})' if bbox else ''}",
        f"_Source: NASA FIRMS ({data}) — {src}._",
        f"_Units: hotspot detections / sensor-adjusted activity index (NOT confirmed fires)._",
        "",
        f"- Period: {ys[0]}–{ys[-1]} ({len(ys)} years, {out['daily_cells']} daily cells)",
        f"- Yearly mean: {round(sum(c['row_totals']) / len(ys), 1)} detections/yr; "
        f"peak year {ys[c['row_totals'].index(max(c['row_totals']))]}",
        "- Top anomalous months (|z|>=2, MAD units): " + (
            "; ".join(f"{p['year']}-{p['month']:02d} (z={p['z']})" for p in out["critical_periods"][:5]) or "none"),
    ]
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
    records = _resolve_records(aoi, data, 1000000)
    pairs = ml_cal.build_monthly_pairs(records)
    res = ml_cal.train_holdout(pairs, test_years=test_years)
    if not res.get("trained"):
        raise HTTPException(422, f"Not enough overlap data: {res.get('reason')} "
                                 f"(n_train={res.get('n_train')}, n_test={res.get('n_test')})")
    model = res.pop("model")
    paths = ml_cal.save_artifact(model, res, aoi, MODEL_DIR)
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
    records = _resolve_records(aoi, data, 1000000)
    wins = tst.build_windows(ml_cal.build_monthly_pairs(records))
    res = tst.train_holdout(wins, test_years=test_years, epochs=epochs)
    if not res.get("trained"):
        raise HTTPException(422, f"Not enough window data: {res.get('reason')} "
                                 f"(n_train={res.get('n_train')}, n_test={res.get('n_test')})")
    model = res.pop("model")
    paths = tst.save_artifact(model, res, aoi, MODEL_DIR)
    return JSONResponse({**res, **paths, "data_source": _data_source_label(data)})


@app.get("/api/firms/ts-status")
def firms_ts_status(aoi: str = Query("vietnam")):
    """Persisted Transformer artifact metadata (or not-trained)."""
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    _, meta = tst.load_artifact(aoi, MODEL_DIR)
    if meta is None:
        return {"trained": False, "aoi": aoi,
                "hint": "POST /api/firms/ts-train to train"}
    return {"trained": True, **meta}


@app.get("/api/firms/ml-status")
def firms_ml_status(aoi: str = Query("vietnam")):
    """Persisted HGB artifact metadata (or not-trained)."""
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    _, meta = ml_cal.load_artifact(aoi, MODEL_DIR)
    if meta is None:
        return {"trained": False, "aoi": aoi,
                "hint": "POST /api/firms/ml-train to train"}
    return {"trained": True, **meta}


@app.get("/api/firms/backtest")
def firms_backtest(request: Request,
                   aoi: str = Query("vietnam"),
                   data: str = Query("sample", pattern="^(sample|raw)$"),
                   test_years: int = Query(3, ge=1, le=6),
                   refresh: int = Query(0)):
    """Time-travel backtest: train on early years, hide VIIRS in test years,
    predict from MODIS, compare B0/B1/B2/ML vs the VIIRS reference.

    VIIRS is a sensor reference, NOT ground truth of real fires.

    The result is cached to data/firms/models/backtest_{aoi}_{data}.json on
    first GET and served from cache afterwards; ?refresh=1 recomputes
    (requires admin when ADMIN_TOKEN is set).
    """
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    cache_path = MODEL_DIR / f"backtest_{aoi}_{data}.json"
    if refresh:
        _require_admin(request)
    elif cache_path.exists():
        try:
            return JSONResponse(json.loads(cache_path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
    records = _resolve_records(aoi, data, 1000000)
    pairs = ml_cal.build_monthly_pairs(records)
    res = ml_cal.train_holdout(pairs, test_years=test_years)
    if not res.get("trained"):
        raise HTTPException(422, f"Not enough overlap data ({res.get('reason')})")
    model = res.pop("model")
    # Transformer on the same split (honest comparison, same holdout years).
    ts_metrics = None
    ts_preds: dict[tuple[int, int], float] = {}
    try:
        wins = tst.build_windows(pairs)
        tres = tst.train_holdout(wins, test_years=test_years, epochs=60)
        if tres.get("trained"):
            tmodel = tres.pop("model")
            lm = float(tres.get("log_mean", 0.0)); ls = float(tres.get("log_std", 1.0)) or 1.0
            for w in wins:
                if w["year"] in res["test_years"]:
                    import numpy as _np
                    ts_preds[(w["year"], w["month"])] = float(
                        tst.predict_windows(tmodel, w["X"].reshape(1, 12, 3), lm, ls)[0])
            ts_metrics = tres.get("metrics", {}).get("transformer")
    except Exception as e:  # noqa: BLE001 - transformer is bonus, never break backtest
        logger.warning("transformer backtest skipped: %s", e)
    rows = []
    for p in pairs:
        if p["year"] in res["test_years"]:
            m = ml_cal.predict_viirs(model, p["modis"], p["month"])
            rows.append({"year": p["year"], "month": p["month"],
                         "modis": p["modis"], "viirs_ref": p["viirs"],
                         "ml_pred": round(m, 2),
                         "ts_pred": round(ts_preds.get((p["year"], p["month"]), float("nan")), 2)
                         if (p["year"], p["month"]) in ts_preds else None})
    payload = {"aoi": aoi, "data": data,
               "data_source": _data_source_label(data),
               "metrics": _round4({**res["metrics"],
                                   **({"transformer": ts_metrics} if ts_metrics else {})}),
               "train_years": res["train_years"],
               "test_years": res["test_years"],
               "method_id": res["method_id"],
               "note": "VIIRS is a sensor reference, not ground truth of fire events.",
               "months": rows}
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

    Plus the holdout backtest metrics so judges see error, not just curves.
    """
    if aoi not in AOIS:
        raise HTTPException(400, f"Unknown aoi {aoi!r}")
    records = _resolve_records(aoi, data, 1000000)
    pairs = ml_cal.build_monthly_pairs(records)
    # P0-02: the real calendar monthly totals for these same records/method,
    # so the frontend can compare bias curves against the calendar output.
    cal_out = _harmonize_from_records(records, daily_cap=0, data=data, aoi=aoi, method="stat")
    cal_by_ym: dict[tuple[int, int], float] = {}
    for _yi, _y in enumerate(cal_out["calendar"]["years"]):
        for _mi in range(12):
            _v = cal_out["calendar"]["matrix"][_yi][_mi]
            if _v is not None:
                cal_by_ym[(_y, _mi + 1)] = _v
    by_ym: dict[tuple[int, int], dict] = {}
    for p in pairs:
        by_ym[(p["year"], p["month"])] = {"modis": p["modis"], "viirs": p["viirs"]}
    try:
        res = ml_cal.train_holdout(pairs, test_years=3)
        metrics = res.get("metrics") if res.get("trained") else None
        b2 = res.get("b2_ratios", {}) if res.get("trained") else {}
        b1 = res.get("b1_ratio") if res.get("trained") else None
    except Exception:
        metrics, b2, b1 = None, {}, None
    months = []
    for (y, m), v in sorted(by_ym.items()):
        k = float(b2.get(str(m), b1 or 0.35)) if (b2 or b1) else 0.35
        months.append({"year": y, "month": m,
                       "modis_raw": v["modis"], "viirs_ref": v["viirs"],
                       "adjusted_stat": round(v["modis"] * k, 2),
                       "adjusted_calendar": cal_by_ym.get((y, m)),
                       "k_used": round(k, 4)})
    _, ml_meta = ml_cal.load_artifact(aoi, MODEL_DIR)
    _, ts_meta = tst.load_artifact(aoi, MODEL_DIR)
    return JSONResponse({"aoi": aoi, "data": data,
                         "data_source": _data_source_label(data),
                         "units": "hotspot detections per month (NOT fires)",
                         "backtest_metrics": metrics,
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
        f"({len(out['ratios']) - 1} measured months; empirical activity ratio, not a validated calibration); "
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
    """Serve index.html for SPA routes (/calendar, /method...) on refresh.

    API 404s keep JSON: anything under api/ falls through to a JSON 404.
    """
    if full_path.startswith("api/"):
        raise HTTPException(404, f"Unknown API path /{full_path}")
    index = _DIST / "index.html"
    if _DIST.is_dir() and index.exists():
        from fastapi.responses import FileResponse
        return FileResponse(str(index), media_type="text/html")
    raise HTTPException(404, "Dashboard not built (run make demo)")


if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="dashboard")
