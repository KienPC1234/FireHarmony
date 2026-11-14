> **Historical document.** This is the response to Audit V4. Current numbers,
> coverage definitions and the Lab features are in `AUDIT_V5_RESPONSE.md` and the
> generated model card. Do not cite the numbers below as current.

# Audit V4 response — point-by-point

This document answers the external audit of FireHarmony. It lists
what changed, where, how to verify it, and what is still a limitation. Every
number here is reproducible from the committed artifacts without the 650 MB
raw pull (`make_benchmark --check`, `evaluate --verify`).

## Verdict

- The audit's three most damaging findings were valid: HGB V4 inference was
  broken (P0-01), monthly coverage was incomplete/misreported (P0-03/P0-06),
  and the benchmark mixed different splits/AOIs/versions (P0-07/P0-08/P0-09).
  They are fixed and covered by regression tests.
- The audit's warning about over-claiming a Transformer win was also right.
  The unified evaluation now shows **HGB wins vietnam**, **B2 wins amazon**,
  **B1 wins australia**, and the Transformer loses to B2. The old, larger
  “Transformer win” came from a different test set and was removed.
- Data was repaired: vietnam and amazon moved from 73/72 to **84/85 full
  months**; the day-31 gap is closed for them. Australia remains sparse and is
  labelled as such.

## P0 items

| ID | Status | Fix | Evidence / test |
|---|---|---|---|
| P0-01 HGB V4 inference | FIXED | `ml_cal.predict_viirs` dispatches `b2_residual` to `ml_v4.predict_one`; unknown targets raise; `_harmonize_daily_ml` counts failures and refuses to serve stat under an ML label | `test_T01_v4_dispatch_uses_seven_features`, live `/calendar?method=ml` |
| P0-02 fallback formula | FIXED | one `_counts_from_log_ratio` inverse for batch and single-row | `test_T02_predict_one_equals_predict_counts_gate_on_and_off` |
| P0-03 day 31 / month windows | FIXED | `windows_for_month` uses `monthrange`; `fetch_missing.py` downloads only missing intervals; ledger records failures | `test_T03_full_month_windows_cover_every_day`, `/api/firms/coverage` |
| P0-04 baseline leakage | FIXED | B1/B2 fit on train years only; `estimate_efficiency_ratio(mode, exclude_months)`; fusion vs predictive labelled | `test_T04_no_target_leakage_from_test_viirs` |
| P0-05 retrospective drift | FIXED | ratio provenance (`calibration_window`, `train_end`, `sensor_set`, `data_version`) + uncertainty band on upscaled cells | `/calendar` `calibration`, `harmonized_count_low/high` |
| P0-06 completeness vs detection days | FIXED | manifest-derived `observed_days`, `coverage_ratio`, `missing_days`, `coverage_status`; detection days separate | `test_T06` (verified coverage), `test_verified_coverage_marks_partial_not_detection_days` |
| P0-07 mixed benchmark | FIXED | `evaluation.py` freezes one sample set for B0/B1/B2/HGB/TS; per-AOI and pooled tables use the same IDs | `test_T07_unified_evaluation_manifest`, `evaluate --verify` |
| P0-08 stale cache | FIXED | cache filename/key includes data fingerprint + algorithm versions + split; `/backtest` reads the evaluation manifest | `test_T08_cache_key_changes_with_model_or_data_version` |
| P0-09 X-Ray legacy model | FIXED | X-Ray reads the unified manifest and the artifact with `tag=data`; shows effective method/compat | `test_T09_xray_uses_unified_manifest_not_legacy` |
| P0-10 not reproducible | FIXED | committed `evaluation_samples_*.csv`, `BENCHMARK.json` sha256, `make_benchmark --check`, `download_and_verify.py` | check output: `BENCHMARK CHECK OK` |
| P0-11 AOI-month vs cell-day | FIXED/DISCLOSED | `eval_unit=aoi-month`; serving reports `months_scored`, `months_missing_context`, `conservation_max_abs_error`; export/calendar conservation test | `test_T11_export_matches_calendar` |
| P0-12 platform mixing | FIXED/DISCLOSED | `platform_counts`, `platform_mix`, `/platform-series` (SNPP-only series), N20/N21 normalisation, `platform_set=snpp` | `test_T15_platform_mix_is_explicit` |
| P0-13 stale artifact/data | FIXED | `artifact_compat` checks `data_fingerprint` + `feature_version`; 409 on mismatch | `test_T13_artifact_compat_rejects_stale_fingerprint` |
| P0-14 raw absent 200 | FIXED | 404 `no_raw_data`; `data-status.raw_ready`; calendar does not return an empty observed calendar | `test_T10_raw_absent_is_explicit_404` |

## P1 items

