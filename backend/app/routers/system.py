"""FIRMS health/schema/ingest/investigate/ask routes (split from app.main — CLAIM-016, contract unchanged)."""
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
from app.firms.pipeline import (_artifact_availability, _block_raw_ml_ts, _data_source_label, _evaluation_facts, _harmonize_from_records, _harmonize_stream, _require_aoi, _resolve_records, _sample_records)

router = APIRouter()


@router.get("/api/health")
def health():
    from app.main import _STARTED
    availability = _artifact_availability()
    return {"status": "ok", "service": "firms-calendar",
            "uptime_s": round(time.time() - _STARTED, 1),
            "torch": dl.describe()["has_torch"],
            "primary_method_id": registry.PRIMARY,
            "baseline_method_id": registry.BASELINE,
            "methods_available": {"stat": availability["stat"],
                                  "stan": availability["stan"],
                                  "hts": availability["hts"]},
            "methods_detail": availability}


@router.get("/api/firms/aois")
def firms_aois():
    """Preset + custom AOIs with bbox, fetched months and coverage class."""
    out = []
    for aid in sorted(set(store.aoi_registry()) | cov.manifest_aois()):
        entry = store.aoi_registry().get(aid, {})
        cover = cov.coverage_for_aoi(aid)
        full = sum(1 for c in cover.values() if not c.get("partial"))
        if not cover:
            coverage_class = "unknown"
        elif len(cover) == full and all(
                c.get("coverage_status") == "complete" for c in cover.values()):
            coverage_class = "complete"
        elif full > 0:
            coverage_class = "usable"
        else:
            coverage_class = "incomplete"
        out.append({"id": aid, "label": entry.get("label", aid),
                    "bbox": entry.get("bbox") or store.aoi_bbox(aid),
                    "months": len(cover),
                    "coverage_class": coverage_class,
                    "dataset_ready": store.raw_ready(aid)})
    return {"aois": out}


@router.post("/api/firms/aois")
def firms_aois_create(request: Request, payload: dict):
    from app.main import _require_admin
    """Register a custom AOI: {id?, label, bbox:[minLon,minLat,maxLon,maxLat]}.

    Validates the bbox range/order, slugifies the id, and appends to the
    'custom' group of aois.json with an atomic write (presets win on
    conflict). Fresh entries report dataset_ready=false until a fetch lands.
    """
    _require_admin(request)
    if not isinstance(payload, dict):
        raise HTTPException(400, "Provide {label, bbox:[minLon,minLat,maxLon,maxLat]}")
    try:
        created = store.register_custom_aoi(
            payload.get("id"), payload.get("label", ""), payload.get("bbox"))
    except ValueError as e:
        msg = str(e)
        raise HTTPException(409 if "already exists" in msg else 400, msg)
    return JSONResponse(created)


@router.get("/api/firms/schema")
def firms_schema():
    return {"fields": list(FirmsRecord.model_fields.keys()),
            "instruments": ["MODIS", "VIIRS"],
            "notes": "Field names match NASA FIRMS CSV headers (lowercased)."}


@router.get("/api/firms/sample")
def firms_sample(limit: int = Query(200, ge=1, le=2000),
                 aoi: str = Query("vietnam", description="preset region")):
    rows = _sample_records(limit, aoi)
    return {"count": len(rows), "records": rows}


@router.post("/api/firms/validate")
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


@router.post("/api/firms/harmonize")
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
    if method not in ("stat", "hts", "stan"):
        raise HTTPException(400, "method must be stat|hts|stan")
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
                      "hts": "daily 0.05deg grid + hierarchical 1-degree tile seasonal anchor (hts_anchor_v1, candidate); MODIS-only cells are rescaled to the tile target, VIIRS-observed cells are untouched",
                      "stan": "daily 0.05deg grid + STAN spatial-temporal negative-binomial model (stan_safe_v1, main); STAN targets for 2024+ with HTS fallback before 2024; VIIRS-observed cells are untouched"}[method])
    return JSONResponse(out)


@router.get("/api/firms/progress")
def firms_progress(aoi: str = Query("vietnam"),
                   data: str = Query("raw", pattern="^(sample|raw)$")):
    from app.main import _PROGRESS_LOCK, _PROGRESS_STATE
    """Real-time backend progress for raw/sample harmonization."""
    with _PROGRESS_LOCK:
        st = _PROGRESS_STATE.get(f"{aoi}:{data}")
    if st is None:
        return {"aoi": aoi, "data": data, "stage": "idle", "percent": 0, "detail": ""}
    return st


