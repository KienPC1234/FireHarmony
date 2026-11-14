# FIRMS Fire Calendar

> **NASA Space Apps 2026 — Harmonization of MODIS and VIIRS Hot Spots.**
> One burning-activity calendar where the sensor of origin no longer matters.

MODIS (Terra/Aqua, 1 km, since 2000) and VIIRS (Suomi-NPP/NOAA-20/21, 375 m, since 2012)
see different fires: VIIRS detects ~3× more. This app standardizes both into one
Pydantic schema, aggregates to a daily 0.05° grid, calibrates VIIRS→MODIS-equivalent
(per-month efficiency ratio + quantile mapping + calibrated max-fill + optional MLP residual), and renders
month × year counts with robust median/MAD anomalies + CSV export.

## Quick start

```bash
make install
make sample        # deterministic sample CSV (offline demo)
make test-backend  # 6 tests, no network/GPU
make dev           # API :8000 + Vite :5173
```

Real data (free FIRMS MAP_KEY):
```bash
export FIRMS_MAP_KEY=<key>  # https://firms.modaps.eosdis.nasa.gov/api/area/
cd backend && ../.venv/bin/python -m scripts.firms.fetch_firms --source VIIRS_SNPP_NRT --bbox 104,10,109,16 --days 7
```

## API

| Endpoint | What |
|---|---|
| `GET /api/health` | status + torch flag |
| `GET /api/firms/schema` | standardized field list |
| `POST /api/firms/validate` | QA a FIRMS CSV (keep/low_confidence/suspect_geometry) |
| `POST /api/firms/harmonize` | grid + calibrate + calendar + critical periods |
| `GET /api/firms/calendar` | same, on the sample dataset |
| `GET /api/firms/export` | `harmonized_hotspots.csv` download |
| `GET /api/firms/dl-info` | deep-learning models + `has_torch` |
| `POST /api/firms/train-calibrator` | train MLP residual on overlap pairs |

## Deep learning (poster highlight ★)

- **CrossSensorCalibrator** — MLP residual 6→32→32→1 (~2.3k params, Huber loss),
  learns the VIIRS→MODIS correction from overlap days; CPU seconds.
- **FireSeasonAE** — Conv1d autoencoder over the 12-month season vector;
  reconstruction MAE flags unusual season *shapes*.
- Both degrade gracefully: no torch or thin data → statistical blend only.

## Docs

- `docs/FIRMS_DATASET_CARD.md` — sources, schema, sample, limits
- `docs/FIRMS_MODEL_CARD.md` — the two tiny models + fallbacks
- `docs/AGENT_CLAIMS.md` — who owns what (claim before editing)

Previous microgravity project source (if kept): `/data/AlphaCentauriAB_old/` — not part of this repo.
