# FIRMS model card — what is trained, on what, and how it scores

> Two artifact families ship: `*_sample` (synthetic, offline demo) and `*_raw`
> (real NASA FIRMS pulls). A raw request (`data=raw`) can only be served by a
> `*_raw` artifact whose `data_fingerprint` matches the raw files on disk;
> otherwise the API returns 409, never a stale or sample model.
>
> Every number below comes from `backend/data/firms/models/evaluation_raw.json`
> and can be recomputed from the committed
> `backend/data/firms/benchmark/evaluation_samples_raw.csv` with
> `python -m scripts.firms.make_benchmark --check` (tolerance 1e-6).

## Data coverage — read this before the table

| AOI | raw rows | manifest months | months ≥90% of days requested | coverage class |
|---|---|---|---|---|
| vietnam | 3,411,143 | 169 (2012-01 … 2026-11) | 168 | full-month |
| amazon | 4,653,546 | 85 | 84 | full-month |
| australia | 1,700,959 | 85 | 1 | **sparse 5-day windows only** |

The first full-month fetcher requested days 1,6,11,16,21,26 × 5 days, which
covers 1–30 and **never day 31**. `fetch_missing.py` now diffs the manifest
against every calendar day and fetched only the gaps: vietnam and amazon are
at **168/169 full months** for vietnam (2012–2025 after the early-year backfill) and **84/85** for amazon.
Australia is still one 5-day window per month (0/85 months with ≥90% paired days); its numbers
are a 5-day-window comparison, not a monthly total. The "full-month pooled"
rows below therefore use vietnam + amazon only.

## Scientific guards (audit V6)

- **Anomaly eligibility.** A month enters median/MAD, leave-one-year-out and
  column climatology only when its manifest coverage is verified and its
  `paired_coverage_ratio >= 0.90`. Partial months keep their observed value in
  the matrix but get `anomaly=null`/`anomaly_reason="ineligible_coverage"`.
  With fewer than three eligible other years, the cell returns
  `insufficient_comparable_history` rather than falling back to a baseline that
  contains the year being scored.
- **Uncertainty.** `harmonized_count_low/high` is emitted only with at least
  three co-observed months and a positive monthly-ratio IQR. Otherwise both are
  null and `uncertainty_status="not_calibrated"`; k=0.35 remains a labeled
  fallback, never a zero-width interval.
- **Transformer artifacts.** Six `ts_*.pt` state dicts ship with the release,
  pinned in `backend/data/firms/models/TS_WEIGHTS.sha256`. `/api/health`
  advertises `ts` only when torch and the weight+metadata files both exist.
- **Raw subset.** `data/firms/raw_subset/vietnam_2025-01` contains 16 untouched
  NASA CSVs + checksums; `rebuild_subset` reproduces 49,638 clean rows,
  20,306 cell-days and 54,563.23 for that month.

## Unified evaluation protocol

`evaluation.py` freezes one sample set:

1. holdout years are the last two complete years in the manifest (`scored_years=[2024, 2025]`); 2026 NRT is excluded as partial and context-missing;
2. B1/B2 ratios and the HGB residual are fit on train years only;
3. the pooled Transformer is trained on the same train years;
4. only AOI-months where **every** method has a prediction enter the table;
   the Transformer needs 12 prior MODIS months, so 2026-11 is context-missing
   and is excluded (reported as `ts_months_missing_context`);
5. per-AOI and pooled metrics are computed on exactly the same sample IDs.

`eval_unit = "aoi-month (VIIRS hotspot detections, not fires)"`. The calendar
allocates the monthly prediction only to MODIS-only cells, so the month total
equals the prediction by construction; `ml_meta.conservation_max_abs_error`
measures that identity at serving time. The headline table uses the default
filters `qa_min=all` and `platform_set=all`; `/api/firms/qa-summary` and the
Calendar filter selects expose how the answer changes when low-confidence rows
are dropped or only SNPP VIIRS is kept.

## Real unified table

The block below is generated from the evaluation artifact by
`python -m scripts.firms.render_docs`; `--check` is part of CI. Do not edit it
by hand.

<!-- BEGIN GENERATED METRICS -->
_Generated from `evaluation_raw.json` · `eval-v2` · pair_table_hash `b359387bc92e7e1c`._

