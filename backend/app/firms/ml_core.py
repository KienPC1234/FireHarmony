"""Shared ML primitives: one copy of the math every model used to re-implement.

Before this module, `_metrics`, `_delta_ci`, the B2/B1 log-ratio estimate and the
"rescale only the estimated cells" conservation step existed in 3-4 copies
(`evaluation`, `stan`, `sf_tile`, `hts`, `main`). Divergence there is how
the served number and the published number drift apart, so the canonical
implementations live here and every caller imports them.

No torch, no sklearn, no FastAPI: pure numpy/math, safe to import anywhere.
"""
from __future__ import annotations

import math

import numpy as np

# One served model. Everything else in the repo is a baseline, a comparator or
# an archived negative result (see `app.firms.registry`).
PRIMARY_METHOD_ID = "stan_safe_v1"
BASELINE_METHOD_ID = "b2_seasonal_ratio"
STAT_METHOD_ID = "seasonal_ratio_v1"


def counts_from_log_ratio(modis: float, log_ratio: float) -> float:
    """Inverse of log((viirs+1)/(modis+1)); the only count-space inverse."""
    return max(math.exp(float(log_ratio)) * (max(float(modis), 0.0) + 1.0) - 1.0, 0.0)


def counts_from_log_ratio_array(modis, log_ratio):
    """Vectorised twin of `counts_from_log_ratio` (same formula, no drift)."""
    m = np.asarray(modis, dtype=float)
    r = np.asarray(log_ratio, dtype=float)
    return np.clip(np.exp(r) * (m + 1.0) - 1.0, 0.0, None)


def log_ratio(viirs: float, modis: float) -> float:
    """log((VIIRS+1)/(MODIS+1)); the only forward ratio transform."""
    return math.log((float(viirs) + 1.0) / (float(modis) + 1.0))


def ratios_from_train(train: list[dict]) -> tuple[float, dict[int, float]]:
    """B1 global log-ratio and B2 per-month log-ratio, fit on train rows only."""
    logs = [log_ratio(p["viirs"], p["modis"]) for p in train if p["modis"] > 0]
    b1 = float(np.median(logs)) if logs else 0.0
    by_m: dict[int, float] = {}
    for m in range(1, 13):
        rs = [log_ratio(p["viirs"], p["modis"])
              for p in train if int(p["month"]) == m and p["modis"] > 0]
        if rs:
            by_m[m] = float(np.median(rs))
    return b1, by_m


def metrics_raw(y_true, y_pred) -> dict:
    """Unrounded MAE/WAPE/bias in count space (training-time diagnostics)."""
    y = np.asarray(y_true, dtype=float)
    p = np.asarray(y_pred, dtype=float)
    err = p - y
    denom = float(np.sum(y)) or 1.0
    return {"mae": float(np.mean(np.abs(err))),
            "wape": float(np.sum(np.abs(err)) / denom),
            "bias": float(np.mean(err))}


def metrics(y_true, y_pred) -> dict:
    """MAE/WAPE/bias in count space, rounded for JSON artifacts."""
    m = metrics_raw(y_true, y_pred)
    return {"mae": round(m["mae"], 4), "wape": round(m["wape"], 6),
            "bias": round(m["bias"], 4), "n": int(len(np.asarray(y_true)))}


def delta_ci(samples: list[dict], method_a: str, method_b: str,
             n_boot: int = 2000, seed: int = 7,
             block: str | None = None) -> dict | None:
    """Bootstrap of ΔMAE (A − B); negative means A is better.

    Default resamples AOI-month rows. `block="year"` resamples whole years,
    which respects within-year correlation but is coarse with two years.
    """
    rows = [s for s in samples
            if s.get(method_a) is not None and s.get(method_b) is not None]
    if len(rows) < 8:
        return None
    rng = np.random.default_rng(seed)
    y_all = np.array([s["viirs_ref"] for s in rows], dtype=float)
    pa_all = np.array([s[method_a] for s in rows], dtype=float)
    pb_all = np.array([s[method_b] for s in rows], dtype=float)
    deltas = []
    if block:
        keys = sorted({s.get(block) for s in rows}, key=str)
        groups = {k: [i for i, s in enumerate(rows) if s.get(block) == k]
                  for k in keys}
        for _ in range(n_boot):
            pick = rng.integers(0, len(keys), len(keys))
            idx = np.array([i for p in pick for i in groups[keys[p]]], dtype=int)
            deltas.append(float(np.mean(np.abs(pa_all[idx] - y_all[idx])) -
                                np.mean(np.abs(pb_all[idx] - y_all[idx]))))
        unit = (f"{block}-block cluster bootstrap ({len(keys)} blocks; "
                "coarse, respects within-block correlation)")
    else:
        for _ in range(n_boot):
            idx = rng.integers(0, len(rows), len(rows))
            deltas.append(float(np.mean(np.abs(pa_all[idx] - y_all[idx])) -
                                np.mean(np.abs(pb_all[idx] - y_all[idx]))))
        unit = "AOI-month row bootstrap (not independent hotspots)"
    deltas = np.array(deltas)
    return {
        "method_a": method_a, "method_b": method_b,
        "delta_mae": round(float(np.mean(np.abs(pa_all - y_all)) -
                                 np.mean(np.abs(pb_all - y_all))), 4),
        "ci95": [round(float(np.percentile(deltas, 2.5)), 4),
                 round(float(np.percentile(deltas, 97.5)), 4)],
        "prob_a_better": round(float(np.mean(deltas < 0)), 4),
        "n": len(rows), "n_boot": n_boot,
        "unit": unit,
    }


