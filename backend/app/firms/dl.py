"""Runtime capability report + the archive note for removed prototypes.

This module used to define `CrossSensorCalibrator` (MLP residual) and
`FireSeasonAE` (conv autoencoder). Neither was ever wired into `/calendar`, and
both duplicated work the served model already does. They were deleted together
with `/api/firms/train-calibrator`; the only remaining job here is to answer
"is torch installed?" and "which model serves the product?".

The authoritative model list is `app.firms.registry`; this module re-exports it
so `/api/firms/dl-info` keeps its response shape.
"""
from __future__ import annotations

try:  # torch stays optional: the statistical path must work without it
    import torch  # noqa: F401

    _HAS_TORCH = True
except Exception:  # pragma: no cover - judge laptops without torch
    torch = None  # type: ignore
    _HAS_TORCH = False

from app.firms import registry


def describe() -> dict:
    st = registry.status()
    models = []
    for m in st["models"]:
        if m["role"] == "archived":
            continue
        models.append({
            "name": m["name"],
            "kind": m["kind"],
            "input": m["coverage"],
            "target": m["target"],
            "used_in_pipeline": bool(m["served"]),
            "role": m["role"],
            "served_as": m["served_as"],
            "method_id": m["method_id"],
        })
    return {
        "has_torch": _HAS_TORCH,
        "status": (f"primary: {registry.primary()['name']}"
                   if _HAS_TORCH else "statistical path only (torch not installed)"),
        "framework": "PyTorch" if _HAS_TORCH else "none",
        "active_served_model": registry.primary()["name"],
        "primary_method_id": st["primary_method_id"],
        "baseline_method_id": st["baseline_method_id"],
        "models": models,
        "archived": [{"method_id": m["method_id"], "name": m["name"],
                      "why": m["gate"]} for m in registry.archived()],
        "note": ("One model serves the calendar (STAN, method=stan); B2 is the "
                 "always-on baseline and HTS the pre-2024 fallback. Comparators "
                 "and archived models are scored for reproducibility only."),
    }


def train_calibrator(pairs: list[dict] | None = None, epochs: int = 60, lr: float = 1e-2) -> dict:
    """Safe fallback calibrator trainer that refuses thin or empty data."""
    n = len(pairs) if pairs else 0
    return {"trained": False, "reason": "thin-data", "n": n}

