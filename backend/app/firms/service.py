"""Activity-summary service helpers (moved verbatim from `app.main`, CLAIM-013).

`app.main` re-imports these names so existing `from app.main import ...`
users keep working. No logic, message, or threshold changed here.
"""
from __future__ import annotations

import hashlib
import json


def _round4(x):
    """Round every float in a nested metrics structure to 4 decimals."""
    if isinstance(x, float):
        return round(x, 4)
    if isinstance(x, dict):
        return {k: _round4(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_round4(v) for v in x]
    return x


def _forecast(calen: dict, latest_date: str | None) -> dict | None:
    """Seasonal-naive climatology outlook (NOT a prediction).

    P1-11: uses only year-months with observed coverage; baseline excludes the
    target year's own value via col history; n_years = covered years, and
    returns None when fewer than 3 covered years exist.
    """
    if not latest_date or not calen.get("years"):
        return None
    try:
        ly, lm = int(latest_date[:4]), int(latest_date[5:7])
    except ValueError:
        return None
    ty, tm = (ly + 1, 1) if lm == 12 else (ly, lm + 1)
    mi = tm - 1
    comp = calen.get("completeness", {})
    # Climatology only from months whose coverage is not verified-partial.
    col = [calen["matrix"][yi][mi] for yi in range(len(calen["years"]))
           if calen["matrix"][yi][mi] is not None
           and comp.get(f"{calen['years'][yi]}-{mi + 1:02d}", {}).get("partial") is not True]
    if len(col) < 3:
        return None
    col = sorted(col)
    n = len(col)
    q = lambda p: col[min(n - 1, int(p * n))]
    return {"year": ty, "month": tm, "median": round(col[n // 2], 2),
            "p25": round(q(0.25), 2), "p75": round(q(0.75), 2),
            "n_years": n, "method": "seasonal-naive climatology (same-month history, not a prediction)"}


def _empty_month_slot() -> dict:
    return {"modis": 0.0, "viirs": 0.0, "harmonized": 0.0, "cells": 0,
            "paired_cells": 0, "modis_only_cells": 0, "viirs_only_cells": 0,
            "estimated_cells": 0}


def _slot_add(slot: dict, modis: float, viirs: float, harmonized: float,
              estimated: bool) -> None:
    slot["modis"] += float(modis or 0)
    slot["viirs"] += float(viirs or 0)
    slot["harmonized"] += round(float(harmonized or 0), 3)
    slot["cells"] += 1
    if modis and viirs:
        slot["paired_cells"] += 1
    elif modis:
        slot["modis_only_cells"] += 1
    elif viirs:
        slot["viirs_only_cells"] += 1
    if estimated:
        slot["estimated_cells"] += 1


def _activity_summary(out: dict, *, data: str, method: str, aoi: str,
                      bbox: str | None, qa_min: str, platform_set: str,
                      dataset: str | None, geom_hash: str = "none",
                      from_date: str | None = None,
                      to_date: str | None = None,
                      source_type: str = "all") -> dict:
    """P0-01: server-side totals over the FULL filtered set.

    Sensor detections are hotspot records, not fires. MODIS and VIIRS are
    reported separately; `sensor_detections_total` is their sum and must not be
    presented as a fire count.
    """
    # Deferred: app.main imports this module at load time, so the label helper
    # is resolved at call time (main is fully initialised by then).
    from app.main import _data_source_label

    monthly = out.get("monthly") or {}
    modis = viirs = harmonized = 0.0
    cells = paired = modis_only = viirs_only = estimated = 0
    for slot in monthly.values():
        modis += float(slot.get("modis", 0) or 0)
        viirs += float(slot.get("viirs", 0) or 0)
        harmonized += float(slot.get("harmonized", 0) or 0)
        cells += int(slot.get("cells", 0) or 0)
        paired += int(slot.get("paired_cells", 0) or 0)
        modis_only += int(slot.get("modis_only_cells", 0) or 0)
        viirs_only += int(slot.get("viirs_only_cells", 0) or 0)
        estimated += int(slot.get("estimated_cells", 0) or 0)
    months = sorted(monthly)
    if not months and out.get("calendar"):
        cyears = out["calendar"].get("years") or []
        if cyears:
            months = [f"{cyears[0]}-01", f"{cyears[-1]}-12"]
    n_total = int(out.get("daily_cells") or cells)
    n_returned = len(out.get("daily") or [])
    scope = ("nasa_firms_observed" if (data == "raw" and not dataset)
             else "user_upload_unverified" if dataset
             else "synthetic_demo_not_observed")
    filters = {"aoi": aoi, "bbox": bbox or "all", "data": data,
               "method": method, "qa_min": qa_min,
               "platform_set": platform_set, "source_type": source_type,
               "dataset": dataset or "none",
               "geometry_hash": geom_hash,
               "from_date": from_date or "all", "to_date": to_date or "all"}
    return {
        "modis_detections": round(modis, 3),
        "viirs_detections": round(viirs, 3),
        "sensor_detections_total": round(modis + viirs, 3),
        "harmonized_total": round(harmonized, 3),
        "paired_cells": paired,
        "modis_only_cells": modis_only,
        "viirs_only_cells": viirs_only,
        "estimated_cells": estimated,
        "estimated_index": round(estimated / cells, 4) if cells else None,
        "n_daily_cells_total": n_total,
        "n_daily_cells_returned": n_returned,
        "period": {"from": months[0] if months else None,
                   "to": months[-1] if months else None},
        "source_scope": scope,
        "data_source": _data_source_label(data, dataset),
        "method": method,
        "method_id": out.get("method_id"),
        "effective_method": out.get("effective_method"),
        "filter_hash": hashlib.sha256(
            json.dumps(filters, sort_keys=True).encode()).hexdigest()[:16],
        "filters": filters,
        "note": ("Sensor detections are hotspot records, not fire counts. "
                 "MODIS and VIIRS are reported separately and are not additive "
                 "as real fires. estimated_index = share of grid cell-days "
                 "whose value is model-estimated (no same-day VIIRS detection). "
                 "VIIRS mixes SNPP (since 2012) with NOAA-20/21 (later, different "
                 "overpasses): a rise in all-platform counts can be sensor mix, "
                 "not more fire — use platform_set=snpp or /platform-series for "
                 "the comparable single-platform series."),
    }


def _latest_summary(calen: dict, daily: list[dict],
                    month_latest: dict[str, str] | None = None) -> dict | None:
    """Latest COMPLETE month vs history.

    Partial months carry no verdict; instead of returning null when the newest
    NRT month is partial, we fall back to the newest month whose coverage is
    not verified-partial (audit P1-01). Streaming callers pass `month_latest`
    (newest detection date per YYYY-MM) instead of a full daily-cell list.
    """
    if not (daily or month_latest) or not calen.get("years"):
        return None
    by_month: dict[str, list[str]] = {}
    if month_latest:
        by_month = {ym: [d] for ym, d in month_latest.items()}
    else:
        for c in daily:
            d = str(c["date"])[:10]
            by_month.setdefault(d[:7], []).append(d)
    comp = calen.get("completeness", {})
    for ym in sorted(by_month, reverse=True):
        if comp.get(ym, {}).get("partial") is True:
            continue
        latest_date = max(by_month[ym])
        m = int(ym[5:7])
        mi = m - 1
        ly = int(ym[:4])
        import statistics as _st
        excluded = set((calen.get("anomaly_eligibility") or {})
                       .get("excluded_months") or [])
        col = [calen["matrix"][yi][mi] for yi, y in enumerate(calen["years"])
               if y != ly and calen["matrix"][yi][mi] is not None
               and f"{y}-{m:02d}" not in excluded]
        cur = next((calen["matrix"][yi][mi] for yi, y in enumerate(calen["years"])
                    if y == ly), None)
        if cur is None or len(col) < 3:
            continue
        med = round(float(_st.median(col)), 2)
        return {"date": latest_date, "month": m, "month_total": round(cur, 2),
                "hist_median": med, "hist_years": len(col),
                "ratio": round(cur / med, 2) if med else None,
                "coverage_status": comp.get(ym, {}).get("coverage_status", "unknown"),
                "coverage_ratio": comp.get(ym, {}).get("coverage_ratio"),
                "verdict": ("above_history" if cur > 1.5 * med
                            else "below_history" if cur < 0.5 * med
                            else "near_history") if med else "no_history"}
    return None