Candidate holdout years: `[2024, 2025]` · scored years: `[2024, 2025]` · excluded months (no 12-month context): `[]`.

**Headline — full-month AOIs only ['vietnam', 'amazon'] (n=48)**

| Method | MAE | WAPE | Bias | n |
|---|---:|---:|---:|---:|
| `b0_raw_modis` | 21623.4 | 0.758 | -21623.4 | 48 |
| `b1_global_ratio` | 5294.6 | 0.186 | -3718.5 | 48 |
| `b2_seasonal_ratio` | 2746.0 | 0.096 | -222.9 | 48 |
| `hgb_b2res_v4` | 2746.0 | 0.096 | -222.9 | 48 |
| `ts_logratio_pool_v2` | 2934.4 | 0.103 | -845.8 | 48 |

_Australia has 0/85 months with >=90% paired MODIS/VIIRS days; it is a sparse stress test, not a comparable monthly series._

**All-AOI pooled (n=72)**

| Method | MAE | WAPE | Bias | n |
|---|---:|---:|---:|---:|
| `b0_raw_modis` | 18220.6 | 0.764 | -18220.6 | 72 |
| `b1_global_ratio` | 4095.5 | 0.172 | -2163.0 | 72 |
| `b2_seasonal_ratio` | 2386.9 | 0.100 | +90.0 | 72 |
| `hgb_b2res_v4` | 2396.4 | 0.101 | +167.4 | 72 |
| `ts_logratio_pool_v2` | 2573.9 | 0.108 | -196.6 | 72 |

| AOI | coverage class | months ≥90% paired days | months |
|---|---|---:|---:|
| vietnam | full_month | 168 | 169 |
| amazon | full_month | 84 | 85 |
| australia | sparse_window | 0 | 85 |

| comparison | ΔMAE (A−B) | 95% bootstrap CI | P(A better) | n |
|---|---:|---|---:|---:|
| hgb_vs_b2 | +9.5 | [-59.4, +89.0] | 0.38 | 72 |
| hgb_vs_b1 | -1699.1 | [-3244.4, -450.1] | 1.00 | 72 |
| ts_vs_b2 | +186.9 | [-258.3, +620.9] | 0.19 | 72 |
| ts_vs_b1 | -1521.6 | [-2964.7, -379.6] | 1.00 | 72 |

_Bootstrap unit: AOI-month block; it is not a claim of independent hotspot observations._

**Walk-forward HGB gate folds (expanding window, count MAE)**

| AOI | test year | B1 | B2 | residual |
|---|---:|---:|---:|---:|
| vietnam | 2015 | 5426.5 | 2466.09 | 2930.99 |
| vietnam | 2016 | 7811.86 | 4731.46 | 4831.95 |
| vietnam | 2017 | 3496.16 | 1115.02 | 1282.03 |
| vietnam | 2018 | 3765.74 | 547.55 | 971.72 |
| vietnam | 2019 | 4972.09 | 1768.35 | 1737.8 |
| vietnam | 2020 | 6756.34 | 2430.08 | 2443.56 |
| vietnam | 2021 | 4115.81 | 1311.58 | 1632.17 |
| vietnam | 2022 | 2856.38 | 1902.84 | 2165.56 |
| vietnam | 2023 | 3754.8 | 865.28 | 696.74 |
| amazon | 2022 | 7649.42 | 4434.51 | 4350.69 |
| amazon | 2023 | 4977.64 | 2662.11 | 2863.9 |
| australia | 2022 | 1726.91 | 2035.6 | 1840.71 |
| australia | 2023 | 1191.68 | 1907.94 | 1552.37 |

**Per-AOI metrics**

| AOI | b0_raw_modis | b1_global_ratio | b2_seasonal_ratio | hgb_b2res_v4 | ts_logratio_pool_v2 |
|---|---:|---:|---:|---:|---:|
| vietnam | 11112.1 | 3493.2 | 844.2 | 844.2 | 1329.6 |
| amazon | 32134.6 | 7095.9 | 4647.7 | 4647.7 | 4539.1 |
| australia | 11415.2 | 1697.3 | 1668.8 | 1697.3 | 1852.8 |
<!-- END GENERATED METRICS -->

How to read it:

- The headline is the full-month pool (vietnam + amazon). Australia is a sparse
  5-day-window stress test and is excluded from the headline ranking.
