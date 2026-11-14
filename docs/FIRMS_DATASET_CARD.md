# FIRMS dataset card — harmonized MODIS + VIIRS hot spots

- **Sources:** NASA FIRMS active-fire CSV: `MODIS_NRT` (C6.1, Terra/Aqua,
  1 km, 2000–), `VIIRS_SNPP_NRT` / `VIIRS_NOAA20_NRT` / `VIIRS_NOAA21_NRT`
  (375 m, 2012–), plus the science-quality archive `MODIS_SP` /
  `VIIRS_SNPP_SP`. Free `MAP_KEY` at
  <https://firms.modaps.eosdis.nasa.gov/api/area/> (key lives only in the
  gitignored `backend/.env`, never committed).
- **Strict schema:** accepts VIIRS `bright_ti4/ti5` aliases, non-zero-padded
  `acq_time` (`830`), MODIS C6 percent-scale `confidence` (≥80→h, ≥40→n, else
  l; raw value kept in `confidence_pct`), missing `type` tolerated (stays
  `None`). Unknown instruments, impossible HHMM and out-of-range confidence
  are **rejected**; `frp`/`daynight` may be `None` (never zero-filled);
  platform-vs-date checked (Aqua 2002-07-04+, NOAA-20 2018-04+).

## Full-month coverage and the day-31 defect

The Area API caps a request at 5 days. `fetch_full_month.py` derives windows
from `calendar.monthrange`, so days 1,6,11,16,21,26 **plus 31 when it exists**
(and the 29th in leap February) are requested exactly once. It also appends
every outcome to `backend/data/firms/request_ledger.jsonl`
(`success_rows` / `success_empty` / `failed`).

The first backfill used the old fixed starts, so it never requested day 31:

| AOI | raw rows | manifest months | months ≥90% **paired** days | missing day 31 | coverage class |
|---|---|---|---|---|---|
| vietnam | 3,411,143 | 169 (2012-01 … 2026-11) | 168 | 0 | full-month |
| amazon | 4,653,546 | 85 | 84 | 0 | full-month |
| australia | 1,700,959 | 85 | 0 | 48 | **5-day window only** |

`GET /api/firms/coverage?aoi=…&data=raw` returns the per-month
`paired_days`, `coverage_by_sensor`, `coverage_ratio`, `missing_days`, per-source counts and the
request ledger. A month is only `partial=true` when <90% of its days have **paired MODIS+VIIRS**
requests; union coverage is reported separately. **Detection days are a separate field**. Australia's every month
is partial because each has only one 5-day window; its numbers must not be
compared to full-month totals.

Re-fetch with a fresh key to close the day-31 gap:

```bash
cd backend
../.venv/bin/python -m scripts.firms.fetch_full_month --aoi vietnam \
  --bbox 104,10,109,16 --start-year 2019 --end-year 2025 --workers 4
../.venv/bin/python -m scripts.firms.fetch_full_month --aoi australia \
  --bbox 113,-39,153,-12 --start-year 2019 --end-year 2025 --workers 4
```

`download_and_verify.py` reconstructs the exact files and checks every
`sha16` against the filename and manifest without re-downloading.

`fetch_missing.py` is the repair path: it diffs the manifest against every
calendar day and fetches **only** the missing intervals (max 5 days/request).
A full backfill raised vietnam from 73 to **168/169 full months** (2012–2025)
and amazon to **84/85**, removing the day-31 gap; the remaining amazon month is
the partial 2026-11 NRT. Early 2013+ months are excluded from training/eval
until their paired coverage reaches 90%.
Australia remains sparse because its VIIRS responses are large and the run was
stopped deliberately; the same command resumes it.

```bash
cd backend
../.venv/bin/python -m scripts.firms.fetch_missing --aoi vietnam \
  --start-year 2019 --end-year 2025 --workers 2
../.venv/bin/python -m scripts.firms.fetch_missing --aoi australia \
  --start-year 2019 --end-year 2025 --workers 2
```

## Filters: confidence and platform balance

