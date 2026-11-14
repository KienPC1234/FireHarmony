"""Grid aggregation + cross-sensor harmonization (no torch required).

Why VIIRS != MODIS (must explain on the poster):
- MODIS: 1 km nadir (Terra/Aqua, since 2000), coarser, misses small burns.
- VIIRS 375 m (Suomi-NPP/NOAA-20/21, since 2012): ~3-4x more detections,
  higher FRP sensitivity, different overpass times.
Direct count comparison is meaningless — harmonize forward to VIIRS-level.

Pipeline per (cell, day):
  1. aggregate raw detections per sensor (count, sum FRP)
  2. estimate k = MODIS/VIIRS from monthly AOI totals (no collocation needed)
  3. forward harmonization to VIIRS sensitivity (not a sum, not a max):
     harmonized = VIIRS where VIIRS observed the cell-day (authoritative,
     more sensitive), else MODIS / k (MODIS-era upscaled to VIIRS level).
     Rationale: k*VIIRS ~= MODIS on the same fire population, so a sum or a
     max over disjoint cells double-counts (~2x step in 2012, measured).
     Using VIIRS wherever it flew keeps every real detection; the 1/k
     upscale applies only where VIIRS never flew (pre-2012) and is labeled
     estimated. Era-consistent by construction.
  4. optional torch MLP residual corrector (dl.py) refines the MODIS->VIIRS
     upscale on overlap months.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date

import numpy as np

RES_DEG = 0.05  # ~5 km cells: fine enough for districts, coarse enough for MODIS


ALGORITHM_VERSION = "harmonize-v3"  # sensor-adjusted activity index, not fire counts
FEATURE_VERSION = "harmonize-features-v1"


@dataclass
class DailyAgg:
    count: int = 0
    frp: float = 0.0
    platforms: set = None  # type: ignore
    platform_counts: dict = None  # type: ignore

    def __post_init__(self):
        if self.platforms is None:
            self.platforms = set()
        if self.platform_counts is None:
            self.platform_counts = {}


def _dedup_key(r: dict) -> tuple:
    """P0-08: (instrument, satellite, date, time, rounded lat/lon, version)."""
    try:
        la = round(float(r["latitude"]), 4)
        lo = round(float(r["longitude"]), 4)
    except (KeyError, TypeError, ValueError):
        la, lo = 0.0, 0.0
    inst = str(r.get("instrument", "")).upper()
    inst = "VIIRS" if inst.startswith("VIIRS") else ("MODIS" if inst == "MODIS" else inst)
    return (inst, str(r.get("satellite", "")).strip(), str(r.get("acq_date", ""))[:10],
            str(r.get("acq_time", "")).strip(), la, lo, str(r.get("version", "")))


def aggregate(records: list[dict], res_deg: float = RES_DEG) -> dict[tuple[str, str, str], DailyAgg]:
    """Group validated records by (cell_id, date, instrument). Dedups exact re-pulls."""
    out: dict[tuple[str, str, str], DailyAgg] = defaultdict(DailyAgg)
    seen: set[tuple] = set()
    for r in records:
        sig = _dedup_key(r)
        if sig in seen:
            continue  # same detection pulled twice (overlapping raw files)
        seen.add(sig)
        try:
            lat = float(r["latitude"])
            lon = float(r["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        inst = str(r.get("instrument", "MODIS")).upper()
        inst = "VIIRS" if inst.startswith("VIIRS") else "MODIS"
        d = str(r.get("acq_date", ""))[:10]
        la = np.floor(lat / res_deg) * res_deg
        lo = np.floor(lon / res_deg) * res_deg
        key = (f"{la:.2f}_{lo:.2f}", d, inst)
        agg = out[key]
        agg.count += 1
        sat = str(r.get("satellite", "UNKNOWN"))
        agg.platforms.add(sat)
        agg.platform_counts[sat] = agg.platform_counts.get(sat, 0) + 1
        try:
            agg.frp += float(r.get("frp", 0.0) or 0.0)
        except (TypeError, ValueError):
            pass
    return out


def aggregate_iter(records, res_deg: float = RES_DEG, keep_clean=None):
    """Streaming aggregate used for large raw pulls (never builds a row list).

    `keep_clean` is an optional callable receiving each validated dict (used by
    the monthly ML context); pass None to skip retaining anything. Returns
    (agg, stats) where stats has clean/rejected/qa_counts.
    """
    from app.firms.schema import FirmsRecord

    out: dict[tuple[str, str, str], DailyAgg] = defaultdict(DailyAgg)
    seen: set[tuple] = set()
    stats = {"clean": 0, "rejected": 0, "qa_counts": {}}
    for r in records:
        try:
            rec = FirmsRecord(**{k.lower(): v for k, v in dict(r).items()})
        except Exception:
            stats["rejected"] += 1
            continue
        d = rec.model_dump(mode="json")
        q = rec.qa()
        d["qa_flag"] = q
        stats["qa_counts"][q] = stats["qa_counts"].get(q, 0) + 1
        if q in ("suspect_geometry", "anachronistic_platform"):
            stats["rejected"] += 1
            continue
        stats["clean"] += 1
        if keep_clean is not None:
            keep_clean(d)
        sig = _dedup_key(d)
        if sig in seen:
            continue
        seen.add(sig)
        lat, lon = float(d["latitude"]), float(d["longitude"])
        inst = "VIIRS" if str(d.get("instrument", "")).upper().startswith("VIIRS") else "MODIS"
        day = str(d.get("acq_date", ""))[:10]
        la = np.floor(lat / res_deg) * res_deg
        lo = np.floor(lon / res_deg) * res_deg
        key = (f"{la:.2f}_{lo:.2f}", day, inst)
        agg = out[key]
        agg.count += 1
        sat = str(d.get("satellite", "UNKNOWN"))
        agg.platforms.add(sat)
        agg.platform_counts[sat] = agg.platform_counts.get(sat, 0) + 1
        try:
            agg.frp += float(d.get("frp", 0.0) or 0.0)
        except (TypeError, ValueError):
            pass
    return out, stats


def estimate_efficiency_ratio(
    agg: dict[tuple[str, str, str], DailyAgg],
    min_months: int = 3,
    exclude_months: set[str] | frozenset[str] | None = None,
    mode: str = "fusion",
) -> dict[str, float]:
    """Per-month detection ratio k = MODIS / VIIRS from AOI-monthly totals.

    Deliberately NOT estimated on same-cell overlap days: at 0.05° the two
    sensors' pixels of the same fire usually land in different cells
    (375 m vs 1 km footprints, geolocation offsets, different overpass
    times), so cell-overlap is near-empty on real data too. Monthly AOI
    totals need no collocation: both sensors saw the same fire population.

    Audit P0-04/P0-05: this is a FUSION ratio when the same month's VIIRS is
    used to produce the same month's output. For a predictive backtest pass
    `exclude_months` (the evaluation months) and `mode="predictive"`; the
    ratio is then built only from information available before the test
    period. Provenance keys start with `_` and never collide with YYYY-MM.
    """
    exclude = set(exclude_months or ())
    monthly: dict[str, dict[str, float]] = defaultdict(lambda: {"MODIS": 0.0, "VIIRS": 0.0})
    for (cell, day, inst), a in agg.items():
        monthly[day[:7]][inst] += a.count
    ratios: dict[str, float] = {}
    all_r: list[float] = []
    used_months: list[str] = []
    for m in sorted(monthly):
        if m in exclude:
            continue
        per = monthly[m]
        if per["MODIS"] > 0 and per["VIIRS"] > 0:
            r = per["MODIS"] / per["VIIRS"]
            ratios[m] = r
            all_r.append(r)
            used_months.append(m)
    if len(all_r) < min_months:
        ratios = {}
        used_months = []
    fallback = float(np.median(all_r)) if all_r else 0.35
    fallback = round(float(np.clip(fallback, 0.05, 1.5)), 4)
    if all_r:
        q1, q3 = np.percentile(all_r, [25, 75])
        rel_iqr = float((q3 - q1) / fallback) if fallback > 0 else 0.0
    else:
        rel_iqr = 0.0
    out = {
        "_fallback": fallback,
        "_fallback_rel_iqr": round(float(np.clip(rel_iqr, 0.0, 1.0)), 4),
        "_n_months": len(all_r),
        "_mode": mode,
        "_excluded_months": sorted(exclude),
        "_calibration_window": [used_months[0], used_months[-1]] if used_months else None,
        "_train_end": used_months[-1] if used_months else None,
        "_sensor_set": ["MODIS", "VIIRS"],
        "_data_version": ALGORITHM_VERSION,
        **{m: round(float(np.clip(v, 0.05, 1.5)), 4) for m, v in ratios.items()},
    }
    return out


def harmonize_daily(
    agg: dict[tuple[str, str, str], DailyAgg],
    ratios: dict[str, float] | None = None,
) -> list[dict]:
    """Fuse per-sensor aggregates into a sensor-adjusted activity index.

    P0-04: a hotspot-only feed cannot prove 'VIIRS looked and saw nothing'.
    vi.count == 0 therefore means *no VIIRS detection recorded*, not *confirmed
    absence*. Cells where VIIRS recorded >=1 detection keep the VIIRS value
    (authoritative, more sensitive); MODIS-only cell-days are upscaled by 1/k
    and MUST be treated as estimates (estimate_type + coverage_status=unknown).
    P0-06: harmonized_frp is null for upscaled cells — count-ratio k must never
    rescale FRP (different retrieval physics).
    P0-05: upscaled cells carry an uncertainty interval from the month-to-month
    dispersion of k, so the output never presents one number as exact.
    """
    ratios = ratios or {"_fallback": 0.35}
    rel_iqr = float(ratios.get("_fallback_rel_iqr", 0.0) or 0.0)
    mode = str(ratios.get("_mode", "fusion"))
    provenance = {
        "ratio_mode": mode,
        "calibration_window": ratios.get("_calibration_window"),
        "calibration_train_end": ratios.get("_train_end"),
        "calibration_sensor_set": ratios.get("_sensor_set"),
        "calibration_version": ratios.get("_data_version", ALGORITHM_VERSION),
        "calibration_months": ratios.get("_n_months", 0),
    }
    cells_days: dict[tuple[str, str], dict[str, DailyAgg]] = defaultdict(dict)
    for (cell, day, inst), a in agg.items():
        cells_days[(cell, day)][inst] = a
    out: list[dict] = []
    for (cell, day), per in sorted(cells_days.items()):
        mo = per.get("MODIS", DailyAgg())
        vi = per.get("VIIRS", DailyAgg())
        k = ratios.get(day[:7], ratios["_fallback"])
        plats = sorted((mo.platforms or set()) | (vi.platforms or set()))
        platform_counts: dict[str, int] = {}
        for src in (mo.platform_counts or {}), (vi.platform_counts or {}):
            for sat, n in src.items():
                platform_counts[sat] = platform_counts.get(sat, 0) + int(n)
        if vi.count > 0:
            h_count = float(vi.count)
            h_frp = float(vi.frp)
            h_low = h_high = None
            est, sensors = "viirs_observed", "VIIRS" if mo.count == 0 else "VIIRS+MODIS"
        else:
            h_count = mo.count / k
            h_frp = None
            if rel_iqr > 0:
                k_low = max(k * (1.0 - rel_iqr), 1e-6)
                k_high = k * (1.0 + rel_iqr)
                h_low = mo.count / k_high
                h_high = mo.count / k_low
            else:
                h_low = h_high = h_count
            est, sensors = "modis_upscaled_estimated", "MODIS"
        lat_s, lon_s = cell.split("_")
        clat, clon = float(lat_s) + RES_DEG / 2, float(lon_s) + RES_DEG / 2
        # P1-16: physical cell area shrinks with latitude (0.05° is not equal-area).
        import math as _math
        cell_km2 = round((111.32 * RES_DEG) ** 2 * max(_math.cos(_math.radians(clat)), 0.2), 3)
        out.append({
            "cell_id": cell,
            "date": day,
            "lat": clat,
            "lon": clon,
            "cell_km2": cell_km2,
            "cell_area_method": "cos-lat approximation of a 0.05 deg box; not an equal-area grid",
            "modis_count": mo.count,
            "viirs_count": vi.count,
            "modis_frp": round(mo.frp, 3),
            "viirs_frp": round(vi.frp, 3),
            "harmonized_count": round(float(h_count), 3),
            "harmonized_count_low": None if h_low is None else round(float(h_low), 3),
            "harmonized_count_high": None if h_high is None else round(float(h_high), 3),
            "harmonized_per_km2": round(float(h_count) / cell_km2, 4),
            "harmonized_frp": None if h_frp is None else round(h_frp, 3),
            "method": "sensor_adjusted_index_v3",
            "estimate_type": est,
            "sensors": sensors,
            "platforms": "+".join(p for p in plats if p and p != "UNKNOWN") or "UNKNOWN",
            "platform_counts": platform_counts,
            "platform_single": plats[0] if len(plats) == 1 else ("mixed" if plats else "UNKNOWN"),
            "coverage_status": "observed" if vi.count > 0 else "unknown",
            "k_used": round(float(k), 4),
            "uncertainty_rel": round(rel_iqr, 4),
            "algorithm_version": ALGORITHM_VERSION,
            **provenance,
        })
    return out
