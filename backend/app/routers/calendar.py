"""FIRMS calendar/map/brief/coverage routes (split from app.main — CLAIM-016, contract unchanged)."""
from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import logging
import math
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from app.firms import calendar as cal
from app.firms import (coverage as cov, dl, evaluation, evidence as evd,
                       explain as ex, harmonize, hts, llm, ml_cal, registry,
                       stan, spatial, store)
from app.firms.service import (_activity_summary, _empty_month_slot,
                               _forecast, _latest_summary, _round4,
                               _slot_add)
from app.firms.spatial import (_geometry_bbox, _geometry_hash, _in_bbox,
                               _in_dates, _norm_confidence_filter,
                               _norm_satellite_filter, _parse_bbox,
                               _parse_date_range, _parse_geometry,
                               _point_in_geometry, _point_in_ring,
                               _row_in_scope)
from app.firms.schema import FirmsRecord
# CLAIM-019: pipeline owns these helpers; import forward, not from app.main.
from app.firms.pipeline import (_block_raw_ml_ts, _data_source_label, _harmonize_from_records, _harmonize_stream, _raw_agg, _require_aoi, _resolve_records)

router = APIRouter()


@router.get("/api/firms/calendar")
def firms_calendar(limit: int = Query(2000, ge=1, le=2000000),
                   bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                   aoi: str = Query("vietnam", description="preset region"),
                   data: str = Query("sample", pattern="^(sample|raw)$"),
                   method: str = Query("stat", pattern="^(stat|hts|stan)$"),
                   qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                   platform_set: str = Query("all", pattern="^(all|snpp)$"),
                   source_type: str = Query("all", pattern="^(all|land|vegetation)$"),
                   dataset: str | None = Query(None, description="session upload id (upload:<hex>)"),
                   geometry: str | None = Query(None, description="GeoJSON Polygon/MultiPolygon"),
                   from_date: str | None = Query(None, description="inclusive YYYY-MM-DD"),
                   to_date: str | None = Query(None, description="inclusive YYYY-MM-DD")):
    # P0-06: aggregate the FULL filtered set, slice only the daily response.
    geom = _parse_geometry(geometry)
    from_date, to_date = _parse_date_range(from_date, to_date)
    if method in ("hts", "stan") and (
            bbox is not None or from_date or to_date):
        raise HTTPException(409, detail={
            "error_code": "model_requires_full_aoi",
            "message": ("Monthly model targets are AOI-level totals for the full "
                        "AOI and full month: they are not per-polygon predictions "
                        "and cannot be reallocated to a bbox/geometry or date "
                        "subset without inventing numbers. A filtered request "
                        "must use method=stat (the grid ratio path, valid on any "
                        "subset); do not filter after a model total."),
            "method": method})
    if geom is not None and method in ("hts", "stan"):
        raise HTTPException(409, detail={
            "error_code": "geometry_requires_stat_method",
            "message": ("Custom geometry uses method=stat: model targets are "
                       "AOI-level monthly totals for the full AOI, not per-polygon "
                       "predictions, and cannot be reallocated to an arbitrary "
                       "polygon without inventing numbers. Retry the same polygon "
                       "with method=stat (the grid ratio path)."),
            "method": method})
    _block_raw_ml_ts(method, data, aoi)
    if data == "raw" and not dataset and not store.raw_ready(aoi):
        raise HTTPException(404, detail={
            "error_code": "no_raw_data",
            "message": f"No raw FIRMS data on this server for aoi={aoi}. "
                       "Use data=sample for the synthetic demo, or fetch a month first.",
            "aoi": aoi})
    if data == "raw" and not dataset:
        try:
            out = _harmonize_stream(aoi, data, bbox, method, daily_cap=min(limit, 5000),
                                    qa_min=qa_min, platform_set=platform_set,
                                    geom=geom, from_date=from_date, to_date=to_date,
                                    source_type=source_type)
        except HTTPException as exc:
            if exc.status_code != 404 or not (geom is not None or bbox is not None or from_date or to_date):
                raise
            empty_cal = {
                "years": [], "months": list(range(1, 13)),
                "values": [], "anomalies": [], "row_totals": [],
                "baseline": [], "k": [], "coverage": [],
            }
            out = {
                "daily_cells": 0, "ratios": {}, "calendar": empty_cal,
                "critical_periods": [], "latest": None,
                "data_source": _data_source_label(data),
                "method_id": {"stat": "seasonal_ratio_v1", "hts": "hts_anchor_v1", "stan": "stan_safe_v1"}.get(method, "seasonal_ratio_v1"),
                "effective_method": method,
                "daily": [],
                "empty_filter": True,
                "summary": {
                    "sensor_detections_total": 0,
                    "modis_detections": 0,
                    "viirs_detections": 0,
                    "harmonized_total": 0,
                    "n_daily_cells_returned": 0,
                    "n_daily_cells_total": 0,
                    "source_scope": f"{aoi}/{data}",
                    "estimated_index": None,
                    "filter_hash": "empty",
                    "period": {"from": from_date, "to": to_date},
                },
            }
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
                                      bbox=bbox, source_type=source_type)
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


