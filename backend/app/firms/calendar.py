"""Burning-activity calendar: month x year matrix + anomaly vs history.

P0-09: months with no observed cell-days are null (no data), never 0.
P0-10: values are hotspot-detection activity, not fire counts.
z is reported in robust MAD units (1.4826*MAD ~= sigma); see method page.
"""
from __future__ import annotations

from collections import defaultdict
from statistics import median

ROBUST_SIGMA = 1.4826


def build_calendar(daily_cells: list[dict]) -> dict:
    """Return {years, months, matrix, row_totals, col_medians, coverage}.

    matrix cells are float totals or None when that year-month has zero
    observed cell-days. anomalies mirror that mask (None = no data).
    """
    ym: dict[tuple[int, int], float] = defaultdict(float)
    seen: set[tuple[int, int]] = set()
    ymdays: dict[tuple[int, int], set[str]] = defaultdict(set)
    for c in daily_cells:
        d = str(c["date"])[:10]
        try:
            y, m = int(d[:4]), int(d[5:7])
        except ValueError:
            continue
        ym[(y, m)] += float(c.get("harmonized_count", 0.0) or 0.0)
        seen.add((y, m))
        ymdays[(y, m)].add(d)
    if not ym:
        return {"years": [], "months": list(range(1, 13)), "matrix": [],
                "anomalies": [], "row_totals": [], "col_medians": [None] * 12,
                "coverage": [], "completeness": {}}
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
    for yi in range(len(years)):
        row: list[float | None] = []
        for mi in range(12):
            v = matrix[yi][mi]
            if v is None or col_med[mi] is None:
                row.append(None)
            else:
                row.append(round((v - col_med[mi]) / col_mad[mi], 2))  # MAD units
        anomalies.append(row)
    row_totals = [round(sum(v for v in r if v is not None), 2) for r in matrix]
    coverage = [[1 if v is not None else 0 for v in r] for r in matrix]
    completeness: dict[str, dict] = {}
    for (y, m) in sorted(seen):
        ds = sorted(ymdays[(y, m)])
        completeness[f"{y}-{m:02d}"] = {
            "days": len(ds), "span": [ds[0], ds[-1]], "partial": len(ds) < 15,
        }
    return {
        "years": years,
        "months": list(range(1, 13)),
        "matrix": matrix,
        "anomalies": anomalies,
        "row_totals": row_totals,
        "col_medians": col_med,
        "coverage": coverage,
        "completeness": completeness,
        "z_unit": "robust MAD units (1.4826*MAD)",
    }


def critical_periods(calendar: dict, z_thresh: float = 2.0) -> list[dict]:
    """Cells with |z| >= thresh, ranked. Skips null (no-data) AND partial months."""
    comp = calendar.get("completeness", {})
    out = []
    for yi, y in enumerate(calendar.get("years", [])):
        for mi, m in enumerate(calendar.get("months", [])):
            if comp.get(f"{y}-{m:02d}", {}).get("partial"):
                continue
            z = calendar["anomalies"][yi][mi]
            if z is None:
                continue
            if abs(z) >= z_thresh:
                out.append({
                    "year": y, "month": m,
                    "count": calendar["matrix"][yi][mi],
                    "z": z,
                    "label": "above_history" if z > 0 else "below_history",
                })
    return sorted(out, key=lambda r: -abs(r["z"]))
