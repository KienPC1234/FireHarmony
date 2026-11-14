"""Coarse-grid co-observation diagnostics (never a spatial holdout claim).

MODIS 1 km and VIIRS 375 m do not share footprints, so cell-level VIIRS is a
sensor reference, not ground truth. This module measures whether the
harmonized field has the same coarse spatial pattern on cells where BOTH
sensors recorded detections. It is labelled `co_observation_consistency`,
not `spatial_validation`.

The geo/filter helpers below moved here verbatim from `app.main`
(CLAIM-013 de-frag); `app.main` re-imports them so existing
`from app.main import _parse_geometry` callers keep working.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from collections import defaultdict
from datetime import datetime

from fastapi import HTTPException


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


def _parse_bbox(raw: str | None) -> tuple[float, float, float, float] | None:
    """Parse 'minLon,minLat,maxLon,maxLat'. None = whole dataset."""
    if not raw:
        return None
    try:
        x0, y0, x1, y1 = (float(v) for v in raw.split(","))
    except ValueError:
        raise HTTPException(400, "bbox must be 'minLon,minLat,maxLon,maxLat'")
    if not (-180 <= x0 < x1 <= 180 and -90 <= y0 < y1 <= 90):
        raise HTTPException(400, "bbox out of range or inverted")
    return (x0, y0, x1, y1)


def _in_bbox(r: dict, b: tuple[float, float, float, float] | None) -> bool:
    if b is None:
        return True
    try:
        return b[0] <= float(r["longitude"]) <= b[2] and b[1] <= float(r["latitude"]) <= b[3]
    except (KeyError, TypeError, ValueError):
        return False


def _parse_geometry(raw: str | None) -> dict | None:
    """Parse a GeoJSON Polygon/MultiPolygon geometry (P0-03).

    Bounded: raw payload capped at 200 kB and 5000 vertices so a hostile
    polygon cannot pin a worker in the O(V) ray-casting loop below.
    """
    if not raw:
        return None
    if len(raw) > 200_000:
        raise HTTPException(400, "geometry payload too large (max 200 kB)")
    try:
        g = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        raise HTTPException(400, "geometry must be GeoJSON Polygon/MultiPolygon JSON")
    if not isinstance(g, dict):
        raise HTTPException(400, "geometry must be a GeoJSON object")
    if g.get("type") == "Feature":
        g = g.get("geometry") or {}
    if g.get("type") == "Polygon":
        rings = [g.get("coordinates") or []]
    elif g.get("type") == "MultiPolygon":
        rings = g.get("coordinates") or []
    else:
        raise HTTPException(400, "geometry type must be Polygon or MultiPolygon")
    out = []
    n_pts = 0
    for poly in rings:
        if not poly or not isinstance(poly[0], list):
            raise HTTPException(400, "geometry has no rings")
        norm = []
        for ring in poly:
            pts = []
            for pt in ring:
                try:
                    lon, lat = float(pt[0]), float(pt[1])
                except (TypeError, ValueError, IndexError):
                    raise HTTPException(400, "geometry coordinates must be [lon, lat]")
                pts.append((lon, lat))
            if len(pts) < 3:
                raise HTTPException(400, "geometry ring needs at least 3 vertices")
            n_pts += len(pts)
            if n_pts > 5000:
                raise HTTPException(400, "geometry has too many vertices (max 5000)")
            norm.append(pts)
        out.append(norm)
    if not out:
        raise HTTPException(400, "geometry is empty")
    return {"type": "MultiPolygon", "coordinates": out}


def _geometry_bbox(geom: dict) -> tuple[float, float, float, float]:
    xs = [pt[0] for poly in geom["coordinates"] for ring in poly for pt in ring]
    ys = [pt[1] for poly in geom["coordinates"] for ring in poly for pt in ring]
    return (min(xs), min(ys), max(xs), max(ys))


def _point_in_ring(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat):
            xint = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < xint:
                inside = not inside
        j = i
    return inside


def _point_in_geometry(lon: float, lat: float, geom: dict | None) -> bool:
    """Point-in-polygon with holes; bbox prefilter happens upstream."""
    if geom is None:
        return True
    for poly in geom["coordinates"]:
        if not poly or not _point_in_ring(lon, lat, poly[0]):
            continue
        if any(_point_in_ring(lon, lat, hole) for hole in poly[1:]):
            continue
        return True
    return False


def _geometry_hash(geom: dict | None) -> str:
    if not geom:
        return "none"
    blob = json.dumps(geom, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def _parse_date_range(from_date: str | None,
                      to_date: str | None) -> tuple[str | None, str | None]:
    """Validate ISO dates (YYYY-MM-DD) and return the inclusive day bounds."""
    out = []
    for raw in (from_date, to_date):
        if raw is None or raw == "":
            out.append(None)
            continue
        try:
            d = datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "from_date/to_date must be YYYY-MM-DD")
        out.append(d.isoformat())
    if out[0] and out[1] and out[0] > out[1]:
        raise HTTPException(400, "from_date must be <= to_date")
    return out[0], out[1]


def _in_dates(r: dict, lo: str | None, hi: str | None) -> bool:
    if not lo and not hi:
        return True
    d = str(r.get("acq_date", ""))[:10]
    if not d:
        return False
    if lo and d < lo:
        return False
    if hi and d > hi:
        return False
    return True


def _norm_confidence_filter(value: object) -> str:
    """Normalize a raw FIRMS confidence for QA filtering.

    Real MODIS C6.1 NRT rows ship a 0-100 percent scale ("54", "30"), not
    l/n/h. Thresholds mirror FirmsRecord._norm_conf (>=80 h, >=40 n, else l)
    so /export-detections agrees with the harmonize path; the old raw-string
    compare silently dropped every numeric-confidence detection under
    qa_min=high. Unknown tokens pass through lowercased.
    """
    s = str(value if value is not None else "").strip().lower()
    if re.fullmatch(r"\d{1,3}", s):
        pct = int(s)
        if pct >= 80:
            return "h"
        if pct >= 40:
            return "n"
        return "l"
    return s


def _norm_satellite_filter(value: object) -> str:
    """Normalize a raw satellite token (N/SNPP/Suomi-NPP -> NPP, ...).

    Mirrors FirmsRecord._norm_sat so platform_set=snpp does not drop VIIRS
    rows whose satellite column uses an alias spelling.
    """
    s = str(value or "UNKNOWN").strip()
    s = (s.replace("NOAA20", "NOAA-20").replace("NOAA21", "NOAA-21")
          .replace("NOAA_20", "NOAA-20").replace("NOAA_21", "NOAA-21")
          .replace("NOAA 20", "NOAA-20").replace("NOAA 21", "NOAA-21"))
    if s in {"N20", "N-20"}:
        return "NOAA-20"
    if s in {"N21", "N-21"}:
        return "NOAA-21"
    if s.upper() in {"N", "NPP", "SNPP", "SUOMI NPP", "SUOMI-NPP",
                     "S-NPP", "S NPP"}:
        return "NPP"
    return s


def _row_in_scope(r: dict, b: tuple[float, float, float, float] | None,
                  geom: dict | None) -> bool:
    """Shared bbox + polygon prefilter for raw-row generators (CLAIM-013).

    Identical semantics to the inline checks it replaces: bbox miss drops
    the row; with a polygon, out-of-polygon or unparseable coordinates drop
    the row. No filtering by confidence/platform/source here.
    """
    if b is not None and not _in_bbox(r, b):
        return False
    if geom is not None:
        try:
            if not _point_in_geometry(float(r["longitude"]),
                                      float(r["latitude"]), geom):
                return False
        except (KeyError, TypeError, ValueError):
            return False
    return True
