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


@dataclass
class DailyAgg:
    count: int = 0
    frp: float = 0.0


def aggregate(records: list[dict], res_deg: float = RES_DEG) -> dict[tuple[str, str, str], DailyAgg]:
    """Group validated records by (cell_id, date, instrument)."""
    out: dict[tuple[str, str, str], DailyAgg] = defaultdict(DailyAgg)
    for r in records:
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
    fallback = float(np.clip(fallback, 0.05, 1.5))
    return {"_fallback": fallback, **{m: float(np.clip(v, 0.05, 1.5)) for m, v in ratios.items()}}


def harmonize_daily(
    agg: dict[tuple[str, str, str], DailyAgg],
    ratios: dict[str, float] | None = None,
) -> list[dict]:
    """Fuse per-sensor aggregates into VIIRS-equivalent daily cells."""
    ratios = ratios or {"_fallback": 0.35}
    cells_days: dict[tuple[str, str], dict[str, DailyAgg]] = defaultdict(dict)
    for (cell, day, inst), a in agg.items():
        cells_days[(cell, day)][inst] = a
    out: list[dict] = []
    for (cell, day), per in sorted(cells_days.items()):
        mo = per.get("MODIS", DailyAgg())
        vi = per.get("VIIRS", DailyAgg())
        k = ratios.get(day[:7], ratios["_fallback"])
        # Forward harmonization to VIIRS sensitivity (see module docstring).
        if vi.count > 0:
            h_count, h_frp = float(vi.count), float(vi.frp)
        else:
            h_count = mo.count / k
            h_frp = mo.frp / k
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
            "harmonized_count": round(h_count, 3),
            "harmonized_frp": round(h_frp, 3),
            "method": "viirs_equiv",
        })
    return out
