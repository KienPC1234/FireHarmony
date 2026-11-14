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

EVALUATION_VERSION = "eval-v2"
METHOD_ORDER = ("b0_raw_modis", "b1_global_ratio", "b2_seasonal_ratio",
                "hgb_b2res_v4", "ts_logratio_pool_v2")


def _hash(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    err = np.asarray(y_pred, dtype=float) - np.asarray(y_true, dtype=float)
    denom = float(np.sum(y_true)) or 1.0
    return {"mae": round(float(np.mean(np.abs(err))), 4),
            "wape": round(float(np.sum(np.abs(err)) / denom), 6),
            "bias": round(float(np.mean(err)), 4),
            "n": int(len(y_true))}


def pair_id(aoi: str, p: dict) -> str:
    return f"{aoi}:{int(p['year'])}-{int(p['month']):02d}"


def split_years(pairs: list[dict], test_years: int) -> tuple[set[int], set[int]]:
    years = sorted({int(p["year"]) for p in pairs})
    if not years:
        return set(), set()
    return set(years[:-test_years]), set(years[-test_years:])


def ratios_from_train(train: list[dict]) -> tuple[float, dict[int, float]]:
    """B1 global log-ratio and B2 per-month log-ratio, from train only."""
    logs = [math.log((p["viirs"] + 1.0) / (p["modis"] + 1.0))
            for p in train if p["modis"] > 0]
    b1 = float(np.median(logs)) if logs else 0.0
    by_m: dict[int, float] = {}
    for m in range(1, 13):
        rs = [math.log((p["viirs"] + 1.0) / (p["modis"] + 1.0))
              for p in train if int(p["month"]) == m and p["modis"] > 0]
        if rs:
            by_m[m] = float(np.median(rs))
    return b1, by_m


def _counts(modis: float, log_ratio: float) -> float:
    return max(math.exp(log_ratio) * (max(float(modis), 0.0) + 1.0) - 1.0, 0.0)


def _delta_ci(samples: list[dict], method_a: str, method_b: str,
              n_boot: int = 2000, seed: int = 7,
              block: str | None = None) -> dict | None:
    """Bootstrap of ΔMAE (A − B); negative means A is better.

    Default resamples AOI-month rows. `block="year"` resamples whole years, which
    respects within-year correlation but is coarse when only two years exist.
    """
    rows = [s for s in samples if s.get(method_a) is not None and s.get(method_b) is not None]
    if len(rows) < 8:
        return None
    rng = np.random.default_rng(seed)
    y_all = np.array([s["viirs_ref"] for s in rows], dtype=float)
    pa_all = np.array([s[method_a] for s in rows], dtype=float)
    pb_all = np.array([s[method_b] for s in rows], dtype=float)
    deltas = []
    if block:
        keys = sorted({s.get(block) for s in rows}, key=str)
        groups = {k: [i for i, s in enumerate(rows) if s.get(block) == k]
                  for k in keys}
        for _ in range(n_boot):
            pick = rng.integers(0, len(keys), len(keys))
            idx = np.array([i for p in pick for i in groups[keys[p]]], dtype=int)
            deltas.append(float(np.mean(np.abs(pa_all[idx] - y_all[idx])) -
                                np.mean(np.abs(pb_all[idx] - y_all[idx]))))
        unit = (f"{block}-block cluster bootstrap ({len(keys)} blocks; "
                "coarse, respects within-block correlation)")
    else:
        for _ in range(n_boot):
            idx = rng.integers(0, len(rows), len(rows))
            deltas.append(float(np.mean(np.abs(pa_all[idx] - y_all[idx])) -
                                np.mean(np.abs(pb_all[idx] - y_all[idx]))))
        unit = "AOI-month row bootstrap (not independent hotspots)"
    deltas = np.array(deltas)
    return {
        "method_a": method_a, "method_b": method_b,
        "delta_mae": round(float(np.mean(np.abs(pa_all - y_all)) -
                                 np.mean(np.abs(pb_all - y_all))), 4),
        "ci95": [round(float(np.percentile(deltas, 2.5)), 4),
                 round(float(np.percentile(deltas, 97.5)), 4)],
        "prob_a_better": round(float(np.mean(deltas < 0)), 4),
        "n": len(rows), "n_boot": n_boot,
        "unit": unit,
    }


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
        {"aoi": a, "pairs": [{k: p[k] for k in ("year", "month", "modis", "viirs")}
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
                     "why": "Australia has 0/85 months with >=90% paired MODIS/VIIRS days; it is a sparse stress test, not a comparable monthly series."},
        "ts": {k: v for k, v in ts_info.items() if k not in ("models", "metrics")},
        "ts_unified_seed_mae_range": ts_seed_range,
        "ts_training_split_metrics": ts_info.get("metrics"),
        "methods": list(METHOD_ORDER),
        "note": ("Every method in `pooled`/`per_aoi` is scored on the exact same "
                 "sample IDs. `hgb_full_test` covers all monthly test pairs and is "
                 "reported separately because the Transformer lacks a 12-month "
                 "context for some of them."),
    }
    out = model_dir / f"evaluation_{data}.json"
    model_dir.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
    return {"trained": True, "manifest": manifest, "path": str(out)}


def load_manifest(data: str, model_dir: Path | None = None) -> dict | None:
    model_dir = Path(model_dir or Path(__file__).resolve().parents[2] / "data" / "firms" / "models")
    p = model_dir / f"evaluation_{data}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def cache_key(aoi: str, data: str, test_years: int, extra: str = "") -> str:
    """Cache identity includes data + algorithm + split, not just AOI."""
    fp = store.raw_fingerprint(aoi) if data == "raw" else store.sample_path(aoi).name
    payload = {"v": EVALUATION_VERSION, "aoi": aoi, "data": data,
               "test_years": test_years, "fp": fp,
               "ml": ml_v4.ALGORITHM_VERSION, "ts": ts_v2.ALGORITHM_VERSION,
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