def apply_monthly_targets(
    daily: list[dict],
    targets_by_month: dict[str, float],
    *,
    estimate_label: str,
    method_id: str,
    requested: str,
    candidate: bool = False,
    gate_passed: bool = False,
    method_by_month: dict[str, str] | None = None,
    targets_low: dict[str, float] | None = None,
    targets_high: dict[str, float] | None = None,
    band_status: str = "model_band",
    labels_by_month: dict[str, str] | None = None,
    untouched_method: str = "stat:seasonal_ratio_v1",
) -> tuple[list[dict], dict]:
    """Rescale MODIS-only cells so each month totals its model target.

    VIIRS-observed cells are never changed: only the estimated part is
    redistributed. This is the single conservation implementation shared by
    STAN, HTS, HGB-v4 (`ml`) and the Transformer (`ts`); before it existed each
    path carried its own copy, and only some of them reported conservation.

    Mutates `daily` in place on purpose: a second 600k-cell copy doubles peak
    memory on the raw Vietnam pull.
    """
    month_totals: dict[str, list[float]] = {}
    for c in daily:
        ym = str(c["date"])[:7]
        slot = month_totals.setdefault(ym, [0.0, 0.0])
        slot[0] += float(c["harmonized_count"])
        if c.get("estimate_type") == "modis_upscaled_estimated":
            slot[1] += float(c["harmonized_count"])
    factors: dict[str, float] = {}
    targets_used: dict[str, float] = {}
    bands: dict[str, tuple[float, float]] = {}
    missing: list[str] = []
    below: list[str] = []
    for ym in sorted(month_totals):
        target = targets_by_month.get(ym)
        if target is None:
            missing.append(ym)
            continue
        stat_total, modis_only = month_totals[ym]
        observed_part = stat_total - modis_only
        target_est = float(target) - observed_part
        if modis_only > 0 and target_est > 0:
            factors[ym] = target_est / modis_only
            targets_used[ym] = float(target)
            if targets_low and targets_high:
                lo = float(targets_low.get(ym, target)) - observed_part
                hi = float(targets_high.get(ym, target)) - observed_part
                if hi > 0 and lo < target_est:
                    bands[ym] = (max(lo, 0.0), max(hi, lo))
        else:
            below.append(ym)
    for c in daily:
        ym = str(c["date"])[:7]
        if c.get("estimate_type") == "modis_upscaled_estimated" and ym in factors:
            c["harmonized_count"] = round(c["harmonized_count"] * factors[ym], 3)
            cell_km2 = c.get("cell_km2")
            if cell_km2 is not None and float(cell_km2) > 0:
                c["harmonized_per_km2"] = round(c["harmonized_count"] / float(cell_km2), 4)
            c["estimate_type"] = (labels_by_month or {}).get(ym, estimate_label)
            mid = (method_by_month or {}).get(ym, method_id)
            c["method"] = mid
            c["effective_method"] = mid
            c["coverage_status"] = "unknown"
            if ym in bands:
                share = (float(c["harmonized_count"])
                         / max(targets_used[ym] - (month_totals[ym][0]
                                                   - month_totals[ym][1]), 1e-9))
                lo, hi = bands[ym]
                c["harmonized_count_low"] = round(max(lo, 0.0) * share, 3)
                c["harmonized_count_high"] = round(hi * share, 3)
                c["uncertainty_status"] = band_status
                # P2-11: the status is relabelled to the model band, so the
                # human-readable label must follow — otherwise the card shows
                # a stale statistical label next to a model-band status.
                c["uncertainty_label"] = (
                    f"estimated — model predictive band ({mid} monthly target; "
                    "VIIRS-observed part untouched)")
        else:
            c["effective_method"] = untouched_method
    conservation = []
    for ym in factors:
        total = sum(float(c["harmonized_count"]) for c in daily
                    if str(c["date"])[:7] == ym)
        conservation.append(abs(total - targets_used[ym]))
    return daily, {
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
        "months_with_band": len(bands),
        "conservation_max_abs_error": round(max(conservation), 4) if conservation else 0.0,
        "month_effective_method": {ym: (method_by_month or {}).get(ym, method_id)
                                   for ym in factors},
    }
