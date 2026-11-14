"""FIRMS harmonized burning-activity calendar API (NASA Space Apps 2026)."""
from __future__ import annotations

import csv
import io
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.firms import calendar as cal
from app.firms import dl, explain as ex, harmonize, store
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
    allow_headers=["Content-Type"],
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


def _in_bbox(r: dict, b: tuple[float, float, float, float] | None) -> bool:
    if b is None:
        return True
    try:
        return b[0] <= float(r["longitude"]) <= b[2] and b[1] <= float(r["latitude"]) <= b[3]
    except (KeyError, TypeError, ValueError):
        return False


def _harmonize_from_records(records: list[dict], daily_cap: int = 2000) -> dict:
    agg = harmonize.aggregate(records)
    ratios = harmonize.estimate_efficiency_ratio(agg)
    daily = harmonize.harmonize_daily(agg, ratios)
    calen = cal.build_calendar(daily)
    crit = cal.critical_periods(calen)
    latest_date = max((c["date"] for c in daily), default=None)
    latest = None
    if latest_date and calen.get("years"):
        m = int(latest_date[5:7])
        mi = m - 1
        month_total = round(calen["matrix"][-1][mi], 2)
        hist_med = calen["col_medians"][mi]
        latest = {"date": latest_date, "month": m,
                  "month_total": month_total,
                  "hist_median": hist_med,
                  "ratio": round(month_total / hist_med, 2) if hist_med else None,
                  "verdict": ("above_history" if month_total > 1.5 * hist_med
                              else "below_history" if month_total < 0.5 * hist_med
                              else "near_history") if hist_med else "no_history"}
    return {"daily_cells": len(daily), "ratios": ratios,
            "calendar": calen, "critical_periods": crit[:24],
            "latest": latest,
            "daily": daily[:daily_cap]}


@app.post("/api/firms/harmonize")
def firms_harmonize(payload: dict):
    raw = payload.get("records")
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "sample"))
    if data not in ("sample", "raw"):
        raise HTTPException(400, "data must be sample|raw")
    records = raw if isinstance(raw, list) and raw else _resolve_records(aoi, data, 25000)
    records = [r for r in records if _in_bbox(r, _parse_bbox(payload.get("bbox")))]
    if not records:
        raise HTTPException(404, "No records in this AOI; widen the bbox or POST records")
    t0 = time.perf_counter()
    out = _harmonize_from_records(records)
    out["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    out["method"] = "grid(0.05deg) + monthly VIIRS/MODIS ratio + forward fill to VIIRS sensitivity"
    return JSONResponse(out)


@app.get("/api/firms/calendar")
def firms_calendar(limit: int = Query(25000, ge=100, le=30000),
                   bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                   aoi: str = Query("vietnam", description="preset region"),
                   data: str = Query("sample", pattern="^(sample|raw)$")):
    records = [r for r in _resolve_records(aoi, data, limit) if _in_bbox(r, _parse_bbox(bbox))]
    if not records:
        raise HTTPException(404, f"No {data} data in this AOI")
    out = _harmonize_from_records(records)
    out["bbox"] = bbox
    out["aoi"] = aoi
    return JSONResponse(out)


@app.get("/api/firms/export")
def firms_export(limit: int = Query(25000, ge=100, le=30000),
                 bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                 aoi: str = Query("vietnam", description="preset region"),
                 data: str = Query("sample", pattern="^(sample|raw)$")):
    records = [r for r in _resolve_records(aoi, data, limit) if _in_bbox(r, _parse_bbox(bbox))]
    out = _harmonize_from_records(records, daily_cap=30000)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["cell_id", "date", "lat", "lon",
                                        "modis_count", "viirs_count",
                                        "modis_frp", "viirs_frp",
                                        "harmonized_count", "harmonized_frp",
                                        "method"])
    w.writeheader()
    for c in out.get("daily", []):
        w.writerow(c)
    return PlainTextResponse(buf.getvalue(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="harmonized_hotspots_{aoi}.csv"'})


@app.get("/api/firms/dl-info")
def firms_dl_info():
    return dl.describe()


@app.get("/api/firms/data-status")
def firms_data_status():
    """What datasets are on disk (samples + ingested raw + cache stats)."""
    return store.data_status()


@app.post("/api/firms/ingest")
async def firms_ingest(aoi: str = Query("vietnam"), source: str = Query("upload"),
                       file: UploadFile = File(...)):
    """Upload a real FIRMS CSV: validated in chunks, stored, QA report back."""
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 50 MB)")
    if not content:
        raise HTTPException(400, "Empty file")
    try:
        return store.ingest_upload(file.filename or "upload.csv", content, aoi, source)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/firms/train-calibrator")
def firms_train(payload: dict):
    pairs = payload.get("pairs", [])
    if not isinstance(pairs, list):
        raise HTTPException(400, "Provide pairs: list")
    return dl.train_calibrator(pairs)


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
    out = _harmonize_from_records(records)
    facts = ex.gather_facts(out["calendar"], out["daily_cells"],
                            out["ratios"], len(records), payload.get("bbox"))
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
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="dashboard")
