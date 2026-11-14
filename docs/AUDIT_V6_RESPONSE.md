# Audit V6 response — FireHarmony

Source: `FireHarmony-source.zip` rebuilt 2026-11-11 after this response.
Scope: P0 items that can be fixed in code/data, plus the P1 items that affect
scientific claims. Items we did not fix are listed as **OPEN** rather than
argued away.

## P0

| ID | Status | Fix | Evidence |
|---|---|---|---|
| P0-01 anomaly contaminated by partial months | **FIXED** | `build_calendar` now builds one `eligible` mask (verified coverage, `partial is not True`, paired ratio ≥ 0.9). Median/MAD, leave-one-year-out and column climatology use only eligible months. Ineligible/insufficient cells get `anomaly=null` plus `anomaly_reason` (`ineligible_coverage`, `insufficient_comparable_history`). No fallback to a baseline that includes the current year. | `test_partial_months_never_enter_anomaly_baseline` (4 full years at 100 + 4 partial at 1 → 2022 z=0); `test_calendar_matrix_and_anomaly`; `anomaly_eligibility.excluded_months` in every response |
| P0-02 zero-width uncertainty without calibration | **FIXED** | `estimate_efficiency_ratio` records `_calibration_status`, `_calibration_min_months`, clipped months/fraction. `fuse_cell_day` emits `harmonized_count_low/high` **only** when ≥3 co-observed months and a positive monthly IQR exist; otherwise both are `null` and `uncertainty_status="not_calibrated"`. The fallback k=0.35 remains a labeled assumption, not an interval. | `test_no_overlap_never_emits_zero_width_uncertainty` (one MODIS row → low/high null, status `not_calibrated`); calendar shows a **Not calibrated** badge |
| P0-03 TS metadata without weights | **FIXED** | All six 400 KB state dicts (`ts_*.pt`) ship in the ZIP and are pinned by `backend/data/firms/models/TS_WEIGHTS.sha256`; each JSON records `weights_file` + `weights_sha256`. `/api/health` derives `methods_available` from torch **and** artifact files (`methods_detail.ts_reason` distinguishes `weights_missing` vs `torch_missing`), not import alone. | `check_release` artifact-health gate; TS status/calendar/backtest/replay tests pass from a clean extraction |
| P0-04 no raw→metric reproducibility in the ZIP | **PARTIAL → FIXED for a subset** | Added `backend/data/firms/raw_subset/vietnam_2025-01/`: 16 unmodified NASA FIRMS CSVs (4.3 MB) with SHA-256 checksums and `expected.json`. `python -m scripts.firms.rebuild_subset` verifies checksums then reruns validate → dedup → aggregate → ratio → harmonize → calendar; expected 49,638 clean rows, 20,306 cell-days, total 54,563.23. Now part of `check_release`. The full 3.4M-row pull remains downloadable, not bundled. | `SUBSET REBUILD OK`; total equals the full-run calendar month exactly |
| P0-05 multi-platform mix changes the series | **PARTIAL / DISCLOSED** | Served raw pulls currently contain only MODIS + SNPP (no NOAA-20/21 rows), so default and `snpp` are identical for this data. `/simulate` now returns `platforms_present`; the Lab warns that identical NOAA configs mean “platform absent from this pull”, not “no contribution”. Platform mix per year remains in `/calendar.platform_mix` and `/platform-series`. | `platforms_present=['Aqua','NPP','Terra']`; simulator note; model card |
| P0-06 request ledger overclaimed as observation | **PARTIAL → LABELS FIXED** | Coverage response now states `coverage_metric="paired_request_coverage"` and `observation_footprint="unknown"`; definition says request success is not cloud-free overpass. Blind-spot status `observed_empty` is displayed as “Requested, no detection”, with a note that it is not proof of clear sky or no fire. UI no longer says “Observed empty”. | `/api/firms/coverage`, `/api/firms/blind-spots`, `BlindSpotsTab`, `evidence.tsx` |
| P0-07 LLM guard only checked ≥1000 | **FIXED (numeric layer)** | Guard now checks every numeric token, including 75/65. Decimals must match at 4 dp; integer claims must match a fact; only years 1990–2100, ordinals 0–31, and percent renderings of a fractional fact are allowed without an exact match. | `test_T32_llm_guard_catches_wrong_small_numbers_and_percentages`; `T23` still passes |
| P0-08 release gate not green in the ZIP | **FIXED** | Weights are packaged, `check_release` starts with artifact health and includes the raw-subset rebuild, and the ZIP is built from the tested commit. The environment here is Python 3.11 / sklearn 1.9.1 / torch 2.14. | `check_release` sequence below; clean extraction re-verified |

