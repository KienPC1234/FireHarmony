# FIRMS dataset card — harmonized MODIS + VIIRS hot spots

- **Sources:** NASA FIRMS active-fire CSV: `MODIS_NRT` (C6.1, Terra/Aqua, 1 km, 2000–),
  `VIIRS_SNPP_NRT` / `VIIRS_NOAA20_NRT` / `VIIRS_NOAA21_NRT` (375 m, 2012–).
  Get a free `MAP_KEY` at <https://firms.modaps.eosdis.nasa.gov/api/area/>.
- **Real-data hardened schema:** accepts VIIRS `bright_ti4/ti5` aliases, non-zero-padded `acq_time` (`830`),
  MODIS C6 percent-scale `confidence` (mapped ≥80→h, ≥40→n, else l; raw kept in `confidence_pct`), missing `type` column.
- **Raw mode:** fetched/ingested CSVs in `backend/data/firms/raw/` are merged per-AOI and served with `?data=raw`
  (calendar/export/ask/harmonize); `?data=sample` (default) keeps the stable demo.
- **Standard schema:** `backend/app/firms/schema.py` — one Pydantic model for both
  sensors; field names match FIRMS CSV headers (lowercased). QA flags:
  `keep` / `low_confidence` / `suspect_geometry` / `duplicate`. Rejected rows are
  reported per-row, never silently dropped.
- **Harmonization:** daily 0.05° grid → per-sensor count + FRP → per-month
  efficiency ratio k = median(MODIS/VIIRS) on overlap cell-days (fallback 0.35) →
  forward fill to VIIRS-equivalent: VIIRS kept where it flew, MODIS-era cells upscaled by 1/k + optional MLP residual (`CrossSensorCalibrator`).
- **Sample (offline):** `backend/data/firms/samples/firms_sample_{vietnam,amazon,australia}.csv` — 3 files, ~55k rows total: `firms_sample_vietnam.csv` (~20.7k, bbox 104–109°E/10–16°N), `firms_sample_amazon.csv` (~17.8k), `firms_sample_australia.csv` (~17.0k).
  All cover MODIS 2001–2025 + VIIRS 2012–2025, event-clustered (shared cell-days),
  dry-season peak Dec–Apr + planted 2019-02/03 anomaly. Regenerate:
  `python backend/scripts/firms/make_sample.py`.
- **Real fetch:** `make fetch AOI_BBOX=104,10,109,16 DAYS=7 SOURCES=VIIRS_SNPP_NRT,MODIS_NRT AOI=vietnam`
  (needs `FIRMS_MAP_KEY`; days 1..5; retry + sha + QA + manifest). Output: `backend/data/firms/raw/*.csv` (gitignored).
- **Server ingest:** `POST /api/firms/ingest?aoi=amazon` with a FIRMS CSV file → chunk-validated, stored, QA report.
  `GET /api/firms/data-status` shows samples + raw files + cache stats.
- **Known limits:** 0.05° grid hides sub-village detail; months with <5 overlap
  days use the 0.35 fallback; overpass-time and cloud/smoke obscuration biases are
  reduced, not removed. Always read the Method page before citing a number.
