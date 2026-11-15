"""Evaluate the hierarchical tile-seasonal anchor (HTS) on the official holdout.

HTS = per-tile monthly median log-ratio, shrunk toward the AOI-month B2 ratio:
    w = n / (n + 3),  anchor_tile,m = w * median_tile,m + (1 - w) * b2_aoi,m

The anchor is fit on years before the evaluation cutoff. Calendar-level
predictions sum the per-tile VIIRS-equivalent counts for each AOI-month, so the
comparison against B2 is on the same 72 official holdout rows.

    python -m scripts.firms.evaluate_hts

Writes backend/data/firms/models/hts_anchor_raw.json.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np

from app.firms import sf_tile
from app.firms.evaluation import _delta_ci, _metrics

BENCH = Path(__file__).resolve().parents[2] / "data" / "firms" / "benchmark"
OUT = Path(__file__).resolve().parents[2] / "data" / "firms" / "models" / "hts_anchor_raw.json"
K = 3.0


def official_rows() -> list[dict]:
    p = BENCH / "evaluation_samples_raw.csv"
    with p.open(encoding="utf-8") as fh:
        return [{"id": r["id"], "aoi": r["aoi"], "year": int(r["year"]),
                 "month": int(r["month"]), "viirs_ref": float(r["viirs_ref"]),
                 "b2": float(r["b2_seasonal_ratio"])}
                for r in csv.DictReader(fh)]


def main() -> dict:
    tiles = sf_tile.loads()
    pairs = sf_tile.load_aoi_pairs()
    if not tiles:
        raise RuntimeError("run scripts.firms.build_tiles first")
    ratios24 = sf_tile.b2_by_aoi(pairs, 2024)
    ratios23 = sf_tile.b2_by_aoi(pairs, 2023)
    tr24 = sf_tile.tile_anchors(tiles, ratios24, 2024, k=K)
    tr23 = sf_tile.tile_anchors(tiles, ratios23, 2023, k=K)
    by_month: dict[tuple, list[dict]] = defaultdict(list)
    for t in tiles:
        by_month[(t["aoi"], t["year"], t["month"])].append(t)

    def hts_counts(aoi: str, y: int, m: int, tr: dict) -> float:
        out = 0.0
        for t in by_month.get((aoi, y, m), []):
            anchor = tr.get((t["tile_id"], t["month"]))
            if anchor is None:
                b1, b2m = ratios24[t["aoi"]]
                anchor = b2m.get(t["month"], b1)
            out += max(math.exp(anchor) * (t["modis"] + 1.0) - 1.0, 0.0)
        return out

    # Global level, calibrated on 2023 with anchors that never see 2024-25.
    num = den = 0.0
    for p in pairs:
        if p["year"] != 2023:
            continue
        num += p["viirs"]
        den += hts_counts(p["aoi"], 2023, p["month"], tr23)
    scale = num / den if den else 1.0

    rows = official_rows()
    samples = []
    for r in rows:
        h = hts_counts(r["aoi"], r["year"], r["month"], tr24) * scale
        samples.append({**r, "hts": h})
    y = np.array([s["viirs_ref"] for s in samples])
    b = np.array([s["b2"] for s in samples])
    h = np.array([s["hts"] for s in samples])
    mae_b2 = float(np.mean(np.abs(b - y)))
    mae_hts = float(np.mean(np.abs(h - y)))
    headline_idx = [i for i, s in enumerate(samples)
                    if s["aoi"] in ("vietnam", "amazon")]
    headline = _metrics(y[headline_idx], h[headline_idx]) if headline_idx else None
    per_aoi = {}
    for aoi in sf_tile.active_aois(samples):
        idx = [i for i, s in enumerate(samples) if s["aoi"] == aoi]
        if not idx:
            continue
        per_aoi[aoi] = {
            **_metrics(y[idx], h[idx]),
            "b2_mae": round(float(np.mean(np.abs(b[idx] - y[idx]))), 2),
            "hts_mae": round(float(np.mean(np.abs(h[idx] - y[idx]))), 2),
        }
    row_ci = _delta_ci(samples, "hts", "b2")
    year_ci = _delta_ci(samples, "hts", "b2", block="year")
    gain = (mae_b2 - mae_hts) / mae_b2 if mae_b2 else 0.0
    gate_pass = bool(gain >= 0.02 and (row_ci or {}).get("ci95", [0, 1])[1] < 0)
    state = {
        "method_id": "hts_anchor_v1",
        "algorithm_version": "hts-v1.0",
        "method": "hierarchical_tile_seasonal_anchor",
        "data_tag": "raw",
        "k_shrink": K,
        "tile_deg": 1.0,
        "level_scale_2023": round(scale, 5),
        "n_test": len(samples),
        "b2_mae": round(mae_b2, 4),
        "hts_mae": round(mae_hts, 4),
        "mean_gain_vs_b2": round(gain, 4),
        "metrics": _metrics(y, h),
        "b2_metrics": _metrics(y, b),
        "headline": headline,
        "per_aoi": per_aoi,
        "comparisons": {"hts_vs_b2": row_ci,
                        "hts_vs_b2_year_block": year_ci},
        "gate": {"rule": ">=2% mean gain AND HTS-B2 CI upper < 0",
                 "passed": gate_pass},
        "deployed": bool(gate_pass),
        "status": ("passes gate" if gate_pass
                   else ("candidate: point estimate underperforms B2; no established gain"
                         if gain < 0 else
                         "candidate: point estimate improves B2; statistical gate not passed"
                         if gain > 0 else
                         "candidate: point estimate equals B2; no established gain")),
        "dataset_sha256": hashlib.sha256(
            (BENCH / "tile_pairs_raw.csv").read_bytes()).hexdigest(),
        "predictions": {s["id"]: {"hts": round(float(s["hts"]), 4),
                                  "b2": round(float(s["b2"]), 4),
                                  "viirs_ref": s["viirs_ref"]}
                        for s in samples},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(state, indent=1) + "\n", encoding="utf-8")
    return state


if __name__ == "__main__":
    s = main()
    print(json.dumps({k: s[k] for k in (
        "method_id", "n_test", "b2_mae", "hts_mae", "mean_gain_vs_b2",
        "per_aoi", "comparisons", "gate", "status")}, indent=1))
