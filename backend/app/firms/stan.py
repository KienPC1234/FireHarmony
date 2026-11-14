"""STAN: Spatial-Temporal Anchor Network, built for tile-month fire counts.

Why this shape (not a standard Transformer):
1. Counts, not Gaussian levels -> negative-binomial (NB2) likelihood with the
   mean anchored on the HTS tile-seasonal baseline.
2. A 12-month seasonal cycle -> dilated causal TCN (1/2/4) with seasonal FiLM
   modulation, plus a learned target-month query cross-attending over the
   window (no 12x12 self-attention).
3. Fire is spatially correlated -> neighbour-tile summary (same-month MODIS,
   previous-month VIIRS ratio). The retrospective variant may also use
   same-month neighbour VIIRS; the forecast-safe variant may not.
4. Exposure differs -> `days_modis` enters as a covariate.

Deliberately small (tens of thousands of parameters) because n is a few
thousand windows. Ablations (Poisson vs NB, FiLM, spatial context, attention)
are reported by the caller.
"""
from __future__ import annotations

import os

os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

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

METHOD_ID = "stan_v1"
ALGORITHM_VERSION = "stan-v1.0"
WIN = 12
D_MODEL = 96
NHEAD = 4
SEEDS = (7, 17, 27, 37, 47)
AOIS = ("vietnam", "amazon", "australia")
SEQ_FEATURES = ("log_modis", "days_modis", "day_frac", "terra_frac",
                "sin", "cos", "nbr_modis_log", "nbr_ratio_prev")
SAFE_CTX = ("latr", "lonr", "sinlat", "coslat", "sinlon", "coslon",
            "tile_clim", "anchor", "nbr_viirs_prev_log")
RETRO_CTX = SAFE_CTX + ("nbr_viirs_log", "nbr_ratio")
BENCH = Path(__file__).resolve().parents[2] / "data" / "firms" / "benchmark"
MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "firms" / "models"


def build_windows(retrospective: bool, cutoff: int = 2024) -> list[dict]:
    from app.firms import sf_tile, spatial_hgb
    df = spatial_hgb._frame()
    pairs = sf_tile.load_aoi_pairs()
    ratios = sf_tile.b2_by_aoi(pairs, cutoff)
    anchors = sf_tile.tile_anchors(sf_tile.loads(), ratios, cutoff)
    train_mask = df.year < cutoff
    clim = df[train_mask].groupby("tile_id").logm.mean()
    global_clim = float(df[train_mask].logm.mean())
    df["anchor"] = [anchors.get((t, m), 0.0)
                    for t, m in zip(df.tile_id, df.month)]
    df["tile_clim"] = df.tile_id.map(clim).fillna(global_clim)
    ctx_cols = list(RETRO_CTX if retrospective else SAFE_CTX)
    by_tile: dict[str, list] = {}
    for row in df.itertuples():
        by_tile.setdefault(row.tile_id, []).append(row)
    out = []
    for tid, rows in by_tile.items():
        rows.sort(key=lambda r: r.ym)
        index = {r.ym: i for i, r in enumerate(rows)}
        for r in rows:
            if r.modis < 20:
                continue
            seq = []
            ok = True
            for k in range(WIN - 1, -1, -1):
                j = index.get(r.ym - k)
                if j is None:
                    ok = False
                    break
                seq.append(rows[j])
            if not ok:
                continue
            X = np.array([[q.logm, q.days_modis, q.day_frac, q.terra_frac,
                           q.sin, q.cos, q.nbr_modis_log, q.nbr_ratio_prev]
                          for q in seq], dtype=np.float32)
            ctx = np.array([float(getattr(r, c)) for c in ctx_cols],
                           dtype=np.float32)
            anchor_count = max(math.exp(r.anchor) * (r.modis + 1) - 1, 0.0)
            out.append({"id": f"{tid}:{r.year}-{r.month:02d}",
                        "aoi": r.aoi, "tile_id": tid,
                        "year": int(r.year), "month": int(r.month),
                        "modis": float(r.modis), "viirs": float(r.viirs),
                        "anchor": float(r.anchor),
                        "anchor_count": float(anchor_count),
                        "X": X, "ctx": ctx})
    return out


