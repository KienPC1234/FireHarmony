# Audit V5 response — point-by-point

Source: `firms-fire-calendar-source(5).zip` / `AlphaCentauriAB`.
All numbers below are generated from `backend/data/firms/models/evaluation_raw.json`
and checked by `render_docs --check`; the raw NASA pull is not bundled, but
`training_pairs_raw.csv` + `evaluation_samples_raw.csv` reproduce the metrics
without it.

## P0

| ID | Status | Fix | Verification |
|---|---|---|---|
| P0-01 tests fail on clean ZIP | FIXED | two profiles: `make test-clean` (raw/SPA skipped) and `make test-full`; SPA test skips without `dist`; raw tests skip with a reason | clean: **62 pass, 4 skip**; full: **66 pass**; `frontend/dist` is included in the release zip |
| P0-02 verify does not retrain | FIXED | three levels: `evaluate --verify` (artifact), `rebuild_benchmark --data raw` (retrain from committed monthly pairs), `download_and_verify` + train (full raw) | rebuild delta **0.00** for B0/B1/B2/HGB/TS; `REBUILD OK` |
| P0-03 docs mismatch artifact | FIXED | `render_docs.py` generates the model-card block; `--check` in release gate | `DOCS METRICS OK` |
| P0-04 union coverage | FIXED | `coverage_from_day_sets`: MODIS days, VIIRS days, **paired days**, union reported separately; `partial` uses paired ratio | `test_T25_paired_sensor_coverage_not_union` (MODIS 31 + VIIRS 5 → paired 5, incomplete) |
| P0-05 fingerprint by metadata | FIXED | SHA-256 of file contents, memoized by size/mtime_ns/ctime_ns; same-size edit with restored mtime changes fingerprint | `test_T26_content_fingerprint_detects_same_size_edit` |
| P0-06 AOI-month vs cell-day | FIXED/DISCLOSED | `validation_unit=aoi-month`; UI banner says cell-day is not spatially validated; added `/spatial-check` (coarse co-observation consistency, explicitly **not** a spatial holdout) | Calendar banner, `/spatial-check`, `/lab` spatial tab |
| P0-07 Australia mixed into pooled | FIXED | `headline` = full-month AOIs only (vietnam+amazon); australia is a sparse stress test; docs generated with eligibility | generated model card header |
| P0-08 no uncertainty | FIXED | AOI-month block bootstrap (2000 resamples) for ΔMAE; CI and P(A better) in manifest | HGB−B2 Δ +9.5, CI [−59.4, +89.0] (gate abstains); TS−B2 Δ +186.9, CI [−258.3, +620.9] → **not established**; no “proven win” claim |

## P1

| ID | Status | What was done |
|---|---|---|
| P1-01 test years | FIXED | each AOI trains only on years before its holdout (`train_years` < min(`scored_years`)); current global holdout `scored_years=[2024,2025]`, n=72, `excluded_months` list |
| P1-02 coverage language | FIXED | `complete` (100% paired), `usable` (≥90%), `incomplete`; `full_months` = usable |
| P1-03 acquisition differences | MEASURED | `qa_summary.retained_fraction`, `platform_set=snpp`, simulator sensor subsets, and `/cross-validate` for a user-supplied burned-area series; no claim that biases are removed |
| P1-04 hotspots vs fires | FIXED | every chart/response says hotspot detections / activity index; FRP never upscaled |
| P1-05 dataset hash naming | FIXED | `pair_table_hash` added; raw manifest separate; docs use the precise name |
| P1-06 raw tests assume data | FIXED | skip with reason; tmp raw tests cover dedup/interleave; fixture-generated simulator tests |
| P1-07 SPA build dependency | FIXED | `dist` included in release zip; test-close profile skips with reason |
| P1-08 sklearn pin | MITIGATED | `scikit-learn==1.9.1` pinned; artifacts load under 1.8 with a warning; release gate can check version |
| P1-09 raw_ready too weak | FIXED | `dashboard_ready`, `benchmark_ready`, `checksums_present`, content `fingerprint` |
| P1-10 NRT | FIXED | `completeness.nrt` flag; 2026-11 never presented as a complete month |
| P1-11 only 3 AOIs | DISCLOSED | UI states raw is 3 preset AOIs; sample/upload supports custom bbox |
| P1-12 adversarial fixtures | FIXED | paired-coverage fixture, platform subset, missing data, dedup, gate tests |
| P1-13 frontend E2E | FIXED | typecheck/lint/build; `make e2e` HTTP smoke; **Playwright 4/4 passed** including `/lab` simulator |
| P1-14 chart provenance | FIXED | calendar shows method, data source, filters, coverage class; Lab shows config/units |

## Reproducibility levels

```bash
# 1. artifact consistency (seconds)
python -m scripts.firms.evaluate --data raw --verify
python -m scripts.firms.make_benchmark --check
python -m scripts.firms.render_docs --check

# 2. rebuild from committed monthly pairs (minutes, no raw pixels)
python -m scripts.firms.rebuild_benchmark --data raw

# 3. full raw rebuild (needs FIRMS_MAP_KEY, ~820 MB)
python -m scripts.firms.download_and_verify --aoi vietnam --bbox 104,10,109,16 \
  --start-year 2012 --end-year 2025
python -m scripts.firms.train_ml --aoi vietnam --data raw --test-years 2
python -m scripts.firms.train_ts --aoi vietnam --data raw --test-years 2
python -m scripts.firms.evaluate --data raw --test-years 2
```

## Data and coverage after repair

