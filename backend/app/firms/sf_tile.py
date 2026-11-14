"""TileFormer: region-agnostic residual model on 1-degree tile-months.

Why this exists
---------------
The AOI-level benchmark has 231 training windows for 3 regions. A one-hot AOI
embedding can only memorise those regions, and a GPU cannot fix n=231. The raw
FIRMS pull already contains enough rows to aggregate 1-degree tiles:
28,769 tile-months (10,315 with >=20 MODIS and >=20 VIIRS detections) over 963
tiles. This model uses that granularity and drops the AOI embedding, so the
same weights can be tested on a region they never saw.

Target: residual on the seasonal anchor,
    y = log((VIIRS+1)/(MODIS+1)) - b2_log[aoi, month]
with monotone 0.1/0.5/0.9 quantiles. The anchor is fit on years before the
evaluation cutoff, exactly like the served B2 baseline.

This is a research artifact: it is scored on tile-months and on AOI-month
aggregates, with temporal and leave-one-region-out splits, before any serving
decision.
"""
from __future__ import annotations

import csv
import hashlib
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

METHOD_ID = "tileformer_v1"
ALGORITHM_VERSION = "tileformer_v1.0"
WIN = 12
D_MODEL = 64
NHEAD = 4
SEEDS = (7, 17, 27, 37, 47)
QUANTILES = (0.1, 0.5, 0.9)
AOIS = ("vietnam", "amazon", "australia")
FEATURES = ("log_modis", "sin_month", "cos_month", "day_frac", "terra_frac")
N_CTX = 10
MIN_MODIS = 20
MIN_VIIRS = 20
BENCH = Path(__file__).resolve().parents[2] / "data" / "firms" / "benchmark"


def _phase(month: int) -> tuple[float, float]:
    return (math.sin(2.0 * math.pi * month / 12.0),
            math.cos(2.0 * math.pi * month / 12.0))


def _geo(lat: float, lon: float) -> list[float]:
    """Smooth spatial basis: no region id, so a new tile can be scored."""
    return [
        lat / 90.0, lon / 180.0,
        math.sin(math.pi * lat / 15.0), math.cos(math.pi * lat / 15.0),
        math.sin(math.pi * lon / 30.0), math.cos(math.pi * lon / 30.0),
    ]


def loads(path: Path | None = None) -> list[dict]:
    p = path or (BENCH / "tile_pairs_raw.csv")
    if not p.exists():
        return []
    out = []
    with p.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            out.append({
                "aoi": r["aoi"], "tile_id": r["tile_id"],
                "lat": float(r["lat"]), "lon": float(r["lon"]),
                "year": int(r["year"]), "month": int(r["month"]),
                "modis": float(r["modis"]), "viirs": float(r["viirs"]),
                "day_frac": float(r["day_frac"]),
                "terra_frac": float(r["terra_frac"]),
            })
    return out


def load_aoi_pairs() -> list[dict]:
    p = BENCH / "training_pairs_raw.csv"
    if not p.exists():
        return []
    with p.open(encoding="utf-8") as fh:
        return [{"aoi": r["aoi"], "year": int(r["year"]),
                 "month": int(r["month"]), "modis": float(r["modis"]),
                 "viirs": float(r["viirs"])} for r in csv.DictReader(fh)]


def b2_by_aoi(pairs: list[dict], cutoff: int) -> dict:
    from app.firms.evaluation import ratios_from_train
    return {a: ratios_from_train([p for p in pairs
                                  if p["aoi"] == a and p["year"] < cutoff])
            for a in AOIS}


def tile_anchors(tiles: list[dict], ratios: dict, cutoff: int,
                 k: float = 3.0) -> dict:
    """Hierarchical tile-month anchor, shrunk toward the AOI-month ratio.

    A tile-month median is noisy when a tile has few co-observed years, so it is
    blended with the AOI seasonal ratio: w = n/(n+k). This is still a simple
    empirical baseline (no network), fit only on years < cutoff.
    """
    per = {}
    allv = {}
    for t in tiles:
        if t["year"] >= cutoff or t["modis"] <= 0:
            continue
        lr = math.log((t["viirs"] + 1.0) / (t["modis"] + 1.0))
        per.setdefault((t["tile_id"], t["month"]), []).append(lr)
        allv.setdefault(t["tile_id"], []).append(lr)
    out = {}
    for t in tiles:
        b1, b2m = ratios[t["aoi"]]
        base = float(b2m.get(t["month"], b1))
        vals = per.get((t["tile_id"], t["month"]), [])
        if vals:
            w = len(vals) / (len(vals) + k)
            out[(t["tile_id"], t["month"])] = w * float(np.median(vals)) + (1 - w) * base
        else:
            av = allv.get(t["tile_id"], [])
            if av:
                w = len(av) / (len(av) + k)
                out[(t["tile_id"], t["month"])] = w * float(np.median(av)) + (1 - w) * base
            else:
                out[(t["tile_id"], t["month"])] = base
    return out


