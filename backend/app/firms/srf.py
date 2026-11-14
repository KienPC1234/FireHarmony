"""Seasonal-Residual Former (SRF): a data-shaped transformer for MODIS→VIIRS.

Why this shape, from the current data:
- annual seasonality dominates, so a learned *target-month query* cross-attends
  over lag tokens (instead of a generic 12-token self-attention stack);
- short-term persistence matters more than long context (window 9 beat 12/6),
  so a 3-layer dilated TCN (dilations 1/2/4) reads 1/2/4-month scales;
- AOIs disagree: B2 is strong in Vietnam, residual correction helps Amazon.
  A per-AOI gate starts near zero and is calibrated on validation, so an AOI
  with no gain keeps the B2 anchor;
- 195-300 windows cannot support a large model: d=32, one cross-attention
  layer, ~20k parameters, residual target on the B2 log-ratio.

This is an experiment. It is scored on the same 72 holdout rows and only
"deployed" if it beats B2 under the pre-registered gate.
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

METHOD_ID = "srf_v1"
ALGORITHM_VERSION = "srf_v1.0"
WIN = 12
D_MODEL = 32
NHEAD = 4
SEEDS = (7, 17, 27, 37, 47)
AOIS = ("vietnam", "amazon", "australia")
FEATURES = ("log_modis", "sin", "cos", "day_frac", "terra_frac", "observed",
            "diff1", "diff3")


def _phase(month: int) -> tuple[float, float]:
    return (math.sin(2 * math.pi * month / 12), math.cos(2 * math.pi * month / 12))


def load_pairs(data: str) -> list[dict]:
    import csv
    root = Path(__file__).resolve().parents[2]
    p = root / "data" / "firms" / "benchmark" / f"training_pairs_{data}.csv"
    if not p.exists():
        return []
    out = []
    with p.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            out.append({"aoi": r["aoi"], "year": int(r["year"]), "month": int(r["month"]),
                        "modis": float(r["modis"]), "viirs": float(r["viirs"]),
                        "day_frac": float(r["day_frac"]),
                        "terra_frac": float(r["terra_frac"])})
    return out


def b2_by_aoi(train_pairs: list[dict]) -> dict[str, tuple[float, dict[int, float]]]:
    from app.firms.evaluation import ratios_from_train
    return {a: ratios_from_train([p for p in train_pairs if p["aoi"] == a])
            for a in AOIS}


def build_samples(pairs: list[dict], ratios: dict, win: int = WIN) -> list[dict]:
    by_aoi: dict[str, list[dict]] = {}
    for p in pairs:
        by_aoi.setdefault(p["aoi"], []).append(p)
    out = []
    for aoi, ps in by_aoi.items():
        ps = sorted(ps, key=lambda p: (p["year"], p["month"]))
        index = {(p["year"], p["month"]): i for i, p in enumerate(ps)}
        b1, b2m = ratios[aoi]
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
            if not ok:
                continue
            logs = np.array([math.log1p(max(q["modis"], 0)) for q in seq])
            X = []
            for t, q in enumerate(seq):
                d1 = logs[t] - logs[t - 1] if t >= 1 else 0.0
                d3 = logs[t] - logs[t - 3] if t >= 3 else 0.0
                X.append([logs[t], *_phase(q["month"]), q["day_frac"],
                          q["terra_frac"], 1.0, d1, d3])
            base = b2m.get(p["month"], b1)
            y = math.log((p["viirs"] + 1.0) / (p["modis"] + 1.0)) - base
            out.append({
                "id": f"{aoi}:{p['year']}-{p['month']:02d}",
                "aoi": aoi, "year": p["year"], "month": p["month"],
                "modis": p["modis"], "viirs": p["viirs"], "b2_log": base,
                "X": np.array(X, dtype=np.float32), "y": y,
                "ctx": np.array([*_phase(p["month"]), logs[-1], base],
                                dtype=np.float32),
            })
    return out


if _HAS_TORCH:
    class SeasonalResidualFormer(nn.Module):
        def __init__(self, d: int = D_MODEL, nhead: int = NHEAD, win: int = WIN,
                     per_aoi_head: bool = False, gate_init: float = -4.0,
                     direct: bool = False):
            super().__init__()
            self.direct = direct
            self.proj = nn.Linear(len(FEATURES), d)
            self.lag = nn.Embedding(win, d)
            self.aoi = nn.Embedding(len(AOIS), d)
            self.query = nn.Embedding(12, d)
            self.convs = nn.ModuleList([
                nn.Conv1d(d, d, 3, padding=dil, dilation=dil) for dil in (1, 2, 4)])
            self.norms = nn.ModuleList([nn.GroupNorm(1, d) for _ in range(3)])
            self.attn = nn.MultiheadAttention(d, nhead, batch_first=True,
                                              dropout=0.1)
            self.drop = nn.Dropout(0.1)
            def head():
                return nn.Sequential(nn.Linear(2 * d + 7, 64), nn.GELU(),
                                     nn.Linear(64, 1))
            self.heads = nn.ModuleList([head() for _ in AOIS]) if per_aoi_head \
                else nn.ModuleList([head()])
            self.per_aoi_head = per_aoi_head
            # Starts near the B2 anchor (or neutral when gate_init=0).
            self.gate_logit = nn.Parameter(torch.full((len(AOIS),), gate_init))

        def forward(self, x, aoi_idx, month_idx):
            h = self.proj(x) + self.lag.weight[: x.size(1)] + \
                self.aoi(aoi_idx).unsqueeze(1)
            for conv, norm in zip(self.convs, self.norms):
                z = h.transpose(1, 2)
                z = z + torch.nn.functional.gelu(conv(z))
                h = norm(z).transpose(1, 2)
            q = self.query(month_idx).unsqueeze(1) + self.aoi(aoi_idx).unsqueeze(1)
            a, _ = self.attn(q, h, h, need_weights=False)
            ctx = torch.cat([x[:, -1, 1:5],
                             x[:, -1, 0:1],
                             x[:, -1, 6:8]], dim=-1)
            z = torch.cat([a.squeeze(1), h[:, -1, :], ctx], dim=-1)
            z = self.drop(z)
            if self.per_aoi_head:
                outs = torch.cat([hd(z) for hd in self.heads], dim=-1)
                delta = outs.gather(1, aoi_idx[:, None]).squeeze(1)
            else:
                delta = self.heads[0](z).squeeze(-1)
            if self.direct:
                return delta
            gate = torch.sigmoid(self.gate_logit[aoi_idx])
            return delta * gate
else:
    class SeasonalResidualFormer:  # type: ignore[no-redef]
        def __init__(self, *a, **k):
            raise RuntimeError("torch not installed")


def _train_one(train, val, seed, cfg):
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    model = SeasonalResidualFormer(d=cfg["d"], win=cfg["win"],
                                   per_aoi_head=cfg.get("per_aoi_head", False),
                                   gate_init=cfg.get("gate_init", -4.0),
                                   direct=cfg.get("direct", False))
    opt = torch.optim.AdamW(model.parameters(), lr=cfg["lr"], weight_decay=1e-3)
    X = torch.tensor(np.stack([w["X"] for w in train]))
    A = torch.tensor([AOIS.index(w["aoi"]) for w in train])
    M = torch.tensor([w["month"] - 1 for w in train])
    Y = torch.tensor([w["y"] + (w["b2_log"] if cfg.get("direct") else 0.0)
                      for w in train], dtype=torch.float32)
    if cfg.get("balanced"):
        counts: dict[str, int] = {}
        for w in train:
            counts[w["aoi"]] = counts.get(w["aoi"], 0) + 1
        wts = torch.tensor([1.0 / counts[w["aoi"]] for w in train], dtype=torch.float32)
        wts = wts / wts.mean()
    else:
        wts = torch.ones(len(train))
    Xv = torch.tensor(np.stack([w["X"] for w in val]))
    Av = torch.tensor([AOIS.index(w["aoi"]) for w in val])
    Mv = torch.tensor([w["month"] - 1 for w in val])
    Yv = torch.tensor([w["y"] + (w["b2_log"] if cfg.get("direct") else 0.0)
                       for w in val], dtype=torch.float32)
    best, state, bad = float("inf"), None, 0
    for _ in range(cfg.get("epochs", 300)):
        model.train()
        idx = torch.tensor(rng.permutation(len(train)))
        opt.zero_grad()
        pred = model(X[idx], A[idx], M[idx])
        loss = torch.mean(wts[idx] * (pred - Y[idx]) ** 2)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        model.eval()
        with torch.no_grad():
            v = float(torch.mean((model(Xv, Av, Mv) - Yv) ** 2))
        if v < best - 1e-6:
            best, bad = v, 0
            state = {k: t.detach().clone() for k, t in model.state_dict().items()}
        else:
            bad += 1
            if bad >= 40:
                break
    if state:
        model.load_state_dict(state)
    model.eval()
    return model


def _deltas(models, rows):
    X = torch.tensor(np.stack([w["X"] for w in rows]))
    A = torch.tensor([AOIS.index(w["aoi"]) for w in rows])
    M = torch.tensor([w["month"] - 1 for w in rows])
    with torch.no_grad():
        return np.mean([m(X, A, M).numpy() for m in models], axis=0)


def _counts(row, delta_log, direct: bool = False, lam: float = 1.0):
    if direct:
        log_ratio = (1.0 - lam) * row["b2_log"] + lam * float(delta_log)
    else:
        log_ratio = row["b2_log"] + lam * float(delta_log)
    return max(math.exp(log_ratio) * (row["modis"] + 1) - 1, 0)


def train(data: str = "raw", epochs: int = 300) -> dict:
    if not _HAS_TORCH:
        raise RuntimeError("torch is not installed")
    pairs = load_pairs(data)
    train_pairs = [p for p in pairs if p["year"] < 2024]
    ratios = b2_by_aoi(train_pairs)
    rows = build_samples(pairs, ratios)
    train_rows = [r for r in rows if r["year"] < 2023]
    val_rows = [r for r in rows if r["year"] == 2023]
    test_rows = [r for r in rows if r["year"] >= 2024]
    cfg = {"d": D_MODEL, "win": WIN, "lr": 2e-3, "epochs": epochs}
    models = [_train_one(train_rows, val_rows, s, cfg) for s in SEEDS]
    val_d = _deltas(models, val_rows)
    # Per-AOI shrinkage on validation: a region with no gain keeps B2.
    lam: dict[str, float] = {}
    for aoi in AOIS:
        idx = [i for i, r in enumerate(val_rows) if r["aoi"] == aoi]
        if not idx:
            lam[aoi] = 0.0
            continue
        best = (float("inf"), 0.0)
        for L in np.linspace(0.0, 1.0, 11):
            err = np.mean([abs(_counts(val_rows[i], val_d[i],
                                       direct=cfg.get("direct", False),
                                       lam=L) - val_rows[i]["viirs"])
                           for i in idx])
            if err < best[0]:
                best = (float(err), float(L))
        lam[aoi] = best[1]
    test_d = _deltas(models, test_rows)
    preds = [_counts(r, d, direct=cfg.get("direct", False),
                     lam=lam[r["aoi"]]) for r, d in zip(test_rows, test_d)]
    y = np.array([r["viirs"] for r in test_rows])
    b2c = np.array([_counts(r, 0.0, direct=True, lam=0.0) for r in test_rows])
    from app.firms.evaluation import _metrics, _delta_ci
    metrics = _metrics(y, np.array(preds))
    samples = [{"id": r["id"], "aoi": r["aoi"], "year": r["year"],
                "month": r["month"], "viirs_ref": r["viirs"], METHOD_ID: float(p),
                "b2_seasonal_ratio": float(b)} for r, p, b in zip(test_rows, preds, b2c)]
    ci = _delta_ci(samples, METHOD_ID, "b2_seasonal_ratio")
    per_aoi = {}
    for aoi in AOIS:
        idx = [i for i, r in enumerate(test_rows) if r["aoi"] == aoi]
        if idx:
            per_aoi[aoi] = {**_metrics(y[idx], np.array(preds)[idx]),
                            "b2_mae": round(float(np.mean(np.abs(b2c[idx] - y[idx]))), 2),
                            "lambda": lam[aoi]}
    # Conformal 80% band from validation absolute residuals per AOI.
    q = {}
    for aoi in AOIS:
        idx = [i for i, r in enumerate(val_rows) if r["aoi"] == aoi]
        if idx:
            res = np.abs(np.array([
                math.log((_counts(val_rows[i], val_d[i],
                                  direct=cfg.get("direct", False), lam=lam[aoi]) + 1) /
                         (val_rows[i]["viirs"] + 1)) for i in idx]))
            q[aoi] = float(np.quantile(res, 0.8))
        else:
            q[aoi] = 0.5
    cover = []
    widths = []
    for r, d in zip(test_rows, test_d):
        lo = _counts(r, d - q[r["aoi"]],
                     direct=cfg.get("direct", False), lam=lam[r["aoi"]])
        hi = _counts(r, d + q[r["aoi"]],
                     direct=cfg.get("direct", False), lam=lam[r["aoi"]])
        cover.append(lo <= r["viirs"] <= hi)
        widths.append(hi - lo)
    b2mae = _metrics(y, b2c)["mae"]
    gain = (b2mae - metrics["mae"]) / b2mae
    deployed = bool(gain >= 0.02 and (ci or {}).get("ci95", [0, 0])[1] < 0)
    state = {
        "method_id": METHOD_ID, "algorithm_version": ALGORITHM_VERSION,
        "method": "seasonal_residual_former", "data_tag": data,
        "training_source": ("NASA FIRMS observed" if data == "raw"
                            else "synthetic demo (NOT observed)"),
        "features": list(FEATURES), "win": WIN,
        "params": int(sum(p.numel() for p in models[0].parameters())),
        "train_years": sorted({r["year"] for r in train_rows}),
        "test_years": sorted({r["year"] for r in test_rows}),
        "n_train": len(train_rows), "n_test": len(test_rows),
        "lambda_by_aoi": lam, "conformal_q80": q,
        "metrics": metrics, "per_aoi": per_aoi,
        "comparisons": {"srf_vs_b2": ci}, "b2_mae": round(b2mae, 4),
        "mean_gain_vs_b2": round(gain, 4), "deployed": deployed,
        "coverage80": round(float(np.mean(cover)), 4),
        "median_interval_width": round(float(np.median(widths)), 2),
        "gate": {"rule": ">=2% mean gain AND SRF-B2 CI upper < 0",
                 "passed": deployed},
        "predictions": {r["id"]: {"mid": round(float(p), 4)}
                        for r, p in zip(test_rows, preds)},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    root = Path(__file__).resolve().parents[2]
    mdir = root / "data" / "firms" / "models"
    tag = "" if data == "sample" else f"_{data}"
    mp, jp = mdir / f"srf{tag}.pt", mdir / f"srf{tag}.json"
    torch.save({"models": [m.state_dict() for m in models],
                "config": {"d": D_MODEL, "win": WIN, "features": list(FEATURES)}}, mp)
    import hashlib
    state["weights_file"] = mp.name
    state["weights_sha256"] = hashlib.sha256(mp.read_bytes()).hexdigest()
    jp.write_text(json.dumps(state, indent=1, ensure_ascii=False), encoding="utf-8")
    return state


def load_artifact(data: str = "raw", model_dir: Path | None = None):
    if not _HAS_TORCH:
        return None, None
    root = model_dir or (Path(__file__).resolve().parents[2] / "data" / "firms" / "models")
    tag = "" if data == "sample" else f"_{data}"
    mp, jp = root / f"srf{tag}.pt", root / f"srf{tag}.json"
    if not (mp.exists() and jp.exists()):
        return None, None
    try:
        blob = torch.load(mp, map_location="cpu", weights_only=True)
        models = []
        for sd in blob["models"]:
            m = SeasonalResidualFormer(d=blob["config"]["d"],
                                       win=blob["config"]["win"])
            m.load_state_dict(sd)
            m.eval()
            models.append(m)
        return models, json.loads(jp.read_text(encoding="utf-8"))
    except Exception:
        return None, None
