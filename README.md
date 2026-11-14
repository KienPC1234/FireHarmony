# FIRMS Fire Calendar

> **NASA Space Apps 2026 — Harmonization of MODIS and VIIRS Hot Spots.**
> One burning-activity calendar where the sensor of origin no longer matters.

MODIS (Terra/Aqua, 1 km, since 2000) and VIIRS (Suomi-NPP/NOAA-20/21, 375 m,
since 2012) do not see the same fires: VIIRS detects roughly 3–5× more hotspots.
Adding the two raw counts fakes a step change in 2012. This project builds a
single **hotspot-detection activity index** on a daily 0.05° grid:

1. strict schema + QA (unknown instruments, impossible HHMM, platform/date
   anachronisms rejected — never silently repaired);
2. dedup across overlapping raw pulls;
3. per-month empirical ratio `k = MODIS / VIIRS` from AOI totals (fusion) or
   from **train months only** (predictive evaluation);
4. VIIRS is authoritative where it recorded a detection; MODIS-only cells are
   upscaled by `1/k` and labelled **estimated**, with an uncertainty interval;
5. month × year calendar, leave-one-year-out robust z anomalies, CSV/brief
   export, and an offline explainer.

Units are **hotspot detections / sensor-adjusted activity index**, never
confirmed fires. VIIRS is a sensor reference, not fire ground truth.

## Quick start

```bash
make install
make sample          # deterministic synthetic sample (offline demo)
make test-backend    # 53 tests, no network needed
make dev             # API :8000 + Vite :5173
make demo            # build frontend and serve API+SPA on :8000
```

Real NASA data (free FIRMS MAP_KEY):

```bash
export FIRMS_MAP_KEY=<key>   # https://firms.modaps.eosdis.nasa.gov/api/area/
cd backend
../.venv/bin/python -m scripts.firms.fetch_full_month \
  --aoi vietnam --bbox 104,10,109,16 --start-year 2019 --end-year 2025 --workers 4
```

`fetch_full_month` stitches 5-day windows covering **every** day of each month
(including the 31st and leap Februaries) and writes a request ledger.

## Models (all numbers are from the committed artifacts)

| Method | What it is | Unified eval, pooled 2025 (n=36) |
|---|---|---|
| `b0_raw_modis` | raw MODIS count | 10262.5 MAE |
| `b1_global_ratio` | one global median ratio | 2037.7 |
| `b2_seasonal_ratio` | per-month median ratio | 1282.6 |
| `ml_b2res_v4` | HGB residual **on top of B2**, with a blocked-CV abstain gate | **1263.0** |
| `ts_logratio_pool_v2` | pooled 3-AOI Transformer, log-ratio target, 5 seeds | 1798.0 |

Per AOI, best method: vietnam `b2` 867.6 · amazon `b2` 1255.1 ·
australia `b1` 1666.3. **No model wins every region.** The pooled winner is
the gated HGB, but only because it serves B1 for australia and B2 elsewhere —
the learned residual itself abstains on all three AOIs
(`residual_enabled=false`). The Transformer beats B1 pooled but loses to B2 on
every AOI and on the full-month pool (1781.8 vs 1061.4). See
`docs/FIRMS_MODEL_CARD.md` for the full table, seed spread, and the
leave-one-region-out transfer test.

Evaluation protocol: one frozen `evaluation_manifest.json` gives every method
the **same AOI-month sample IDs**; only months where the Transformer has a
12-month context enter the comparison. Cache identity includes data
fingerprint + algorithm version. `GET /api/firms/backtest` reads that manifest
and never trains on a public request.

## API (selected)

| Endpoint | What |
|---|---|
| `GET /api/health` | status, torch, available methods |
| `GET /api/firms/data-status` | raw readiness, months, coverage, fingerprints |
| `GET /api/firms/coverage` | request ledger: requested days, failures, missing days |
| `GET /api/firms/platform-series` | platform mix + SNPP-only comparable series |
| `GET /api/firms/calendar?data=raw&method=stat` | calendar (404 `no_raw_data` if absent) |
| `GET /api/firms/export` | full CSV (no silent row cap) |
| `GET /api/firms/brief` | one-page Markdown brief for the same method/data |
| `GET /api/firms/backtest` | frozen unified evaluation (503 until built) |
| `GET /api/firms/xray` | MODIS vs VIIRS vs adjusted, same split |
| `GET /api/firms/data-status` | samples + raw + cache |
| `POST /api/firms/ml-train`, `/ts-train` | admin/offline training |

## Reproduce

```bash
cd backend
../.venv/bin/python -m scripts.firms.fetch_full_month --aoi vietnam --bbox 104,10,109,16 --start-year 2019 --end-year 2025 --workers 4
../.venv/bin/python -m scripts.firms.train_ml --aoi vietnam --data raw --test-years 2
../.venv/bin/python -m scripts.firms.train_ts --aoi vietnam --data raw --test-years 2
../.venv/bin/python -m scripts.firms.evaluate --data raw --test-years 2
../.venv/bin/python -m scripts.firms.evaluate --data raw --verify
../.venv/bin/python -m scripts.firms.make_benchmark --check
../.venv/bin/python -m pytest tests/test_firms.py -q
```

The committed `backend/data/firms/benchmark/evaluation_samples_*.csv` files are
the exact evaluation sample IDs; `make_benchmark --check` recomputes every
published MAE/WAPE/bias to 1e-6 without needing the 650 MB raw pulls.

## Docs

- `docs/FIRMS_DATASET_CARD.md` — sources, coverage, request ledger, known defects
- `docs/FIRMS_MODEL_CARD.md` — architectures, unified table, losses, limits
- `docs/DEMO.md` — 3-minute demo script using the real numbers
- `AGENTS.md` / `CONTRIBUTING.md` — repository conventions
