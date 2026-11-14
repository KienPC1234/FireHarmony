"""One registry for every model in the repo: role, artifact, and gate status.

The project accumulated seven model families (`ml_v4`, `ts_v2`, `stan`, `hts`,
`spatial_hgb`, `sf_lite`, `sf_tile`) and each one carried its own status
endpoint, artifact naming and claim. That made it impossible for a reader (or
the UI) to answer "what actually serves the calendar?".

This registry is the single answer. Exactly one entry has `role == "primary"`;
everything else is a baseline (always-on reference), a comparator (scored but
never served) or archived (code/artifacts kept for reproducibility only).

Keep this file declarative: no imports of torch/sklearn, so /health and
/dl-info stay cheap on a machine without torch.
"""
from __future__ import annotations

from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "firms" / "models"

PRIMARY = "stan_safe_v1"
BASELINE = "b2_seasonal_ratio"
FALLBACK = "hts_anchor_v1"

MODELS: tuple[dict, ...] = (
    {
        "method_id": "stan_safe_v1",
        "name": "STAN (Spatial-Temporal Anchor Network)",
        "role": "primary",
        "served": True,
        "served_as": "method=stan",
        "family": "torch",
        "kind": "Dilated causal TCN + seasonal FiLM + target-month attention, NB2 loss",
        "target": "VIIRS-equivalent hotspot activity, anchored on HTS",
        "artifact": "stan_series_raw.json",
        "weights": "stan_safe_raw.pt",
        "evaluation": "stan_safe_raw.json#official",
        "coverage": "raw data, 2024+ (HTS anchor before 2024)",
        "gate": "must beat B2 on the frozen holdout with a CI excluding 0; re-check after every retrain",
    },
    {
        "method_id": "b2_seasonal_ratio",
        "name": "Seasonal ratio baseline (B2)",
        "role": "baseline",
        "served": True,
        "served_as": "method=stat",
        "family": "statistical",
        "kind": "per-month empirical k = MODIS/VIIRS",
        "target": "sensor-adjusted activity index",
        "artifact": None,
        "evaluation": "evaluation_raw.json#pooled",
        "coverage": "any data (sample, raw, upload)",
        "gate": "reference model; every learned model must beat it to serve",
    },
    {
        "method_id": "hts_anchor_v1",
        "name": "Hierarchical tile-seasonal anchor (HTS)",
        "role": "fallback",
        "served": True,
        "served_as": "method=hts, and STAN pre-2024 fallback",
        "family": "statistical",
        "kind": "shrunk tile-month anchor toward the AOI seasonal ratio",
        "target": "VIIRS-equivalent hotspot activity",
        "artifact": "hts_series_raw.json",
        "evaluation": "hts_anchor_raw.json",
        "coverage": "raw data only",
        "gate": "point estimate beats B2 on all AOIs; CI still includes 0",
    },
    {
        "method_id": "spatial_hgb_v1",
        "name": "Spatial HGB (retrospective reconstruction)",
        "role": "comparator",
        "served": False,
        "served_as": None,
        "family": "sklearn",
        "kind": "HistGradientBoosting with 8-neighbour tile context",
        "target": "spatial gap-fill of the same-month VIIRS count",
        "artifact": "spatial_hgb_raw.json",
        "evaluation": "spatial_hgb_raw.json#headline",
        "coverage": "raw data only; needs same-month neighbour VIIRS",
        "gate": "wins retrospectively; invalid as a forecast, so not served",
    },
    {
        "method_id": "sf_lite_v1",
        "name": "SensorFormer Lite (CrossSensorCalibrator)",
        "role": "comparator",
        "served": False,
        "served_as": None,
        "family": "torch",
        "kind": "temporal CNN + one attention layer + monotone quantile heads",
        "target": "residual on B2 with an 80% predictive band",
        "artifact": "sf_lite_raw.json",
        "evaluation": "sf_lite_raw.json#metrics",
        "coverage": "artifact only",
        "gate": "loses to B2 (MAE 2458 vs 2387), gate closed",
    },
    {
        "method_id": "hgb_b2res_v4",
        "name": "HGB residual calibrator (archived)",
        "artifact_method_id": "hgb-b2residual-v4",
        "role": "archived",
        "served": False,
        "served_as": None,
        "family": "sklearn",
        "kind": "HistGradientBoosting residual on the B2 log ratio",
        "target": "VIIRS-equivalent hotspot activity",
        "artifact": "cal_*_raw.json",
        "evaluation": "evaluation_raw.json#pooled",
        "coverage": "artifact only",
        "gate": "residual gate abstains; kept for reproducibility, not served",
    },
    {
        "method_id": "ts_logratio_pool_v2",
        "name": "Pooled seasonal Transformer (archived)",
        "role": "archived",
        "served": False,
        "served_as": None,
        "family": "torch",
        "kind": "3-AOI transformer encoder over a 12-month MODIS window",
        "target": "log-ratio VIIRS/MODIS",
        "artifact": "ts_*_raw.pt",
        "evaluation": "evaluation_raw.json#pooled",
        "coverage": "artifact only",
        "gate": "loses to B2 (MAE 2934 vs 2746), archived",
    },
    {
        "method_id": "tileformer_v1",
        "name": "TileFormer (archived)",
        "role": "archived",
        "served": False,
        "served_as": None,
        "family": "torch",
        "kind": "region-agnostic tile residual transformer",
        "target": "residual on the tile anchor",
        "artifact": None,
        "evaluation": "docs/TILE_HIERARCHY.md",
        "coverage": "research only",
        "gate": "does not beat the HTS anchor; artifacts removed",
    },
)


def get(method_id: str) -> dict | None:
    return next((m for m in MODELS if m["method_id"] == method_id), None)


def primary() -> dict:
    return get(PRIMARY) or MODELS[0]


def served_methods() -> list[str]:
    return [m["method_id"] for m in MODELS if m["served"]]


def archived() -> list[dict]:
    return [m for m in MODELS if m["role"] == "archived"]


def status(model_dir: Path | None = None) -> dict:
    """Registry + artifact presence, without importing torch or sklearn."""
    root = model_dir or MODEL_DIR
    rows = []
    for m in MODELS:
        art = m.get("artifact")
        present = bool(art) and any(root.glob(art)) if art else False
        rows.append({**m, "artifact_present": present})
    return {
        "primary_method_id": PRIMARY,
        "baseline_method_id": BASELINE,
        "fallback_method_id": FALLBACK,
        "served": served_methods(),
        "roles": sorted({m["role"] for m in MODELS}),
        "models": rows,
    }
