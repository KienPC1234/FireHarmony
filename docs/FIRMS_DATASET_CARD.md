# FIRMS dataset card — harmonized MODIS + VIIRS hot spots

- **Sources:** NASA FIRMS active-fire CSV: `MODIS_NRT` (C6.1, Terra/Aqua, 1 km, 2000–),
  `VIIRS_SNPP_NRT` / `VIIRS_NOAA20_NRT` / `VIIRS_NOAA21_NRT` (375 m, 2012–),
  plus science-quality archive `MODIS_SP` / `VIIRS_SNPP_SP` for fire-season windows.
  Free `MAP_KEY` at <https://firms.modaps.eosdis.nasa.gov/api/area/> (key lives only in
  gitignored `backend/.env`, never committed).
- **Real-data hardened schema:** accepts VIIRS `bright_ti4/ti5` aliases, non-zero-padded `acq_time` (`830`),
  MODIS C6 percent-scale `confidence` (mapped ≥80→h, ≥40→n, else l; raw kept in `confidence_pct`),
  missing `type` column tolerated (stays `None`, never forced to 0). Unknown instruments,
  impossible HHMM and out-of-range confidence are **rejected**; `frp`/`daynight` may be `None`
  (never zero-filled); platform-vs-date checked (`Aqua` from 2002-07-04, `NOAA-20` from 2018-04).
- **Real pulls (2026-11-09, MAP_KEY, 22 manifest entries, 319,004 clean / 74 rejected*):**
  - NRT 5-day Nov 2026, all 3 AOIs × MODIS + VIIRS SNPP/NOAA-20/NOAA-21:
    vietnam 715, amazon 33,980, australia 114,334 rows — **0 rejected** under the strict schema.
  - SP archive fire seasons: vietnam 2019-02 (11,399), amazon 2019-08 (51,390),
    australia 2019-12 (74,786) + 2020-01 (32,474) — **0 rejected**.
  - `*` the 74 rejects are one stale 2026-11-09 MODIS_NRT entry logged under the old
    lenient schema; the same file parses 79/79 today.
  - VIIRS SNPP NRT currently returns header-only (empty) for all AOIs; NOAA-20/21 carry the NRT load.
- **Raw mode:** `backend/data/firms/raw/` merged per-AOI with cross-file dedup
  (instrument/satellite/date/time/rounded-lat-lon/version) and **round-robin interleave**,
  so any `limit` prefix stays representative across sources/dates (P1-12).
  Served with `?data=raw` (calendar/export/ask/xray/harmonize) and labeled
  `NASA FIRMS observed`; `?data=sample` (default) keeps the stable demo.
  Real coverage is sparse (a few 5-day snapshots: 2019-02, 2019-08, 2019-12, 2020-01, 2026-11),
  so training/backtest correctly refuse on `data=raw` (`422 small_data`) instead of inventing —
  artifacts stay trained on the dense synthetic sample (documented in the model card).
- **Raw spot-check (X-Ray, real months):** vietnam (2019-02, 2026-11), amazon (2019-08, 2026-11),
  australia (2019-12, 2020-01, 2026-11) — the 2019 fire-season months appear in genuine
  NASA data, not just the planted synthetic spikes.
- **Sample (offline):** `backend/data/firms/samples/firms_sample_{vietnam,amazon,australia}.csv` —
  55,467 rows total (vietnam 20,425, amazon 17,558, australia 17,484), MODIS 2001–2025 +
  VIIRS 2012–2025, event-clustered, dry-season peaks + planted 2019 anomalies (pipeline test only).
  Regenerate: `python -m scripts.firms.make_sample all`. CI guard: `python scripts/check_data.py`.
- **Real fetch:** `make fetch AOI_BBOX=... DAYS=5 SOURCES=... AOI=...` (days 1..5, retry + sha + QA + manifest).
  Output: `backend/data/firms/raw/*.csv` (gitignored, excluded from the source zip).
- **Server ingest:** `POST /api/firms/ingest?aoi=amazon` with a FIRMS CSV file → validated **before**
  commit to disk, stored, QA report. `GET /api/firms/data-status` shows samples + raw files + cache stats.
- **Known limits:** 0.05° grid hides sub-village detail; overpass-time and cloud/smoke biases reduced,
  not removed; hotspot detections ≠ confirmed fires; climatology outlook ≠ forecast.
  Always read the Method page before citing a number.
