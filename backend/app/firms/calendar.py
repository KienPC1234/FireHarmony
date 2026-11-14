"""Burning-activity calendar: month x year matrix + anomaly vs history.

Anomaly per (year, month): robust z against the same calendar month across
years — median and MAD, so one mega-fire year cannot drag the baseline.
Accessible color ramp: diverging blue (below median) -> neutral -> YlOrRd
(above median); never red/green alone.
"""
from __future__ import annotations

from collections import defaultdict
from statistics import median


def build_calendar(daily_cells: list[dict]) -> dict:
    """Return {years, months, matrix, row_totals, col_totals, anomalies}."""
    ym: dict[tuple[int, int], float] = defaultdict(float)
    for c in daily_cells:
        d = str(c["date"])[:10]
        try:
            y, m = int(d[:4]), int(d[5:7])
        except ValueError:
            continue
        ym[(y, m)] += float(c.get("harmonized_count", 0.0))
    if not ym:
        return {"years": [], "months": list(range(1, 13)), "matrix": [],
                "anomalies": [], "row_totals": [], "col_medians": [0.0] * 12}
    years = sorted({y for y, _ in ym})
    matrix = [[round(ym.get((y, m), 0.0), 2) for m in range(1, 13)] for y in years]
    # per-calendar-month median + MAD across years
    col_med = []
    col_mad = []
    for mi in range(12):
        col = [matrix[yi][mi] for yi in range(len(years))]
        med = median(col) if col else 0.0
        mad = median([abs(v - med) for v in col]) if col else 0.0
        col_med.append(med)
        col_mad.append(mad if mad > 1e-9 else max(med * 0.2, 1.0))
    anomalies = [
        [round((matrix[yi][mi] - col_med[mi]) / col_mad[mi], 2)
         for mi in range(12)]
        for yi in range(len(years))
    ]
    row_totals = [round(sum(r), 2) for r in matrix]
    return {
        "years": years,
        "months": list(range(1, 13)),
        "matrix": matrix,
        "anomalies": anomalies,
        "row_totals": row_totals,
        "col_medians": [round(v, 2) for v in col_med],
    }


def critical_periods(calendar: dict, z_thresh: float = 2.0) -> list[dict]:
    """Cells with |z| >= thresh, ranked — the 'which month/year burned most' answer."""
    out = []
    for yi, y in enumerate(calendar.get("years", [])):
        for mi, m in enumerate(calendar.get("months", [])):
            z = calendar["anomalies"][yi][mi]
            if abs(z) >= z_thresh:
                out.append({
                    "year": y, "month": m,
                    "count": calendar["matrix"][yi][mi],
                    "z": z,
                    "label": "above_history" if z > 0 else "below_history",
                })
    return sorted(out, key=lambda r: -abs(r["z"]))