- HGB is allowed to touch the output only when its blocked-CV gate beats the
  **best** baseline on the majority of folds. Otherwise the served output is
  B1/B2 and `residual_enabled=false`.
- The Transformer is reported even when it loses: it narrowly wins amazon,
  but loses to B2 on vietnam and australia and on the headline pool. A losing
  model is evidence, not a marketing claim.
- The bootstrap CI resamples AOI-month rows independently (2,000 draws), not
  hotspots and not whole years. Seasonal/year correlation can make it
  optimistic; it is not a year-block or region-year bootstrap. A CI that
  includes 0 means the improvement is not established.
- On the current manifest the HGB−B2 CI includes 0, so the defensible claim is
  “the gate is a safety rule, not a win”; on the current data it abstains on
  all AOIs, so the served output is B1/B2. The Transformer−B2 CI also includes
  0; it is not significantly different from B2 on this sample.

## Architectures

### `ml_b2res_v4` (HGB, sklearn)

- prediction = `(MODIS + 1) · exp(b2_log_ratio[month] + residual) − 1`;
  the same inverse is used by batch and single-row inference (audit P0-02).
- 7 features: log MODIS, relative activity vs train climatology, day fraction,
  Terra fraction, previous-month relative activity, month sin/cos.
- `blocked_cv_compare` scores B1, B2 and the residual on identical expanding
  folds; abstains unless all three gate conditions hold: ≥2% mean gain, a
  majority of folds, and no regression on the latest fold.
- On the current data (including the 2012–2013 backfill for vietnam) the gate
  **abstains for all three AOIs**: the residual does not beat the best
  baseline on a majority of folds, so the served output is B2 (or B1 where CV
  selects it). Adding early years made the baseline stronger, not the model.
- Artifacts carry `feature_version`, `algorithm_version`, `data_fingerprint`.

### `ts_logratio_pool_v2` (PyTorch, 17,793 params)

- target = `log((VIIRS+1)/(MODIS+1))` of the window's last month, not a level;
- pooled 3-AOI training with an AOI embedding (219 windows vs 73 per AOI);
- early stopping on the last **training** year, GELU, dropout 0.1, grad clip,
  AdamW, 5-seed ensemble; on the unified sample the seed range is
  **2547.6–2975.8** and the ensemble 2573.9 loses to B2 2386.9; the comparison
  CI includes 0, so no gain is established;
- months without 12 consecutive MODIS months are not scored; the API returns
  `months_scored`, `months_missing_context`, and a per-month effective method.

### `sf_lite_v1` (SensorFormer — single served architecture, gate OFF)

- Seasonal anchor (B2) + residual network: temporal CNN (2 conv layers) + one
  attention layer + context gate; monotone quantile heads 0.1/0.5/0.9.
- Inputs: 12-month MODIS window + month phase + day/Terra fractions + AOI
  embedding. The target month's VIIRS is never an input (`T34`), and the
  constant `observed` flag was removed because FIRMS CSV has no observation
  footprint.
- Two-phase protocol: B2 and the net fit on `< 2023` for epoch selection
  (validation 2023, eval mode, count-space MAE); then both re-fit on `< 2024`
  with that epoch budget and scored once on 72 holdout IDs. `T36` pins the
  leak-free 2023 baseline.
- **Result: pooled MAE 2,458.5 vs anchor 2,386.9**; Δ = +71.6, AOI-month CI
  [−46.7, +213.4], year-block CI [+33.9, +109.2]; mean gain −3.0%. Gate
  **OFF**; the calendar serves the anchor only and labels the gate state.
- Per-seed holdout MAE 2,296.9–2,588.6 across 5 seeds.
- Ablation: `no_gate` 2,631.6; `no_attn` 2,524.7. The gate helps vs no-gate,
  but attention does not justify itself at 231 windows.
- Empirical 80% band coverage 86.1%; mean width 8,894, median 4,296;
  zero quantile crossings by construction.
- Weights SHA-256 is verified on load (`T38`); status separates model artifact
  from live NASA data (`T39`). Full protocol and limits: `docs/SENSORFORMER.md`.

### `hts_anchor_v1` (hierarchical tile-seasonal anchor — candidate)

- Aggregates the raw pull at 1-degree tiles: 42,327 tile-months, 10,315 with
  ≥20 MODIS and ≥20 VIIRS, 1,060 tiles, 3,924 windows with 12-month context.
