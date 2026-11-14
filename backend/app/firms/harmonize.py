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


ALGORITHM_VERSION = "harmonize-v2"  # sensor-adjusted activity index, not fire counts


@dataclass
class DailyAgg:
    count: int = 0
    frp: float = 0.0
    platforms: set = None  # type: ignore

    def __post_init__(self):
        if self.platforms is None:
            self.platforms = set()


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
        agg.platforms.add(str(r.get("satellite", "UNKNOWN")))
        try:
            agg.frp += float(r.get("frp", 0.0) or 0.0)
        except (TypeError, ValueError):
            pass
    return out


def estimate_efficiency_ratio(
    agg: dict[tuple[str, str, str], DailyAgg],
    min_months: int = 3,
) -> dict[str, float]:
    """Per-month detection ratio k = MODIS / VIIRS from AOI-monthly totals.

    Deliberately NOT estimated on same-cell overlap days: at 0.05° the two
    sensors' pixels of the same fire usually land in different cells
    (375 m vs 1 km footprints, geolocation offsets, different overpass
    times), so cell-overlap is near-empty on real data too. Monthly AOI
    totals need no collocation: both sensors saw the same fire population.
    Falls back to 0.35 (literature: VIIRS detects ~3x MODIS) when fewer
    than min_months overlap months exist. Never returns 0/NaN.
    """
    monthly: dict[str, dict[str, float]] = defaultdict(lambda: {"MODIS": 0.0, "VIIRS": 0.0})
    for (cell, day, inst), a in agg.items():
        monthly[day[:7]][inst] += a.count
    ratios: dict[str, float] = {}
    all_r: list[float] = []
    for m, per in monthly.items():
        if per["MODIS"] > 0 and per["VIIRS"] > 0:
            r = per["MODIS"] / per["VIIRS"]
            ratios[m] = r
            all_r.append(r)
    if len(all_r) < min_months:
        ratios = {}
    fallback = float(np.median(all_r)) if all_r else 0.35
    fallback = round(float(np.clip(fallback, 0.05, 1.5)), 4)
    return {"_fallback": fallback, **{m: round(float(np.clip(v, 0.05, 1.5)), 4) for m, v in ratios.items()}}


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
    """
    ratios = ratios or {"_fallback": 0.35}
    cells_days: dict[tuple[str, str], dict[str, DailyAgg]] = defaultdict(dict)
    for (cell, day, inst), a in agg.items():
        cells_days[(cell, day)][inst] = a
    out: list[dict] = []
    for (cell, day), per in sorted(cells_days.items()):
        mo = per.get("MODIS", DailyAgg())
        vi = per.get("VIIRS", DailyAgg())
        k = ratios.get(day[:7], ratios["_fallback"])
        plats = sorted((mo.platforms or set()) | (vi.platforms or set()))
        if vi.count > 0:
            h_count = float(vi.count)
            h_frp = float(vi.frp)
            est, sensors = "viirs_observed", "VIIRS" if mo.count == 0 else "VIIRS+MODIS"
        else:
            h_count, h_frp = mo.count / k, None
            est, sensors = "modis_upscaled_estimated", "MODIS"
        lat_s, lon_s = cell.split("_")
        out.append({
            "cell_id": cell,
            "date": day,
            "lat": float(lat_s) + RES_DEG / 2,
            "lon": float(lon_s) + RES_DEG / 2,
            "modis_count": mo.count,
            "viirs_count": vi.count,
            "modis_frp": round(mo.frp, 3),
            "viirs_frp": round(vi.frp, 3),
            "harmonized_count": round(float(h_count), 3),
            "harmonized_frp": None if h_frp is None else round(h_frp, 3),
            "method": "sensor_adjusted_index_v2",
            "estimate_type": est,
            "sensors": sensors,
            "platforms": "+".join(p for p in plats if p and p != "UNKNOWN") or "UNKNOWN",
            "coverage_status": "observed" if vi.count > 0 else "unknown",
            "k_used": round(float(k), 4),
            "algorithm_version": ALGORITHM_VERSION,
        })
    return out
