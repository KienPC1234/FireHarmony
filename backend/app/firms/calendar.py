"""Burning-activity calendar: month x year matrix + anomaly vs history.

P0-09: months with no observed cell-days are null (no data), never 0.
P0-10: values are hotspot-detection activity, not fire counts.
z is reported in robust MAD units (1.4826*MAD ~= sigma); see method page.
"""
from __future__ import annotations

from collections import defaultdict
from statistics import median

ROBUST_SIGMA = 1.4826


def build_calendar(daily_cells: list[dict], coverage: dict | None = None) -> dict:
    """Return {years, months, matrix, row_totals, col_medians, coverage}.

    matrix cells are float totals or None when that year-month has zero
    observed cell-days. anomalies mirror that mask (None = no data).

    `coverage` is a manifest-derived map {YYYY-MM: {...}} from
    app.firms.coverage. When absent, observation coverage is UNKNOWN — it is
    never inferred from `detection_days` (audit P0-06).
    """
    ym: dict[tuple[int, int], float] = defaultdict(float)
    seen: set[tuple[int, int]] = set()
    ymdays: dict[tuple[int, int], set[str]] = defaultdict(set)
    plat_year: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for c in daily_cells:
        d = str(c["date"])[:10]
        try:
            y, m = int(d[:4]), int(d[5:7])
        except ValueError:
            continue
        ym[(y, m)] += float(c.get("harmonized_count", 0.0) or 0.0)
        seen.add((y, m))
        ymdays[(y, m)].add(d)
        for sat, n in (c.get("platform_counts") or {}).items():
            plat_year[y][str(sat)] += float(n or 0)
    if not ym:
        return {"years": [], "months": list(range(1, 13)), "matrix": [],
                "anomalies": [], "row_totals": [], "col_medians": [None] * 12,
                "coverage": [], "completeness": {}, "platform_mix": {}}
    years = sorted({y for y, _ in ym})
    matrix: list[list[float | None]] = [
        [round(ym[(y, m)], 2) if (y, m) in seen else None for m in range(1, 13)]
        for y in years
    ]
    col_med: list[float | None] = []
    col_mad: list[float] = []
    for mi in range(12):
        col = [matrix[yi][mi] for yi in range(len(years)) if matrix[yi][mi] is not None]
        if not col:
            col_med.append(None)
            col_mad.append(1.0)
            continue
        med = median(col)
        mad = median([abs(v - med) for v in col]) if col else 0.0
        col_med.append(round(float(med), 2))
        sigma = ROBUST_SIGMA * mad if mad > 1e-9 else max(abs(med) * 0.2, 1.0)
        col_mad.append(float(sigma))
    anomalies: list[list[float | None]] = []
    anomaly_n: list[list[int]] = []
    for yi in range(len(years)):
        row: list[float | None] = []
        nrow: list[int] = []
        for mi in range(12):
            v = matrix[yi][mi]
            others = [matrix[yi2][mi] for yi2 in range(len(years))
                      if yi2 != yi and matrix[yi2][mi] is not None]
            if v is None or (not others and col_med[mi] is None):
                row.append(None)
                nrow.append(len(others))
                continue
            if len(others) >= 3:
                med = median(others)
                mad = median([abs(x - med) for x in others])
                sigma = (ROBUST_SIGMA * mad if mad > 1e-9
                         else max(abs(med) * 0.2, 1.0))
            else:
                med = col_med[mi]
                sigma = col_mad[mi]
            row.append(round((v - med) / sigma, 2))
            nrow.append(len(others))
        anomalies.append(row)
        anomaly_n.append(nrow)
    row_totals = [round(sum(v for v in r if v is not None), 2) for r in matrix]
    coverage_mask = [[1 if v is not None else 0 for v in r] for r in matrix]
    coverage = coverage or {}
    completeness: dict[str, dict] = {}
    for (y, m) in sorted(seen):
        ds = sorted(ymdays[(y, m)])
        key = f"{y}-{m:02d}"
        cov = coverage.get(key)
        if cov and cov.get("status") == "verified":
            observed_days = int(cov.get("requested_days", 0))
            ratio = float(cov.get("coverage_ratio", 0.0))
            status = "verified"
            partial: bool | None = ratio < 0.9
            missing = list(cov.get("missing_days", []))
            days_in_month = int(cov.get("days_in_month", 0))
        else:
            observed_days = None
            ratio = None
            status = "unknown"
            partial = None
            missing = []
            days_in_month = None
        completeness[key] = {
            # explicit: detections != observations
            "detection_days": len(ds),
            "days": len(ds),  # legacy key, same meaning as detection_days
            "span": [ds[0], ds[-1]],
            "days_in_month": days_in_month,
            "observed_days": observed_days,
            "coverage_ratio": ratio,
            "coverage_status": status,
            "missing_days": missing,
            "partial": partial,
            "sparse_detections": len(ds) < 5,
        }
    platform_mix = {str(y): {k: round(v, 2) for k, v in sorted(plat_year[y].items())}
                    for y in sorted(plat_year)}
    return {
        "years": years,
        "months": list(range(1, 13)),
        "matrix": matrix,
        "anomalies": anomalies,
        "row_totals": row_totals,
        "col_medians": col_med,
        "coverage": coverage_mask,
        "completeness": completeness,
        "anomaly_n_years": anomaly_n,
        "anomaly_baseline": "leave-one-year-out (falls back to column median with <3 other years)",
        "platform_mix": platform_mix,
        "z_unit": "robust MAD units (1.4826*MAD)",
    }


def critical_periods(calendar: dict, z_thresh: float = 2.0) -> list[dict]:
    """Cells with |z| >= thresh, ranked.

    Skips only months whose coverage is VERIFIED to be partial (<90% days
    requested). Unknown coverage is allowed but reported as such; a month with
    one detection day is not partial if the fetch ledger says all days were
    requested (audit P0-06).
    """
    comp = calendar.get("completeness", {})
    out = []
    for yi, y in enumerate(calendar.get("years", [])):
        for mi, m in enumerate(calendar.get("months", [])):
            cinfo = comp.get(f"{y}-{m:02d}", {})
            if cinfo.get("partial") is True:
                continue
            z = calendar["anomalies"][yi][mi]
            if z is None:
                continue
            if abs(z) >= z_thresh:
                out.append({
                    "year": y, "month": m,
                    "count": calendar["matrix"][yi][mi],
                    "z": z,
                    "coverage_status": cinfo.get("coverage_status", "unknown"),
                    "coverage_ratio": cinfo.get("coverage_ratio"),
                    "label": "above_history" if z > 0 else "below_history",
                })
    return sorted(out, key=lambda r: -abs(r["z"]))
