"""FIRMS health/schema/ingest/investigate/ask routes (split from app.main — CLAIM-016, contract unchanged)."""
from __future__ import annotations

import json
import time

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from app.firms import (
    agent_tools,
    coverage as cov,
    dl,
    evidence as evd,
    explain as ex,
    firms_live,
    harmonize,
    llm,
    registry,
    store,
    turnstile,
)
from app.firms.spatial import _in_bbox, _parse_bbox
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


@router.delete("/api/firms/aois/{aoi_id}")
def firms_aois_delete(request: Request, aoi_id: str):
    """Delete a custom AOI from aois.json 'custom' (presets cannot be deleted)."""
    from app.main import _require_admin
    _require_admin(request)
    try:
        deleted = store.delete_custom_aoi(aoi_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not deleted:
        raise HTTPException(404, f"Custom AOI {aoi_id!r} not found")
    return JSONResponse({"ok": True, "deleted": aoi_id})


@router.post("/api/firms/fetch-live")
def firms_fetch_live(payload: dict):
    """Fetch live NASA FIRMS detections for a bbox and cache as live:<hex>."""
    if not isinstance(payload, dict) or "bbox" not in payload:
        raise HTTPException(
            400,
            "Provide {bbox: [w,s,e,n], days?: 1..60, end_date?: YYYY-MM-DD, from_date?: YYYY-MM-DD, to_date?: YYYY-MM-DD, sources?: [...]}",
        )
    days = payload.get("days", 5)
    end_date = payload.get("end_date")
    from_date = payload.get("from_date")
    to_date = payload.get("to_date")
    sources = payload.get("sources")
    aoi = payload.get("aoi")
    use_sample = bool(payload.get("use_sample", False))
    try:
        result = firms_live.fetch_live_firms_area(
            bbox=payload["bbox"],
            days=days,
            end_date=end_date,
            from_date=from_date,
            to_date=to_date,
            sources=sources,
            aoi=aoi,
            use_sample=use_sample,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except firms_live.FirmsLiveError as e:
        raise HTTPException(503, str(e))
    return JSONResponse(result)


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
    import json
    import time
    from app.main import _PROGRESS_LOCK, _PROGRESS_STATE, _progress_file
    """Real-time backend progress for raw/sample harmonization across workers."""
    st = None
    try:
        pf = _progress_file(aoi, data)
        if pf.exists():
            st = json.loads(pf.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        st = None
    if st is None:
        with _PROGRESS_LOCK:
            st = _PROGRESS_STATE.get(f"{aoi}:{data}")
    if st is None or (time.time() - float(st.get("updated_at", 0)) > 300):
        return {"aoi": aoi, "data": data, "stage": "idle", "percent": 0, "detail": ""}
    return st


@router.get("/api/firms/dl-info")
def firms_dl_info():
    return dl.describe()


@router.get("/api/firms/captcha-config")
def firms_captcha_config(request: Request):
    """Tell the SPA whether this viewer must solve Turnstile, and with which
    public site key. Local/direct callers get `enabled: false` so dev, e2e and
    prewarm scripts keep working without a browser."""
    enabled = turnstile.required(request)
    return {"enabled": enabled, "site_key": turnstile.site_key() if enabled else ""}


@router.post("/api/firms/ingest")
async def firms_ingest(request: Request,
                       aoi: str = Query("vietnam"), source: str = Query("upload"),
                       file: UploadFile = File(...)):
    from app.main import _require_admin
    """Upload a real FIRMS CSV: validated in chunks, stored, QA report back."""
    turnstile.enforce(request)
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
    turnstile.enforce(request)
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
def firms_investigate(request: Request, payload: dict):
    from app.main import _SENSOR_KW, _analysis_for_evidence, _sensor_context_facts
    """AI Scientific Investigator: deterministic tools first, LLM explains.

    The response lists the tools that actually ran and the limitations. The
    LLM never computes MAE/coverage; it receives the tool outputs and the
    evidence card, and the grounding guard rejects invented large numbers.
    """
    turnstile.enforce(request, payload)
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


_SATELLITE_SPECS = {
    "MODIS_resolution_km": 1,
    "MODIS_launch_year": 2000,
    "VIIRS_resolution_m": 375,
    "VIIRS_launch_year": 2012,
}

_PROJECT_CONTEXT = (
    "NASA FIRMS Fire Activity Calendar harmonizes pre-2012 MODIS (1 km) and post-2012 VIIRS (375 m) "
    "hotspot detections onto a comparable sensor-adjusted activity index (hotspot detections, NOT confirmed fires). "
    "On the map, cyan/grey dots are satellite hotspot detections and orange rings/hulls are observed hotspot clusters "
    "(not burned-area boundaries). Methods: stat (seasonal ratio k), hts (ML residual model), stan (spatio-temporal "
    "attention model). Filters: qa_min (all/nominal/high) and platform_set (all/snpp)."
)


def _compact_evaluation_for_llm(ev: dict | None) -> dict | None:
    if not isinstance(ev, dict):
        return ev
    out = {k: v for k, v in ev.items() if k != "per_aoi"}
    per_aoi = ev.get("per_aoi")
    if isinstance(per_aoi, dict):
        compact_aois = {}
        for aoi_key, aoi_val in per_aoi.items():
            if not isinstance(aoi_val, dict):
                compact_aois[aoi_key] = aoi_val
                continue
            item = {k: v for k, v in aoi_val.items() if k not in ("coverage", "unified_eval")}
            cov = aoi_val.get("coverage")
            if isinstance(cov, dict):
                item["coverage"] = {k: v for k, v in cov.items() if k != "months_detail"}
            ue = aoi_val.get("unified_eval")
            if isinstance(ue, dict):
                item["unified_eval"] = {k: v for k, v in ue.items() if k != "coverage"}
            compact_aois[aoi_key] = item
        out["per_aoi"] = compact_aois
    return out


def _normalize_preset_bbox(aoi: str, bbox: object) -> str | None:
    """Treat a bbox equal to the AOI's own preset bbox as None (full preset AOI)."""
    if not bbox:
        return None
    raw_bbox = str(bbox).strip()
    if not raw_bbox:
        return None
    preset_bbox = (store.PRESET_AOIS.get(aoi) or {}).get("bbox")
    if preset_bbox:
        try:
            a = [float(x.strip()) for x in raw_bbox.split(",")]
            b = [float(x.strip()) for x in str(preset_bbox).split(",")]
            if len(a) == 4 and len(b) == 4 and all(abs(x - y) < 1e-6 for x, y in zip(a, b)):
                return None
        except ValueError:
            pass
    return raw_bbox


@router.post("/api/firms/investigate-stream")
def firms_investigate_stream(request: Request, payload: dict):
    from app.main import _SENSOR_KW, _analysis_for_evidence, _sensor_context_facts
    """Streaming endpoint for AI Scientific Investigator."""
    turnstile.enforce(request, payload)
    q = str(payload.get("question", "")).strip()
    if not q or len(q) > 1000:
        raise HTTPException(400, "Provide question (1-1000 chars)")
    aoi = str(payload.get("aoi", "vietnam"))
    data = str(payload.get("data", "sample"))
    method = str(payload.get("method", "stat"))
    dataset = payload.get("dataset")
    dataset_str = str(dataset).strip() if dataset else None
    if not (dataset_str and (dataset_str.startswith("live:") or dataset_str.startswith("upload:"))):
        _require_aoi(aoi, data)
    if data not in ("sample", "raw") or method not in ("stat", "hts", "stan"):
        raise HTTPException(400, "data must be sample|raw and method stat|hts|stan")
    year = payload.get("year")
    month = payload.get("month")
    focus = (f"{int(year)}-{int(month):02d}"
             if year and month and 1 <= int(month) <= 12 else None)

    is_custom_dataset = bool(
        dataset_str and (dataset_str.startswith("live:") or dataset_str.startswith("upload:"))
    )
    req_bbox = _normalize_preset_bbox(aoi, payload.get("bbox"))
    has_bbox = bool(req_bbox)
    analysis_method = (
        "stat"
        if method in ("hts", "stan") and (is_custom_dataset or has_bbox)
        else method
    )

    def event_stream():
        yield f"event: status\ndata: {json.dumps({'stage': 'analyzing', 'detail': f'Routing tools for {aoi} ({data}/{analysis_method})...'}, ensure_ascii=False)}\n\n"
        ctx = agent_tools.AgentContext(
            aoi=aoi,
            data=data,
            analysis_method=analysis_method,
            requested_method=method,
            bbox=req_bbox,
            qa_min=str(payload.get("qa_min", "all")),
            platform_set=str(payload.get("platform_set", "all")),
            focus_ym=focus,
            year=int(year) if year else None,
            month=int(month) if month else None,
            dataset_str=dataset_str,
            audience_mode=str(payload.get("mode", "research")),
            lang=str(payload.get("lang", "vi")),
            analysis_fn=_analysis_for_evidence,
            eval_fn=_evaluation_facts,
            source_label_fn=_data_source_label,
            sensor_ctx_fn=_sensor_context_facts,
        )
        use_llm = bool(payload.get("use_llm", True))
        try:
            for ev in agent_tools.run_tool_agent(q, ctx, use_llm=use_llm):
                etype = ev.get("type")
                if etype == "status":
                    yield f"event: status\ndata: {json.dumps({'stage': ev.get('stage'), 'detail': ev.get('detail')}, ensure_ascii=False)}\n\n"
                elif etype == "tool":
                    yield f"event: tool\ndata: {json.dumps({'name': ev.get('name'), 'args': ev.get('args', {}), 'summary': ev.get('summary', '')}, ensure_ascii=False)}\n\n"
                elif etype == "meta":
                    yield f"event: meta\ndata: {json.dumps(ev.get('meta', {}), ensure_ascii=False)}\n\n"
                elif etype == "delta":
                    yield f"event: delta\ndata: {json.dumps({'delta': ev.get('delta', ''), 'llm_used': ev.get('llm_used', False)}, ensure_ascii=False)}\n\n"
                elif etype == "done":
                    done_payload = {"full_answer": ev.get("full_answer", ""), "status": "completed"}
                    yield f"event: done\ndata: {json.dumps(done_payload, ensure_ascii=False)}\n\n"
        except HTTPException as exc:
            err_msg = exc.detail.get("message") if isinstance(exc.detail, dict) else str(exc.detail)
            yield f"event: error\ndata: {json.dumps({'status': exc.status_code, 'message': err_msg}, ensure_ascii=False)}\n\n"
        except Exception as exc:
            yield f"event: error\ndata: {json.dumps({'status': 500, 'message': str(exc)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/firms/llm-status")
def firms_llm_status():
    return llm.available()


@router.post("/api/firms/ask-llm")
def firms_ask_llm(request: Request, payload: dict):
    """LLM explainer grounded on verified facts (falls back honestly offline)."""
    turnstile.enforce(request, payload)
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
    compact_facts = {k: v for k, v in facts.items() if k != "evaluation"}
    llm_payload = {
        "audience_mode": str(payload.get("mode", "research")),
        "project_context": _PROJECT_CONTEXT,
        "satellite_specs": _SATELLITE_SPECS,
        **compact_facts,
        "top_months": out["critical_periods"][:5],
        "evaluation": _compact_evaluation_for_llm(facts.get("evaluation")),
    }
    res = llm.ask_llm(q, llm_payload,
                      rule["answer"])
    return JSONResponse({**res, "facts": facts, "suggestions": rule["suggestions"]})


@router.post("/api/firms/ask")
def firms_ask(request: Request, payload: dict):
    """Offline assistant: explains algorithm/data/accuracy from live numbers."""
    turnstile.enforce(request, payload)
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
