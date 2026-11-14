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
| australia | 1,700,959 | 85 | 84 | full-month (backfilled 2026-11-13) |

The first full-month fetcher requested days 1,6,11,16,21,26 × 5 days, which
covers 1–30 and **never day 31**. `fetch_missing.py` now diffs the manifest
against every calendar day and fetched only the gaps: vietnam and amazon are
at **168/169 full months** for vietnam (2012–2025 after the early-year backfill)
and **84/85** for amazon. Australia was 0/85 full months (one 5-day window per
month); the 2026-11-13 backfill brought it to **84/85**, so it is now a comparable
third AOI instead of a sparse stress test. The one partial month is the current
NRT month, which stays excluded.

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
  fallback, never a zero-width interval. For `method=stan`, estimated cells also
  carry the model's own log-scale band (`uncertainty_status="model_band"`),
  calibrated on the 2023 selection year. The artifact publishes both the
  validation coverage (0.81) and the 2024-25 holdout coverage (0.72): the
  nominal 80% band still undercovers on the holdout, and
  `/api/firms/stan-status` reports that number instead of quoting 80% as if it
  were measured on the test years.
- **Raw subset.** `data/firms/raw_subset/vietnam_2025-01` contains 16 untouched
  NASA CSVs + checksums; `rebuild_subset` reproduces 49,638 clean rows,
  20,306 cell-days and 54,563.23 for that month.

## Rebuild the stack

One command replaces the eight remembered steps (old workflow could silently mix
artifacts from different data pulls):

```bash
cd backend
python -m scripts.firms.retrain_all            # tiles -> eval -> HTS -> STAN -> unify -> docs
```

Order and rationale are in the module docstring; nothing is served until the
STAN series step, and the last two steps only publish numbers.

## Unified evaluation protocol

`evaluation.py` freezes one sample set:

1. holdout years are the last two complete years in the manifest (`scored_years=[2024, 2025]`); 2026 NRT is excluded as partial;
2. B1/B2 ratios are fit on train years only;
3. STAN/HTS predictions are joined onto the same sample IDs from their artifacts
   (`merge_artifact_methods`), never retrained inside a request;
4. per-AOI and pooled metrics are computed on exactly the same sample IDs.

`eval_unit = "aoi-month (VIIRS hotspot detections, not fires)"`. The calendar
allocates the monthly prediction only to MODIS-only cells, so the month total
equals the prediction by construction; `ml_meta.conservation_max_abs_error`
measures that identity at serving time. The headline table uses the default
filters `qa_min=all` and `platform_set=all`; `/api/firms/qa-summary` and the
Calendar filter selects expose how the answer changes when low-confidence rows
are dropped or only SNPP VIIRS is kept.

## One served model

`backend/app/firms/registry.py` is the single source of truth for what serves
the product:

| role | method | served as | why |
|---|---|---|---|
| primary | `stan_safe_v1` | `method=stan` | best point estimate: 3,765.8 vs B2 4,411.8 and HTS 4,154.4 on the 72-month holdout; every AOI improves, but the 95% CI vs B2 [−1,452.9, +81.8] still includes 0 |
| baseline | `b2_seasonal_ratio` | `method=stat` | reference every learned model must beat |
| fallback | `hts_anchor_v1` | `method=hts`, STAN pre-2024 | stable anchor before the 12-month tile window exists; 4,154.4, CI vs B2 includes 0 |

The table below joins STAN/HTS onto the same 72 AOI-months via
`evaluation.merge_artifact_methods` (run `python -m scripts.firms.unify_eval`),
so the served STAN number sits next to its baselines instead of in a separate
document. Point estimate and statistical significance are reported separately
(`/api/firms/models` → `primary_gate`).

## Real unified table

The block below is generated from the evaluation artifact by
`python -m scripts.firms.render_docs`; `--check` is part of CI. Do not edit it
by hand.

<!-- BEGIN GENERATED METRICS -->
_Generated from `evaluation_raw.json` · `eval-v4` · pair_table_hash `ba2843d649435d28`._

Candidate holdout years: `[2024, 2025]` · scored years: `[2024, 2025]` · excluded months (no 12-month context): `[]`.

**Headline — full-month AOIs only ['vietnam', 'amazon', 'australia'] (n=72)**

| Method | MAE | WAPE | Bias | n |
|---|---:|---:|---:|---:|
| `b0_raw_modis` | 38119.8 | 0.774 | -38119.8 | 72 |
| `b1_global_ratio` | 6386.6 | 0.130 | -682.6 | 72 |
| `b2_seasonal_ratio` | 4411.8 | 0.090 | +1281.3 | 72 |
| `stan_safe_v1` | 3765.8 | 0.077 | +1421.3 | 72 |
| `hts_anchor_v1` | 4154.4 | 0.084 | +646.1 | 72 |

_All scored AOIs meet the full-month coverage rule (>=80% of months with >=90% paired MODIS/VIIRS days)._

**All-AOI pooled (n=72)**

| Method | MAE | WAPE | Bias | n |
|---|---:|---:|---:|---:|
| `b0_raw_modis` | 38119.8 | 0.774 | -38119.8 | 72 |
| `b1_global_ratio` | 6386.6 | 0.130 | -682.6 | 72 |
| `b2_seasonal_ratio` | 4411.8 | 0.090 | +1281.3 | 72 |
| `stan_safe_v1` | 3765.8 | 0.077 | +1421.3 | 72 |
| `hts_anchor_v1` | 4154.4 | 0.084 | +646.1 | 72 |

