"""SensorFormer Lite: context-calibrated residual model (experimental).

Not a forecasting model and not a replacement for B2. It predicts a residual on
the B2 seasonal log-ratio from a 12-month MODIS-only window plus region/context
features, with a learned context gate and one attention layer.

Design constraints (audit V6 + audit-2 fixes):
- inputs contain MODIS counts, month phase, day/terra fractions and an AOI
  embedding; the target month's VIIRS is NEVER an input;
- **two-phase protocol against leakage**: epoch selection fits B2 only on years
  before 2023 and validates on 2023; the final weights are refit on years before
  the 2024 holdout with that epoch budget. The served B2 baseline and the model
  then share the `< 2024` cutoff;
- validation runs with `model.eval()` (dropout off) and monitors MAE in hotspot
  counts, not a noisy log-residual loss;
- no `observed` flag is fabricated: FIRMS CSV has no per-cell observation
  footprint, so a month without a complete window is dropped, never zero-filled;
- 5 seeds, monotone quantile heads 0.1/0.5/0.9 (pinball loss): `low <= mid <=
  high` by construction; empirical 80% coverage is reported rather than calling
  the band a confidence interval;
- ablations (`no_gate`, `no_attn`) use the same two-phase split;
- `load_artifact` verifies the weights SHA-256 before returning a model, and the
  metadata records the training/evaluation dataset hashes;
- the artifact is a comparator. `deployed` is true only if it beats B2 by the
  same >=2% mean-gain rule used by HGB.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

try:
    import torch
    import torch.nn as nn

    _HAS_TORCH = True
except Exception:  # pragma: no cover
    torch = None  # type: ignore
    nn = None  # type: ignore
    _HAS_TORCH = False

METHOD_ID = "sf_lite_v1"
ALGORITHM_VERSION = "sf_lite_v1.1"
FEATURE_VERSION = "sf-features-v2"
WIN = 12
D_MODEL = 32
NHEAD = 4
SEEDS = (7, 17, 27, 37, 47)
QUANTILES = (0.1, 0.5, 0.9)
AOIS = ("vietnam", "amazon", "australia")
# Audit-2: `observed` was constantly 1.0 (FIRMS CSV has no observation footprint),
# so it taught nothing and implied a mask we do not have. Dropped.
FEATURES = ("log_modis", "sin_month", "cos_month", "day_frac", "terra_frac")


def _phase(month: int) -> tuple[float, float]:
    return (math.sin(2.0 * math.pi * month / 12.0),
            math.cos(2.0 * math.pi * month / 12.0))


def _pairs_path(data: str) -> Path:
    root = Path(__file__).resolve().parents[2]
    return root / "data" / "firms" / "benchmark" / f"training_pairs_{data}.csv"


def load_pairs(data: str) -> list[dict]:
    import csv
    p = _pairs_path(data)
    if not p.exists():
        return []
    out = []
    with p.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            out.append({"aoi": row["aoi"], "year": int(row["year"]),
                        "month": int(row["month"]), "modis": float(row["modis"]),
                        "viirs": float(row["viirs"]),
                        "day_frac": float(row["day_frac"]),
                        "terra_frac": float(row["terra_frac"])})
    return out


def _b2_log(train: list[dict]) -> tuple[float, dict[int, float]]:
    from app.firms.evaluation import ratios_from_train
    return ratios_from_train(train)


def build_windows(pairs: list[dict],
                  ratios: dict[str, tuple[float, dict[int, float]]],
                  win: int = WIN) -> list[dict]:
    """One sample per month with a complete consecutive MODIS window.

    `ratios` is per AOI: B2 is a per-region seasonal anchor, so pooling AOIs
    into one monthly median would silently change the baseline being compared.
    """
    by_aoi: dict[str, list[dict]] = {}
    for p in pairs:
        by_aoi.setdefault(p["aoi"], []).append(p)
    out: list[dict] = []
    for aoi, ps in by_aoi.items():
        b1, b2m = ratios[aoi]
        ps = sorted(ps, key=lambda p: (p["year"], p["month"]))
        index = {(p["year"], p["month"]): i for i, p in enumerate(ps)}
        for i, p in enumerate(ps):
            seq = []
            ok = True
            for k in range(win - 1, -1, -1):
                yy = p["year"] + (p["month"] - 1 - k) // 12
                mm = (p["month"] - 1 - k) % 12 + 1
                j = index.get((yy, mm))
                if j is None:
                    ok = False
                    break
                seq.append(ps[j])
            if not ok or len(seq) != win:
                continue
            sin_m, cos_m = _phase(p["month"])
            X = np.array([
                [math.log1p(max(q["modis"], 0.0)), *_phase(q["month"]),
                 q["day_frac"], q["terra_frac"]]
                for q in seq
            ], dtype=np.float32)
            base = b2m.get(p["month"], b1)
            y = math.log((p["viirs"] + 1.0) / (p["modis"] + 1.0))
            out.append({
                "id": f"{aoi}:{p['year']}-{p['month']:02d}",
                "aoi": aoi, "year": p["year"], "month": p["month"],
                "modis": p["modis"], "viirs": p["viirs"],
                "X": X, "b2_log": base, "y_delta": y - base,
                "ctx": np.array([1.0 if aoi == a else 0.0 for a in AOIS]
                                + [math.log1p(max(p["modis"], 0.0)), base,
                                   sin_m, cos_m], dtype=np.float32),
            })
    return out


if _HAS_TORCH:
    class SensorFormerLite(nn.Module):
        """Tiny temporal CNN + one attention layer + context gate + quantiles."""

        def __init__(self, d: int = D_MODEL, nhead: int = NHEAD,
                     use_gate: bool = True, use_attn: bool = True):
            super().__init__()
            self.use_gate = use_gate
            self.use_attn = use_attn
            self.proj = nn.Linear(len(FEATURES), d)
            self.conv1 = nn.Conv1d(d, d, kernel_size=3, padding=1)
            self.conv2 = nn.Conv1d(d, d, kernel_size=3, padding=1)
            self.norm1 = nn.GroupNorm(1, d)
            self.norm2 = nn.GroupNorm(1, d)
            self.attn = (nn.MultiheadAttention(d, nhead, batch_first=True,
                                              dropout=0.1) if use_attn else None)
            self.gate = nn.Sequential(nn.Linear(7, d), nn.Sigmoid()) if use_gate else None
            self.head = nn.Sequential(nn.Linear(2 * d, 64), nn.GELU(),
                                      nn.Linear(64, len(QUANTILES)))

        def forward(self, x, ctx):
            h = self.proj(x).transpose(1, 2)
            h = h + torch.nn.functional.gelu(self.conv1(h))
            h = self.norm1(h)
            h = h + torch.nn.functional.gelu(self.conv2(h))
            h = self.norm2(h).transpose(1, 2)
            if self.attn is not None:
                a, _ = self.attn(h, h, h, need_weights=False)
                h = h + a
            if self.gate is not None:
                h = h * self.gate(ctx).unsqueeze(1)
            z = torch.cat([h.mean(dim=1), h[:, -1, :]], dim=-1)
            raw = self.head(z)
            # Monotone quantiles: low = mid - softplus(a), high = mid + softplus(b).
            # This removes quantile crossings by construction (audit-2 P1).
            mid = raw[:, 1]
            low = mid - torch.nn.functional.softplus(raw[:, 0])
            high = mid + torch.nn.functional.softplus(raw[:, 2])
            return torch.stack([low, mid, high], dim=1)


def _pinball(pred, target: float):
    losses = []
    for i, q in enumerate(QUANTILES):
        err = target - pred[:, i]
        losses.append(torch.maximum(q * err, (q - 1.0) * err))
    return torch.stack(losses, dim=1).mean()


def _counts_for(rows: list[dict], deltas: np.ndarray) -> np.ndarray:
    base = np.array([r["b2_log"] for r in rows], dtype=float)
    modis = np.array([max(float(r["modis"]), 0.0) for r in rows], dtype=float)
    return np.maximum(np.exp(base + np.asarray(deltas, dtype=float)) *
                      (modis + 1.0) - 1.0, 0.0)


def _val_mae(model, val: list[dict]) -> float:
    """Validation MAE in hotspot counts, with dropout disabled."""
    if not val:
        return float("inf")
    model.eval()
    with torch.no_grad():
        p = model(torch.tensor(np.stack([s["X"] for s in val])),
                  torch.tensor(np.stack([s["ctx"] for s in val])))
        pred = _counts_for(val, p[:, 1].numpy())
    y = np.array([s["viirs"] for s in val], dtype=float)
    return float(np.mean(np.abs(pred - y)))


def _fit(seed: int, train: list[dict], val: list[dict] | None, epochs: int = 240,
         use_gate: bool = True, use_attn: bool = True) -> tuple:
    """Train one seed. Returns (model, best_epoch, best_val_mae).

    If `val` is given, early stopping monitors count-space MAE in eval mode
    (audit-2 P0). If `val` is None, training runs exactly `epochs` steps and is
    used for the final refit after the epoch budget has been selected.
    """
    torch.manual_seed(seed)
    np.random.seed(seed)
    model = SensorFormerLite(use_gate=use_gate, use_attn=use_attn)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-3)
    X = torch.tensor(np.stack([s["X"] for s in train]))
    C = torch.tensor(np.stack([s["ctx"] for s in train]))
    Y = torch.tensor(np.array([s["y_delta"] for s in train], dtype=np.float32))

    best, best_state, best_epoch, patience = float("inf"), None, 0, 0
    for epoch in range(1, epochs + 1):
        model.train()
        opt.zero_grad()
        pred = model(X, C)
        losses = []
        for i, q in enumerate(QUANTILES):
            err = Y - pred[:, i]
            losses.append(torch.maximum(q * err, (q - 1.0) * err))
        loss = torch.stack(losses, dim=1).mean()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        if not val:
            best_epoch = epoch
            continue
        vl = _val_mae(model, val)
        if vl < best - 1e-4:
            best, patience = vl, 0
            best_epoch = epoch
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
            if patience >= 30:
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    return model, best_epoch, (best if val else float("nan"))


def _quantile_counts(sample: dict, deltas: np.ndarray) -> dict:
    base = sample["b2_log"]
    modis = max(float(sample["modis"]), 0.0)
    out = {}
    for name, q in zip(("low", "mid", "high"), deltas):
        out[name] = max(math.exp(base + float(q)) * (modis + 1.0) - 1.0, 0.0)
    return out


def _sha256(path: Path) -> str | None:
    import hashlib
    if not path.exists():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _width_stats(preds: dict, rows: list[dict]) -> dict:
    lows = np.array([preds[w["id"]]["low"] for w in rows], dtype=float)
    mids = np.array([preds[w["id"]]["mid"] for w in rows], dtype=float)
    highs = np.array([preds[w["id"]]["high"] for w in rows], dtype=float)
    widths = highs - lows
    return {
        "mean_interval_width": round(float(np.mean(widths)), 2),
        "median_interval_width": round(float(np.median(widths)), 2),
        "quantile_crossings": int(np.sum((lows > mids) | (mids > highs))),
    }


def train(data: str = "raw", epochs: int = 240) -> dict:
    """Two-phase protocol (audit-2 P0).

    Phase 1 (selection): B2 is fit on years < 2023, the network on windows < 2023,
    early stopping on 2023 in eval mode. This chooses an epoch budget per seed
    without letting 2023 labels enter the baseline used to build 2023 features.

    Phase 2 (final): B2 is re-fit on years < 2024 and the network is retrained on
    those rows with the epoch budget from phase 1. The 2024-2025 holdout is only
    scored after this refit, and the served B2 baseline uses the same `< 2024`
    cutoff.
    """
    if not _HAS_TORCH:
        raise RuntimeError("torch is not installed")
    from app.firms import evaluation

    pairs = load_pairs(data)
    if not pairs:
        raise RuntimeError(f"no training pairs for data={data}")
    root = Path(__file__).resolve().parents[2]
    eval_csv = root / "data" / "firms" / "benchmark" / f"evaluation_samples_{data}.csv"
    ids: list[str] = []
    if eval_csv.exists():
        import csv
        with eval_csv.open(encoding="utf-8") as fh:
            ids = [r["id"] for r in csv.DictReader(fh)]
    if not ids:
        raise RuntimeError("no evaluation windows; run make_benchmark first")
    id_set = set(ids)

    # Phase 1: leak-free selection split (B2 and fit both stop before 2023).
    ratios_sel = {aoi: _b2_log([p for p in pairs
                                if p["aoi"] == aoi and p["year"] < 2023])
                  for aoi in AOIS}
    win_sel = build_windows(pairs, ratios_sel)
    fit_sel = [w for w in win_sel if w["year"] < 2023]
    val_sel = [w for w in win_sel if w["year"] == 2023]

    # Phase 2: final refit with the served `< 2024` cutoff.
    baseline_pairs = [p for p in pairs if p["year"] < 2024]
    ratios_final = {aoi: _b2_log([p for p in baseline_pairs if p["aoi"] == aoi])
                    for aoi in AOIS}
    win_final = build_windows(pairs, ratios_final)
    fit_final = [w for w in win_final if w["year"] < 2024]
    eval_windows = [w for w in win_final if w["id"] in id_set]
    if not eval_windows:
        raise RuntimeError("no evaluation windows; run make_benchmark first")

    def run_variant(use_gate: bool, use_attn: bool):
        epochs_by_seed: dict[int, int] = {}
        for s in SEEDS:
            _, ep, _ = _fit(s, fit_sel, val_sel, epochs, use_gate, use_attn)
            epochs_by_seed[s] = max(1, int(ep))
        models = [_fit(s, fit_final, None, epochs_by_seed[s], use_gate, use_attn)[0]
                  for s in SEEDS]
        preds = {}
        for w in eval_windows:
            X = torch.tensor(w["X"][None, ...])
            C = torch.tensor(w["ctx"][None, ...])
            with torch.no_grad():
                d = np.mean([m(X, C).numpy()[0] for m in models], axis=0)
            preds[w["id"]] = _quantile_counts(w, d)
        y = np.array([w["viirs"] for w in eval_windows])
        mid = np.array([preds[w["id"]]["mid"] for w in eval_windows])
        met = evaluation._metrics(y, mid)
        cov = float(np.mean([
            (preds[w["id"]]["low"] <= w["viirs"] <= preds[w["id"]]["high"])
            for w in eval_windows]))
        return models, preds, met, cov, _width_stats(preds, eval_windows), epochs_by_seed

    models, preds, metrics, coverage80, widths, epochs_by_seed = run_variant(True, True)
    ablations = {}
    for name, gate, attn in (("no_gate", False, True), ("no_attn", True, False)):
        _, _, met, cov, wd, ep = run_variant(gate, attn)
        ablations[name] = {**met, "coverage80": round(cov, 4),
                           **wd, "epochs_by_seed": ep}

    # Per-seed stability on the same holdout (audit-2 requested).
    per_seed_mae = {}
    for seed, model in zip(SEEDS, models):
        Xs = torch.tensor(np.stack([w["X"] for w in eval_windows]))
        Cs = torch.tensor(np.stack([w["ctx"] for w in eval_windows]))
        with torch.no_grad():
            ds = model(Xs, Cs).numpy()[:, 1]
        ps = _counts_for(eval_windows, ds)
        ys = np.array([w["viirs"] for w in eval_windows], dtype=float)
        per_seed_mae[str(seed)] = round(float(np.mean(np.abs(ps - ys))), 2)

    by_aoi: dict[str, list[dict]] = {}
    for w in eval_windows:
        by_aoi.setdefault(w["aoi"], []).append(w)
    per_aoi = {}
    for aoi, ws in by_aoi.items():
        yy = np.array([w["viirs"] for w in ws])
        pp = np.array([preds[w["id"]]["mid"] for w in ws])
        per_aoi[aoi] = evaluation._metrics(yy, pp)
    full_month = [w for w in eval_windows if w["aoi"] in ("vietnam", "amazon")]
    headline = (evaluation._metrics(
        np.array([w["viirs"] for w in full_month]),
        np.array([preds[w["id"]]["mid"] for w in full_month]))
        if full_month else None)

    samples = []
    for w in eval_windows:
        p = preds[w["id"]]
        samples.append({"id": w["id"], "aoi": w["aoi"], "year": w["year"],
                        "month": w["month"], "viirs_ref": w["viirs"],
                        "sf_lite_v1": p["mid"], "b2_seasonal_ratio":
                        max(math.exp(w["b2_log"]) * (w["modis"] + 1.0) - 1.0, 0.0)})
    comparisons = {
        "sf_vs_b2": evaluation._delta_ci(samples, "sf_lite_v1", "b2_seasonal_ratio"),
        # Audit-2 P1: year-block cluster bootstrap as a secondary, coarser view.
        "sf_vs_b2_year_block": evaluation._delta_ci(
            samples, "sf_lite_v1", "b2_seasonal_ratio", block="year"),
    }
    b2_mae = evaluation._metrics(
        np.array([s["viirs_ref"] for s in samples]),
        np.array([s["b2_seasonal_ratio"] for s in samples]))["mae"]
    gain = (b2_mae - metrics["mae"]) / b2_mae if b2_mae else 0.0
    deployed = bool(gain >= 0.02 and (comparisons["sf_vs_b2"] or {}).get(
        "ci95", [0, 0])[1] < 0)

    state = {
        "method_id": METHOD_ID,
        "algorithm_version": ALGORITHM_VERSION,
        "method": "sf_lite",
        "data_tag": data,
        "training_source": ("NASA FIRMS observed" if data == "raw"
                            else "synthetic demo (NOT observed)"),
        "feature_version": FEATURE_VERSION,
        "features": list(FEATURES),
        "win": WIN,
        "params": int(sum(p.numel() for p in models[0].parameters())),
        "protocol": {
            "selection": {
                "baseline_fit_years": sorted({p["year"] for p in pairs
                                              if p["year"] < 2023}),
                "fit_years": sorted({w["year"] for w in fit_sel}),
                "validation_years": sorted({w["year"] for w in val_sel}),
                "early_stop_metric": "hotspot MAE (counts), model.eval()",
                "epochs_by_seed": epochs_by_seed,
            },
            "final": {
                "baseline_fit_years": sorted({p["year"] for p in baseline_pairs}),
                "fit_years": sorted({w["year"] for w in fit_final}),
            },
            "holdout_years": sorted({w["year"] for w in eval_windows}),
            "leak_note": ("2023 is used only to pick an epoch budget; the model "
                          "is refit on <2024 before the holdout is scored."),
        },
        "train_years": sorted({w["year"] for w in fit_final}),
        "validation_years": sorted({w["year"] for w in val_sel}),
        "baseline_fit_years": sorted({p["year"] for p in baseline_pairs}),
        "test_years": sorted({w["year"] for w in eval_windows}),
        "n_train": len(fit_final),
        "n_selection_train": len(fit_sel),
        "n_test": len(eval_windows),
        "dataset_sha256": _sha256(_pairs_path(data)),
        "evaluation_sha256": _sha256(eval_csv),
        "metrics": metrics,
        "headline": headline,
        "per_aoi": per_aoi,
        "per_seed_mae": per_seed_mae,
        "comparisons": comparisons,
        "b2_mae": round(b2_mae, 4),
        "mean_gain_vs_b2": round(gain, 4),
        "deployed": deployed,
        "gate": {"rule": ">=2% mean gain AND SF-B2 CI upper bound < 0",
                 "passed": deployed},
        "coverage80": round(coverage80, 4),
        **widths,
        "interval_note": ("10th-90th predictive band from monotone quantile heads; "
                          "coverage is empirical, not a confidence interval."),
        "ablation": ablations,
        "seed_mae_range": [min(per_seed_mae.values()), max(per_seed_mae.values())],
        "predictions": {k: {kk: round(vv, 4) for kk, vv in v.items()}
                        for k, v in preds.items()},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    model_dir = root / "data" / "firms" / "models"
    model_dir.mkdir(parents=True, exist_ok=True)
    tag = "" if data == "sample" else f"_{data}"
    mp = model_dir / f"sf_lite{tag}.pt"
    jp = model_dir / f"sf_lite{tag}.json"
    torch.save({"models": [m.state_dict() for m in models],
                "config": {"d_model": D_MODEL, "nhead": NHEAD, "win": WIN,
                           "features": list(FEATURES),
                           "algorithm_version": ALGORITHM_VERSION,
                           "use_gate": True, "use_attn": True}}, mp)
    state["weights_file"] = mp.name
    state["weights_sha256"] = _sha256(mp)
    jp.write_text(json.dumps(state, indent=1, ensure_ascii=False), encoding="utf-8")
    return state


def artifact_status(data: str = "raw", model_dir: Path | None = None) -> dict:
    """Check artifact files, metadata and the weights SHA-256 without loading torch."""
    root = model_dir or (Path(__file__).resolve().parents[2] / "data" / "firms" / "models")
    tag = "" if data == "sample" else f"_{data}"
    mp, jp = root / f"sf_lite{tag}.pt", root / f"sf_lite{tag}.json"
    out = {"available": False, "weights_present": mp.exists(),
           "metadata_present": jp.exists(), "hash_ok": False,
           "weights_file": mp.name, "reason": None,
           "feature_version": None}
    if not (mp.exists() and jp.exists()):
        out["reason"] = "artifact_missing"
        return out
    try:
        meta = json.loads(jp.read_text(encoding="utf-8"))
    except Exception:
        out["reason"] = "metadata_unreadable"
        return out
    out["feature_version"] = meta.get("feature_version")
    want = meta.get("weights_sha256")
    got = _sha256(mp)
    out["hash_ok"] = bool(want and got == want)
    out["weights_sha256"] = got
    integrity = True
    if out["feature_version"] != FEATURE_VERSION:
        out["reason"] = "feature_version_mismatch"
        integrity = False
    elif not out["hash_ok"]:
        out["reason"] = "weights_sha256_mismatch"
        integrity = False
    elif not _HAS_TORCH:
        out["reason"] = "torch_missing"
    # `available` = the artifact is present and intact. Whether it can run is a
    # separate flag, so a serving-only (no-torch) host reports the artifact
    # honestly instead of calling it missing.
    out["available"] = integrity
    out["runtime_available"] = bool(integrity and _HAS_TORCH)
    return out


def load_artifact(data: str = "raw", model_dir: Path | None = None,
                  verify: bool = True):
    """Load models only if metadata exists and the weight hash matches."""
    if not _HAS_TORCH or torch is None:
        return None, None
    status = artifact_status(data, model_dir)
    if verify and not status["available"]:
        return None, None
    root = model_dir or (Path(__file__).resolve().parents[2] / "data" / "firms" / "models")
    tag = "" if data == "sample" else f"_{data}"
    mp, jp = root / f"sf_lite{tag}.pt", root / f"sf_lite{tag}.json"
    try:
        blob = torch.load(mp, map_location="cpu", weights_only=True)
        cfg = blob.get("config", {})
        models = []
        for sd in blob["models"]:
            m = SensorFormerLite(d=int(cfg.get("d_model", D_MODEL)),
                                 nhead=int(cfg.get("nhead", NHEAD)),
                                 use_gate=bool(cfg.get("use_gate", True)),
                                 use_attn=bool(cfg.get("use_attn", True)))
            m.load_state_dict(sd)
            m.eval()
            models.append(m)
        meta = json.loads(jp.read_text(encoding="utf-8"))
        meta["artifact_verified"] = True
        return models, meta
    except Exception:
        return None, None


def predict(models, windows: list[dict]) -> list[dict]:
    out = []
    for w in windows:
        X = torch.tensor(w["X"][None, ...])
        C = torch.tensor(w["ctx"][None, ...])
        with torch.no_grad():
            d = np.mean([m(X, C).numpy()[0] for m in models], axis=0)
        out.append(_quantile_counts(w, d))
    return out
