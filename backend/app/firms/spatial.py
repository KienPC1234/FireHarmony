"""Coarse-grid co-observation diagnostics (never a spatial holdout claim).

MODIS 1 km and VIIRS 375 m do not share footprints, so cell-level VIIRS is a
sensor reference, not ground truth. This module measures whether the
harmonized field has the same coarse spatial pattern on cells where BOTH
sensors recorded detections. It is labelled `co_observation_consistency`,
not `spatial_validation`.
"""
from __future__ import annotations

import math
from collections import defaultdict


def _rank(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def _pearson(a: list[float], b: list[float]) -> float | None:
    n = len(a)
    if n < 3:
        return None
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((x - mb) ** 2 for x in b)
    if va <= 0 or vb <= 0:
        return None
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    return cov / math.sqrt(va * vb)


def _spearman(a: list[float], b: list[float]) -> float | None:
    if len(a) < 3:
        return None
    return _pearson(_rank(a), _rank(b))


def coobservation(daily: list[dict], year: int, month: int,
                  res_deg: float = 0.25) -> dict:
    """Aggregate to a coarse grid and compare on co-observed cells."""
    ym = f"{year}-{month:02d}"
    cells = [c for c in daily if str(c.get("date", ""))[:7] == ym]
    grid: dict[tuple[float, float], dict[str, float]] = defaultdict(
        lambda: {"modis": 0.0, "viirs": 0.0})
    for c in cells:
        la = math.floor(float(c["lat"]) / res_deg) * res_deg
        lo = math.floor(float(c["lon"]) / res_deg) * res_deg
        slot = grid[(round(la, 3), round(lo, 3))]
        slot["modis"] += float(c.get("modis_count", 0) or 0)
        slot["viirs"] += float(c.get("viirs_count", 0) or 0)
    modis_total = sum(v["modis"] for v in grid.values())
    viirs_total = sum(v["viirs"] for v in grid.values())
    k = (modis_total / viirs_total) if viirs_total > 0 else 0.35
    co = [(v["modis"] / k, v["viirs"]) for v in grid.values()
          if v["modis"] > 0 and v["viirs"] > 0]
    pred = [p for p, _ in co]
    obs = [o for _, o in co]
    mae = sum(abs(p - o) for p, o in co) / len(co) if co else None
    n = len(co)
    top_n = max(1, int(0.1 * n)) if n else 0
    top_pred = {i for i, _ in sorted(enumerate(pred), key=lambda x: -x[1])[:top_n]}
    top_obs = {i for i, _ in sorted(enumerate(obs), key=lambda x: -x[1])[:top_n]}
    overlap = (len(top_pred & top_obs) / len(top_pred | top_obs)
               if top_pred and top_obs else None)
    modis_only = sum(1 for v in grid.values()
                     if v["modis"] > 0 and v["viirs"] == 0)
    return {
        "aoi_month": ym, "res_deg": res_deg,
        "coarse_cells": len(grid), "co_observed_cells": n,
        "modis_detections": int(modis_total),
        "viirs_detections": int(viirs_total),
        "k_used": round(float(k), 4),
        "mae_coarse_cell": None if mae is None else round(float(mae), 2),
        "pearson": None if (r := _pearson(pred, obs)) is None else round(r, 3),
        "spearman": None if (r := _spearman(pred, obs)) is None else round(r, 3),
        "top_decile_jaccard": None if overlap is None else round(overlap, 3),
        "modis_only_coarse_cells": modis_only,
        "validation_kind": "co_observation_consistency",
        "claim": ("Coarse spatial consistency on cells where both sensors saw "
                  "detections. This is NOT a spatial holdout and does not "
                  "validate cell-day locations."),
    }