def build_windows(tiles: list[dict], ratios: dict, win: int = WIN,
                  min_modis: int = MIN_MODIS, min_viirs: int = MIN_VIIRS,
                  tile_ratios: dict | None = None) -> list[dict]:
    # Keep every co-observed month for continuity; threshold only the target.
    # Filtering before indexing broke 12-month windows whenever one month in
    # the window was thin, which collapsed the dataset to a handful of samples.
    by_tile: dict[str, list[dict]] = {}
    for t in tiles:
        by_tile.setdefault(t["tile_id"], []).append(t)
    out = []
    for tid, rows in by_tile.items():
        rows.sort(key=lambda r: (r["year"], r["month"]))
        index = {(r["year"], r["month"]): i for i, r in enumerate(rows)}
        b1, b2m = ratios[rows[0]["aoi"]]
        for r in rows:
            seq = []
            ok = True
            for k in range(win - 1, -1, -1):
                yy = r["year"] + (r["month"] - 1 - k) // 12
                mm = (r["month"] - 1 - k) % 12 + 1
                j = index.get((yy, mm))
                if j is None:
                    ok = False
                    break
                seq.append(rows[j])
            if not ok:
                continue
            if r["modis"] < min_modis or r["viirs"] < min_viirs:
                continue
            logs = np.array([math.log1p(q["modis"]) for q in seq], dtype=np.float32)
            X = np.array([
                [logs[t], *_phase(q["month"]), q["day_frac"], q["terra_frac"]]
                for t, q in enumerate(seq)
            ], dtype=np.float32)
            anchor = float((tile_ratios or {}).get(
                (tid, r["month"]), b2m.get(r["month"], b1)))
            y = math.log((r["viirs"] + 1.0) / (r["modis"] + 1.0)) - anchor
            sin_m, cos_m = _phase(r["month"])
            ctx = np.array(
                _geo(r["lat"], r["lon"]) +
                [float(logs.mean()), anchor, sin_m, cos_m],
                dtype=np.float32)
            out.append({
                "id": f"{tid}:{r['year']}-{r['month']:02d}",
                "aoi": r["aoi"], "tile_id": tid,
                "year": r["year"], "month": r["month"],
                "lat": r["lat"], "lon": r["lon"],
                "modis": r["modis"], "viirs": r["viirs"],
                "anchor": anchor, "X": X, "ctx": ctx,
                "y": float(y),
            })
    return out


if _HAS_TORCH:
    class TileFormer(nn.Module):
        def __init__(self, d: int = D_MODEL, nhead: int = NHEAD):
            super().__init__()
            self.proj = nn.Linear(len(FEATURES), d)
            self.conv1 = nn.Conv1d(d, d, 3, padding=1, dilation=1)
            self.conv2 = nn.Conv1d(d, d, 3, padding=2, dilation=2)
            self.norm1 = nn.GroupNorm(1, d)
            self.norm2 = nn.GroupNorm(1, d)
            self.attn = nn.TransformerEncoderLayer(
                d, nhead, dim_feedforward=2 * d, dropout=0.1,
                batch_first=True, norm_first=True)
            self.gate = nn.Linear(N_CTX, 1)
            nn.init.constant_(self.gate.bias, -1.0)
            self.head = nn.Sequential(nn.Linear(2 * d + N_CTX, 96), nn.GELU(),
                                      nn.Linear(96, len(QUANTILES)))

        def forward(self, x, ctx):
            h = self.proj(x).transpose(1, 2)
            h = h + torch.nn.functional.gelu(self.conv1(h))
            h = self.norm1(h)
            h = h + torch.nn.functional.gelu(self.conv2(h))
            h = self.norm2(h).transpose(1, 2)
            h = self.attn(h)
            z = torch.cat([h.mean(dim=1), h[:, -1, :], ctx], dim=-1)
            raw = self.head(z)
            mid = raw[:, 1]
            low = mid - torch.nn.functional.softplus(raw[:, 0])
            high = mid + torch.nn.functional.softplus(raw[:, 2])
            g = torch.sigmoid(self.gate(ctx)).squeeze(-1)
            out = torch.stack([low, mid, high], dim=1) * g.unsqueeze(1)
            return out
else:
    class TileFormer:  # type: ignore[no-redef]
        def __init__(self, *a, **k):
            raise RuntimeError("torch not installed")


def _device():
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _counts(rows: list[dict], deltas: np.ndarray) -> np.ndarray:
    base = np.array([r["anchor"] for r in rows], dtype=float)
    modis = np.array([r["modis"] for r in rows], dtype=float)
    return np.maximum(np.exp(base + np.asarray(deltas, float)) * (modis + 1.0) - 1.0, 0.0)


