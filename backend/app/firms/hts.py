"""Serving helpers for the hierarchical tile-seasonal anchor (HTS).

HTS is a candidate method: it improves the point estimate on every AOI but its
95% CI still includes zero, so it is labelled as a candidate and is never
silently substituted for the statistical baseline.
"""
from __future__ import annotations

import json
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "firms" / "models"
SERIES_FILE = "hts_series_raw.json"


def series_path(model_dir: Path | None = None) -> Path:
    return (model_dir or MODEL_DIR) / SERIES_FILE


_HTS_CACHE: tuple[float, str, dict] | None = None


def load_series(model_dir: Path | None = None) -> dict | None:
    global _HTS_CACHE
    p = series_path(model_dir)
    if not p.exists():
        return None
    try:
        mtime = p.stat().st_mtime
    except OSError:
        return None
    if _HTS_CACHE is not None and _HTS_CACHE[0] == mtime and _HTS_CACHE[1] == str(p):
        return _HTS_CACHE[2]
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        _HTS_CACHE = (mtime, str(p), data)
        return data
    except (OSError, json.JSONDecodeError):
        return None


def targets(aoi: str, model_dir: Path | None = None) -> dict[str, float]:
    data = load_series(model_dir)
    if not data:
        return {}
    return {ym: float(v["hts"])
            for ym, v in (data.get("series", {}).get(aoi) or {}).items()}


def status(model_dir: Path | None = None) -> dict:
    data = load_series(model_dir)
    if not data:
        return {"available": False, "method_id": "hts_anchor_v1",
                "hint": "python -m scripts.firms.build_hts_series"}
    return {
        "available": True,
        "method_id": data.get("method_id"),
        "algorithm_version": data.get("algorithm_version"),
        "candidate": True,
        "months": data.get("months"),
        "cutoff_rule": data.get("cutoff_rule"),
        "dataset_sha256": data.get("dataset_sha256"),
    }


def apply_monthly(daily_stat: list[dict], targets_by_month: dict[str, float],
                  method_id: str = "hts_anchor_v1",
                  requested: str = "hts",
                  candidate: bool = True,
                  gate_passed: bool = False,
                  method_by_month: dict[str, str] | None = None) -> tuple[list[dict], dict]:
    """Rescale MODIS-only cells so each month totals the HTS target.

    VIIRS-observed cells are never changed; only the estimated part is
    redistributed, exactly like the ML/TS post-adjustment paths.
    """
    month_totals: dict[str, list[float]] = {}
    for c in daily_stat:
        ym = str(c["date"])[:7]
        slot = month_totals.setdefault(ym, [0.0, 0.0])
        slot[0] += float(c["harmonized_count"])
        if c.get("estimate_type") == "modis_upscaled_estimated":
            slot[1] += float(c["harmonized_count"])
    factors: dict[str, float] = {}
    targets_used: dict[str, float] = {}
    missing: list[str] = []
    below: list[str] = []
    for ym in sorted(month_totals):
        target = targets_by_month.get(ym)
        if target is None:
            missing.append(ym)
            continue
        stat_total, modis_only = month_totals[ym]
        observed_part = stat_total - modis_only
        target_est = target - observed_part
        if modis_only > 0 and target_est > 0:
            factors[ym] = target_est / modis_only
            targets_used[ym] = target
        else:
            below.append(ym)
    for c in daily_stat:
        ym = str(c["date"])[:7]
        if c.get("estimate_type") == "modis_upscaled_estimated" and ym in factors:
            c["harmonized_count"] = round(c["harmonized_count"] * factors[ym], 3)
            c["estimate_type"] = "hts_predicted"
            mid = (method_by_month or {}).get(ym, method_id)
            c["method"] = mid
            c["effective_method"] = mid
            c["coverage_status"] = "unknown"
        else:
            c["effective_method"] = "stat:seasonal_ratio_v1"
    conservation = []
    for ym in factors:
        total = sum(float(c["harmonized_count"]) for c in daily_stat
                    if str(c["date"])[:7] == ym)
        conservation.append(abs(total - targets_used[ym]))
    return daily_stat, {
        "requested_method": requested,
        "effective_method": method_id,
        "model_method_id": method_id,
        "candidate": candidate,
        "gate_passed": gate_passed,
        "months_requested": len(month_totals),
        "months_scored": len(factors),
        "months_missing_target": len(missing),
        "missing_target_examples": missing[:12],
        "months_without_modis_only_cells": len(below),
        "months_corrected": len(factors),
        "conservation_max_abs_error": round(max(conservation), 4) if conservation else 0.0,
        "month_effective_method": {ym: (method_by_month or {}).get(ym, method_id)
                                   for ym in factors},
    }