| AOI | coverage class | months ≥90% paired days | months |
|---|---|---:|---:|
| vietnam | full_month | 168 | 169 |
| amazon | full_month | 84 | 85 |
| australia | full_month | 84 | 85 |

| comparison | ΔMAE (A−B) | 95% bootstrap CI | P(A better) | n |
|---|---:|---|---:|---:|
| stan_vs_b2 | -646.0 | [-1452.9, +81.8] | 0.96 | 72 |
| stan_vs_hts | -388.6 | [-939.0, +50.7] | 0.95 | 72 |
| hts_vs_b2 | -257.4 | [-777.1, +266.2] | 0.83 | 72 |

_Bootstrap unit: AOI-month block; it is not a claim of independent hotspot observations._

**Per-AOI metrics**

| AOI | b0_raw_modis | b1_global_ratio | b2_seasonal_ratio | stan_safe_v1 | hts_anchor_v1 |
|---|---:|---:|---:|---:|---:|
| vietnam | 11112.1 | 3493.2 | 844.2 | 694.2 | 783.9 |
| amazon | 32134.6 | 7095.9 | 4647.7 | 3391.4 | 4250.1 |
| australia | 71112.8 | 8570.5 | 7743.6 | 7211.9 | 7429.3 |
<!-- END GENERATED METRICS -->

How to read it:

- The headline pool now includes all three AOIs: Australia was backfilled to
  84/85 full months on 2026-11-13, so it is no longer a 5-day-window stress test.
- STAN is the point-estimate winner and improves every AOI over B2 and HTS, but
  its 95% CI vs B2 `[-1,452.9, +81.8]` still includes 0. The API reports
  `recommended_primary=stan_safe_v1` and `statistically_established=false`
  separately.
- HTS is retained as the fallback (and as STAN's pre-2024 base). Its own gain
  over B2 (4.4%) is also not statistically established.
- The bootstrap CI resamples AOI-month rows independently (2,000 draws), not
  hotspots and not whole years. Seasonal/year correlation can make it
  optimistic; it is not a year-block or region-year bootstrap. A year-block
  bootstrap (`block="year"` in `ml_core.delta_ci`) is future work: with only
  two holdout years it would be coarse, so the shipped CI stays AOI-month
  (see the generated row above: unit is AOI-month block). A CI that
  includes 0 means the improvement is not established.

## Architectures

### `hts_anchor_v1` (hierarchical tile-seasonal anchor — candidate)

- Aggregates the raw pull at 1-degree tiles: 56,187 tile-months, 17,742 with
  ≥20 MODIS and ≥20 VIIRS, 1,125 tiles.
- Per-tile monthly log-ratio shrunk toward B2: `w = n/(n+3)`; sparse tiles fall
  back to the tile mean, then B2. One global level factor fit on 2023 (0.995).
- **Result on the official 72 rows: MAE 4,218.8 vs B2 4,411.8 (−193.0, −4.4%)**;
  Vietnam 795.7, Amazon 4,325.9, Australia 7,534.8 — all three improve.
- CI **[−743.8, +358.6]**, P(better) 0.76. The gate (≥2% and CI upper < 0) is
  **not passed**, so this is a candidate/fallback, not a deployed win.
- Artifact: `models/hts_anchor_raw.json`; monthly serving targets:
  `models/hts_series_raw.json` (`scripts.firms.build_hts_series`).
- Served as `method=hts` on raw data and as STAN's pre-2024 fallback; responses
  mark it candidate with `gate_passed=false`. The synthetic sample returns 409.

### `stan_v1` (Spatial-Temporal Anchor Network — served main model)

- NB2 count likelihood; mean = HTS anchor × exp(δ); 12-month dilated TCN
  (1/2/4) with seasonal FiLM; target-month query cross-attention; neighbour
  context without same-month neighbour VIIRS.
- 171k params, 5 fixed seeds (7, 17, 27, 37, 47; `SEEDS` in
  `backend/app/firms/stan.py:47`), early stop on 2023 count MAE (the NLL made training
  collapse to epoch 1 after the full Australia backfill — fixed), refit `< 2024`,
  one level factor from 2023. Weights `models/stan_safe_raw.pt` (sha256 in JSON).
- **Official 72: MAE 3,765.8 vs B2 4,411.8 (−14.6%), CI [−1,452.9, +81.8];
  Vietnam 694.2, Amazon 3,391.4, Australia 7,211.9.** Best point estimate and
  beats HTS (4,154.4) in every AOI, but the 95% CI still includes 0.
- LOO: Vietnam 801.4 vs HTS 783.9, Amazon 4,510.9 vs 4,250.1, Australia
  7,493.2 vs 7,429.3. Region transfer is still not solved.
- Predictive band: log-scale 80% band calibrated on the 2023 selection year;
  validation coverage 0.81, 2024-25 holdout coverage 0.72 (measured
  undercoverage on n=72 holdout months; the width is still fit on 2023 only —
  a coverage gap, not a point-estimate claim).
- Ablations from the earlier run: FiLM is the main structural win (no-FiLM +13%);
  3 layers best; Poisson ≈ NB; d=96 > d=64 > d=32. The retrospective twin
  (neighbour VIIRS) is flagged, not the forecast claim.
- **Served as `method=stan` on raw data**: STAN targets for 2024+, HTS fallback
  before 2024; sample uses B2 and STAN returns 409.
  `/api/firms/stan-status` reports `served=true, role=main`, and
  `/api/firms/models` separates the point-estimate winner from
  `statistically_established`.
- Caveats stay visible: the CI vs B2 includes 0, and LOO fails for all three AOIs.

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