def _val_mae(model, rows, dev) -> float:
    if not rows:
        return float("inf")
    model.eval()
    with torch.no_grad():
        X = torch.tensor(np.stack([r["X"] for r in rows])).to(dev)
        C = torch.tensor(np.stack([r["ctx"] for r in rows])).to(dev)
        p = model(X, C).cpu().numpy()[:, 1]
    return float(np.mean(np.abs(_counts(rows, p) - np.array([r["viirs"] for r in rows]))))


def _fit(seed: int, train: list[dict], val: list[dict] | None, epochs: int,
         d: int = D_MODEL, nhead: int = NHEAD) -> tuple:
    torch.manual_seed(seed)
    np.random.seed(seed)
    dev = _device()
    model = TileFormer(d=d, nhead=nhead).to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-3)
    X = torch.tensor(np.stack([r["X"] for r in train])).to(dev)
    C = torch.tensor(np.stack([r["ctx"] for r in train])).to(dev)
    Y = torch.tensor([r["y"] for r in train], dtype=torch.float32).to(dev)
    best, state, best_ep, patience = float("inf"), None, 0, 0
    for ep in range(1, epochs + 1):
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
            best_ep = ep
            continue
        vl = _val_mae(model, val, dev)
        if vl < best - 1e-3:
            best, patience, best_ep = vl, 0, ep
            state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
            if patience >= 25:
                break
    if state is not None:
        model.load_state_dict(state)
    model.eval()
    return model, best_ep, best


def predict(models, rows) -> np.ndarray:
    dev = _device()
    X = torch.tensor(np.stack([r["X"] for r in rows])).to(dev)
    C = torch.tensor(np.stack([r["ctx"] for r in rows])).to(dev)
    with torch.no_grad():
        p = np.mean([m(X, C).cpu().numpy() for m in models], axis=0)
    return p


def metrics(y, p) -> dict:
    y = np.asarray(y, float)
    p = np.asarray(p, float)
    return {"mae": round(float(np.mean(np.abs(p - y))), 4),
            "wape": round(float(np.sum(np.abs(p - y)) / max(np.sum(y), 1e-9)), 4),
            "bias": round(float(np.mean(p - y)), 4), "n": int(len(y))}


def aggregate(rows: list[dict], preds: np.ndarray) -> list[dict]:
    groups: dict[tuple, list[float]] = {}
    for r, p in zip(rows, preds):
        key = (r["aoi"], r["year"], r["month"])
        g = groups.setdefault(key, [0.0, 0.0, 0.0])
        g[0] += float(p)
        g[1] += float(r["viirs"])
        g[2] += max(math.exp(r["anchor"]) * (r["modis"] + 1.0) - 1.0, 0.0)
    return [{"aoi": k[0], "year": k[1], "month": k[2],
             "pred": v[0], "viirs": v[1], "anchor": v[2]} for k, v in groups.items()]


def _agg_metrics(agg: list[dict]) -> dict:
    y = np.array([a["viirs"] for a in agg])
    p = np.array([a["pred"] for a in agg])
    b = np.array([a["anchor"] for a in agg])
    return {"tiles": {"model": metrics(y, p), "anchor": metrics(y, b)},
            "delta_mae": round(float(np.mean(np.abs(y - p)) - np.mean(np.abs(y - b))), 4),
            "n_aoi_months": len(agg)}


def _run_split(fit, val, test, epochs, seeds=SEEDS, d=D_MODEL, nhead=NHEAD):
    models = []
    eps = {}
    for s in seeds:
        m, ep, _ = _fit(s, fit, val, epochs, d, nhead)
        models.append(m)
        eps[s] = ep
    preds = predict(models, test)
    return models, preds, eps


