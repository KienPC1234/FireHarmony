"""Harmonized FIRMS pipeline (CLAIM-019).

Owns the calendar-building pipeline previously living in `app.main`:
record resolution, raw aggregation, streaming harmonization and the small
label/gate helpers routers need. `app.main` re-exports these names so
`from app.main import _harmonize_stream` callers keep working; routers import
forward from here (`app.firms.pipeline`), never backward from `app.main`.
No logic, message, key, default, limit or cache-key changed.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from fastapi import HTTPException

from app.firms import calendar as cal
from app.firms import (coverage as cov, evaluation, harmonize, hts, ml_cal,
                        stan, store)
from app.firms.schema import FirmsRecord
from app.firms.service import (_activity_summary, _empty_month_slot,
                                _forecast, _latest_summary, _slot_add)
from app.firms.spatial import (_geometry_hash, _in_dates, _parse_bbox,
                                _point_in_geometry, _row_in_scope)

# CLAIM-019: same values as app.main (pipeline must not import main at top).
PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = PROJECT_ROOT / "data" / "firms" / "models"



def _require_aoi(aoi: str, data: str = "sample") -> None:
    """Preset + manifest-backed custom AOIs pass; unknown ids fail loudly.

    Sample data exists only for presets (400, same as before). Raw data for
    an unknown id with no manifest entries and no raw files is 404
    no_raw_data, never invented numbers; with a manifest it serves (200).
    """
    if store.is_known_aoi(aoi):
        return
    if data == "raw":
        raise HTTPException(404, detail={
            "error_code": "no_raw_data",
            "message": f"No raw FIRMS data on this server for aoi={aoi}. "
                       "Use data=sample for the synthetic demo, or fetch a month first.",
            "aoi": aoi})
    raise HTTPException(400, f"Unknown sample aoi {aoi!r}; register it via POST /aois "
                             f"(requires admin) or use ?dataset=upload:<id> for an uploaded "
                             f"session dataset, or a bbox+stat slice; "
                             f"known presets: {sorted(store.aoi_registry())}")


def _sample_records(limit: int = 500, aoi: str = "vietnam") -> list[dict]:
    if aoi not in store.aoi_registry():
        raise HTTPException(400, f"Unknown sample aoi {aoi!r}; register it via POST /aois "
                                 f"(requires admin) or use ?dataset=upload:<id> for an uploaded "
                                 f"session dataset, or a bbox+stat slice; "
                                 f"known presets: {sorted(store.aoi_registry())}")
    try:
        return store.load_records(aoi, limit)
    except ValueError as e:
        raise HTTPException(400, str(e))


def _artifact_availability() -> dict:
    """Report the three served paths from artifact FILES (no import alone)."""
    from app.main import MODEL_DIR  # CLAIM-019: single source in main; deferred to avoid cycle (tests patch it)
    stan_series = (MODEL_DIR / "stan_series_raw.json").exists()
    hts_series = (MODEL_DIR / "hts_series_raw.json").exists()
    return {
        "stat": True,
        "stan": stan_series,
        "hts": hts_series,
        "primary": stan_series,
        "baseline": True,
        "fallback": hts_series,
    }


def _evaluation_facts(aoi: str, data: str) -> dict:
    from app.main import MODEL_DIR, _stan_meta  # CLAIM-019: constants/meta stay in main; deferred to avoid cycle
    m = evaluation.load_manifest(data, MODEL_DIR)
    if not m:
        return {}
    per = (m.get("per_aoi") or {}).get(aoi) or {}
    stan_m = _stan_meta("safe") if data == "raw" else None
    facts = {
        "evaluation_version": m.get("evaluation_version"),
        "test_years": per.get("test_years") or m.get("test_years"),
        "n_eval": m.get("n_eval"),
        "eval_unit": m.get("eval_unit"),
        "pooled_metrics": (m.get("pooled") or {}).get("metrics", {}),
        "pooled_full_month": m.get("pooled_full_month"),
        "per_aoi": {aoi: per},
    }
    if stan_m:
        off = evaluation.official_summary(m)
        facts["stan_official"] = off
        facts["stan_headline"] = off.get("headline")
        facts["stan_vs_b2"] = off.get("comparisons", {}).get("stan_vs_b2")
        facts["stan_per_aoi"] = (off.get("per_aoi") or {}).get(aoi)
    return facts


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
        if aoi != "custom" and not store.is_known_aoi(aoi):
            raise HTTPException(400, f"Unknown aoi {aoi!r}")
        return store.load_raw_merged(aoi, limit)
    return _sample_records(limit, aoi)


def _data_source_label(data: str, dataset: str | None = None) -> str:
    if dataset or data == "upload":
        return "user-uploaded session dataset (unverified source)"
    return ("synthetic demo (NOT observed: do not claim real events)"
            if data == "sample" else "NASA FIRMS observed")


def _covered_targets(aoi: str, targets: dict[str, float]) -> tuple[dict[str, float], int, list[str]]:
    """Exclude verified-partial months so they keep their statistical value."""
    cov_map = cov.coverage_for_aoi(aoi) or {}
    kept: dict[str, float] = {}
    skipped: list[str] = []
    for ym, val in targets.items():
        info = cov_map.get(ym)
        if info is not None and info.get("partial"):
            skipped.append(ym)
        else:
            kept[ym] = val
    return kept, len(skipped), skipped


def _block_raw_ml_ts(method: str, data: str, aoi: str = "vietnam") -> None:
    """HTS/STAN series must match the current tile dataset and code version.

    File existence alone used to be enough, so an artifact built from an older
    pull kept serving. A stale series now fails loudly (409).
    """
    from app.main import MODEL_DIR, PROJECT_ROOT  # CLAIM-019: constants live in main; deferred to avoid cycle (tests patch them)
    if method in ("hts", "stan"):
        if data != "raw":
            raise HTTPException(
                409, f"{method.upper()} requires raw NASA data for its AOI-level monthly targets; "
                     "the synthetic sample has no 1-degree tiles. "
                     "Use method=stat for the sample (stat works on any "
                     "bbox, polygon, or date subset).")
        check = ((MODEL_DIR / "hts_series_raw.json") if method == "hts"
                 else (MODEL_DIR / "stan_series_raw.json"))
        if not check.exists():
            hint = ("python -m scripts.firms.build_hts_series"
                    if method == "hts" else
                    "python -m scripts.firms.build_stan_series")
            raise HTTPException(422, f"no {method} series artifact; run {hint}")
        tile = PROJECT_ROOT / "data" / "firms" / "benchmark" / "tile_pairs_raw.csv"
        if tile.exists():
            try:
                meta = json.loads(check.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                meta = {}
            expected = hashlib.sha256(tile.read_bytes()).hexdigest()
            if meta.get("dataset_sha256") != expected:
                hint = ("python -m scripts.firms.build_hts_series"
                        if method == "hts" else
                        "python -m scripts.firms.build_stan_series")
                raise HTTPException(
                    409, f"{method} series artifact is stale for current tile_pairs_raw.csv; run {hint}")
            want_ver = (stan.ALGORITHM_VERSION if method == "stan"
                        else hts.ALGORITHM_VERSION)
            if meta.get("algorithm_version") and meta["algorithm_version"] != want_ver:
                raise HTTPException(
                    409, f"{method} series algorithm {meta['algorithm_version']} != "
                         f"code {want_ver}; run python -m scripts.firms.retrain_all")
        return
    return


def _raw_agg(aoi: str, bbox=None, qa_min: str = "all",
             platform_set: str = "all", year: int | None = None,
             ym: str | None = None, geom: dict | None = None,
             source_type: str = "all"):
    """Aggregate raw rows for one AOI without materialising cell-day dicts."""
    b = _parse_bbox(bbox) if isinstance(bbox, str) else bbox

    def rows():
        for r in store.iter_raw_rows(aoi, limit=None, year=year, ym=ym):
            if not _row_in_scope(r, b, geom):
                continue
            yield r

    return harmonize.aggregate_iter(rows(), qa_min=qa_min,
                                    platform_set=platform_set,
                                    source_type=source_type)


def _harmonize_stream(aoi: str, data: str, bbox, method: str = "stat",
                      daily_cap: int = 2000, qa_min: str = "all",
                      platform_set: str = "all",
                      focus_ym: str | None = None,
                      simulate_year: int | None = None,
                      simulate_configs: list[dict] | None = None,
                      cache_result: bool = True,
                      geom: dict | None = None,
                      from_date: str | None = None,
                      to_date: str | None = None,
                      source_type: str = "all") -> dict:
    """Memory-bounded pipeline for large raw pulls (1.4M+ rows).

    Validates, dedups and aggregates while streaming from disk; only the
    monthly ML context and the final daily cells are retained.
    """
    from app.main import MODEL_DIR, _set_progress  # CLAIM-019: constants/progress stay in main; deferred to avoid cycle
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
    if method in ("hts", "stan"):
        mp = MODEL_DIR / {"hts": "hts_series_raw.json",
                          "stan": "stan_series_raw.json"}[method]
        if mp.exists():
            model_key = hashlib.sha256(mp.read_bytes()).hexdigest()[:10]
    manifest_key = "none"
    if store.MANIFEST.exists():
        manifest_key = hashlib.sha256(store.MANIFEST.read_bytes()).hexdigest()[:12]
    sim_key = (hashlib.sha256(json.dumps(simulate_configs or [],
                                          sort_keys=True).encode()).hexdigest()[:8]
               if simulate_configs else "nosim")
    geom_key = _geometry_hash(geom)
    ckey = (f"cal_{aoi}_{method}_{fp}_{bbox or 'all'}_{cache_cap}_"
            f"{qa_min}_{platform_set}_{source_type}_{focus_ym or 'all'}_{simulate_year or 'nosim'}_"
            f"{model_key}_{manifest_key}_{sim_key}_{geom_key}_"
            f"{from_date or 'all'}_{to_date or 'all'}_sum-v3_"
            f"{harmonize.ALGORITHM_VERSION}_{hts.ALGORITHM_VERSION}_"
            f"{stan.ALGORITHM_VERSION}_{harmonize.cache_behavior()}")

    def _finish(d: dict) -> dict:
        cap = int(daily_cap or 0)
        if cap == 0:
            d = {**d, "daily": []}
        elif len(d.get("daily") or []) > cap:
            d = {**d, "daily": d["daily"][:cap]}
        d = {**d, "summary": _activity_summary(
            d, data=data, method=method, aoi=aoi, bbox=bbox,
            qa_min=qa_min, platform_set=platform_set, dataset=None,
            geom_hash=geom_key, from_date=from_date, to_date=to_date,
            source_type=source_type)}
        return d

    _set_progress(aoi, data, "checking_cache", 15, f"Checking cached {aoi} {method.upper()} series...")
    hit = store.cache_get(ckey) if cache_result else None
    if hit is not None:
        _set_progress(aoi, data, "done", 100, "Loaded from cache")
        return _finish(hit)
    _set_progress(aoi, data, "aggregating", 35, f"Scanning and aggregating {aoi} FIRMS rows...")
    keep = None
    def rows():
        n_scanned = 0
        for r in store.iter_raw_rows(aoi, limit=None, year=simulate_year, ym=focus_ym):
            n_scanned += 1
            if n_scanned % 25000 == 0:
                pct = min(70, 35 + (n_scanned // 25000) * 3)
                _set_progress(aoi, data, "aggregating", pct, f"Scanning {n_scanned:,} FIRMS rows for {aoi}...")
            if not _row_in_scope(r, b, geom):
                continue
            yield r
    agg, stats = harmonize.aggregate_iter(rows(), keep_clean=keep,
                                          qa_min=qa_min,
                                          platform_set=platform_set,
                                          source_type=source_type)
    if not agg:
        _set_progress(aoi, data, "done", 100, "No matching rows")
        raise HTTPException(404, detail={
            "error_code": "no_raw_data",
            "message": f"No raw FIRMS rows available for aoi={aoi}. "
                       "Fetch a full month first (scripts/firms/fetch_full_month).",
            "aoi": aoi})
    _set_progress(aoi, data, "calibrating", 75, f"Running {method.upper()} calibration & monthly ratios...")
    ratios = harmonize.estimate_efficiency_ratio(agg)
    # A focus-month request only parses that month's files (fast path), so its
    # month-k is identical but the cross-month dispersion (`_fallback_rel_iqr`)
    # is not. Reuse the full-run calibration cached by any earlier full request
    # so evidence cards and the calendar quote the same uncertainty.
    ratio_key = (f"ratios_{aoi}_{fp}_{harmonize.ALGORITHM_VERSION}_"
                 f"fusion_{qa_min}_{platform_set}_{source_type}_"
                 f"{harmonize.cache_behavior()}")
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
    if method == "hts":
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
        bands = stan.bands(aoi)
        cell_days, ml_meta = hts.apply_monthly(
            harmonize.harmonize_daily(agg, ratios), targets,
            method_id="stan_safe_v1", requested="stan",
            candidate=False, gate_passed=True,
            method_by_month=stan.sources(aoi),
            targets_low={k: v[0] for k, v in bands.items()},
            targets_high={k: v[1] for k, v in bands.items()})
        ml_meta["interval"] = stan.interval_status()
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
        "_calibration_note", "_calibration_min_months", "_clipped_months", "_clipped_fraction",
        "_mode", "_calibration_window", "_train_end", "_sensor_set",
        "_data_version", "_excluded_months")}
    out = {"daily_cells": n_cells, "ratios": ratios, "calendar": calen,
           # Top-level alias for old frontend readers; calendar.platform_mix
           # stays the canonical location (frontend prefers nested).
           "platform_mix": dict(calen.get("platform_mix", {})),
           "critical_periods": crit[:24], "latest": latest,
           "forecast": _forecast(calen, latest["date"] if latest else None),
           "data_source": _data_source_label(data),
           "method_id": {"stat": "seasonal_ratio_v1",
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
    _set_progress(aoi, data, "done", 100, "Calibration complete")
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
                              bbox: str | None = None,
                              source_type: str = "all") -> dict:
    """Validate -> QA -> dedup -> harmonize. Single path for sample/raw/upload (P0-07)."""
    _block_raw_ml_ts(method, data, aoi)
    if method in ("hts", "stan"):
        raise HTTPException(409, f"{method.upper()} is not available for uploaded "
                                 "datasets; use method=stat")
    clean: list[dict] = []
    rejected = 0
    qa_counts: dict[str, int] = {}
    filtered_low = filtered_conf = filtered_plat = filtered_source = 0
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
        if source_type == "land" and rec.type == 3:
            filtered_source += 1
            continue
        if source_type == "vegetation" and rec.type in (1, 2, 3):
            filtered_source += 1
            continue
        clean.append(d)
    agg = harmonize.aggregate(clean)
    ratios = harmonize.estimate_efficiency_ratio(agg)
    ml_meta = None
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
        "_calibration_note", "_calibration_min_months", "_clipped_months", "_clipped_fraction",
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
            "calendar": calen,
            # Top-level alias for old frontend readers; calendar.platform_mix
            # stays the canonical location (frontend prefers nested).
            "platform_mix": dict(calen.get("platform_mix", {})),
            "critical_periods": crit[:24],
            "latest": latest,
            "forecast": _forecast(calen, latest["date"] if latest else None),
            "data_source": _data_source_label(data),
            "method_id": ({"hts": "hts_anchor_v1",
                           "stan": "stan_safe_v1"}.get(method, "seasonal_ratio_v1")),
            "effective_method": (ml_meta or {}).get("effective_method",
                                                    "seasonal_ratio_v1"),
            "calibration": calibration,
            "validation_unit": "aoi-month",
            "spatial_validation": "not_identified_from_monthly_pairs",
            "filters": {"qa_min": qa_min, "platform_set": platform_set,
                        "source_type": source_type},
            "ml_meta": ml_meta,
            "coverage": (cov.coverage_summary(aoi) if (data == "raw" and not dataset) else
                         {"verified": False, "reason": "sample_or_upload"}),
            "qa": {"clean": len(clean), "rejected": rejected,
                   "filtered_low_confidence": filtered_low,
                   "filtered_confidence": filtered_conf,
                   "filtered_platform": filtered_plat,
                   "filtered_source_type": filtered_source,
                   "qa_counts": qa_counts},
            "daily": daily[:daily_cap] if daily_cap else []}
    out["summary"] = _activity_summary(
        out, data=data, method=method, aoi=aoi, bbox=bbox,
        qa_min=qa_min, platform_set=platform_set, dataset=dataset,
        geom_hash=_geometry_hash(geom), from_date=from_date, to_date=to_date,
        source_type=source_type)
    return out