@router.get("/api/firms/dl-info")
def firms_dl_info():
    return dl.describe()


@router.post("/api/firms/ingest")
async def firms_ingest(request: Request,
                       aoi: str = Query("vietnam"), source: str = Query("upload"),
                       file: UploadFile = File(...)):
    from app.main import _require_admin
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


@router.post("/api/firms/upload-dataset")
async def firms_upload_dataset(request: Request, file: UploadFile = File(...)):
    from app.main import _require_admin
    """Session upload (P1-18): streamed with a 50 MB cap, validated, returns
    dataset_id for /calendar?dataset=upload:<id>. Gated when ADMIN_TOKEN set."""
    _require_admin(request)
    import hashlib as _hl
    import time as _t
    max_bytes = 50 * 1024 * 1024
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
                    raise ValueError("File too large (>50 MB session cap)")
                digest.update(ch)
                fh.write(ch)
        report = store.register_upload_file(
            tmp, file.filename or "upload.csv", size, digest.hexdigest())
        return JSONResponse({**report, "calendar_url": f"/calendar?dataset={report['dataset_id']}"})
    except ValueError as e:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, str(e))


@router.get("/api/firms/qa-summary")
def firms_qa_summary(aoi: str = Query("vietnam"),
                     data: str = Query("raw", pattern="^(sample|raw)$"),
                     limit: int = Query(200000, ge=1000, le=2000000)):
    """Confidence/platform mix for a bounded prefix (filter sensitivity)."""
    _require_aoi(aoi, data)
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


@router.get("/api/firms/dedup-sensitivity")
def firms_dedup_sensitivity(aoi: str = Query("vietnam"),
                            data: str = Query("raw", pattern="^(sample|raw)$"),
                            limit: int = Query(200000, ge=1000, le=1000000)):
    """Exact vs pixel-day dedup collision bound (audit P1-08)."""
    _require_aoi(aoi, data)
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


@router.post("/api/firms/investigate")
def firms_investigate(payload: dict):
    from app.main import _SENSOR_KW, _analysis_for_evidence, _sensor_context_facts
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
    _require_aoi(aoi, data)
    if data not in ("sample", "raw") or method not in ("stat", "hts", "stan"):
        raise HTTPException(400, "data must be sample|raw and method stat|hts|stan")
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
    sensor_ctx = _sensor_context_facts(aoi, facts) if any(w in q.lower() for w in _SENSOR_KW) else None
    if sensor_ctx:
        tools_used.append("sensor_context")
    rule = ex.answer(q, facts, out["critical_periods"], out["latest"], dl.describe())
    llm_facts = {**facts, "evidence": evidence,
                 "top_months": out["critical_periods"][:5],
                 "tools_used": tools_used,
                 **({"sensor_context": sensor_ctx} if sensor_ctx else {}),
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


@router.post("/api/firms/investigate-stream")
def firms_investigate_stream(payload: dict):
    from app.main import _SENSOR_KW, _analysis_for_evidence, _sensor_context_facts
    """Streaming endpoint for AI Scientific Investigator."""
    q = str(payload.get("question", "")).strip()
    if not q or len(q) > 1000:
        raise HTTPException(400, "Provide question (1-1000 chars)")
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "sample"))
    method = str(payload.get("method", "stat"))
    _require_aoi(aoi, data)
    if data not in ("sample", "raw") or method not in ("stat", "hts", "stan"):
        raise HTTPException(400, "data must be sample|raw and method stat|hts|stan")
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
    sensor_ctx = _sensor_context_facts(aoi, facts) if any(w in q.lower() for w in _SENSOR_KW) else None
    if sensor_ctx:
        tools_used.append("sensor_context")
    rule = ex.answer(q, facts, out["critical_periods"], out["latest"], dl.describe())
    llm_facts = {**facts, "evidence": evidence,
                 "top_months": out["critical_periods"][:5],
                 "tools_used": tools_used,
                 **({"sensor_context": sensor_ctx} if sensor_ctx else {}),
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


@router.get("/api/firms/llm-status")
def firms_llm_status():
    return llm.available()


@router.post("/api/firms/ask-llm")
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
    if method not in ("stat", "hts", "stan"):
        raise HTTPException(400, "method must be stat|hts|stan")
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


@router.post("/api/firms/ask")
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
    if method not in ("stat", "hts", "stan"):
        raise HTTPException(400, "method must be stat|hts|stan")
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