### Release commands (from the ZIP root)

```bash
cd backend
python -m scripts.firms.check_release        # pytest + subset + benchmark + eval + docs + env + artifacts
python -m scripts.firms.rebuild_subset       # raw subset, checksum-pinned
```

## P1 fixed in this pass

- **P1-01** Evidence eligibility now reads `eligibility_threshold` from the API
  (0.90) instead of hardcoding 0.80.
- **P1-02** Wording separates persisted benchmark from live raw: Methods says
  “persisted evaluation artifact”; Calendar marks `SYNTHETIC DEMO` vs `NASA
  Observed`; raw endpoints still return an explicit 404 when raw is absent.
- **P1-03** Removed the made-up 2019 burned-area series. The Lab input starts
  empty with an explicit placeholder; no result appears until the user pastes
  their own data.
- **P1-05** Spatial-transfer verdicts corrected: vietnam beats B1 and raw
  MODIS; australia loses to B1 but beats raw MODIS; amazon beats B1 only.
- **P1-11** Health reports `methods_detail` with artifact presence/reason.
- **P1-13** Dedup by 64-bit hash remains; the collision risk is documented
  (not silently called “exact”).
- **P1-15** Blind-spot labels no longer imply observed clear sky.

## SensorFormer Lite (follow-up experiment)

The audit's P0-05 concern led to a deliberately small hybrid rather than a
larger Transformer: `sf_lite_v1` (temporal CNN + one attention layer + sensor/
context gate + quantile heads) was trained on MODIS-only windows and scored on
the same 72 holdout IDs. It **lost to B2** (pooled 2,452 vs 2,387 MAE; gate
OFF, not served). Ablations show the gate helps vs no-gate (2,513) while
attention does not (no-attn 2,447). Empirical 80% interval coverage is 80.6%.
Full evidence: `docs/SENSORFORMER.md`.

## Still OPEN (not presented as solved)

- **P0-05** A true all-platform vs SNPP-only event study is only meaningful
  when NOAA-20/21 rows are pulled; the current 2019–2025 raw pull has none.
  The UI now says so instead of showing identical totals as a result.
- **P0-06** Per-cell cloud/overpass footprints are not available from the FIRMS
  CSV feed; the API labels the footprint `unknown`.
- **P1-04** The 3–4× sensitivity statement is qualitative; it is not a fixed
  ratio for every AOI/month and is not used as a metric.
- **P1-06** k clipping is reported (`_clipped_fraction`) but no threshold
  sensitivity study is shipped.
- **P1-08** Bootstrap resamples AOI-month rows; it is not a year-block
  bootstrap. The model card says so.
- **P1-10** Admin mutation endpoints remain open in local mode by design; set
  `APP_ENV=production` + `ADMIN_TOKEN` for deployment.
- **P1-14** First raw stat call is still ~152 s on 3.41M rows; the client
  budget is 240 s and cached calls are 0.26 s.

## Verification snapshot

- Backend: 69 tests, including the new P0-01/P0-02/P0-07 regressions.
- `make_benchmark --check`, `evaluate --data raw|sample --verify`,
  `render_docs --check`, `check_env`, `rebuild_subset`: OK.
- Frontend: typecheck/lint/build, Playwright 4/4.
- Raw stat calendar: 151.8 s cold / 0.264 s warm, ~1.1 GB RSS.
- Raw subset: 16 files, 49,638 clean rows, 20,306 cell-days, 54,563.23 total.
