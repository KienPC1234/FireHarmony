# SensorFormer — the single served architecture

Status: **served, anchor-only.** SensorFormer is the only model in the runtime
and UI. It is a seasonal-anchor-plus-residual model: the B2 monthly ratio is the
anchor, and a small transformer residue is allowed only if it clears a
pre-registered gate. On the 2024–2025 holdout the gate is **closed**, so every
served number is the anchor. This document explains the architecture, the
protocol, the negative result, and the limits.

## One architecture, no parallel model zoo

Older experiments are archived as negative results, not served:

- `ml_b2res_v4` (HGB residual) — gate off;
- `ts_logratio_pool_v2` (pooled Transformer) — loses to the anchor;
- `srf_v1` (Seasonal-Residual Former) — ties the anchor, uncalibrated band;
- `sf_lite_v1` (this model) — gate off, anchor fallback.

Only SensorFormer is wired into the calendar/API presentation. The archived
models remain reproducible in `docs/MODEL_DIAGNOSTICS.md` and their scripts, but
they are not choices a user can select.

## What it is

```
served(x) = seasonal_anchor(m, AOI) + gate × residual_net(window, context)
```

- **Seasonal anchor**: B2 per-month median log-ratio, fit on years before the
  holdout (`< 2024`).
- **Residual net**: 2-layer temporal CNN + one self-attention layer + context
  gate, predicting `log((VIIRS+1)/(MODIS+1)) − b2_log[month]`.
- **Gate**: calibrated per model, opened only with ≥2% mean MAE gain over the
  anchor **and** a bootstrap CI upper bound below zero. It is closed here.
- **Band**: monotone 10th/50th/90th quantiles. `low = mid − softplus(a)`,
  `high = mid + softplus(b)`, so quantile crossing is impossible by construction.
  Empirical coverage is reported; the band is not called a confidence interval.

Inputs use only MODIS counts, month phase, day fraction, Terra fraction and an
AOI embedding. The target month's VIIRS is never an input (regression `T34`).

## Protocol (audit-2 fixes)

The first version had two real defects, both fixed and tested:

1. **Validation leakage.** B2 was fit on years `< 2024` while 2023 was the
   validation year, so 2023 labels shaped the 2023 features and residuals.
   Now:
   - **selection phase**: B2 and the network fit on `< 2023`; early stopping on
     2023;
   - **final phase**: B2 and the network re-fit on `< 2024` with the selected
     epoch budget; the holdout is scored once.
   The leak is pinned by `T36` (2023-06 Vietnam: 1.18391 leaky vs 1.21260 clean).
2. **Early stopping with dropout on.** Validation ran in `model.train()`, so
   the epoch choice was noisy. `_val_mae()` now switches to `eval()` and monitors
   MAE in hotspot counts. `T37` checks determinism.

Other audit-2 changes:

- Removed the constant `observed` feature (it was always `1.0`; FIRMS CSV has no
  per-cell observation footprint). A month without a complete 12-month window is
  dropped, never zero-filled.
- Stored `mean_interval_width` and `median_interval_width` separately. The old
  artifact stored the mean under the median name (9,033 vs 4,162).
- Added `dataset_sha256`, `evaluation_sha256`, `fit_years`,
  `validation_years`, `baseline_fit_years`.
- `load_artifact` verifies the weights SHA-256; a mismatch returns no model
  (`T38`).
- `/api/firms/sf-status` reports `model_artifact_available` and
  `live_data_available` separately (`T39`).
- Added a year-block cluster bootstrap beside the AOI-month bootstrap.

## Raw NASA results (72 AOI-months, 2024–2025)

| Method | Pooled MAE | Headline (VN+AM, n=48) | Vietnam | Amazon | Australia |
|---|---:|---:|---:|---:|---:|
| Seasonal anchor (B2) | **2,386.9** | **2,746.0** | **844.2** | **4,647.7** | 1,668.8 |
| SensorFormer (gate off) | 2,458.5 | 2,859.8 | 849.2 | 4,836.8 | 1,689.4 |

- SF−anchor ΔMAE = **+71.6** (SF is worse), AOI-month CI **[−46.7, +213.4]**,
  P(SF better) = 0.15.
- Year-block CI **[+33.9, +109.2]** (2 blocks only; coarse but consistent with
  "worse"). The year-block view is the stricter one because months within a year
  are correlated.
- Mean gain vs anchor = **−3.0%** → gate **OFF**; served output is anchor-only.
- Empirical 80% band coverage = **86.1%**; mean width **8,894**, median **4,296**.
- Per-seed holdout MAE ranges **2,296.9–2,588.6**; the ensemble is not hiding a
  single lucky seed.

### Ablation (same two-phase split)

| Variant | Pooled MAE | Coverage 80% |
|---|---:|---:|
| Full (gate + attention) | **2,458.5** | 86.1% |
| `no_gate` | 2,631.6 | 86.1% |
| `no_attn` | 2,524.7 | 95.8% |

The gate helps over `no_gate`, but removing attention is still better than the
full model (2,525 vs 2,458). At 231 training windows, attention does not earn
its place. The `no_attn` band is also much wider (mean 19,890), so its higher
coverage is not evidence of a better model.

## Limits (do not overclaim)

- **Not a full observation-bias model.** FIRMS CSV gives hotspot counts, not
  cloud masks, footprint overlap, view angles, or overpass counts. The model
  corrects context-conditioned residual bias, not physical detection
  probability. The name is kept for continuity; the claim is limited.
- **No sensor-specific NOAA-20/21 learning.** Current raw pulls contain MODIS
  plus SNPP rows only. The day/Terra fractions are MODIS context, not a
  per-platform bias term.
- **No spatial transfer.** The AOI embedding is a one-hot over Vietnam, Amazon,
  Australia. Leave-one-region-out is future work, not a demonstrated result.
- **Detection-only target.** FIRMS records detected hotspots; fires missed by
  both sensors are absent from the benchmark. No model here estimates them.

## Reproduce

```bash
cd backend
python -m scripts.firms.train_sf --data raw --epochs 240
python -m scripts.firms.train_sf --data sample --epochs 240
python -m pytest tests/test_firms.py -q -k "T33 or T34 or T36 or T37 or T38 or T39"
```

Artifacts: `backend/data/firms/models/sf_lite_raw.{pt,json}` and
`sf_lite.{pt,json}`. API: `GET /api/firms/sf-status?data=raw`; the calendar
serves the anchor and labels the gate state.
