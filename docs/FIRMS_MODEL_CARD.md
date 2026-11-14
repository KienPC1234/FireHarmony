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
| vietnam | 1,387,361 | 85 (2019-01 … 2026-11) | 73 | full-month |
| amazon | 4,460,272 | 85 | 72 | full-month |
| australia | 1,656,892 | 85 | 0 | **sparse 5-day windows only** |

The first full-month fetcher requested days 1,6,11,16,21,26 × 5 days, which
covers 1–30 and **never day 31**. `coverage.missing_day_histogram` reports that
gap explicitly (49 months per AOI); those months are 30/31 = 96.8% covered, so
they remain usable but are not described as 100%. The fixed fetcher derives
windows from `calendar.monthrange`, so a re-fetch covers day 31 and leap
Februaries. Australia still has only the old one-window-per-month pulls; every
australia month is flagged `partial`, and its numbers are a 5-day-window
comparison, not a monthly total. The "full-month pooled" rows below therefore
use vietnam + amazon only.

## Unified evaluation protocol

`evaluation.py` freezes one sample set:

1. holdout years are chosen once (`test_years=2` → 2025 + NRT 2026-11);
2. B1/B2 ratios and the HGB residual are fit on train years only;
3. the pooled Transformer is trained on the same train years;
4. only AOI-months where **every** method has a prediction enter the table;
   the Transformer needs 12 prior MODIS months, so 2026-11 is context-missing
   and is excluded (reported as `ts_months_missing_context`);
5. per-AOI and pooled metrics are computed on exactly the same sample IDs.

`eval_unit = "aoi-month (VIIRS hotspot detections, not fires)"`. The calendar
allocates the monthly prediction only to MODIS-only cells, so the month total
equals the prediction by construction; `ml_meta.conservation_max_abs_error`
measures that identity at serving time.

## Real unified table (train 2019–2024 → test 2025, n=36)

| Method | pooled MAE | vietnam | amazon | australia |
|---|---|---|---|---|
| B0 raw MODIS | 10262.5 | 8665.2 | 9670.2 | 12452.3 |
| B1 global ratio | 2037.7 | 2426.8 | 2019.8 | **1666.3** |
| B2 seasonal ratio | 1282.6 | **867.6** | **1255.1** | 1725.1 |
| `ml_b2res_v4` (gated) | **1263.0** | 867.6 | 1255.1 | 1666.3 |
| `ts_logratio_pool_v2` | 1798.0 | 1225.4 | 2338.2 | 1830.5 |

Full-month pooled only (vietnam + amazon, n=24):

| Method | MAE |
|---|---|
| B2 seasonal ratio | **1061.4** |
| `ml_b2res_v4` (abstains to B2) | 1061.4 |
| `ts_logratio_pool_v2` | 1781.8 |
| B1 global ratio | 2223.3 |
| B0 raw MODIS | 9167.7 |

Read the losses honestly:

- **The gated HGB wins pooled by 1.5%** (1263.0 vs 1282.6). It does that only
  because the gate serves B1 for australia and B2 for vietnam/amazon — the
  learned residual itself is disabled on all three AOIs. This is a baseline
  selector, not evidence that the residual works.
- **The Transformer does not beat B2.** It beats B1 pooled (1798 vs 2038) but
  loses to B2 on every AOI and by 68% on the full-month pool. Its earlier,
  larger “win” came from a different test set; the unified protocol replaced it.
- B2 wins vietnam and amazon; B1 wins australia; the gate wins pooled. No
  single method wins every region.

## Architectures

### `ml_b2res_v4` (HGB, sklearn)

- prediction = `(MODIS + 1) · exp(b2_log_ratio[month] + residual) − 1`;
  the same inverse is used by batch and single-row inference (audit P0-02).
- 7 features: log MODIS, relative activity vs train climatology, day fraction,
  Terra fraction, previous-month relative activity, month sin/cos.
- `blocked_cv_compare` scores B1, B2 and the residual on identical expanding
  folds; abstains unless all three gate conditions hold: ≥2% mean gain, a
  majority of folds, and no regression on the latest fold.
- On the real data the gate **abstains** for all three AOIs:
  `residual_enabled=false`, `fallback_baseline=b2_seasonal_ratio` (vietnam,
  amazon) or `b1_global_ratio` (australia).
- Artifacts carry `feature_version`, `algorithm_version`, `data_fingerprint`.

### `ts_logratio_pool_v2` (PyTorch, 17,793 params)

- target = `log((VIIRS+1)/(MODIS+1))` of the window's last month, not a level;
- pooled 3-AOI training with an AOI embedding (219 windows vs 73 per AOI);
- early stopping on the last **training** year, GELU, dropout 0.1, grad clip,
  AdamW, 5-seed ensemble; on the unified sample the seed range is
  **1704.4–1986.0**, and even the best seed loses to B2 (1282.6);
- months without 12 consecutive MODIS months are not scored; the API returns
  `months_scored`, `months_missing_context`, and a per-month effective method.

## Spatial transfer — the honest weak spot

`scripts.firms.train_spatial` / `ts_v2.train_leave_one_out` trains on the other
two AOIs with **no AOI embedding** and scores the held-out region. This is the
protocol that can detect a model that only memorised a region.

| Held out | Transformer MAE | B1 MAE | B0 raw MODIS | Verdict |
|---|---|---|---|---|
| vietnam | 4192.9 | 3450.5 | 10778.6 | loses to B1 |
| amazon | 20445.3 | 24319.1 | 7061.0 | beats B1, loses badly to raw MODIS |
| australia | 4693.5 | 5611.0 | 11828.2 | beats B1 |

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
    --bbox 104,10,109,16 --start-year 2019 --end-year 2025 --workers 4
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
