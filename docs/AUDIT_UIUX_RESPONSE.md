# Audit UI/UX + data-truth response (2026-11-12)

Scope: the P0 list in the UI/UX audit, plus the P1 items that affect truth,
navigation, accessibility and tests. Model work is unchanged: STAN remains the
served main model on raw, with HTS fallback before 2024.

## P0 — closed

| ID | Fix | Evidence |
|---|---|---|
| **P0-01** KPI used a non-existent `count` key and the capped `daily` slice | `/api/firms/calendar` returns a server-side `summary` (`modis_detections`, `viirs_detections`, `sensor_detections_total`, `paired_cells`, `estimated_index`, `n_daily_cells_total/returned`, `period`, `source_scope`, `filter_hash`, `effective_method`). The KPI and header read only `summary`. | `test_UX05_summary_is_invariant_to_limit` (10/100/5000) |
| **P0-02** convex hull labelled fire perimeter / burned area / severity | `clusterZones.ts` now returns `HotspotCluster` with no `areaKm2` and no severity. UI says “Observed hotspot cluster”, dashed low-opacity hull, and an explicit “not a fire perimeter, burned area, or risk grade” caveat in both tooltips and the legend. | grep for `areaKm2`/`FireZone` returns nothing; map code review |
| **P0-03** drawn polygon only sent its bbox | `geometry` (GeoJSON Polygon/MultiPolygon, holes supported) is accepted by `/calendar`, `/export`, `/map-cells` and `/export-detections`; a backend point-in-polygon pass runs after the bbox prefilter. `geometry_hash` is in the cache key, response, CSV headers and URL. Model methods are rejected with `409 geometry_requires_stat_method` because AOI-level targets cannot be reallocated to an arbitrary polygon. | `test_UX04_polygon_filters_beyond_bbox`, `test_UX04_map_cells_respect_polygon`, `test_P0_03_geometry_is_stat_only_for_models` |
| **P0-04** raw silently replaced by synthetic on any error | The calendar keeps `data=raw`, shows an “NASA raw data unavailable” panel with HTTP status, `error_code`, message and a retry button. Switching to the synthetic demo is an explicit button and also sets `method=stat` so a stale STAN request cannot 409. | Playwright `raw 404 is explained and never silently switches to synthetic` |
| **P0-05** no unified date range | `from_date`/`to_date` are validated (`YYYY-MM-DD`, inclusive, `from <= to`) and applied before aggregation; presets are Full history / 1 month / 12 months / Custom, stored as `from`/`to` in the URL and used by calendar, map cells and both CSV exports. Calibration ratios still use the full record set. | `test_UX09_date_range_is_inclusive_and_month_safe`, `test_UX06_export_respects_the_same_filter_and_date_range` |
| **P0-06** matrix full history, map a capped slice, no label | `GET /api/firms/map-cells?ym=` aggregates one month independently from the calendar cap and returns `returned`, `total`, `preview`, `aggregation_level`, `filter_hash`. The map legend says “Preview N of M cells (cell-month)” and the “all months” map path is labelled as a preview too. | `test_UX03_map_cells_has_explicit_scope_metadata` |
| **P0-07** clean ZIP had no raw | `backend/data/firms/demo_pack/` carries a verified 24-month Vietnam subset (2024-01..2025-12, 362 CSVs, 459,832 rows). `make demo-verify` re-hashes it; `make demo-install` copies it into `data/firms/raw`, after which `/calendar?data=raw&method=stan` serves real data end to end. The pack manifest states that **request coverage is not inferred from it**. | `make demo-verify`; clean-ZIP run |
| **P0-08** “Vietnam” preset overstated the AOI | Presets now say “Central/Southern Vietnam sample region (104–109E, 10–16N)”, “Southern Amazon sample region (70–50W, 12S–3N)”, “Southeast Australia sample region (113–153E, 39–12S)”. Home KPI badges no longer claim 2000–2025 or zero hallucination. | locales `aoi.*`, `home.kpi_*` |

## P1 — fixed in this pass

- **P1-01** nav links carry `location.search`, so AOI/data/range survive navigation.
- **P1-02** Explore/Research is no longer decorative: Research mode shows a provenance strip (method id, effective method, source scope, estimated index, filter hash, period, geometry hash).
- **P1-03** mobile mode buttons call `setMode()`; no direct `history.replaceState`.
- **P1-04** Home reads the sample period from `/calendar` summary and raw readiness from `/data-status`; “ZERO HALLUCINATION” is gone.
- **P1-05** `SeasonComparisonCard` uses `calendar.eligible_mask`; null months stay null in totals, peaks and the chart (`connectNulls={false}`), never 0.
- **P1-07** matrix cells are real `<button>`s with `aria-label`, keyboard activation and Escape to close the inspector.
- **P1-09** added `GET /api/firms/export-detections` (original per-detection rows) alongside the harmonized cell-day CSV.
- **P1-10** request ledger is labelled `coverage_kind=request_ledger_not_observation`, `observation_coverage=unknown`; blind-spot status renamed `requested_no_hotspot_record` with `clear_sky_verified=false`.
- **P1-11** Playwright now clicks the matrix tab, asserts 14 header cells (year + 12 months + total), activates a month by keyboard and checks the inspector.
- **P1-12** month detail shows the response’s `effective_method`, not a hardcoded model name.
- **P1-13** `data-status` exposes `dataset_ready` next to `model_artifact_ready`; the Evidence page warns when a request ledger exists but `dataset_ready=false`.
- **P1-15** default basemap is Dark Canvas; satellite is opt-in.

## Still open (honest)

- **P1-06 / P1-16**: typography and task-first IA were not redesigned; this pass fixed truth and blocking interactions only.
- **P1-08**: cold raw is still a few minutes without a warm cache; the offline Parquet/DuckDB ETL is not in this release.
- **P1-14**: `admin_gated=false` on local dev is expected; public deployment still requires `APP_ENV=production` + `ADMIN_TOKEN` (the API already fails closed without one).
- **Observation coverage** (cloud/footprint) remains unverified; no burned-area product is bundled.

## Verification snapshot

- `make check-fast`: **97 passed, 6 skipped**
- New contracts: UX01, UX03, UX04, UX05, UX06, UX07, UX09, UX14, P0-03, P1-09
- Frontend `tsc --noEmit`, `eslint --max-warnings=0`, `vite build`: pass
- Playwright (desktop + mobile): **11 passed / 1 skipped**
