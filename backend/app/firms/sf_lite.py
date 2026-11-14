"""SensorFormer Lite: sensor-aware residual calibrator (experimental).

Not a forecasting model and not a replacement for B2. It predicts a residual on
the B2 seasonal log-ratio from a 12-month MODIS-only window plus observation
context, with a learned sensor/context gate and one attention layer.

Design constraints (audit V6):
- inputs contain MODIS counts, month phase, day/terra fractions and an AOI
  embedding; the target month's VIIRS is NEVER an input;
- trained on years before the holdout, validated on the last train year;
- 5 seeds, quantile heads 0.1/0.5/0.9 (pinball loss), empirical 80% coverage is
  reported on the holdout rather than calling the band a confidence interval;
- ablations (`no_gate`, `no_attn`) are trained with the same split;
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
ALGORITHM_VERSION = "sf_lite_v1.0"
FEATURE_VERSION = "sf-features-v1"
WIN = 12
D_MODEL = 32
NHEAD = 4
SEEDS = (7, 17, 27, 37, 47)
QUANTILES = (0.1, 0.5, 0.9)
AOIS = ("vietnam", "amazon", "australia")
FEATURES = ("log_modis", "sin_month", "cos_month", "day_frac", "terra_frac", "observed")


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
                 q["day_frac"], q["terra_frac"], 1.0]
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
            return self.head(z)


def _pinball(pred, target: float):
    losses = []
    for i, q in enumerate(QUANTILES):
        err = target - pred[:, i]
        losses.append(torch.maximum(q * err, (q - 1.0) * err))
    return torch.stack(losses, dim=1).mean()


def _fit(seed: int, train: list[dict], val: list[dict], epochs: int = 240,
         use_gate: bool = True, use_attn: bool = True):
    torch.manual_seed(seed)
    np.random.seed(seed)
    model = SensorFormerLite(use_gate=use_gate, use_attn=use_attn)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-3)
    X = torch.tensor(np.stack([s["X"] for s in train]))
    C = torch.tensor(np.stack([s["ctx"] for s in train]))
    Y = torch.tensor(np.array([s["y_delta"] for s in train], dtype=np.float32))

    def val_loss() -> float:
        if not val:
            return float("inf")
        with torch.no_grad():
            p = model(torch.tensor(np.stack([s["X"] for s in val])),
                      torch.tensor(np.stack([s["ctx"] for s in val])))
            return float(torch.mean(torch.abs(p[:, 1] -
                             torch.tensor(np.array([s["y_delta"] for s in val],
                                                   dtype=np.float32)))))

    best, best_state, patience = float("inf"), None, 0
    for _ in range(epochs):
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
        vl = val_loss()
        if vl < best - 1e-5:
            best, patience = vl, 0
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
            if patience >= 30:
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    return model


def _quantile_counts(sample: dict, deltas: np.ndarray) -> dict:
    base = sample["b2_log"]
    modis = max(float(sample["modis"]), 0.0)
    out = {}
    for name, q in zip(("low", "mid", "high"), deltas):
        out[name] = max(math.exp(base + float(q)) * (modis + 1.0) - 1.0, 0.0)
    return out


def train(data: str = "raw", epochs: int = 240) -> dict:
    if not _HAS_TORCH:
        raise RuntimeError("torch is not installed")
    from app.firms import evaluation

    pairs = load_pairs(data)
    if not pairs:
        raise RuntimeError(f"no training pairs for data={data}")
    train_pairs = [p for p in pairs if p["year"] < 2024]
    ratios = {aoi: _b2_log([p for p in train_pairs if p["aoi"] == aoi])
              for aoi in AOIS}
    windows = build_windows(pairs, ratios)
    fit_rows = [w for w in windows if w["year"] < 2023]
    val_rows = [w for w in windows if w["year"] == 2023]
    # holdout sample ids: same file the evaluation manifest uses
    root = Path(__file__).resolve().parents[2]
    eval_csv = root / "data" / "firms" / "benchmark" / f"evaluation_samples_{data}.csv"
    ids: list[str] = []
    if eval_csv.exists():
        import csv
        with eval_csv.open(encoding="utf-8") as fh:
            ids = [r["id"] for r in csv.DictReader(fh)]
    eval_windows = [w for w in windows if w["id"] in set(ids)]
    if not eval_windows:
        raise RuntimeError("no evaluation windows; run make_benchmark first")

    def run_variant(use_gate: bool, use_attn: bool):
        models = [_fit(s, fit_rows, val_rows, epochs, use_gate, use_attn)
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
        width = float(np.mean([preds[w["id"]]["high"] - preds[w["id"]]["low"]
                              for w in eval_windows]))
        return models, preds, met, cov, width

    models, preds, metrics, coverage80, width = run_variant(True, True)
    ablations = {}
    for name, gate, attn in (("no_gate", False, True), ("no_attn", True, False)):
        _, _, met, cov, wd = run_variant(gate, attn)
        ablations[name] = {**met, "coverage80": round(cov, 4),
                           "median_width": round(wd, 2)}

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
    comparisons = {"sf_vs_b2": evaluation._delta_ci(samples, "sf_lite_v1",
                                                    "b2_seasonal_ratio")}
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
        "train_years": sorted({p["year"] for p in train_pairs}),
        "test_years": sorted({w["year"] for w in eval_windows}),
        "n_train": len(fit_rows),
        "n_test": len(eval_windows),
        "metrics": metrics,
        "headline": headline,
        "per_aoi": per_aoi,
        "comparisons": comparisons,
        "b2_mae": round(b2_mae, 4),
        "mean_gain_vs_b2": round(gain, 4),
        "deployed": deployed,
        "gate": {"rule": ">=2% mean gain AND SF-B2 CI upper bound < 0",
                 "passed": deployed},
        "coverage80": round(coverage80, 4),
        "median_interval_width": round(width, 2),
        "ablation": ablations,
        "seed_mae_range": None,
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
                           "features": list(FEATURES)}}, mp)
    import hashlib
    state["weights_file"] = mp.name
    state["weights_sha256"] = hashlib.sha256(mp.read_bytes()).hexdigest()
    jp.write_text(json.dumps(state, indent=1, ensure_ascii=False), encoding="utf-8")
    return state


def load_artifact(data: str = "raw", model_dir: Path | None = None):
    if not _HAS_TORCH or torch is None:
        return None, None
    root = model_dir or (Path(__file__).resolve().parents[2] / "data" / "firms" / "models")
    tag = "" if data == "sample" else f"_{data}"
    mp, jp = root / f"sf_lite{tag}.pt", root / f"sf_lite{tag}.json"
    if not (mp.exists() and jp.exists()):
        return None, None
    try:
        blob = torch.load(mp, map_location="cpu", weights_only=True)
        models = []
        for sd in blob["models"]:
            m = SensorFormerLite()
            m.load_state_dict(sd)
            m.eval()
            models.append(m)
        return models, json.loads(jp.read_text(encoding="utf-8"))
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
