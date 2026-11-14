"""FIRMS models/backtest/xray/evidence routes (split from app.main — CLAIM-016, contract unchanged)."""
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
from app.firms.pipeline import (_block_raw_ml_ts, _data_source_label, _harmonize_from_records, _harmonize_stream, _require_aoi, _resolve_records)

router = APIRouter()


@router.get("/api/firms/models")
def firms_models():
    from app.main import MODEL_DIR
    """One registry: the primary model, baseline, fallback and the gate."""
    out = registry.status(MODEL_DIR)
    out["primary_gate"] = evaluation.primary_status("raw", MODEL_DIR)
    return out


@router.get("/api/firms/stan-status")
def firms_stan_status():
    from app.main import _stan_meta
    """STAN: tuned spatial-temporal NB model. Safe variant is not retrospective."""
    safe, retro = _stan_meta("safe"), _stan_meta("retro")
    if not safe and not retro:
        return {"trained": False, "method_id": "stan_v1",
                "hint": "python -m app.firms.stan"}
    return {"trained": True, "candidate": False, "served": True,
            "role": "main",
            "primary_method_id": registry.PRIMARY,
            "interval": stan.interval_status(),
            "safe": {k: v for k, v in (safe or {}).items() if k != "predictions"},
            "retrospective": {k: v for k, v in (retro or {}).items()
                              if k != "predictions"}}


@router.get("/api/firms/hts-status")
def firms_hts_status():
    from app.main import MODEL_DIR
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


@router.get("/api/firms/backtest")
def firms_backtest(request: Request,
                   aoi: str = Query("vietnam"),
                   data: str = Query("sample", pattern="^(sample|raw)$"),
                   test_years: int = Query(2, ge=1, le=6),
                   refresh: int = Query(0),
                   dataset: str | None = Query(None)):
    from app.main import MODEL_DIR, _backtest_from_manifest, _require_admin, logger
    """Unified time-travel backtest: one frozen sample set for every method.

    Audit P0-07/P0-08/P0-09: the old endpoint trained the legacy HGB, cached
    by AOI/data/test-years only, and could serve a stale version. This endpoint
    reads `evaluation_{data}.json` (built offline by
    `python -m scripts.firms.evaluate`), verifies the cache identity, and
    refuses to train heavy ensembles on a public GET.
    """
    if dataset and dataset.startswith("upload:"):
        raise HTTPException(400, detail={
            "error_code": "dataset_not_supported_here",
            "message": ("dataset only applies to calendar/map-cells/export/brief; "
                        "this endpoint does not read uploaded session datasets. "
                        "Use method=stat at one of those endpoints, e.g. "
                        "/api/firms/calendar?dataset=<id>&method=stat."),
        })
    _require_aoi(aoi, data)
    if refresh:
        _require_admin(request)
        # Training a new ensemble here would update evaluation_raw.json but NOT
        # the persisted cal_*/ts_* artifacts, so /calendar could keep serving
        # the old model under new metrics (audit V5 P0). The offline CLI is the
        # only path that retrains and stamps both.
        raise HTTPException(409, detail={
            "error_code": "refresh_requires_offline_pipeline",
            "message": ("Rebuild with scripts.firms.retrain_all (tiles -> HTS "
                        "-> STAN -> unify), then restart; this GET does not train "
                        "or mutate artifacts."),
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


@router.get("/api/firms/xray")
def firms_xray(aoi: str = Query("vietnam"),
               data: str = Query("sample", pattern="^(sample|raw)$")):
    from app.main import MODEL_DIR, _stan_meta
    """Sensor Bias X-Ray: per-month MODIS raw vs VIIRS reference vs adjusted.

    Audit P0-09: this used to train the legacy model and load the sample
    artifact even for data=raw. It now reads the unified evaluation manifest
    and the artifact with the correct data tag.
    """
    _require_aoi(aoi, data)
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
    # eval-v4 already contains the served STAN/HTS predictions on these
    # exact AOI-month IDs. Never override it with model-training sidecars.
    metrics = dict(per.get("metrics") or {}) if per else {}
    metrics = metrics or None
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
                         "primary_method_id": registry.PRIMARY,
                         "primary_gate": evaluation.primary_status(data, MODEL_DIR),
                         "stan_trained": data == "raw" and _stan_meta("safe") is not None,
                         "hts_trained": data == "raw" and (
                             MODEL_DIR / "hts_anchor_raw.json").exists(),
                         "months": months})


@router.get("/api/firms/simulate")
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
    _require_aoi(aoi, data)
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


@router.get("/api/firms/blind-spots")
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
    _require_aoi(aoi, data)
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


@router.post("/api/firms/cross-validate")
def firms_cross_validate(payload: dict):
    """Correlate the harmonized activity index with a user-supplied series.

    The bundled project has no MCD64A1 product; the endpoint accepts a
    monthly burned-area series (year, month, burned_area) and returns a
    cross-dataset consistency check, explicitly not ground-truth validation.
    """
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "raw"))
    series = payload.get("series")
    if data not in ("sample", "raw"):
        raise HTTPException(400, "valid aoi and data=sample|raw required")
    _require_aoi(aoi, data)
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


@router.get("/api/firms/spatial-check")
def firms_spatial_check(aoi: str = Query("vietnam"),
                        data: str = Query("raw", pattern="^(sample|raw)$"),
                        year: int = Query(2025, ge=2000, le=2100),
                        month: int = Query(1, ge=1, le=12),
                        res_deg: float = Query(0.25, ge=0.05, le=1.0)):
    """Coarse co-observation consistency; explicitly NOT a spatial holdout."""
    _require_aoi(aoi, data)
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


@router.get("/api/firms/evidence")
def firms_evidence(aoi: str = Query("vietnam"),
                   data: str = Query("raw", pattern="^(sample|raw)$"),
                   method: str = Query("stat", pattern="^(stat|hts|stan)$"),
                   year: int = Query(2025, ge=2000, le=2100),
                   month: int = Query(1, ge=1, le=12),
                   bbox: str | None = Query(None),
                   qa_min: str = Query("all", pattern="^(all|nominal|high)$"),
                   platform_set: str = Query("all", pattern="^(all|snpp)$"),
                   dataset: str | None = Query(None)):
    from app.main import _analysis_for_evidence
    """Evidence card for one AOI-month, from the same cells as /calendar."""
    if dataset and dataset.startswith("upload:"):
        raise HTTPException(400, detail={
            "error_code": "dataset_not_supported_here",
            "message": ("dataset only applies to calendar/map-cells/export/brief; "
                        "this endpoint does not read uploaded session datasets. "
                        "Use method=stat at one of those endpoints, e.g. "
                        "/api/firms/calendar?dataset=<id>&method=stat."),
        })
    _require_aoi(aoi, data)
    _block_raw_ml_ts(method, data, aoi)
    out = _analysis_for_evidence(aoi, data, method, bbox, qa_min, platform_set,
                                 focus_ym=f"{year}-{month:02d}")
    ev = evd.build_evidence(out, out.get("daily") or [], aoi, data, method,
                            year, month)
    return JSONResponse(ev)


@router.post("/api/firms/explain-month")
def firms_explain_month(payload: dict):
    from app.main import _analysis_for_evidence
    """LLM/rule explanation of one AOI-month, grounded on an evidence card."""
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "raw"))
    method = str(payload.get("method", "stat"))
    year = int(payload.get("year", 2025))
    month = int(payload.get("month", 1))
    _require_aoi(aoi, data)
    if data not in ("sample", "raw") or method not in ("stat", "hts", "stan"):
        raise HTTPException(400, "data must be sample|raw and method stat|hts|stan")
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
