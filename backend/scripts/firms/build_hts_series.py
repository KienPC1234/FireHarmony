"""Precompute monthly HTS targets for serving.

For each AOI-month the target is the sum of per-tile VIIRS-equivalent counts
from the hierarchical tile-seasonal anchor. The anchor for a calendar year Y is
fit only on years < Y (expanding cutoff), except the 2024-2025 holdout where the
cutoff is fixed at 2024. That keeps the retrospective calendar free of
look-ahead while matching the published holdout protocol.

    python -m scripts.firms.build_hts_series

Writes backend/data/firms/models/hts_series_raw.json (small).
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

from app.firms import sf_tile

BENCH = Path(__file__).resolve().parents[2] / "data" / "firms" / "benchmark"
OUT = Path(__file__).resolve().parents[2] / "data" / "firms" / "models" / "hts_series_raw.json"


def main() -> dict:
    tiles = sf_tile.loads()
    pairs = sf_tile.load_aoi_pairs()
    if not tiles or not pairs:
        raise RuntimeError("run scripts.firms.build_tiles first")
    by_month: dict[tuple, list[dict]] = defaultdict(list)
    for t in tiles:
        by_month[(t["aoi"], t["year"], t["month"])].append(t)
    pair_by: dict[tuple, dict] = {(p["aoi"], p["year"], p["month"]): p for p in pairs}

    anchors_by_cutoff: dict[int, dict] = {}
    ratios_by_cutoff: dict[int, dict] = {}

    def for_cutoff(cut: int):
        if cut not in anchors_by_cutoff:
            ratios = sf_tile.b2_by_aoi(pairs, cut)
            ratios_by_cutoff[cut] = ratios
            anchors_by_cutoff[cut] = sf_tile.tile_anchors(tiles, ratios, cut)
        return ratios_by_cutoff[cut], anchors_by_cutoff[cut]

    aois = sf_tile.active_aois(tiles)
    series: dict[str, dict] = {a: {} for a in aois}
    years = sorted({t["year"] for t in tiles})
    for y in years:
        cut = 2024 if y >= 2024 else y
        ratios, anchors = for_cutoff(cut)
        for aoi in aois:
            if aoi not in ratios:
                continue
            raw_ratio = ratios[aoi]
            for m in range(1, 13):
                ts = by_month.get((aoi, y, m))
                if not ts:
                    continue
                hts = 0.0
                for t in ts:
                    anchor = anchors.get((t["tile_id"], m))
                    if anchor is None:
                        b1, b2m = raw_ratio
                        anchor = b2m.get(m, b1)
                    hts += max(math.exp(anchor) * (t["modis"] + 1.0) - 1.0, 0.0)
                pair = pair_by.get((aoi, y, m))
                b2 = None
                if pair:
                    b2 = round(max(math.exp(raw_ratio[1].get(m, raw_ratio[0])) *
                                   (pair["modis"] + 1.0) - 1.0, 0.0), 3)
                series[aoi][f"{y}-{m:02d}"] = {
                    "hts": round(hts, 3),
                    "b2": b2,
                    "viirs": round(float(pair["viirs"]), 3) if pair else None,
                    "cutoff": cut,
                }
    state = {
        "method_id": "hts_anchor_v1",
        "algorithm_version": "hts-v1.0",
        "tile_deg": 1.0,
        "cutoff_rule": "year for <2024; fixed 2024 for 2024-2025",
        "aois": list(sf_tile.AOIS),
        "months": {a: len(series[a]) for a in aois},
        "dataset_sha256": hashlib.sha256(
            (BENCH / "tile_pairs_raw.csv").read_bytes()).hexdigest(),
        "series": series,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(state, separators=(",", ":")) + "\n", encoding="utf-8")
    return {k: state[k] for k in ("method_id", "aois", "months", "cutoff_rule")}


if __name__ == "__main__":
    print(json.dumps(main(), indent=1))