| AOI | rows | months | ≥90% **paired** days | day-31 gap | class |
|---|---:|---:|---:|---:|---|
| vietnam | 3,411,143 | 169 (2012-01 … 2026-11) | 168 | none | full-month |
| amazon | 4,653,546 | 85 | 84 | none | full-month |
| australia | 1,700,959 | 85 | 0 | 48 | sparse 5-day |

`coverage_ratio` is now `paired_days / days_in_month`, not union. MODIS-only /
VIIRS-only days are reported separately; the harmonization ratio is never
called “full coverage” from a union.

## Headline metrics (generated)

See `docs/FIRMS_MODEL_CARD.md` (generated block). The current headline
(vietnam+amazon, 2024–2025, n=48): HGB 2746.0 (= B2, gate off),
B2 2746.0, TS 2934.4, B1 5294.6, B0 21623.4. HGB−B2 CI includes 0
because the gate abstains; TS−B2 CI also includes 0.

## Satellite Fire Intelligence Lab (`/lab`)

1. **Satellite Mission Simulator** — choose MODIS / SNPP / NOAA-20 / NOAA-21;
   recompute the same calendar from stored per-platform counts. Outputs
   `k_measured_months`, `viirs_available`, observed/estimated cells, Δ vs all.
   A missing sensor is never presented as no fire.
2. **Sensor Blind Spot Explorer** — day × sensor table with
   `not_requested` / `observed_empty` / `detected` / `unknown_coverage`.
3. **AI Scientific Investigator** — question → deterministic tools (calendar,
   evaluation, coverage, evidence) → LLM/rule answer. Returns `tools_used`,
   evidence card, limitations, citations. The LLM number guard rejects any
   ≥1000 value not present in the facts.
4. **Spatial co-observation** — coarse-grid Pearson/Spearman/top-decile
   Jaccard on cells where both sensors saw detections. Labelled
   `co_observation_consistency`, never “spatial validation”.
5. **Cross-dataset check** — accepts a user-supplied monthly burned-area series
   (e.g. MCD64A1) and reports correlation with the activity index plus the
   caveat that burned area is not independent ground truth.

## Product / UI

The Lab was rebuilt as a mission-control surface rather than a plain form:
sensor toggle cards, KPI tiles (year total, Δ vs all, k months, observed vs
estimated), scenario bar chart, monthly area chart, a day × sensor heatmap with
`not_requested` / `observed_empty` / `detected` / `unknown`, spatial metric
bars, a burned-area scatter, and an investigator panel with tool chips and
limitations. All widgets read the same API responses; the Playwright smoke
test covers the Lab path (`4/4` passing).

## Remaining limits

- Australia is not full-month; the resume command is documented.
- Raw history now covers 2012–2025 for vietnam; 2026 NRT is partial. Exact months and resume commands are in `docs/DATA_GAPS.md`; `/coverage.gaps` and the Calendar UI expose the same ledger. The coverage-aware filter excludes incomplete months from training/eval, so the gap cannot silently bias a monthly ratio.
- Cell-day locations are not spatially validated; only AOI-month accuracy is
  claimed.
- Dedup uses rounded coordinates + time + satellite; `/dedup-sensitivity`
  bounds the collision effect.
- Playwright is executed locally: **4/4 smoke tests pass** (including `/lab`);
  the built SPA is shipped and the HTTP smoke tests cover routes/assets.

## Backend performance notes

Measured on the full vietnam pull (3.41M rows, 169 months):

| Path | Before | After |
|---|---|---|
| cold `/calendar?data=raw` | 188.6 s, RSS grew past the 4 GB PM2 limit and restarted mid-request | **151.8 s**, peak RSS ~1.1 GB |
| cached `/calendar?data=raw` | ~0.02 s | **0.24 s** (full 4.9 MB JSON) |
| raw `/simulate` | empty `daily` for `daily_cap=0` | real per-config totals from the full target year |
| raw CSV `/export` | retained 1.46M cell dicts before writing | aggregates, then streams CSV rows |

- `iter_raw_rows` parses with `csv.reader` + one lowercased header map instead
  of `csv.DictReader` + a per-row dict rebuild (1.8× faster on the same files).
- `FirmsRecord._aliases` skips rebuilding a dict when keys are already lowercase.
- `harmonize.iter_cell_days` walks sorted aggregate keys, so fusing MODIS/VIIRS
  no longer builds a `cells_days` dict with one object per cell-day (the 4 GB
  spike). `harmonize_daily` and `harmonize.iter_daily` share that path.
- `_harmonize_stream` accumulates monthly totals, detection days and platform
  mix while streaming, and materialises only the retained subset (5k for the
  calendar, the focus month for evidence/blind spots, the full target year for
  the simulator). `build_calendar` accepts those aggregates directly.
- Simulation mode retains every cell of the requested year, so sensor-subset
  totals are no longer computed from a truncated list.
- `coverage.load_manifest` / `coverage_for_aoi` are memoized by manifest
  mtime+size; `/coverage`, `/calendar`, and gap checks no longer re-parse the
  2,000-entry manifest independently.
- Calendar results are cached by method+filters, not by `limit`; a 2k/25k
  request no longer triggers a duplicate stream.
- Raw CSV export aggregates once and streams row-by-row; no full cell list and
  no full CSV string in memory.
- Known remaining cost: the first raw stat call still validates 3.41M rows
  through Pydantic (~150 s); later calls are milliseconds. ML/TS raw paths still
  build the full fused list because both models rescale every cell-day of a
  month; that is why `ecosystem.config.cjs` now allows 6 GB instead of 4 GB.
  The default UI path (`stat`) stays near 1.1 GB.
