"""1-degree tile loaders and the hierarchical anchor shared by HTS and STAN.

This file used to also contain `TileFormer` (a region-agnostic residual
transformer, `tileformer_v1`). It never beat the hierarchical anchor and its
artifacts were removed, yet the training code lingered here and was one of the
seven model families in the repo. It is gone; what remains is the small,
torch-free data surface that HTS, STAN and the spatial HGB all import:

- `loads()`           tile-month rows from the pinned benchmark CSV
- `load_aoi_pairs()`  AOI-month pairs for B2 ratios
- `b2_by_aoi()`       B2 log ratio per AOI, fit before a cutoff year
- `tile_anchors()`    shrunk tile-month anchor toward the AOI seasonal ratio
"""
from __future__ import annotations

import csv
import math
from functools import lru_cache
from pathlib import Path

import numpy as np

AOIS = ("vietnam", "amazon", "australia")
BENCH = Path(__file__).resolve().parents[2] / "data" / "firms" / "benchmark"


@lru_cache(maxsize=4)
def _loads_cached(path_str: str, mtime_ns: int, size: int) -> tuple[dict, ...]:
    out = []
    with Path(path_str).open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            out.append({
                "aoi": r["aoi"], "tile_id": r["tile_id"],
                "lat": float(r["lat"]), "lon": float(r["lon"]),
                "year": int(r["year"]), "month": int(r["month"]),
                "modis": float(r["modis"]), "viirs": float(r["viirs"]),
                "day_frac": float(r["day_frac"]),
                "terra_frac": float(r["terra_frac"]),
                "days_modis": int(r.get("days_modis") or 0),
                "days_viirs": int(r.get("days_viirs") or 0),
            })
    return tuple(out)


def loads(path: Path | None = None) -> list[dict]:
    p = path or (BENCH / "tile_pairs_raw.csv")
    if not p.exists():
        return []
    try:
        st = p.stat()
    except OSError:
        return []
    return list(_loads_cached(str(p), st.st_mtime_ns, st.st_size))


@lru_cache(maxsize=4)
def _pairs_cached(path_str: str, mtime_ns: int, size: int) -> tuple[dict, ...]:
    with Path(path_str).open(encoding="utf-8") as fh:
        return tuple({"aoi": r["aoi"], "year": int(r["year"]),
                      "month": int(r["month"]), "modis": float(r["modis"]),
                      "viirs": float(r["viirs"])} for r in csv.DictReader(fh))


def load_aoi_pairs() -> list[dict]:
    p = BENCH / "training_pairs_raw.csv"
    if not p.exists():
        return []
    try:
        st = p.stat()
    except OSError:
        return []
    return list(_pairs_cached(str(p), st.st_mtime_ns, st.st_size))


def b2_by_aoi(pairs: list[dict], cutoff: int) -> dict:
    from app.firms.ml_core import ratios_from_train
    return {a: ratios_from_train([p for p in pairs
                                  if p["aoi"] == a and p["year"] < cutoff])
            for a in AOIS}


def tile_anchors(tiles: list[dict], ratios: dict, cutoff: int,
                 k: float = 3.0) -> dict:
    """Hierarchical tile-month anchor, shrunk toward the AOI-month ratio.

    A tile-month median is noisy when a tile has few co-observed years, so it is
    blended with the AOI seasonal ratio: w = n/(n+k). Still a simple empirical
    baseline (no network), fit only on years < cutoff.
    """
    per = {}
    allv = {}
    for t in tiles:
        if t["year"] >= cutoff or t["modis"] <= 0:
            continue
        lr = math.log((t["viirs"] + 1.0) / (t["modis"] + 1.0))
        per.setdefault((t["tile_id"], t["month"]), []).append(lr)
        allv.setdefault(t["tile_id"], []).append(lr)
    out = {}
    for t in tiles:
        b1, b2m = ratios[t["aoi"]]
        base = float(b2m.get(t["month"], b1))
        vals = per.get((t["tile_id"], t["month"]), [])
        if vals:
            w = len(vals) / (len(vals) + k)
            out[(t["tile_id"], t["month"])] = w * float(np.median(vals)) + (1 - w) * base
        else:
            av = allv.get(t["tile_id"], [])
            if av:
                w = len(av) / (len(av) + k)
                out[(t["tile_id"], t["month"])] = w * float(np.median(av)) + (1 - w) * base
            else:
                out[(t["tile_id"], t["month"])] = base
    return out