if _HAS_TORCH:
    class STAN(nn.Module):
        def __init__(self, seq_dim: int, ctx_dim: int, d: int = D_MODEL,
                     nhead: int = NHEAD, layers: int = 3, use_film: bool = True,
                     dispersion: bool = True):
            super().__init__()
            self.use_film = use_film
            self.dispersion = dispersion
            self.proj = nn.Linear(seq_dim, d)
            self.month = nn.Embedding(12, d)
            self.film = nn.Linear(d, 2 * d) if use_film else None
            self.convs = nn.ModuleList([
                nn.Conv1d(d, d, 3, padding=2 ** i, dilation=2 ** i)
                for i in range(layers)])
            self.norms = nn.ModuleList([nn.GroupNorm(1, d) for _ in range(layers)])
            self.query = nn.Linear(d + ctx_dim, d)
            self.attn = nn.MultiheadAttention(d, nhead, batch_first=True,
                                              dropout=0.1)
            self.drop = nn.Dropout(0.1)
            self.head = nn.Sequential(nn.Linear(2 * d + ctx_dim, 96), nn.GELU(),
                                      nn.Linear(96, 1))
            nn.init.zeros_(self.head[-1].weight)
            nn.init.zeros_(self.head[-1].bias)
            self.log_alpha = nn.Parameter(torch.tensor(-6.0))

        def forward(self, x, ctx, month_idx):
            h = self.proj(x)
            if self.film is not None:
                m = self.month(month_idx)
                gamma, beta = self.film(m).chunk(2, dim=-1)
                h = h * (1 + gamma.unsqueeze(1)) + beta.unsqueeze(1)
            h = h.transpose(1, 2)
            for conv, norm in zip(self.convs, self.norms):
                z = h + torch.nn.functional.gelu(conv(h))
                h = norm(z)
            h = h.transpose(1, 2)
            q = self.query(torch.cat([self.month(month_idx), ctx], dim=-1))
            a, _ = self.attn(q.unsqueeze(1), h, h, need_weights=False)
            z = torch.cat([a.squeeze(1), h[:, -1, :], ctx], dim=-1)
            delta = torch.clamp(self.head(self.drop(z)).squeeze(-1), -3.0, 3.0)
            alpha = torch.nn.functional.softplus(self.log_alpha) if self.dispersion \
                else torch.zeros((), device=x.device)
            return delta, alpha
else:
    class STAN:  # type: ignore[no-redef]
        def __init__(self, *a, **k):
            raise RuntimeError("torch not installed")


def _nb_nll(y, log_mu, alpha):
    log_mu = torch.clamp(log_mu, -20.0, 20.0)
    mu = torch.exp(log_mu) + 1e-6
    if float(alpha.detach()) < 1e-6:
        return torch.mean(mu - y * torch.log(mu))
    a = alpha
    # This expression is log p(y); return its negative.
    log_p = (
        torch.lgamma(y + 1.0 / a) - torch.lgamma(y + 1.0)
        - torch.lgamma(1.0 / a)
        + (1.0 / a) * torch.log(1.0 / (1.0 + a * mu))
        + y * torch.log((a * mu) / (1.0 + a * mu) + 1e-9))
    return -torch.mean(log_p)


def _tensors(rows, device):
    X = torch.tensor(np.stack([r["X"] for r in rows])).to(device)
    C = torch.tensor(np.stack([r["ctx"] for r in rows])).to(device)
    M = torch.tensor([r["month"] - 1 for r in rows], dtype=torch.long).to(device)
    A = torch.tensor([math.log1p(r["anchor_count"]) for r in rows],
                     dtype=torch.float32).to(device)
    Y = torch.tensor([r["viirs"] for r in rows], dtype=torch.float32).to(device)
    return X, C, M, A, Y