- `qa_min=all|nominal|high` — `nominal` drops low-confidence rows, `high` keeps
  only high-confidence rows. Low-confidence rows are never silently dropped by
  default; the calendar response reports `filtered_low_confidence`.
- `platform_set=all|snpp` — `snpp` keeps MODIS + SNPP VIIRS and drops
  NOAA-20/21, so a new overpass is not read as more fire. The response reports
  `filtered_platform`.
- `/api/firms/qa-summary` returns the confidence/platform mix over a bounded
  prefix and warns when a filter would materially change the answer.
- `qa_flag` per row: `keep | low_confidence | suspect_geometry |
  anachronistic_platform`; the latter two are rejected, low-confidence is kept
  by default and counted.

## Real pulls and provenance

- Each file is `{aoi}_{source}_{start}_{days}d_{sha16}.csv` in
  `backend/data/firms/raw/` (gitignored, ~820 MB, excluded from the source zip).
  A checksum-pinned 16-file slice (`backend/data/firms/raw_subset/vietnam_2025-01`,
  4.3 MB) is included so `python -m scripts.firms.rebuild_subset` can rerun the
  pixel→calendar path on real NASA rows without the full pull.
- `ingest_manifest.json` records source, bbox, requested interval, rows, clean
  and rejected counts. `request_ledger.jsonl` records failures too; previously
  failures were printed and lost.
- Raw mode is merged per AOI with dedup on
  (instrument, satellite, date, time, rounded lat/lon), SP before NRT, using a
  64-bit key set so 4.4M rows do not exhaust RAM. Full-data consumers stream
  (`iter_raw_rows` + `PairBuilder`); `load_raw_merged` returns a bounded,
  round-robin prefix.
- `?data=raw` is labelled `NASA FIRMS observed`. If no raw files exist the
  calendar returns **404 `no_raw_data`**, not an empty 200 calendar.
- The 2026-11 NRT month mixes SNPP + NOAA-20 + NOAA-21. `/api/firms/platform-series`
  returns the per-year platform mix and an SNPP-only comparable series, so a
  rise from a new overpass is not reported as more fire.

## Benchmark bundle (what judges can actually recompute)

`backend/data/firms/benchmark/` contains:

- `real_mini_{aoi}.csv` — 1,500 genuine FIRMS rows/AOI (parseable offline);
- `expected_pairs.csv` — full monthly MODIS/VIIRS totals;
- `evaluation_samples_{raw,sample}.csv` — the **exact** evaluation sample IDs
  and every method's prediction;
- `BENCHMARK.json` — sha256 for each file plus the published metrics.

`python -m scripts.firms.make_benchmark --check` recomputes pooled and
per-AOI MAE/WAPE/bias from `evaluation_samples_*.csv` and fails if any differs
from `BENCHMARK.json` by more than 1e-6. It does not need the raw ~820 MB.

## Sample (offline demo)

`backend/data/firms/samples/firms_sample_{vietnam,amazon,australia}.csv` —
55,467 rows total (vietnam 20,425, amazon 17,558, australia 17,484),
MODIS 2001–2025 + VIIRS 2012–2025, event-clustered, dry-season peaks and
planted 2019 anomalies (pipeline test only). Regenerate with
`python -m scripts.firms.make_sample all`; CI guard:
`python scripts/check_data.py`.

## Known limits

- 0.05° grid hides sub-village detail; overpass-time and cloud/smoke biases are
  reduced, not removed.
- Hotspot detections ≠ confirmed fires; upscaled MODIS-only cells are
  estimates with an uncertainty interval and null FRP.
- Dedup uses rounded coordinates + time + satellite; granule/pixel IDs are not
  in the FIRMS CSV, so two valid detections within ~11 m can collapse.
  `GET /api/firms/dedup-sensitivity` reports exact vs pixel-day collapse so the
  effect is measured, not hidden.
- Low-confidence MODIS rows are kept and flagged; an optional sensitivity
  filter is not yet exposed.
- Cell area is a cos-latitude approximation, not an equal-area grid.
- Climatology outlook is not a forecast; FIRMS NRT is the nowcast source.
