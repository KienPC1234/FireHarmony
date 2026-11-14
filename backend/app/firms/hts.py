"""Serving helpers for the hierarchical tile-seasonal anchor (HTS).

HTS is a candidate method: it improves the point estimate on every AOI but its
95% CI still includes zero, so it is labelled as a candidate and is never
silently substituted for the statistical baseline.
"""
from __future__ import annotations

import json
from pathlib import Path

from app.firms.ml_core import apply_monthly_targets

MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "firms" / "models"
SERIES_FILE = "hts_series_raw.json"
ALGORITHM_VERSION = "hts-v1.0"


def series_path(model_dir: Path | None = None) -> Path:
    return (model_dir or MODEL_DIR) / SERIES_FILE


_HTS_CACHE: tuple[float, str, dict] | None = None


def load_series(model_dir: Path | None = None) -> dict | None:
    global _HTS_CACHE
    p = series_path(model_dir)
    if not p.exists():
        return None
    try:
        mtime = p.stat().st_mtime
    except OSError:
        return None
    if _HTS_CACHE is not None and _HTS_CACHE[0] == mtime and _HTS_CACHE[1] == str(p):
        return _HTS_CACHE[2]
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        _HTS_CACHE = (mtime, str(p), data)
        return data
    except (OSError, json.JSONDecodeError):
        return None


def targets(aoi: str, model_dir: Path | None = None) -> dict[str, float]:
    data = load_series(model_dir)
    if not data:
        return {}
    return {ym: float(v["hts"])
            for ym, v in (data.get("series", {}).get(aoi) or {}).items()}


def status(model_dir: Path | None = None) -> dict:
    data = load_series(model_dir)
    if not data:
        return {"available": False, "method_id": "hts_anchor_v1",
                "hint": "python -m scripts.firms.build_hts_series"}
    return {
        "available": True,
        "method_id": data.get("method_id"),
        "algorithm_version": data.get("algorithm_version"),
        "candidate": True,
        "months": data.get("months"),
        "cutoff_rule": data.get("cutoff_rule"),
        "dataset_sha256": data.get("dataset_sha256"),
    }


def apply_monthly(daily_stat: list[dict], targets_by_month: dict[str, float],
                  method_id: str = "hts_anchor_v1",
                  requested: str = "hts",
                  candidate: bool = True,
                  gate_passed: bool = False,
                  method_by_month: dict[str, str] | None = None,
                  targets_low: dict[str, float] | None = None,
                  targets_high: dict[str, float] | None = None,
                  estimate_label: str = "hts_predicted",
                  labels_by_month: dict[str, str] | None = None) -> tuple[list[dict], dict]:
    """Rescale MODIS-only cells so each month totals the model target.

    VIIRS-observed cells are never changed; only the estimated part is
    redistributed. The conservation implementation lives in
    `ml_core.apply_monthly_targets` and is shared with STAN, HGB-v4 and TS.
    Optional `targets_low/high` propagate a model predictive band onto the
    estimated cells (STAN's NB2 interval); HTS itself passes no band.
    """
    return apply_monthly_targets(
        daily_stat, targets_by_month,
        estimate_label=estimate_label, method_id=method_id,
        requested=requested, candidate=candidate, gate_passed=gate_passed,
        method_by_month=method_by_month,
        targets_low=targets_low, targets_high=targets_high,
        labels_by_month=labels_by_month)
