# SensorFormer Lite — experimental sensor-aware calibrator

Status: **not deployed.** It lost to the B2 seasonal anchor on the shared
2024–2025 holdout, so the gate keeps B2 as the served default. This document is
the evidence for treating it as an experiment, not a claim of superiority.

## Why this architecture

The vanilla pooled Transformer (`ts_logratio_pool_v2`) already loses to B2.
Scaling it up would add parameters, not evidence. SensorFormer Lite instead
targets the parts of the problem a generic forecaster ignores:

- **MODIS-only input window**: 12 consecutive months of MODIS count, month
  phase, day fraction, Terra fraction, and an observed flag. The target month's
  VIIRS is never an input (regression test `T34`).
- **Residual on B2**: it predicts `log((VIIRS+1)/(MODIS+1)) - b2_log_ratio[month]`,
  so B2 remains the anchor and the network only learns corrections.
- **Sensor/context gate**: a sigmoid gate conditioned on the AOI embedding,
  current MODIS level, B2 log-ratio and month phase.
- **Temporal CNN + one attention layer**: two kernel-3 convolutions plus one
  self-attention layer; no large stack.
- **Quantile heads** (0.1 / 0.5 / 0.9) trained with pinball loss. Empirical
  coverage is reported on the holdout — the band is not called a confidence
  interval.

## Protocol

- Pairs: `backend/data/firms/benchmark/training_pairs_raw.csv` (337 AOI-months).
- Features use only MODIS + context; B1/B2 ratios are fit on train years only.
- Fit years `< 2023`, validation 2023, holdout from the same 72 sample IDs as
  `evaluation_raw.json` (2024–2025).
- 5 seeds averaged; 195 train windows, 72 test windows.
- Gate: serve only with ≥2% mean gain over B2 **and** SF−B2 bootstrap CI upper
  bound < 0.

## Raw NASA results (72 AOI-months)

| Method | Pooled MAE | Headline MAE (VN+AM, n=48) | Vietnam | Amazon | Australia |
|---|---|---|---|---|---|
| B2 seasonal ratio | **2,386.9** | **2,746.0** | **844.2** | **4,647.7** | 1,668.8 |
| SensorFormer Lite | 2,452.0 | 2,857.4 | 904.8 | 4,810.0 | **1,641.2** |

- SF−B2 ΔMAE = **+65.1**, 95% bootstrap CI **[−76.6, +226.5]**, P(SF better) = 0.23.
- Mean gain vs B2 = **−2.7%** → gate **OFF**; not served.
- Empirical 80% interval coverage = **80.6%** (nominal 80%), median width 9,033.
- Australia is the only AOI where SF wins (1,641 vs 1,669); that is a 1.7%
  difference, not a claim of regional superiority.

### Ablation (same split, same seeds)

| Variant | Pooled MAE | Coverage 80% |
|---|---|---|
| Full (gate + attention) | 2,452.0 | 80.6% |
| `no_gate` | 2,512.7 | 84.7% |
| `no_attn` | **2,446.8** | 87.5% |

The gate improves over `no_gate` by ~61 MAE, but removing attention is slightly
*better* than the full model. There is no evidence here that attention earns its
place at this data scale.

## Sample-data run

| Method | MAE | WAPE | Coverage 80% |
|---|---|---|---|
| B2 | **9.995** | — | — |
| SensorFormer Lite | 10.072 | 14.2% | 80.6% |

Gate is also OFF on synthetic data (`mean_gain_vs_b2 = −0.8%`).

## Reproduce

```bash
cd backend
python -m scripts.firms.train_sf --data raw --epochs 200
python -m scripts.firms.train_sf --data sample --epochs 160
python -m pytest tests/test_firms.py -q -k "T33 or T34"
```

Artifacts: `sf_lite_raw.pt/json`, `sf_lite.pt/json`.
API: `GET /api/firms/sf-status?data=raw`, and `/api/firms/backtest` exposes
`sf_lite`, `sf_lite_deployed`, per-AOI `metrics.sf_lite_v1` and `months[].sf_pred`.
UI: Methods benchmark row and X-Ray leaderboard; status is always “Gate OFF ·
not served” while it loses.

## Limits

- AOI-month level only; this is not a cell-day fire model.
- 195 training windows is small for attention; results are seed-averaged but
  not a large-sample estimate.
- The current raw pull has MODIS + SNPP only, so the sensor gate cannot learn
  NOAA-20/21 effects; that requires a new data pull and an event-study ablation.
- Observation context is request/data presence, not a cloud-free footprint.
- Quantile coverage is measured on 72 points; the binomial uncertainty around
  80.6% is roughly ±9 percentage points.
