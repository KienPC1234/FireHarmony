"""Unified evaluation: every method scored on the SAME test sample IDs.

Audit P0-07/P0-11: HGB was scored per AOI, the Transformer used a pooled
metric over three AOIs, and the backtest cache could show a previous model
version. None of those numbers may be placed in one table.

This module builds one frozen evaluation set:

  1. choose holdout years once per AOI;
  2. train B0/B1/B2, HGB v4 and the pooled Transformer on the same train years;
  3. keep only AOI-months where every method has a prediction (the Transformer
     needs a 12-month context, so the intersection is its context-covered
     subset), and score all methods on that exact list;
  4. also report each method's full-test metric separately, clearly labelled.

The output (`evaluation_manifest.json`) is what /backtest and /xray read, so
the dashboard cannot quote a metric that does not belong to the served model.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from app.firms import coverage as cov, ml_cal, ml_v4, store, ts_v2
from app.firms.ml_core import counts_from_log_ratio as _counts
from app.firms.ml_core import delta_ci as _delta_ci
from app.firms.ml_core import metrics as _metrics
from app.firms.ml_core import ratios_from_train

EVALUATION_VERSION = "eval-v3"
MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "firms" / "models"
METHOD_ORDER = ("b0_raw_modis", "b1_global_ratio", "b2_seasonal_ratio",
                "hgb_b2res_v4", "ts_logratio_pool_v2")
# Artifact-backed methods are joined onto the same sample IDs by
# `merge_artifact_methods`; they are not retrained inside evaluate().
ARTIFACT_METHODS = ("stan_safe_v1", "hts_anchor_v1", "spatial_hgb_v1")


def _hash(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:16]


def pair_id(aoi: str, p: dict) -> str:
    return f"{aoi}:{int(p['year'])}-{int(p['month']):02d}"


def split_years(pairs: list[dict], test_years: int) -> tuple[set[int], set[int]]:
    years = sorted({int(p["year"]) for p in pairs})
    if not years:
        return set(), set()
    return set(years[:-test_years]), set(years[-test_years:])


def evaluate(data: str = "raw", aois: tuple[str, ...] = store.AOIS,
             test_years: int = 2, epochs: int = 140,
             model_dir: Path | None = None) -> dict:
    """Train and score every method on one frozen sample set."""
    model_dir = Path(model_dir or Path(__file__).resolve().parents[2] / "data" / "firms" / "models")
    pairs_by_aoi: dict[str, list[dict]] = {}
    for aoi in aois:
        if data == "raw":
            pairs = ml_cal.build_monthly_pairs_iter(
                store.iter_raw_rows(aoi, limit=None))
            eligible = cov.eligible_pair_months(aoi)
            if len(eligible) >= 24:
                pairs = [p for p in pairs
                         if f"{p['year']}-{p['month']:02d}" in eligible]
        else:
            pairs = ml_cal.build_monthly_pairs(store.load_records(aoi, 100000))
        if pairs:
            pairs_by_aoi[aoi] = pairs
    if not pairs_by_aoi:
        return {"trained": False, "reason": "no_pairs"}

    all_pairs = [p for ps in pairs_by_aoi.values() for p in ps]
    # One global holdout for every AOI: use years present in ALL AOIs, so a
    # pooled table never mixes 2025 for one region with 2026 for another.
    year_sets = [set(int(p["year"]) for p in ps) for ps in pairs_by_aoi.values()]
    common_years = set.intersection(*year_sets) if year_sets else set()
    global_test = set(sorted(common_years)[-test_years:]) if common_years else set()

    windows: list[dict] = []
    for aoi, ps in pairs_by_aoi.items():
        windows += ts_v2.build_windows(ps, aoi=aoi)

    # ---- pooled Transformer, trained on the same train years -------------
    ts_models = None
    ts_info: dict = {"trained": False}
    if ts_v2._HAS_TORCH:  # noqa: SLF001 - capability check is intentional
        tr = ts_v2.train_pooled(windows, test_years=test_years, epochs=epochs,
                                test_set=global_test)
        if tr.get("trained"):
            ts_models = tr["models"]
            ts_info = {k: v for k, v in tr.items() if k != "models"}

    # ---- per-AOI models and the shared intersection ----------------------
    per_aoi: dict[str, dict] = {}
    predicted: dict[str, dict[str, float]] = {}
    refs: dict[str, dict] = {}
    for aoi, pairs in pairs_by_aoi.items():
        years_all = sorted({int(p["year"]) for p in pairs})
        test_years_set = set(global_test)
        cutoff = min(global_test) if global_test else (max(years_all) + 1)
        train_years = {y for y in years_all if y < cutoff}
        train = [p for p in pairs if int(p["year"]) in train_years]
        test = [p for p in pairs if int(p["year"]) in test_years_set]
        if not train or not test:
            continue
        hgb_res = ml_v4.train_holdout(pairs, test_years=test_years,
                                      test_set=global_test)
        hgb_model = hgb_res.get("model")
        b1_log, b2_log = ratios_from_train(train)
        gate = hgb_res.get("residual_gate") or {}
        # HGB on its full test set (reported separately, never in the table)
        hgb_full = None
        if hgb_model is not None:
            hgb_full = _metrics(
                np.array([p["viirs"] for p in test]),
                ml_v4.predict_counts(hgb_model, test))
        # TS eval windows for this AOI, restricted to the same test years
        ev_wins = [w for w in windows
                   if w["aoi"] == aoi and int(w["year"]) in test_years_set]
        ts_pred_by_id: dict[str, float] = {}
        if ts_models and ev_wins:
            preds = np.mean([ts_v2._predict(m, ev_wins) for m in ts_models], axis=0)  # noqa: SLF001
            for w, v in zip(ev_wins, preds):
                ts_pred_by_id[f"{aoi}:{int(w['year'])}-{int(w['month']):02d}"] = float(v)
        test_by_id = {pair_id(aoi, p): p for p in test}
        ids = sorted(set(test_by_id) & set(ts_pred_by_id))
        per_aoi[aoi] = {
            "n_train": len(train), "n_test": len(test),
            "train_years": sorted(train_years), "test_years": sorted(test_years_set),
            "coverage": cov.coverage_summary(aoi),
            "coverage_class": (
                "full_month"
                if cov.coverage_summary(aoi)["full_months"] >=
                max(12, int(0.8 * cov.coverage_summary(aoi)["months"]))
                else "sparse_window"),
            "hgb_full_test": hgb_full,
            "hgb_residual_enabled": bool(hgb_res.get("residual_enabled")),
            "hgb_fallback_baseline": hgb_res.get("fallback_baseline"),
            "hgb_gate": gate,
            "ts_context_covered_months": len(ts_pred_by_id),
            "ts_months_missing_context": max(0, len(test_by_id) - len(ts_pred_by_id)),
            "b1_log_ratio": round(b1_log, 6),
            "b2_log_ratios": {str(k): round(v, 6) for k, v in sorted(b2_log.items())},
            "hgb_model": hgb_model,
            "hgb_meta": {k: v for k, v in hgb_res.items() if k != "model"},
            "ids": ids,
        }
        for sid in ids:
            p = test_by_id[sid]
            refs[sid] = {"aoi": aoi, "year": int(p["year"]), "month": int(p["month"]),
                         "modis": p["modis"], "viirs": p["viirs"]}
            predicted.setdefault("b0_raw_modis", {})[sid] = float(p["modis"])
            predicted.setdefault("b1_global_ratio", {})[sid] = _counts(p["modis"], b1_log)
            predicted.setdefault("b2_seasonal_ratio", {})[sid] = _counts(
                p["modis"], b2_log.get(int(p["month"]), b1_log))
            predicted.setdefault("ts_logratio_pool_v2", {})[sid] = ts_pred_by_id[sid]
            if hgb_model is not None:
                predicted.setdefault("hgb_b2res_v4", {})[sid] = float(
                    ml_v4.predict_counts(hgb_model, [p])[0])

    if not refs:
        return {"trained": False, "reason": "empty_intersection"}

    ids = sorted(refs)
    y = np.array([refs[s]["viirs"] for s in ids], dtype=float)
    metrics_per_aoi: dict[str, dict] = {}
    for aoi in per_aoi:
        sub = [s for s in ids if refs[s]["aoi"] == aoi]
        if not sub:
            continue
        yy = np.array([refs[s]["viirs"] for s in sub], dtype=float)
        metrics_per_aoi[aoi] = {}
        for method in METHOD_ORDER:
            vals = predicted.get(method, {})
            vec = [vals.get(s, float("nan")) for s in sub]
            if method == "hgb_b2res_v4" and per_aoi[aoi].get("hgb_model") is None:
                continue
            if any(math.isnan(v) for v in vec):
                continue
            metrics_per_aoi[aoi][method] = _metrics(yy, np.array(vec))
    for aoi, metrics in metrics_per_aoi.items():
        per_aoi[aoi]["metrics"] = metrics
        per_aoi[aoi]["n_eval"] = metrics.get("b2_seasonal_ratio", {}).get("n", 0)
    pooled: dict[str, dict] = {}
    for method in METHOD_ORDER:
        vals = predicted.get(method, {})
        vec = [vals.get(s, float("nan")) for s in ids]
        if any(math.isnan(v) for v in vec):
            continue
        pooled[method] = _metrics(y, np.array(vec))
    full_month_aois = [a for a, info in per_aoi.items()
                       if info.get("coverage_class") == "full_month"]
    fm_ids = [s for s in ids if refs[s]["aoi"] in full_month_aois]
    pooled_full_month: dict[str, dict] = {}
    if fm_ids:
        y_fm = np.array([refs[s]["viirs"] for s in fm_ids], dtype=float)
        for method in METHOD_ORDER:
            vals = predicted.get(method, {})
            vec = [vals.get(s, float("nan")) for s in fm_ids]
            if any(math.isnan(v) for v in vec):
                continue
            pooled_full_month[method] = _metrics(y_fm, np.array(vec))
    ts_seed_range = None
    if ts_models:
        eval_wins = [w for w in windows
                     if f"{w['aoi']}:{int(w['year'])}-{int(w['month']):02d}" in refs]
        eval_wins.sort(key=lambda w: f"{w['aoi']}:{int(w['year'])}-{int(w['month']):02d}")
        y_ts = np.array([w["viirs_ref"] for w in eval_wins], dtype=float)
        seed_maes = [float(np.mean(np.abs(
            ts_v2._predict(m, eval_wins) - y_ts))) for m in ts_models]  # noqa: SLF001
        ts_seed_range = [round(min(seed_maes), 2), round(max(seed_maes), 2)]
    samples = []
    for sid in ids:
        r = refs[sid]
        samples.append({
            "id": sid, "aoi": r["aoi"], "year": r["year"], "month": r["month"],
            "modis": r["modis"], "viirs_ref": r["viirs"],
            **{m: round(predicted[m][sid], 4) for m in METHOD_ORDER
               if sid in predicted.get(m, {})},
        })

    dataset_sha = _hash([
        {"aoi": a, "pairs": [{k: p[k] for k in
                              ("year", "month", "modis", "viirs",
                               "day_frac", "terra_frac") if k in p}
                             for p in ps]}
        for a, ps in sorted(pairs_by_aoi.items())])
    comparisons = {
        "hgb_vs_b2": _delta_ci(samples, "hgb_b2res_v4", "b2_seasonal_ratio"),
        "hgb_vs_b1": _delta_ci(samples, "hgb_b2res_v4", "b1_global_ratio"),
        "ts_vs_b2": _delta_ci(samples, "ts_logratio_pool_v2", "b2_seasonal_ratio"),
        "ts_vs_b1": _delta_ci(samples, "ts_logratio_pool_v2", "b1_global_ratio"),
    }
    comparisons = {k: v for k, v in comparisons.items() if v}
    scored_years = sorted({s["year"] for s in samples})
    excluded_months = sorted({
        f"{a}:{y}-{m:02d}" for a, ps in pairs_by_aoi.items()
        for p in ps for y, m in [(int(p["year"]), int(p["month"]))]
        if y in global_test and f"{a}:{y}-{m:02d}" not in refs
    })
    manifest = {
        "evaluation_version": EVALUATION_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "data": data,
        "data_source": ("NASA FIRMS observed" if data == "raw"
                        else "synthetic demo (NOT observed)"),
        "eval_unit": "aoi-month (VIIRS hotspot detections, not fires)",
        "candidate_holdout_years": sorted(global_test),
        "scored_years": scored_years,
        "test_years": scored_years,
        "test_year_count": test_years,
        "excluded_months": excluded_months,
        "dataset_sha256": dataset_sha,
        "pair_table_hash": dataset_sha,
        "comparisons": comparisons,
        "n_eval": len(ids),
        "samples": samples,
        "per_aoi": {
            a: {k: v for k, v in info.items()
                if k not in ("hgb_model", "ids", "hgb_meta")}
            for a, info in per_aoi.items()
        },
        "pooled": {"n_eval": len(ids), "metrics": pooled},
        "pooled_full_month": {"aois": full_month_aois, "n_eval": len(fm_ids),
                              "metrics": pooled_full_month},
        "headline": {"scope": "full-month AOIs only", "aois": full_month_aois,
                     "n_eval": len(fm_ids), "metrics": pooled_full_month,
                     "why": ("All scored AOIs meet the full-month coverage rule "
                             "(>=80% of months with >=90% paired MODIS/VIIRS days)."
                             if len(full_month_aois) == len(per_aoi)
                             else "AOIs outside the full-month coverage rule are excluded "
                                  "from this headline; see per_aoi.coverage_class.")},
        "ts": {k: v for k, v in ts_info.items() if k not in ("models", "metrics")},
        "ts_unified_seed_mae_range": ts_seed_range,
        "ts_training_split_metrics": ts_info.get("metrics"),
        "methods": list(METHOD_ORDER),
        "note": ("Every method in `pooled`/`per_aoi` is scored on the exact same "
                 "sample IDs. `hgb_full_test` covers all monthly test pairs and is "
                 "reported separately because the Transformer lacks a 12-month "
                 "context for some of them."),
    }
    manifest = merge_artifact_methods(manifest, model_dir)
    out = model_dir / f"evaluation_{data}.json"
    model_dir.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
    return {"trained": True, "manifest": manifest, "path": str(out)}


def _artifact_predictions(data: str, model_dir: Path) -> dict[str, dict[str, float]]:
    """Join committed artifact predictions onto the unified sample IDs.

    No retraining: STAN/HTS/spatial already publish one prediction per
    AOI-month. This is what stops the README from quoting a table that only
    contains the archived HGB/Transformer while the calendar serves STAN.
    """
    out: dict[str, dict[str, float]] = {}
    if data != "raw":
        return out

    def _read(name: str) -> dict | None:
        p = model_dir / name
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    stan = _read("stan_series_raw.json")
    if stan:
        for aoi, months in (stan.get("series") or {}).items():
            for ym, v in months.items():
                if v.get("target") is not None:
                    out.setdefault("stan_safe_v1", {})[f"{aoi}:{ym}"] = float(v["target"])
    hts = _read("hts_series_raw.json")
    if hts:
        for aoi, months in (hts.get("series") or {}).items():
            for ym, v in months.items():
                if v.get("hts") is not None:
                    out.setdefault("hts_anchor_v1", {})[f"{aoi}:{ym}"] = float(v["hts"])
    spatial = _read("spatial_hgb_raw.json")
    if spatial:
        for sid, v in (spatial.get("predictions") or {}).items():
            if v.get("spatial") is not None:
                out.setdefault("spatial_hgb_v1", {})[sid] = float(v["spatial"])
    return out


def _group_metrics(samples: list[dict], methods: list[str], ids: list[str]) -> dict:
    """Metrics per method on `ids`, skipping methods with a missing value."""
    idx = {s["id"]: s for s in samples}
    y = np.array([idx[i]["viirs_ref"] for i in ids], dtype=float)
    out = {}
    for method in methods:
        if any(idx[i].get(method) is None for i in ids):
            continue
        out[method] = _metrics(y, np.array([idx[i][method] for i in ids], dtype=float))
    return out


def merge_artifact_methods(manifest: dict, model_dir: Path | None = None) -> dict:
    """Add STAN/HTS/spatial to an evaluation manifest, on the same sample IDs.

    Pure bookkeeping over committed artifacts: no model is retrained and no
    sample is added or removed. `verify_manifest` can recompute every number.
    """
    model_dir = Path(model_dir or MODEL_DIR)
    preds = _artifact_predictions(manifest.get("data", "raw"), model_dir)
    if not preds:
        return manifest
    samples = manifest.get("samples") or []
    if not samples:
        return manifest
    methods = list(manifest.get("methods") or METHOD_ORDER)
    for m in preds:
        if m not in methods:
            methods.append(m)
    for s in samples:
        for m, mp in preds.items():
            if s["id"] in mp:
                s[m] = round(float(mp[s["id"]]), 4)
    ids = [s["id"] for s in samples]
    manifest["methods"] = methods
    manifest["evaluation_version"] = EVALUATION_VERSION
    manifest["primary_method_id"] = "stan_safe_v1"
    manifest["pooled"] = {"n_eval": len(ids),
                          "metrics": _group_metrics(samples, methods, ids)}
    fm_aois = ((manifest.get("headline") or {}).get("aois")) or [
        a for a, i in (manifest.get("per_aoi") or {}).items()
        if i.get("coverage_class") == "full_month"]
    fm_ids = [s["id"] for s in samples if s["aoi"] in fm_aois]
    if fm_ids:
        manifest["headline"] = {
            **(manifest.get("headline") or {}),
            "scope": "full-month AOIs only", "aois": fm_aois,
            "n_eval": len(fm_ids),
            "metrics": _group_metrics(samples, methods, fm_ids)}
    for aoi, info in (manifest.get("per_aoi") or {}).items():
        sub = [s["id"] for s in samples if s["aoi"] == aoi]
        info["metrics"] = _group_metrics(samples, methods, sub)
        info["n_eval"] = len(sub)
    comp = dict(manifest.get("comparisons") or {})
    for a, b, name in (("stan_safe_v1", "b2_seasonal_ratio", "stan_vs_b2"),
                       ("stan_safe_v1", "hts_anchor_v1", "stan_vs_hts"),
                       ("hts_anchor_v1", "b2_seasonal_ratio", "hts_vs_b2"),
                       ("spatial_hgb_v1", "b2_seasonal_ratio", "spatial_vs_b2")):
        c = _delta_ci(samples, a, b)
        if c:
            comp[name] = c
    manifest["comparisons"] = comp
    return manifest


def primary_status(data: str = "raw", model_dir: Path | None = None) -> dict:
    """Which model the frozen holdout currently supports as the primary.

    Two separate questions, deliberately not conflated:
      * `recommended_primary` = lowest pooled MAE among served candidates that
        also improves every AOI over B2 (the point-estimate winner);
      * `statistically_established` = its bootstrap CI vs B2 excludes zero.
    With a 72-month, 2-year holdout a point win can be real but not significant;
    the API reports both instead of hiding one behind the other.
    """
    m = load_manifest(data, model_dir)
    pooled = ((m or {}).get("pooled") or {}).get("metrics") or {}
    per = (m or {}).get("per_aoi") or {}
    comps = (m or {}).get("comparisons") or {}

    def beats_b2_everywhere(name: str) -> bool:
        if not per:
            return False
        for info in per.values():
            metrics = info.get("metrics") or {}
            a = (metrics.get(name) or {}).get("mae")
            b = (metrics.get("b2_seasonal_ratio") or {}).get("mae")
            if a is None or b is None or a >= b:
                return False
        return True

    candidates = []
    for name in ("stan_safe_v1", "hts_anchor_v1"):
        mae = (pooled.get(name) or {}).get("mae")
        if mae is not None and beats_b2_everywhere(name):
            candidates.append((mae, name))
    primary = min(candidates)[1] if candidates else "b2_seasonal_ratio"
    comp_key = {"stan_safe_v1": "stan_vs_b2",
                "hts_anchor_v1": "hts_vs_b2"}.get(primary, "")
    c = comps.get(comp_key) or {}
    ci = c.get("ci95") or []
    return {
        "design_primary": "stan_safe_v1",
        "recommended_primary": primary,
        "rule": ("lowest pooled MAE among served candidates that improve every "
                 "AOI over B2; CI is reported separately"),
        "delta_mae_vs_b2": c.get("delta_mae"),
        "ci95_vs_b2": ci,
        "statistically_established": bool(ci and ci[1] < 0),
        "evaluation_version": (m or {}).get("evaluation_version"),
    }


def unified_table(data: str = "raw", model_dir: Path | None = None) -> dict:
    """The one table: primary, baseline, fallback, comparator, pooled + headline."""
    manifest = load_manifest(data, model_dir)
    if not manifest:
        return {"available": False, "reason": "no_manifest"}
    manifest = merge_artifact_methods(manifest, model_dir)
    return {
        "available": True,
        "evaluation_version": manifest.get("evaluation_version"),
        "primary_method_id": manifest.get("primary_method_id"),
        "eval_unit": manifest.get("eval_unit"),
        "n_eval": manifest.get("n_eval"),
        "methods": manifest.get("methods"),
        "pooled": (manifest.get("pooled") or {}).get("metrics"),
        "headline": (manifest.get("headline") or {}).get("metrics"),
        "per_aoi": {a: (i.get("metrics") or {})
                    for a, i in (manifest.get("per_aoi") or {}).items()},
        "comparisons": manifest.get("comparisons"),
    }


_MANIFEST_CACHE: dict[str, tuple[int, int, dict]] = {}


def load_manifest(data: str, model_dir: Path | None = None) -> dict | None:
    model_dir = Path(model_dir or Path(__file__).resolve().parents[2] / "data" / "firms" / "models")
    p = model_dir / f"evaluation_{data}.json"
    if not p.exists():
        return None
    try:
        st = p.stat()
    except OSError:
        return None
    key = str(p)
    hit = _MANIFEST_CACHE.get(key)
    if hit is not None and hit[0] == st.st_mtime_ns and hit[1] == st.st_size:
        return hit[2]
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    _MANIFEST_CACHE[key] = (st.st_mtime_ns, st.st_size, doc)
    return doc


def _model_signature() -> dict:
    """Identity of every served/comparator artifact (path mtime + size)."""
    sig: dict[str, list[int]] = {}
    for name in ("stan_series_raw.json", "hts_series_raw.json",
                 "spatial_hgb_raw.json", "sf_lite_raw.json"):
        p = MODEL_DIR / name
        try:
            st = p.stat()
        except OSError:
            continue
        sig[name] = [st.st_mtime_ns, st.st_size]
    return sig


def cache_key(aoi: str, data: str, test_years: int, extra: str = "") -> str:
    """Cache identity includes data + algorithm + split, not just AOI."""
    fp = store.raw_fingerprint(aoi) if data == "raw" else store.sample_path(aoi).name
    payload = {"v": EVALUATION_VERSION, "aoi": aoi, "data": data,
               "test_years": test_years, "fp": fp,
               "ml": ml_v4.ALGORITHM_VERSION, "ts": ts_v2.ALGORITHM_VERSION,
               "models": _model_signature(),
               "extra": extra}
    return _hash(payload)


def verify_manifest(manifest: dict) -> dict:
    """Recompute metrics from the saved samples; used by CI/judges."""
    from collections import defaultdict
    by: dict[str, list[dict]] = defaultdict(list)
    for s in manifest.get("samples", []):
        by["all"].append(s)
        by[s["aoi"]].append(s)
    out: dict[str, dict] = {}
    for group, rows in by.items():
        if not rows:
            continue
        y = np.array([r["viirs_ref"] for r in rows], dtype=float)
        out[group] = {}
        for method in manifest.get("methods", METHOD_ORDER):
            vals = [r.get(method) for r in rows]
            if any(v is None for v in vals):
                continue
            out[group][method] = _metrics(y, np.array(vals, dtype=float))
    return out


def stamp_artifacts(manifest: dict, model_dir: Path | None = None) -> int:
    """Copy the unified metrics into cal_*/ts_* JSON sidecars.

    Keeps the status endpoints and the model card on the same numbers.
    """
    model_dir = Path(model_dir or Path(__file__).resolve().parents[2] / "data" / "firms" / "models")
    data = manifest.get("data", "raw")
    stamped = 0
    for aoi, info in (manifest.get("per_aoi") or {}).items():
        metrics = info.get("metrics") or {}
        rank = sorted([(v["mae"], k) for k, v in metrics.items()])
        ue = {
            "evaluation_version": manifest.get("evaluation_version"),
            "dataset_sha256": manifest.get("dataset_sha256"),
            "pair_table_hash": manifest.get("pair_table_hash"),
            "candidate_holdout_years": manifest.get("candidate_holdout_years"),
            "scored_years": manifest.get("scored_years"),
            "excluded_months": manifest.get("excluded_months"),
            "n_eval": info.get("n_eval"),
            "eval_unit": manifest.get("eval_unit"),
            "metrics": metrics,
            "pooled_metrics": (manifest.get("pooled") or {}).get("metrics", {}),
            "headline": manifest.get("headline"),
            "pooled_full_month": manifest.get("pooled_full_month"),
            "comparisons": manifest.get("comparisons"),
            "rank": [{"method": k, "mae": v} for v, k in rank],
            "best_method": rank[0][1] if rank else None,
            "coverage_class": info.get("coverage_class"),
            "coverage": {k: (info.get("coverage") or {}).get(k) for k in (
                "months", "full_months", "complete_months", "partial_months",
                "missing_day_histogram", "verified")},
            "ts_unified_seed_mae_range": manifest.get("ts_unified_seed_mae_range"),
            "note": manifest.get("note"),
        }
        info["unified_eval"] = ue
        for prefix in ("cal", "ts"):
            ap = model_dir / f"{prefix}_{aoi}{'' if data == 'sample' else '_' + data}.json"
            if not ap.exists():
                continue
            doc = json.loads(ap.read_text(encoding="utf-8"))
            doc["unified_eval"] = ue
            doc["eval_manifest_id"] = f"{manifest.get('evaluation_version')}:{manifest.get('dataset_sha256')}"
            doc["metrics_scope"] = "training_split; use unified_eval for the published table"
            ap.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
            stamped += 1
    return stamped
