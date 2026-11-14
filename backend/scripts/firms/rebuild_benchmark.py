"""Rebuild the published metrics from committed monthly pairs (no raw pixels).

This is the middle reproducibility level (audit V5 P0-02):

  verify-artifacts : recompute MAE from committed predictions (fast)
  rebuild-fixture  : retrain B1/B2/HGB/TS from training_pairs_*.csv and
                     compare with BENCHMARK.json (this script; ~minutes)
  retrain-full     : fetch raw NASA files with checksums, then train (needs key)

Usage:
  python -m scripts.firms.rebuild_benchmark --data raw
  python -m scripts.firms.rebuild_benchmark --data sample
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import evaluation, ml_cal, ml_v4, ts_v2  # noqa: E402

BENCH = BACKEND / "data" / "firms" / "benchmark"
TOL = 0.5  # MAE tolerance in detection units for a fixture rebuild


def _read_pairs(path: Path) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    with path.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            out.setdefault(r["aoi"], []).append({
                "year": int(r["year"]), "month": int(r["month"]),
                "modis": float(r["modis"]), "viirs": float(r["viirs"]),
                "day_frac": float(r["day_frac"]), "terra_frac": float(r["terra_frac"]),
            })
    return out


def _metrics(y, p):
    e = np.asarray(p) - np.asarray(y)
    return {"mae": float(np.mean(np.abs(e))),
            "wape": float(np.sum(np.abs(e)) / (np.sum(y) or 1.0)),
            "bias": float(np.mean(e))}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="raw", choices=("raw", "sample"))
    a = ap.parse_args()
    pairs_by_aoi = _read_pairs(BENCH / f"training_pairs_{a.data}.csv")
    manifest = evaluation.load_manifest(a.data)
    if not manifest:
        print("no evaluation manifest")
        return 2
    test_years = int(manifest.get("test_year_count", 2))
    test_set = set(int(y) for y in (manifest.get("scored_years") or []))
    sample_ids = {s["id"]: s for s in manifest.get("samples", [])}

    # pooled Transformer
    windows: list[dict] = []
    for aoi, ps in pairs_by_aoi.items():
        windows += ts_v2.build_windows(ps, aoi=aoi)
    tsm = ts_v2.train_pooled(windows, test_years=test_years,
                             epochs=140, test_set=test_set)
    ts_models = tsm.get("models") if tsm.get("trained") else None
    ts_pred: dict[str, float] = {}
    if ts_models:
        ev_wins = [w for w in windows
                   if f"{w['aoi']}:{w['year']}-{w['month']:02d}" in sample_ids]
        if ev_wins:
            p = np.mean([ts_v2._predict(m, ev_wins) for m in ts_models], axis=0)  # noqa: SLF001
            for w, v in zip(ev_wins, p):
                ts_pred[f"{w['aoi']}:{w['year']}-{w['month']:02d}"] = float(v)

    preds: dict[str, dict[str, float]] = {m: {} for m in
                                         ("b0_raw_modis", "b1_global_ratio",
                                          "b2_seasonal_ratio", "hgb_b2res_v4",
                                          "ts_logratio_pool_v2")}
    refs: dict[str, dict] = {}
    for aoi, ps in pairs_by_aoi.items():
        train, test = [], []
        cutoff = min(test_set) if test_set else 10**9
        for p in ps:
            (test if p["year"] in test_set else train).append(p) if p["year"] in test_set else (
                train.append(p) if p["year"] < cutoff else None)
        b1, b2 = evaluation.ratios_from_train(train)
        hgb = ml_v4.train_holdout(ps, test_years=test_years, test_set=test_set)
        model = hgb.get("model")
        for p in test:
            sid = f"{aoi}:{p['year']}-{p['month']:02d}"
            if sid not in sample_ids:
                continue
            refs[sid] = {"viirs": p["viirs"], "aoi": aoi}
            preds["b0_raw_modis"][sid] = p["modis"]
            preds["b1_global_ratio"][sid] = evaluation._counts(p["modis"], b1)  # noqa: SLF001
            preds["b2_seasonal_ratio"][sid] = evaluation._counts(
                p["modis"], b2.get(p["month"], b1))  # noqa: SLF001
            if model is not None:
                preds["hgb_b2res_v4"][sid] = float(
                    ml_v4.predict_counts(model, [p])[0])
            if sid in ts_pred:
                preds["ts_logratio_pool_v2"][sid] = ts_pred[sid]

    ids = sorted(refs)
    y = np.array([refs[s]["viirs"] for s in ids], dtype=float)
    got = {}
    for method, vals in preds.items():
        vec = [vals.get(s) for s in ids]
        if any(v is None for v in vec):
            continue
        got[method] = _metrics(y, np.array(vec, dtype=float))
    bench = json.loads((BENCH / "BENCHMARK.json").read_text())
    expected = ((bench.get("evaluations") or {}).get(a.data) or {}).get("pooled", {})
    bad = 0
    print(f"rebuilt n={len(ids)} for {a.data}")
    for method, m in got.items():
        want = expected.get(method) or {}
        if not want:
            continue
        d = m["mae"] - want["mae"]
        flag = "OK" if abs(d) <= TOL else "MISMATCH"
        if flag != "OK":
            bad += 1
        print(f"  {method:22s} rebuilt {m['mae']:9.1f} "
              f"published {want['mae']:9.1f} delta {d:+.2f} {flag}")
    print("REBUILD " + ("OK" if bad == 0 else "MISMATCH"))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