| ID | Status | What was done |
|---|---|---|
| P1-01 latest partial | FIXED | shared `_latest_summary` skips verified-partial months and falls back to the newest complete month |
| P1-02 brief scope | FIXED | brief uses the same full data + `method` + filters as calendar; no 100k cap |
| P1-03 export cap | FIXED | default export limit 2,000,000; raw uses the streaming path |
| P1-04 map slice | FIXED | map period selector filters cells by month; up to 3,000 markers |
| P1-05 AOI presets | DISCLOSED | raw is a 3-AOI case study; sample/upload supports arbitrary bbox. No fake “fetch anywhere” claim |
| P1-06 anomaly leakage | FIXED | leave-one-year-out median/MAD; `anomaly_n_years` reported |
| P1-07 detection-day filtering | FIXED | partial status comes from coverage, never detection days |
| P1-08 dedup collisions | MEASURED | `/dedup-sensitivity` reports exact vs pixel-day collapse; served policy remains exact and is documented |
| P1-09 low confidence | FIXED | `qa_min=all|nominal|high`, `filtered_low_confidence`, `/qa-summary` retained fractions |
| P1-10 cell area | DISCLOSED | `cell_area_method` says cos-lat approximation, not equal-area |
| P1-11 heavy GET | FIXED | `/backtest` reads the frozen manifest; no public ensemble training |
| P1-12 X-Ray RAM | FIXED | raw X-Ray streams rows and uses `monthly`, not 600k cells |
| P1-13 admin default | FIXED | `APP_ENV=production` without `ADMIN_TOKEN` returns 503 |
| P1-14 ingest size | FIXED | chunked read with early 50 MB abort |
| P1-15 CSV parser | FIXED | RFC4180 parser (`frontend/src/lib/csv.ts`) replaces `split(",")` |
| P1-16 method page stale | FIXED | shows unified eval, gate verdict, seed range, data-quality card |
| P1-17 README stale | FIXED | rewritten to actual method IDs, API, tests, data |
| P1-18 spatial protocol | FIXED | `train_spatial` / `train_leave_one_out` with no AOI embedding; losses published |
| P1-19 TS context months | FIXED | `months_scored`, `months_missing_context`, per-month effective method |
| P1-20 cache safety | FIXED | JSON cache (no pickle), key includes data/model versions |
| P1-21 request ledger | FIXED | `request_ledger.jsonl` + manifest backfill; `/coverage` |
| P1-22 torch in serve | FIXED | `requirements-torch.txt`; `/health.methods_available` |
| P1-23 SPA assets | FIXED | static files served with correct MIME before SPA fallback |
| P1-24 URL context | FIXED | calendar and ask pages initialise from query params; calendar syncs URL |

## Data coverage after repair

| AOI | raw rows | months | months ≥90% days | day-31 gap | class |
|---|---|---|---:|---:|---|
| vietnam | 1,526,793 | 85 | 84 | none | full-month |
| amazon | 4,653,546 | 85 | 84 | none | full-month |
| australia | 1,700,959 | 85 | 1 | 48 | sparse 5-day |

The only partial vn/amz month is the 2026-11 NRT snapshot. Australia's full
backfill is deliberately incomplete (large VIIRS responses); resume with
`fetch_missing --aoi australia`.

## Unified evaluation (train ≤2024 → test 2025, n=36)

| Method | pooled MAE | vietnam | amazon | australia |
|---|---:|---:|---:|---:|
| B0 raw MODIS | 10447.9 | 9048.4 | 9843.0 | 12452.3 |
| B1 global ratio | 2054.6 | 2296.6 | 2201.0 | **1666.3** |
| B2 seasonal ratio | 1386.6 | 1190.9 | **1246.0** | 1722.7 |
| HGB `ml_b2res_v4` | **1350.8** | **1139.9** | 1246.0 | 1666.3 |
| TS `ts_logratio_pool_v2` | 1736.3 | 1563.3 | 1903.1 | 1742.5 |

Full-month pool (vietnam + amazon, n=24): HGB 1193.0, B2 1218.5,
TS 1733.2, B1 2248.8, B0 9445.7.

The HGB gate is ON for vietnam (2/3 folds, 8.2% CV gain vs the best baseline)
and OFF for amazon/australia. The Transformer beats B1 pooled but loses to B2
everywhere; its unified seed range is 1678–1848.

## Reproduce the audit evidence

```bash
cd backend
../.venv/bin/python -m scripts.firms.evaluate --data raw --verify
../.venv/bin/python -m scripts.firms.make_benchmark --check
../.venv/bin/python -m scripts.firms.evaluate --data sample --verify
../.venv/bin/python -m pytest tests/test_firms.py -q        # 59 tests
python scripts/check_data.py
```

## Remaining limits (not hidden)

- Australia is still a 5-day-window series, not full-month.
- Raw history is 2019–2025 + 2026-11 NRT; 2012–2018 is not fetched yet.
  `fetch_missing --start-year 2012 --end-year 2018` is the next data step.
- Dedup uses rounded coordinates + time + satellite because FIRMS CSV has no
  granule/pixel ID; `/dedup-sensitivity` bounds the effect.
- Low-confidence rows are kept by default; `qa_min` and `/qa-summary` expose
  the sensitivity instead of silently dropping them.
- Cell area is a cos-latitude approximation; hotspot detections are not
  confirmed fires, and the outlook is climatology, not a forecast.