@router.get("/api/firms/map-cells")
def firms_map_cells(ym: str = Query(..., description="YYYY-MM"),
                    bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                    aoi: str = Query("vietnam"),
                    data: str = Query("sample", pattern="^(sample|raw)$"),
                    method: str = Query("stat", pattern="^(stat|hts|stan)$"),
                    qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                    platform_set: str = Query("all", pattern="^(all|snpp)$"),
                    source_type: str = Query("all", pattern="^(all|land|vegetation)$"),
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
    if method in ("hts", "stan") and (
            bbox is not None or from_date or to_date):
        raise HTTPException(409, detail={
            "error_code": "model_requires_full_aoi",
            "message": ("Monthly model targets are AOI-level totals for the full "
                        "AOI and full month: they are not per-polygon predictions "
                        "and cannot be reallocated to a bbox/geometry or date "
                        "subset without inventing numbers. A filtered request "
                        "must use method=stat (the grid ratio path, valid on any "
                        "subset); do not filter after a model total."),
            "method": method})
    if geom is not None and method in ("hts", "stan"):
        raise HTTPException(409, detail={
            "error_code": "geometry_requires_stat_method",
            "message": ("Custom geometry map cells only support method=stat: model "
                       "targets are AOI-level monthly totals for the full AOI, "
                       "not per-polygon predictions, and cannot be reallocated "
                       "to an arbitrary polygon without inventing numbers."),
            "method": method})
    _block_raw_ml_ts(method, data, aoi)
    if data == "raw" and not dataset and not store.raw_ready(aoi):
        raise HTTPException(404, detail={"error_code": "no_raw_data",
                                         "message": "No raw FIRMS data on this server.",
                                         "aoi": aoi})
    if data == "raw" and not dataset:
        try:
            out = _harmonize_stream(aoi, data, bbox, method, daily_cap=1000000,
                                    qa_min=qa_min, platform_set=platform_set,
                                    focus_ym=ym, cache_result=False, geom=geom,
                                    from_date=from_date, to_date=to_date,
                                    source_type=source_type)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            out = {"method_id": method, "effective_method": method, "daily": [], "summary": {}}
    else:
        records = [r for r in _resolve_records(aoi, data, 2000000, dataset)
                   if _in_bbox(r, _parse_bbox(bbox))]
        if not records:
            raise HTTPException(404, f"No {data} data in this AOI")
        out = _harmonize_from_records(records, daily_cap=2000000,
                                      data=data, aoi=aoi, method=method,
                                      dataset=dataset, qa_min=qa_min,
                                      platform_set=platform_set, geom=geom,
                                      from_date=from_date, to_date=to_date,
                                      source_type=source_type)
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
    capped = all_cells[:max_cells]
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
        "capped_at": max_cells,
        "filter_hash": summary.get("filter_hash"),
        "source_scope": summary.get("source_scope"),
    })


