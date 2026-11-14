# FIRMS dataset card — harmonized MODIS + VIIRS hot spots

- **Sources:** NASA FIRMS active-fire CSV: `MODIS_NRT` (C6.1, Terra/Aqua, 1 km, 2000–),
  `VIIRS_SNPP_NRT` / `VIIRS_NOAA20_NRT` / `VIIRS_NOAA21_NRT` (375 m, 2012–).
  Get a free `MAP_KEY` at <https://firms.modaps.eosdis.nasa.gov/api/area/>.
- **Standard schema:** `backend/app/firms/schema.py` — one Pydantic model for both
  sensors; field names match FIRMS CSV headers (lowercased). QA flags:
  `keep` / `low_confidence` / `suspect_geometry` / `duplicate`. Rejected rows are
  reported per-row, never silently dropped.
- **Harmonization:** daily 0.05° grid → per-sensor count + FRP → per-month
  efficiency ratio k = median(MODIS/VIIRS) on overlap cell-days (fallback 0.35) →
  forward fill to VIIRS-equivalent: VIIRS kept where it flew, MODIS-era cells upscaled by 1/k + optional MLP residual (`CrossSensorCalibrator`).
- **Sample (offline):** `backend/data/firms/samples/firms_sample.csv` — 20,263
  deterministic synthetic rows, Vietnam bbox 104–109°E / 10–16°N, MODIS 2001–2025 + VIIRS 2012–2025,
  dry-season peak Dec–Apr + planted 2019-02/03 anomaly. Regenerate:
  `python backend/scripts/firms/make_sample.py`.
- **Real fetch:** `python -m scripts.firms.fetch_firms --source VIIRS_SNPP_NRT --bbox 104,10,109,16 --days 7`
  (needs `FIRMS_MAP_KEY`). Output: `backend/data/firms/raw/*.csv` (gitignored).
- **Known limits:** 0.05° grid hides sub-village detail; months with <5 overlap
  days use the 0.35 fallback; overpass-time and cloud/smoke obscuration biases are
  reduced, not removed. Always read the Method page before citing a number.
