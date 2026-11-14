"""One registry for every model in the repo: role, artifact, and gate status.

Three methods serve the calendar after the 2026-11-14 consolidation: STAN
(primary), B2 (baseline) and HTS (fallback). Archived HGB/TS/TileFormer and the
retrospective spatial/SensorFormer comparators were removed, so this registry
no longer needs a "comparator" or "archived" role.

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