@router.get("/api/firms/export")
def firms_export(limit: int = Query(2000000, ge=100, le=2000000),
                 bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                 aoi: str = Query("vietnam", description="preset region"),
                 data: str = Query("sample", pattern="^(sample|raw)$"),
                 method: str = Query("stat", pattern="^(stat|hts|stan)$"),
                 qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                 platform_set: str = Query("all", pattern="^(all|snpp)$"),
                 source_type: str = Query("all", pattern="^(all|land|vegetation)$"),
                 dataset: str | None = Query(None, description="session upload id"),
                 geometry: str | None = Query(None, description="GeoJSON Polygon/MultiPolygon"),
                 from_date: str | None = Query(None),
                 to_date: str | None = Query(None)):
    # P0-06: export the FULL filtered set through the same harmonize path
    # as the dashboard so the CSV matches /calendar (P1-07: no silent cap).
    _block_raw_ml_ts(method, data, aoi)
    geom = _parse_geometry(geometry)
    from_date, to_date = _parse_date_range(from_date, to_date)
    if method in ("hts", "stan") and (
            bbox is not None or from_date or to_date):
        raise HTTPException(409, detail={
            "error_code": "model_requires_full_aoi",
            "message": ("Monthly model targets are AOI-level totals for the full "
                        "AOI and full month: they are not per-polygon predictions "
                        "and cannot be reallocated to a bbox/geometry or date "
                        "subset without inventing numbers. A filtered request "
                        "must use method=stat (the grid ratio path, valid on any "
                        "subset); do not filter after a model total."),
            "method": method})
    if geom is not None and method in ("hts", "stan"):
        raise HTTPException(409, detail={
            "error_code": "geometry_requires_stat_method",
            "message": ("Custom geometry exports only support method=stat: model "
                       "targets are AOI-level monthly totals for the full AOI, "
                       "not per-polygon predictions, and cannot be reallocated "
                       "to an arbitrary polygon without inventing numbers."),
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
        agg, _stats = _raw_agg(aoi, bbox, qa_min, platform_set, geom=geom,
                               source_type=source_type)
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
                                       from_date=from_date, to_date=to_date,
                                       source_type=source_type)["daily"]
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
                                             bbox=bbox, source_type=source_type)["daily"]
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
               "platform_set": platform_set, "source_type": source_type,
               "dataset": dataset or "none",
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


@router.get("/api/firms/export-detections")
def firms_export_detections(bbox: str | None = Query(None),
                            aoi: str = Query("vietnam"),
                            data: str = Query("sample", pattern="^(sample|raw)$"),
                            dataset: str | None = Query(None),
                            qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                            platform_set: str = Query("all", pattern="^(all|snpp)$"),
                            source_type: str = Query("all", pattern="^(all|land|vegetation)$"),
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
        if not _row_in_scope(r, b, geom) or not _in_dates(r, from_date, to_date):
            return False
        conf = _norm_confidence_filter(r.get("confidence", ""))
        if qa_min in ("nominal", "high") and conf == "l":
            return False
        if qa_min == "high" and conf != "h":
            return False
        if (platform_set == "snpp" and str(r.get("instrument", "")).upper() == "VIIRS"
                and _norm_satellite_filter(r.get("satellite", "")) != "NPP"):
            return False
        if source_type != "all":
            try:
                tval = int(r["type"]) if r.get("type") not in (None, "") else None
            except (TypeError, ValueError):
                tval = None
            if source_type == "land" and tval == 3:
                return False
            if source_type == "vegetation" and tval in (1, 2, 3):
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


@router.get("/api/firms/data-status")
def firms_data_status():
    """What datasets are on disk (samples + ingested raw + cache stats)."""
    return store.data_status()


@router.get("/api/firms/coverage")
def firms_coverage(aoi: str = Query("vietnam"),
                   data: str = Query("raw", pattern="^(sample|raw)$")):
    """Request ledger: which days were actually requested, and which failed."""
    _require_aoi(aoi, data)
    if data == "raw":
        return {"aoi": aoi, "data": data,
                "raw_ready": store.raw_ready(aoi),
                **cov.coverage_summary(aoi),
                "ledger": cov.ledger_status(aoi)}
    return {"aoi": aoi, "data": data, "verified": False,
            "reason": "sample data has no request ledger"}


@router.get("/api/firms/platform-series")
def firms_platform_series(aoi: str = Query("vietnam"),
                          data: str = Query("raw", pattern="^(sample|raw)$")):
    """Platform mix per year + a single-platform comparable series.

    Audit P0-12: SNPP/NOAA-20/NOAA-21 are different overpasses; a combined
    count can rise simply because a new platform was added. This endpoint
    exposes the mix and the SNPP-only total, which is the comparable series.
    """
    _require_aoi(aoi, data)
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


@router.get("/api/firms/brief")
def firms_brief(aoi: str = Query("vietnam", description="preset region"),
                bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
                data: str = Query("sample", pattern="^(sample|raw)$"),
                method: str = Query("stat", pattern="^(stat|hts|stan)$"),
                qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                platform_set: str = Query("all", pattern="^(all|snpp)$"),
                source_type: str = Query("all", pattern="^(all|land|vegetation)$"),
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
                                qa_min=qa_min, platform_set=platform_set,
                                source_type=source_type)
    else:
        records = [r for r in _resolve_records(aoi, data, 2000000, dataset)
                   if _in_bbox(r, _parse_bbox(bbox))]
        if not records:
            raise HTTPException(404, f"No {data} data in this AOI")
        out = _harmonize_from_records(records, daily_cap=0, data=data, aoi=aoi,
                                      method=method, dataset=dataset,
                                      qa_min=qa_min, platform_set=platform_set,
                                      source_type=source_type)
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
