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
import pandas as pd

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


def frame() -> pd.DataFrame:
    """Tile-month feature frame with neighbour context (shared by STAN).

    Moved here when the retrospective spatial HGB model was removed: STAN only
    needed the frame builder, not the model.
    """
    tiles = loads()
    df = pd.DataFrame(tiles)
    df["ym"] = df.year * 12 + df.month
    df = df.sort_values(["tile_id", "ym"]).reset_index(drop=True)
    parts = df.tile_id.str.split(":")
    df["ilat"] = parts.str[1].astype(int)
    df["ilon"] = parts.str[2].astype(int)
    df["logm"] = np.log1p(df.modis)
    g = df.groupby("tile_id")
    df["logm_prev"] = g["logm"].shift(1).fillna(df["logm"])
    df["logm_3"] = g["logm"].rolling(3, min_periods=1).mean().reset_index(
        level=0, drop=True)
    df["d1"] = df["logm"] - df["logm_prev"]
    df["sin"] = np.sin(2 * np.pi * df.month / 12)
    df["cos"] = np.cos(2 * np.pi * df.month / 12)
    df["latr"] = df.lat / 90
    df["lonr"] = df.lon / 180
    df["sinlat"] = np.sin(np.pi * df.lat / 15)
    df["coslat"] = np.cos(np.pi * df.lat / 15)
    df["sinlon"] = np.sin(np.pi * df.lon / 30)
    df["coslon"] = np.cos(np.pi * df.lon / 30)
    idx = {(r.aoi, r.ilat, r.ilon, r.ym): r.Index for r in df.itertuples()}

    def nbr(i: int, dym: int) -> tuple[float, float]:
        row = df.iloc[i]
        tm = tv = 0.0
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                j = idx.get((row.aoi, row.ilat + dy, row.ilon + dx, row.ym + dym))
                if j is not None:
                    tm += df.at[j, "modis"]
                    tv += df.at[j, "viirs"]
        return tm, tv

    same = [nbr(i, 0) for i in range(len(df))]
    prev = [nbr(i, -1) for i in range(len(df))]
    df["nbr_m"] = [v[0] for v in same]
    df["nbr_v"] = [v[1] for v in same]
    df["nbr_m_prev"] = [v[0] for v in prev]
    df["nbr_v_prev"] = [v[1] for v in prev]
    df["nbr_modis_log"] = np.log1p(df.nbr_m)
    df["nbr_viirs_log"] = np.log1p(df.nbr_v)
    df["nbr_ratio"] = np.log((df.nbr_v + 1) / (df.nbr_m + 1))
    df["nbr_ratio_prev"] = np.log((df.nbr_v_prev + 1) / (df.nbr_m_prev + 1))
    df["nbr_viirs_prev_log"] = np.log1p(df.nbr_v_prev)
    return df