def _val_loss(model, rows, device):
    if not rows:
        return float("inf")
    model.eval()
    with torch.no_grad():
        X, C, M, A, Y = _tensors(rows, device)
        delta, alpha = model(X, C, M)
        return float(_nb_nll(Y, A + delta, alpha))


def fit(seed, train, val, epochs=160, d=D_MODEL, layers=3, dispersion=True,
        use_film=True, retrospective=False, lr=3e-4):
    torch.manual_seed(seed)
    np.random.seed(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    torch.use_deterministic_algorithms(True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ctx_dim = len(RETRO_CTX if retrospective else SAFE_CTX)
    model = STAN(len(SEQ_FEATURES), ctx_dim, d=d, layers=layers,
                 use_film=use_film, dispersion=dispersion).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-3)
    X, C, M, A, Y = _tensors(train, device)
    best, state, best_ep, patience = float("inf"), None, 0, 0
    for ep in range(1, epochs + 1):
        model.train()
        opt.zero_grad()
        delta, alpha = model(X, C, M)
        loss = _nb_nll(Y, A + delta, alpha)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        if not val:
            best_ep = ep
            continue
        vl = _val_loss(model, val, device)
        if vl < best - 1e-4:
            best, patience, best_ep = vl, 0, ep
            state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
            if patience >= 20:
                break
    if state is not None:
        model.load_state_dict(state)
    model.eval()
    return model, best_ep, best


def predict(models, rows, retrospective):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    X, C, M, A, _Y = _tensors(rows, device)
    with torch.no_grad():
        mus = []
        for m in models:
            m.to(device)
            delta, _ = m(X, C, M)
            mus.append(torch.exp(A + delta).cpu().numpy())
    return np.clip(np.mean(mus, axis=0), 0, None)


def _agg(rows, pred):
    groups = {}
    for r, p in zip(rows, pred):
        key = (r["aoi"], r["year"], r["month"])
        g = groups.setdefault(key, [0.0, 0.0, 0.0])
        g[0] += float(p)
        g[1] += float(r["viirs"])
        g[2] += float(r["anchor_count"])
    return [{"aoi": k[0], "year": k[1], "month": k[2],
             "pred": v[0], "viirs": v[1], "anchor": v[2]} for k, v in groups.items()]


def load_models(path: Path | None = None):
    if not _HAS_TORCH:
        return None, None
    p = path or (MODEL_DIR / "stan_safe_raw.pt")
    if not p.exists():
        return None, None
    blob = torch.load(p, map_location="cpu", weights_only=True)
    cfg = blob.get("config", {})
    models = []
    for sd in blob["models"]:
        m = STAN(len(cfg.get("seq_features", SEQ_FEATURES)),
                 len(cfg.get("ctx_features", SAFE_CTX)),
                 d=int(cfg.get("d", D_MODEL)),
                 layers=int(cfg.get("layers", 3)),
                 use_film=True, dispersion=True)
        m.load_state_dict(sd)
        m.eval()
        models.append(m)
    return models, cfg


def build_series() -> dict:
    """Monthly AOI targets: STAN for 2024+, HTS for earlier months."""
    from app.firms import sf_tile
    models, _cfg = load_models()
    if not models:
        raise RuntimeError("stan_safe_raw.pt missing; run -m app.firms.stan")
    meta = json.loads((MODEL_DIR / "stan_safe_raw.json").read_text(encoding="utf-8"))
    scale = float(meta.get("level_scale_2023", 1.0))
    rows = [r for r in build_windows(False, 2024) if r["year"] >= 2024]
    pred = predict(models, rows, False) * scale
    tiles = sf_tile.loads()
    pairs = sf_tile.load_aoi_pairs()
    ratios = sf_tile.b2_by_aoi(pairs, 2024)
    anchors = sf_tile.tile_anchors(tiles, ratios, 2024)
    from collections import defaultdict
    base = defaultdict(float)
    for t in tiles:
        if t["year"] < 2024:
            continue
        b1, b2m = ratios[t["aoi"]]
        a = anchors.get((t["tile_id"], t["month"]), b2m.get(t["month"], b1))
        base[(t["aoi"], t["year"], t["month"])] += max(
            math.exp(a) * (t["modis"] + 1) - 1, 0)
    delta = defaultdict(float)
    for r, p in zip(rows, pred):
        delta[(r["aoi"], r["year"], r["month"])] += float(p) - r["anchor_count"]
    series: dict[str, dict] = {a: {} for a in AOIS}
    hts_path = MODEL_DIR / "hts_series_raw.json"
    if hts_path.exists():
        hts = json.loads(hts_path.read_text(encoding="utf-8")).get("series", {})
        for a in AOIS:
            for ym, v in (hts.get(a) or {}).items():
                series[a][ym] = {"target": float(v["hts"]), "source": "hts"}
    for (aoi, y, m), v in base.items():
        ym = f"{y}-{m:02d}"
        series[aoi][ym] = {"target": round(v + delta.get((aoi, y, m), 0.0), 3),
                           "source": "stan"}
    state = {
        "method_id": "stan_safe_v1",
        "algorithm_version": ALGORITHM_VERSION,
        "role": "main",
        "cutoff_rule": "STAN for >=2024 (anchor <2024); HTS series before 2024",
        "level_scale_2023": scale,
        "months": {a: len(series[a]) for a in AOIS},
        "dataset_sha256": hashlib.sha256(
            (BENCH / "tile_pairs_raw.csv").read_bytes()).hexdigest(),
        "series": series,
    }
    (MODEL_DIR / "stan_series_raw.json").write_text(
        json.dumps(state, separators=(",", ":")) + "\n", encoding="utf-8")
    return {k: state[k] for k in ("method_id", "role", "months", "cutoff_rule")}


def targets(aoi: str) -> dict[str, float]:
    p = MODEL_DIR / "stan_series_raw.json"
    if not p.exists():
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    return {ym: float(v["target"])
            for ym, v in (data.get("series", {}).get(aoi) or {}).items()}


def _official_eval(test: list[dict], pred: np.ndarray,
                   only_aoi: str | None = None) -> dict:
    """Serve simulation: STAN where a window exists, HTS anchor elsewhere."""
    import csv
    from collections import defaultdict
    from app.firms import sf_tile
    from app.firms.evaluation import _delta_ci, _metrics
    tiles = sf_tile.loads()
    pairs = sf_tile.load_aoi_pairs()
    ratios = sf_tile.b2_by_aoi(pairs, 2024)
    anchors = sf_tile.tile_anchors(tiles, ratios, 2024)
    base: dict[tuple, float] = defaultdict(float)
    for t in tiles:
        if t["year"] < 2024:
            continue
        b1, b2m = ratios[t["aoi"]]
        a = anchors.get((t["tile_id"], t["month"]), b2m.get(t["month"], b1))
        base[(t["aoi"], t["year"], t["month"])] += max(
            math.exp(a) * (t["modis"] + 1) - 1, 0)
    delta: dict[tuple, float] = defaultdict(float)
    for r, p in zip(test, pred):
        delta[(r["aoi"], r["year"], r["month"])] += float(p) - r["anchor_count"]
    official = {}
    with (BENCH / "evaluation_samples_raw.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            official[(r["aoi"], int(r["year"]), int(r["month"]))] = {
                "viirs": float(r["viirs_ref"]),
                "b2": float(r["b2_seasonal_ratio"])}
    samples = []
    for key, off in official.items():
        if key not in base:
            continue
        if only_aoi is not None and key[0] != only_aoi:
            continue
        samples.append({"aoi": key[0], "year": key[1], "month": key[2],
                        "viirs_ref": off["viirs"],
                        "stan": base[key] + delta.get(key, 0.0),
                        "hts_anchor": base[key],
                        "b2_seasonal_ratio": off["b2"]})
    y = np.array([s["viirs_ref"] for s in samples])
    out = {"n": len(samples),
           "metrics": _metrics(y, np.array([s["stan"] for s in samples])),
           "hts_metrics": _metrics(y, np.array([s["hts_anchor"] for s in samples])),
           "b2_metrics": _metrics(y, np.array([s["b2_seasonal_ratio"] for s in samples])),
           "comparisons": {
               "stan_vs_hts": _delta_ci(samples, "stan", "hts_anchor"),
               "stan_vs_b2": _delta_ci(samples, "stan", "b2_seasonal_ratio")},
           "per_aoi": {}}
    hidx = [i for i, s in enumerate(samples)
            if s["aoi"] in ("vietnam", "amazon")]
    if hidx:
        out["headline"] = _metrics(y[hidx], np.array([samples[i]["stan"] for i in hidx]))
        out["hts_headline"] = _metrics(y[hidx], np.array([samples[i]["hts_anchor"] for i in hidx]))
        out["b2_headline"] = _metrics(y[hidx], np.array([samples[i]["b2_seasonal_ratio"] for i in hidx]))
    else:
        out["headline"] = None
        out["hts_headline"] = None
        out["b2_headline"] = None
    for aoi in AOIS:
        idx = [i for i, s in enumerate(samples) if s["aoi"] == aoi]
        if idx:
            out["per_aoi"][aoi] = {
                "stan": _metrics(y[idx], np.array([samples[i]["stan"] for i in idx])),
                "hts": _metrics(y[idx], np.array([samples[i]["hts_anchor"] for i in idx])),
                "b2": _metrics(y[idx], np.array([samples[i]["b2_seasonal_ratio"] for i in idx]))}
    return out


def run_loo(retrospective: bool = False, epochs: int = 160,
            d: int = D_MODEL) -> dict:
    """Leave-one-region-out: train on two AOIs, score the third's official months."""
    rows_sel = build_windows(retrospective, 2023)
    rows_final = build_windows(retrospective, 2024)
    out = {}
    for held in AOIS:
        sel = [r for r in rows_sel if r["aoi"] != held and r["year"] < 2023]
        val = [r for r in rows_sel if r["aoi"] != held and r["year"] == 2023]
        fit_rows = [r for r in rows_final if r["aoi"] != held and r["year"] < 2024]
        test = [r for r in rows_final if r["aoi"] == held and r["year"] >= 2024]
        if not sel or not test:
            continue
        budgets, sel_models = {}, []
        for s in SEEDS:
            m, ep, _ = fit(s, sel, val, epochs, d, True, True, retrospective)
            budgets[s] = max(1, ep)
            sel_models.append(m)
        vp = predict(sel_models, val, retrospective)
        sc = min(2.0, max(0.5, sum(r["viirs"] for r in val) /
                          max(float(vp.sum()), 1e-9)))
        models = [fit(s, fit_rows, None, budgets[s], d, True, True,
                      retrospective)[0] for s in SEEDS]
        pred = predict(models, test, retrospective) * sc
        out[held] = _official_eval(test, pred, only_aoi=held)
        out[held]["level_scale_2023"] = round(sc, 4)
        out[held]["n_train"] = len(fit_rows)
        out[held]["n_test"] = len(test)
    return out


def run(retrospective: bool = True, epochs: int = 160,
        d: int = D_MODEL, layers: int = 3, dispersion: bool = True,
        use_film: bool = True, return_models: bool = False):
    if not _HAS_TORCH:
        raise RuntimeError("torch is not installed")
    from app.firms.evaluation import _delta_ci, _metrics
    rows_sel = build_windows(retrospective, 2023)
    rows_final = build_windows(retrospective, 2024)
    if not rows_final:
        raise RuntimeError("no windows; run build_tiles first")
    sel = [r for r in rows_sel if r["year"] < 2023]
    val = [r for r in rows_sel if r["year"] == 2023]
    fit_rows = [r for r in rows_final if r["year"] < 2024]
    test = [r for r in rows_final if r["year"] >= 2024]
    sel_models, eps = [], {}
    for s in SEEDS:
        m, ep, _ = fit(s, sel, val, epochs, d, layers, dispersion, use_film,
                       retrospective)
        eps[s] = max(1, ep)
        sel_models.append(m)
    val_pred = predict(sel_models, val, retrospective)
    scale = min(2.0, max(0.5,
        sum(r["viirs"] for r in val) / max(float(val_pred.sum()), 1e-9)))
    models = [fit(s, fit_rows, None, eps[s], d, layers, dispersion, use_film,
                  retrospective)[0] for s in SEEDS]
    pred = predict(models, test, retrospective) * scale
    agg = _agg(test, pred)
    y = np.array([a["viirs"] for a in agg])
    p = np.array([a["pred"] for a in agg])
    h = np.array([a["anchor"] for a in agg])
    samples = [{"aoi": a["aoi"], "year": a["year"], "month": a["month"],
                "viirs_ref": a["viirs"], "stan": a["pred"],
                "hts_anchor": a["anchor"]} for a in agg]
    state = {
        "method_id": METHOD_ID,
        "algorithm_version": ALGORITHM_VERSION,
        "variant": "retrospective" if retrospective else "forecast_safe",
        "retrospective": retrospective,
        "uses_neighbour_viirs_same_month": retrospective,
        "params": int(sum(q.numel() for q in models[0].parameters())),
        "n_train": len(fit_rows), "n_test": len(test),
        "epochs_by_seed": eps,
        "level_scale_2023": round(scale, 4),
        "metrics": _metrics(y, p),
        "hts_metrics": _metrics(y, h),
        "per_aoi": {a: {"stan": _metrics(
                            np.array([s["viirs_ref"] for s in samples if s["aoi"] == a]),
                            np.array([s["stan"] for s in samples if s["aoi"] == a])),
                        "hts": _metrics(
                            np.array([s["viirs_ref"] for s in samples if s["aoi"] == a]),
                            np.array([s["hts_anchor"] for s in samples if s["aoi"] == a]))}
                    for a in AOIS if any(s["aoi"] == a for s in samples)},
        "comparisons": {"stan_vs_hts": _delta_ci(samples, "stan", "hts_anchor")},
        "official": _official_eval(test, pred),
        "dataset_sha256": hashlib.sha256(
            (BENCH / "tile_pairs_raw.csv").read_bytes()).hexdigest(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "predictions": {f"{s['aoi']}:{s['year']}-{s['month']:02d}": {
            "stan": round(float(s["stan"]), 3),
            "hts": round(float(s["hts_anchor"]), 3),
            "viirs_ref": s["viirs_ref"]} for s in samples},
    }
    if return_models:
        return state, models
    return state


def main() -> dict:
    if not _HAS_TORCH:
        raise RuntimeError("torch is not installed")
    state, models = run(retrospective=False, return_models=True)
    state["loo_region"] = run_loo(retrospective=False)
    out = MODEL_DIR / "stan_safe_raw.json"
    out.write_text(json.dumps(state, indent=1) + "\n", encoding="utf-8")
    pt = MODEL_DIR / "stan_safe_raw.pt"
    torch.save({"models": [m.state_dict() for m in models],
                "config": {"seq_features": list(SEQ_FEATURES),
                           "ctx_features": list(SAFE_CTX),
                           "d": D_MODEL, "layers": 3, "win": WIN,
                           "algorithm_version": ALGORITHM_VERSION}}, pt)
    state["weights_sha256"] = hashlib.sha256(pt.read_bytes()).hexdigest()
    out.write_text(json.dumps(state, indent=1) + "\n", encoding="utf-8")
    return state


if __name__ == "__main__":
    s = main()
    print(json.dumps({k: s[k] for k in (
        "variant", "params", "n_train", "n_test", "metrics", "hts_metrics",
        "comparisons")}, indent=1))