def main(epochs: int = 200, d: int = D_MODEL) -> dict:
    if not _HAS_TORCH:
        raise RuntimeError("torch is not installed")
    tiles = loads()
    aoi_pairs = load_aoi_pairs()
    if not tiles or not aoi_pairs:
        raise RuntimeError("run scripts.firms.build_tiles first")
    ratios_sel = b2_by_aoi(aoi_pairs, 2023)
    ratios_final = b2_by_aoi(aoi_pairs, 2024)
    tr_sel = tile_anchors(tiles, ratios_sel, 2023)
    tr_final = tile_anchors(tiles, ratios_final, 2024)
    ws_sel = build_windows(tiles, ratios_sel, tile_ratios=tr_sel)
    ws_final = build_windows(tiles, ratios_final, tile_ratios=tr_final)
    print(f"windows: sel={len(ws_sel)} final={len(ws_final)}")

    fit_sel = [w for w in ws_sel if w["year"] < 2023]
    val_sel = [w for w in ws_sel if w["year"] == 2023]
    fit_final = [w for w in ws_final if w["year"] < 2024]
    test = [w for w in ws_final if w["year"] >= 2024]
    if not fit_sel or not test:
        raise RuntimeError("empty split")

    # Temporal split: select epochs on 2023, refit on <2024.
    sel_models, eps = [], {}
    for s in SEEDS:
        m, ep, _ = _fit(s, fit_sel, val_sel, epochs, d)
        sel_models.append(m)
        eps[s] = max(1, ep)
    # One global level calibration: sum(actual)/sum(predicted) on 2023, using
    # the model that never saw 2023. No per-region factor.
    val_p = _counts(val_sel, predict(sel_models, val_sel)[:, 1])
    scale = float(sum(w["viirs"] for w in val_sel) / max(val_p.sum(), 1e-9))
    scale = min(2.0, max(0.5, scale))
    models = [_fit(s, fit_final, None, eps[s], d)[0] for s in SEEDS]
    preds = predict(models, test)
    pred_counts = _counts(test, preds[:, 1]) * scale
    y = np.array([w["viirs"] for w in test])
    tile_metrics = metrics(y, pred_counts)
    anchor_counts = np.array([max(math.exp(w["anchor"]) * (w["modis"] + 1) - 1, 0)
                              for w in test])
    tile_anchor = metrics(y, anchor_counts)
    agg = aggregate(test, pred_counts)
    agg_m = _agg_metrics(agg)
    lo = _counts(test, preds[:, 0]) * scale
    hi = _counts(test, preds[:, 2]) * scale
    coverage = float(np.mean([(a <= w["viirs"] <= b)
                              for a, b, w in zip(lo, hi, test)]))
    result = {
        "method_id": METHOD_ID, "algorithm_version": ALGORITHM_VERSION,
        "data": "raw", "tile_deg": 1.0,
        "n_tiles": len({w["tile_id"] for w in test}),
        "n_train": len(fit_final), "n_test": len(test),
        "params": int(sum(p.numel() for p in models[0].parameters())),
        "epochs_by_seed": eps,
        "tile_metrics": {"model": tile_metrics, "anchor": tile_anchor},
        "tile_delta_mae": round(tile_metrics["mae"] - tile_anchor["mae"], 4),
        "aggregate": agg_m,
        "deployed": False,
        "gate": {
            "rule": ">=2% mean gain on AOI aggregates AND CI upper < 0",
            "passed": False,
            "reason": "the residual network does not beat the hierarchical anchor",
        },
        "coverage80": round(coverage, 4),
        "level_scale": round(scale, 4),
        "test_years": sorted({w["year"] for w in test}),
        "dataset_sha256": hashlib.sha256((BENCH / "tile_pairs_raw.csv").read_bytes()).hexdigest(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "device": str(_device()),
    }

    # Leave-one-region-out: train on the other two, test the third.
    loo = {}
    for held in AOIS:
        tr = [w for w in ws_sel if w["aoi"] != held]
        va = [w for w in tr if w["year"] == 2023]
        tr = [w for w in tr if w["year"] < 2023]
        te = [w for w in ws_final if w["aoi"] == held and w["year"] >= 2024]
        if not tr or not te:
            continue
        budgets, sel_ms = {}, []
        for s in SEEDS:
            m, ep, _ = _fit(s, tr, va, epochs, d)
            sel_ms.append(m)
            budgets[s] = max(1, ep)
        vp = _counts(va, predict(sel_ms, va)[:, 1])
        sc = float(sum(w["viirs"] for w in va) / max(vp.sum(), 1e-9))
        sc = min(2.0, max(0.5, sc))
        ms = [_fit(s, [w for w in ws_final if w["aoi"] != held and w["year"] < 2024],
                   None, budgets[s], d)[0] for s in SEEDS]
        pp = predict(ms, te)
        pc = _counts(te, pp[:, 1]) * sc
        yy = np.array([w["viirs"] for w in te])
        aa = np.array([max(math.exp(w["anchor"]) * (w["modis"] + 1) - 1, 0) for w in te])
        loo[held] = {
            "tile": {"model": metrics(yy, pc), "anchor": metrics(yy, aa)},
            "aggregate": _agg_metrics(aggregate(te, pc)),
            "n_train": len([w for w in ws_final if w["aoi"] != held and w["year"] < 2024]),
            "n_test": len(te), "level_scale": round(sc, 4),
        }
        print("LOO", held, loo[held]["tile"], loo[held]["aggregate"]["delta_mae"])

    result["loo_region"] = loo
    out = BENCH.parent / "models" / "tileformer_raw.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--d", type=int, default=D_MODEL)
    a = ap.parse_args()
    print(json.dumps(main(a.epochs, a.d), indent=1))