- Per-tile monthly log-ratio shrunk toward B2: `w = n/(n+3)`; sparse tiles fall
  back to the tile mean, then B2. One global level factor fit on 2023 (0.997).
- **Result on the official 72 rows: MAE 2,230.7 vs B2 2,386.9 (−156.2, −6.5%)**;
  Vietnam 790.9, Amazon 4,297.1, Australia 1,604.1 — all three improve.
- CI **[−362.0, +44.0]**, P(better) 0.93; year-block CI [−366.9, +54.5]. The
  gate (≥2% and CI upper < 0) is **not passed**, so this is a candidate, not a
  deployed win.
- Artifact: `models/hts_anchor_raw.json`; monthly serving targets:
  `models/hts_series_raw.json` (`scripts.firms.build_hts_series`).
- Served only as `method=hts` on raw data; responses mark it candidate with
  `gate_passed=false`. The synthetic sample returns 409 (no tiles).

### `tileformer_v1` (region-agnostic residual — rejected)

- 12-month tile window + dilated CNN + one transformer layer + smooth
  geographic basis (no AOI one-hot), gated residual on HTS, monotone quantiles.
- Tile-level MAE 141.6 vs HTS 137.0; AOI-aggregate MAE 1,419 vs 1,218.
- Capacity sweep d=32/64/128 (22,574 → 258,254 params) improves tile MAE
  143.2 → 139.5 but never beats HTS; aggregate error stays worse.
- Leave-one-region-out: Vietnam +134, Amazon +1,458, Australia −3.5 aggregate
  MAE versus HTS. Region transfer is not solved.
- `deployed=false`. Full evidence: `docs/TILE_HIERARCHY.md`.

## Spatial transfer — the honest weak spot

`scripts.firms.train_spatial` / `ts_v2.train_leave_one_out` trains on the other
two AOIs with **no AOI embedding** and scores the held-out region. This is the
protocol that can detect a model that only memorised a region.

| Held out | Transformer MAE | B1 MAE | B0 raw MODIS | Verdict |
|---|---|---|---|---|
| vietnam | 3917.8 | 4399.5 | 5456.7 | beats B1 and raw MODIS |
| amazon | 10118.3 | 17004.8 | 6548.4 | beats B1, loses to raw MODIS |
| australia | 5501.3 | 5279.0 | 10940.7 | loses to B1, beats raw MODIS |

Spatial transfer is not reliable, so the served model is the temporally
trained pooled model; the LOO table is published as a limitation, not a win.

## Baselines (always reported, same split)

B0 raw MODIS · B1 global median log-ratio · B2 per-month median log-ratio.
All are fit on train years only and scored in original count space with MAE,
WAPE and bias. Missing months stay null, never zero.

## Reproduce

```bash
cd backend
../.venv/bin/python -m scripts.firms.download_and_verify --aoi vietnam \
    --bbox 104,10,109,16 --start-year 2012 --end-year 2025 --workers 4
../.venv/bin/python -m scripts.firms.train_ml --aoi vietnam --data raw --test-years 2
../.venv/bin/python -m scripts.firms.train_ts --aoi vietnam --data raw --test-years 2
../.venv/bin/python -m scripts.firms.evaluate --data raw --test-years 2
../.venv/bin/python -m scripts.firms.evaluate --data raw --verify
../.venv/bin/python -m scripts.firms.train_spatial --data raw
../.venv/bin/python -m scripts.firms.make_benchmark --check
../.venv/bin/python -m pytest tests/test_firms.py -q
```

## Limits

- Units are hotspot detections / sensor-adjusted activity index, never
  confirmed fires. VIIRS is a sensor reference, not ground truth.
- The 2026-11 NRT month mixes SNPP + NOAA-20 + NOAA-21, while the training
  ratios are mostly SNPP. `platform_mix` and `/api/firms/platform-series`
  expose the mix; a rise can be a new overpass, not more fire.
- Dedup uses rounded coordinates + time + satellite; collocated valid
  detections within ~11 m can collapse. Granule/pixel IDs are not in the CSV.
- Low-confidence MODIS rows are kept (flagged), not silently dropped.
- Cell area is a cos-latitude approximation, not an equal-area grid.
- A sentence-era ratio near 1.1 is internal consistency, not accuracy.
