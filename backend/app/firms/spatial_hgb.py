"""Spatial HGB: retrospective harmonization with neighbouring-tile context.

Why this exists
---------------
The tile-level residual transformer, ridge and Poisson GLMs did not beat the HTS
anchor on rolling years. A gradient-boosted model with *spatial* features does,
but only when it can see the same-month VIIRS counts of neighbouring 1-degree
tiles. That is a **retrospective** covariate: the calendar has VIIRS observations
for many tiles in the month being harmonized, so neighbouring observations are
available when reconstructing that month. It is NOT a forecast feature.

Two variants are reported:
- `spatial`: uses same-month neighbour VIIRS (retrospective).
- `temporal_only`: uses only previous-month neighbour VIIRS + same-month
  neighbour MODIS (forecast-safe).

Target: residual log-ratio on the HTS anchor:
    y = log((VIIRS+1)/(MODIS+1)) - log(anchor_counts+1)
Predictions are summed over tiles to the AOI-month, which is the served unit.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from app.firms import sf_tile
from app.firms.evaluation import _delta_ci, _metrics

BENCH = Path(__file__).resolve().parents[2] / "data" / "firms" / "benchmark"
MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "firms" / "models"
METHOD_ID = "spatial_hgb_v1"
ALGORITHM_VERSION = "spatial-hgb-v1.0"
BASE_FEATURES = [
    "logm", "logm_prev", "logm_3", "d1", "sin", "cos",
    "latr", "lonr", "sinlat", "coslat", "sinlon", "coslon",
    "anchor", "tile_clim", "days_modis", "days_viirs",
]
SPATIAL_FEATURES = ["nbr_modis_log", "nbr_viirs_log", "nbr_ratio", "nbr_ratio_prev"]
SAFE_FEATURES = ["nbr_modis_log", "nbr_ratio_prev", "nbr_viirs_prev_log"]


def _frame() -> pd.DataFrame:
    tiles = sf_tile.loads()
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


def _fit_predict(df, pairs, cutoff, test_years, extra):
    ratios = sf_tile.b2_by_aoi(pairs, cutoff)
    anchors = sf_tile.tile_anchors(sf_tile.loads(), ratios, cutoff)
    d = df.copy()
    d["anchor"] = [anchors.get((t, m), 0.0)
                   for t, m in zip(d.tile_id, d.month)]
    train_mask = d.year < cutoff
    clim = d[train_mask].groupby("tile_id").logm.mean().rename("tile_clim")
    d = d.join(clim, on="tile_id")
    d["tile_clim"] = d.tile_clim.fillna(d[train_mask].logm.mean())
    tr = d[train_mask & (d.modis >= 20)]
    te = d[d.year.isin(test_years)].copy()
    feats = BASE_FEATURES + extra
    model = HistGradientBoostingRegressor(
        loss="squared_error", max_iter=250, learning_rate=0.05,
        l2_regularization=1.0, min_samples_leaf=10, random_state=7)
    model.fit(tr[feats], np.log((tr.viirs + 1) / (tr.modis + 1)) - tr.anchor)
    te["pred"] = np.maximum(
        np.exp(te.anchor + model.predict(te[feats])) * (te.modis + 1) - 1, 0)
    te["hts_counts"] = np.maximum(
        np.exp(te.anchor) * (te.modis + 1) - 1, 0)
    agg = []
    for (aoi, y, m), grp in te.groupby(["aoi", "year", "month"]):
        agg.append({"aoi": aoi, "year": int(y), "month": int(m),
                    "viirs": float(grp.viirs.sum()),
                    "pred": float(grp.pred.sum()),
                    "hts": float(grp.hts_counts.sum())})
    b2 = []
    for row in agg:
        b1, b2m = ratios[row["aoi"]]
        # B2 on the same tile set: sum of per-tile counts.
        sub = te[(te.aoi == row["aoi"]) & (te.year == row["year"])
                 & (te.month == row["month"])]
        b2.append(float(np.sum(np.maximum(
            np.exp(sub.month.map(lambda mm: b2m.get(mm, b1))) * (sub.modis + 1) - 1, 0))))
    for row, b in zip(agg, b2):
        row["b2"] = b
    return agg


def _official_samples(agg: list[dict]) -> list[dict]:
    import csv
    official = {}
    with (BENCH / "evaluation_samples_raw.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            official[(r["aoi"], int(r["year"]), int(r["month"]))] = {
                "viirs_ref": float(r["viirs_ref"]),
                "b2": float(r["b2_seasonal_ratio"]),
            }
    out = []
    for row in agg:
        key = (row["aoi"], row["year"], row["month"])
        if key in official:
            off = official[key]
            out.append({**row, "viirs_ref": off["viirs_ref"],
                        "spatial": row["pred"], "hts_anchor": row["hts"],
                        "b2_seasonal_ratio": off["b2"]})
    return out


def spatial_holdout(df, pairs, cut: int = 2024, every: int = 5) -> dict:
    """Hold out whole tiles (never seen in training), score only those tiles."""
    tiles = sorted(df.tile_id.unique())
    held = {t for t in tiles
            if int(hashlib.sha256(t.encode()).hexdigest()[:8], 16) % every == 0}
    ratios = sf_tile.b2_by_aoi(pairs, cut)
    anchors = sf_tile.tile_anchors(sf_tile.loads(), ratios, cut)
    d = df.copy()
    d["anchor"] = [anchors.get((t, m), 0.0)
                   for t, m in zip(d.tile_id, d.month)]
    train_mask = d.year < cut
    clim = d[train_mask].groupby("tile_id").logm.mean().rename("tile_clim")
    d = d.join(clim, on="tile_id")
    d["tile_clim"] = d.tile_clim.fillna(d[train_mask].logm.mean())
    tr = d[train_mask & ~d.tile_id.isin(held) & (d.modis >= 20)]
    te = d[(d.year >= cut) & d.tile_id.isin(held)].copy()
    feats = BASE_FEATURES + SPATIAL_FEATURES
    model = HistGradientBoostingRegressor(
        loss="squared_error", max_iter=250, learning_rate=0.05,
        l2_regularization=1.0, min_samples_leaf=10, random_state=7)
    model.fit(tr[feats], np.log((tr.viirs + 1) / (tr.modis + 1)) - tr.anchor)
    te["pred"] = np.maximum(
        np.exp(te.anchor + model.predict(te[feats])) * (te.modis + 1) - 1, 0)
    te["hts"] = np.maximum(np.exp(te.anchor) * (te.modis + 1) - 1, 0)
    rows = []
    for (aoi, _y, _m), grp in te.groupby(["aoi", "year", "month"]):
        rows.append({"aoi": aoi, "viirs": float(grp.viirs.sum()),
                     "pred": float(grp.pred.sum()),
                     "hts": float(grp.hts.sum())})
    out = {"held_tiles": len(held), "train_rows": int(len(tr)),
           "n_aoi_months": len(rows),
           "spatial_mae": round(float(np.mean([abs(r["pred"] - r["viirs"]) for r in rows])), 1),
           "hts_mae": round(float(np.mean([abs(r["hts"] - r["viirs"]) for r in rows])), 1)}
    out["per_aoi"] = {}
    for aoi in sf_tile.AOIS:
        sub = [r for r in rows if r["aoi"] == aoi]
        if sub:
            out["per_aoi"][aoi] = {
                "spatial_mae": round(float(np.mean([abs(r["pred"] - r["viirs"]) for r in sub])), 1),
                "hts_mae": round(float(np.mean([abs(r["hts"] - r["viirs"]) for r in sub])), 1),
                "n": len(sub)}
    return out


def run() -> dict:
    df = _frame()
    pairs = sf_tile.load_aoi_pairs()
    rolling = {}
    for cut, years in ((2021, [2021]), (2022, [2022]),
                       (2023, [2023]), (2024, [2024, 2025])):
        agg = _fit_predict(df, pairs, cut, years, SPATIAL_FEATURES)
        rolling[str(cut)] = {
            "n_aoi_months": len(agg),
            **{k: round(float(np.mean(np.abs(np.array([r[k] for r in agg]) -
                                             np.array([r["viirs"] for r in agg])))), 1)
               for k in ("b2", "hts", "pred")},
        }
    agg_final = _fit_predict(df, pairs, 2024, [2024, 2025], SPATIAL_FEATURES)
    safe_final = _fit_predict(df, pairs, 2024, [2024, 2025], SAFE_FEATURES)
    samples = _official_samples(agg_final)
    safe_map = {(r["aoi"], r["year"], r["month"]): r["pred"] for r in safe_final}
    for s in samples:
        s["spatial_safe"] = safe_map.get((s["aoi"], s["year"], s["month"]), s["hts_anchor"])
    y = np.array([s["viirs_ref"] for s in samples])
    per_aoi = {}
    for aoi in sf_tile.AOIS:
        idx = [i for i, s in enumerate(samples) if s["aoi"] == aoi]
        if not idx:
            continue
        per_aoi[aoi] = {
            "spatial": _metrics(y[idx], np.array([samples[i]["spatial"] for i in idx])),
            "spatial_safe": _metrics(y[idx], np.array([samples[i]["spatial_safe"] for i in idx])),
            "hts": _metrics(y[idx], np.array([samples[i]["hts_anchor"] for i in idx])),
            "b2": _metrics(y[idx], np.array([samples[i]["b2_seasonal_ratio"] for i in idx])),
        }
    comp = {
        "spatial_vs_b2": _delta_ci(samples, "spatial", "b2_seasonal_ratio"),
        "spatial_vs_hts": _delta_ci(samples, "spatial", "hts_anchor"),
        "spatial_safe_vs_hts": _delta_ci(samples, "spatial_safe", "hts_anchor"),
        "spatial_vs_b2_year_block": _delta_ci(
            samples, "spatial", "b2_seasonal_ratio", block="year"),
    }
    state = {
        "method_id": METHOD_ID,
        "algorithm_version": ALGORITHM_VERSION,
        "method": "spatial_hgb_residual_on_hts",
        "data": "raw",
        "retrospective": True,
        "requires_neighbour_viirs": True,
        "feature_note": (
            "Spatial features use same-month VIIRS of neighbouring 1-degree "
            "tiles. Valid for retrospective harmonization, invalid for a "
            "forecast; the `spatial_safe` variant excludes them."),
        "features": BASE_FEATURES + SPATIAL_FEATURES,
        "safe_features": BASE_FEATURES + SAFE_FEATURES,
        "n_train": int((df.year < 2024).sum()),
        "n_test": len(samples),
        "rolling": rolling,
        "per_aoi": per_aoi,
        "comparisons": comp,
        "headline": _metrics(y, np.array([s["spatial"] for s in samples])),
        "b2_headline": _metrics(y, np.array([s["b2_seasonal_ratio"] for s in samples])),
        "hts_headline": _metrics(y, np.array([s["hts_anchor"] for s in samples])),
        "safe_headline": _metrics(y, np.array([s["spatial_safe"] for s in samples])),
        "spatial_holdout": spatial_holdout(df, pairs),
        "dataset_sha256": hashlib.sha256(
            (BENCH / "tile_pairs_raw.csv").read_bytes()).hexdigest(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "predictions": {f"{s['aoi']}:{s['year']}-{s['month']:02d}": {
            "spatial": round(float(s["spatial"]), 3),
            "spatial_safe": round(float(s["spatial_safe"]), 3),
            "hts": round(float(s["hts_anchor"]), 3),
            "b2": round(float(s["b2_seasonal_ratio"]), 3),
            "viirs_ref": s["viirs_ref"]} for s in samples},
    }
    return state


def main() -> dict:
    state = run()
    out = MODEL_DIR / "spatial_hgb_raw.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(state, indent=1) + "\n", encoding="utf-8")
    return state


if __name__ == "__main__":
    s = main()
    print(json.dumps({k: s[k] for k in (
        "method_id", "rolling", "headline", "b2_headline", "hts_headline",
        "safe_headline", "comparisons")}, indent=1))
