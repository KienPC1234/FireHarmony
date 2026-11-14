# FireHarmony

**Satellite fire intelligence lab for harmonizing NASA FIRMS MODIS and VIIRS hotspot detections.**  
*NASA Space Apps 2026 — Harmonization of MODIS and VIIRS Hot Spots*

MODIS (Terra/Aqua, 1 km, since 2000) and VIIRS (Suomi-NPP/NOAA-20/21, 375 m, since 2012) have different detection sensitivity: VIIRS detects roughly 3–5× more hotspots, especially small agricultural burns. Naively summing raw counts creates an artificial ~4× jump in 2012. FireHarmony builds a single **hotspot-detection activity index** on a daily `0.05°` grid so MODIS-era and VIIRS-era records can be compared on a common, uncertainty-aware scale.

> **Units:** hotspot detections / sensor-adjusted activity index — **not** burned area, fire intensity, or emissions. The 2012 VIIRS-era break, QA/coverage gaps, and present-time data lags are surfaced in the product.

## Highlights

- **Strict ingest & QA** — rejects unknown instruments, invalid `HHMM`, and platform/date anachronisms (never silently repaired); deduplicates overlapping raw pulls.
- **Empirical harmonization** — monthly calibration `k = MODIS / VIIRS` (AOI totals for fusion, training months only for predictive evaluation). VIIRS stays authoritative where observed; MODIS-only cells are upscaled by `1/k`, labelled **estimated** with an uncertainty interval.
- **Calendar & analysis** — month × year matrix, leave-one-year-out robust MAD z-scores, CSV/brief exports, sensor lab, evidence x-ray, and a grounded AI investigator.
- **Served models (only):** `stan_safe_v1` (primary, recommended), `b2_seasonal_ratio` (baseline), `hts_anchor_v1` (fallback).

![STAN architecture (slide)](docs/stan_architecture_slide.svg)

*STAN overview (compact): MODIS 12-month window → Encode + FiLM → 3× causal TCN → target attention → concat + head → residual correction on the HTS anchor (NB2). Full diagram and details below.*

## Quick start

**Prerequisites:** Python 3.11 (`.python-version`), Node.js. For real data, a [NASA FIRMS map key](https://firms.modaps.eosdis.nasa.gov/api/area/). Use `make` or `.venv/bin/python` (the system `python3` may not include project deps).

```bash
# 1) Install
python3.11 -m venv .venv
make install-dev        # serving + tests + dataframes, no torch (fast)

# 2) Configure (real data)
cp backend/.env.example backend/.env
# set FIRMS_MAP_KEY=<your key> in backend/.env

# 3) Run in development
make dev                # API http://127.0.0.1:8000 + Vite http://127.0.0.1:5173
```

**Production-style (built SPA served by FastAPI):**

```bash
cd frontend && npm ci && npm run build && cd ..
pm2 start ecosystem.config.cjs   # http://127.0.0.1:8000
```

**Offline / demo data:** `make sample` generates a deterministic sample. A checksum-pinned 24-month Vietnam demo pack is included under `backend/data/firms/demo_pack/` (`make demo-verify` / `make demo-install`) for a real-data demo without a full pull.

## Data

Real FIRMS pulls are stored under `backend/data/firms/raw/` and are **gitignored**.

```bash
# fetch / resume (idempotent, parallel; skips existing chunks)
.venv/bin/python -m backend.scripts.firms.fetch_full_month \
  --aoi vietnam --bbox 104,10,109,16 --start-year 2012 --end-year 2025 --workers 4

# fill manifest-missing days only
.venv/bin/python -m backend.scripts.firms.fetch_missing \
  --aoi australia --start-year 2019 --end-year 2025
```

`fetch_full_month` stitches 5-day windows across every day of each month (including day 31 and leap years) and records requests in a ledger; `fetch_missing` downloads only missing intervals.

### Latency & filters

| Path (full Vietnam pull) | Cold | Warm (disk cache) |
|---|---:|---:|
| `/api/firms/calendar?method=stat` | 153.7 s | 118 ms |
| `/api/firms/calendar?method=stan` | 215.3 s | 91 ms |
| `/api/firms/map-cells` | 94–171 ms | 85–91 ms |

Every response includes `X-Elapsed-Ms`. Warm caches with `make prewarm` (`AOI=... METHODS=...`). Supported filters: `qa_min` (`all|nominal|high`), `platform_set` (`all|snpp`), `source_type` (`all|land|vegetation`), `from_date`/`to_date`, `bbox`, and GeoJSON `geometry` (point-in-polygon, `method=stat` only).

## Models & evaluation

Three served methods only:

| Role | Method | MAE (headline, 72 AOI-months) |
|---|---|---:|
| Primary (recommended) | `stan_safe_v1` | 3765.8 |
| Baseline | `b2_seasonal_ratio` | 4411.8 |
| Fallback | `hts_anchor_v1` | 4154.4 |

> _Headline = full-month AOIs Vietnam, Amazon, Australia (n=72), eval-v4, `evaluation_raw.json`._

STAN vs B2: **−14.6% MAE, −27.3% RMSE**, 2.94 vs 1.69 / 2.57 pp 80%/90% band coverage, CI **[−1452.9, +81.8]** (includes 0). **Verdict:** recommended primary, **not** statistically established over B2 by this CI. `recommended_primary` is an operational serve decision (counts quality + band/coverage gate + robustness), not a claim of statistical superiority. LOO still favours HTS on all AOIs. See [`docs/FIRMS_MODEL_CARD.md`](docs/FIRMS_MODEL_CARD.md) and [`docs/METRIC_POLICY.md`](docs/METRIC_POLICY.md).

### STAN architecture (`stan_safe_v1`)

![STAN architecture](docs/stan_architecture.svg)

*171,362 parameters, NB2 count loss, residual on the HTS anchor. Three converging streams: (1) seasonal conditioning `month → embedding → FiLM`, (2) causal TCN backbone producing `K, V`, (3) forecast-safe static context forming the single target query (no same-month neighbour VIIRS). Right panels show tensor flow and parameter budget.*

- **Slide version (compact):** [docs/stan_architecture_slide.svg](docs/stan_architecture_slide.svg) ([PNG](docs/stan_architecture_slide.png))
- **Source / rebuild:** [docs/stan_architecture.tex](docs/stan_architecture.tex) — `docs/render_stan_figure.sh` (XeLaTeX + `pdftocairo`)
- **Details:** [docs/STAN_ARCHITECTURE.md](docs/STAN_ARCHITECTURE.md) · auto-generated TorchView graph: [docs/stan_torchview.dot](docs/stan_torchview.dot)

## API

| Endpoint | Description |
|---|---|
| `GET /api/firms/health` (`/api/health`) | `status`, `uptime_s`, torch/model availability, `methods_available` (cheap) |
| `GET /api/firms/calendar` | Month × year activity index and anomaly signals |
| `GET /api/firms/map-cells` | Monthly `0.05°` cells |
| `GET /api/firms/evaluation` | MAE/RMSE table, robustness, CI, primary-method verdict |
| `GET /api/firms/backtest` | Month-by-month raw-vs-actual series for a served method |
| `GET /api/firms/coverage-xray` | Per-AOI/year MODIS/VIIRS observation density and confidence labels |
| `GET /api/firms/export` / `brief` | CSV export and one-page brief |

Every response includes `X-Elapsed-Ms`. In production the app is served behind nginx (PM2 `alphacentauriab`, port 8000); use `/api/firms/health` for proxy health checks. `/api/firms/calendar` reads the raw pull and can be slow on a cold cache.

## Project structure

```text
FireHarmony/
├─ backend/app/firms/        # ingest, schema, QA, dedup, harmonize, eval, STAN, HTS
├─ backend/scripts/firms/    # fetch, cache, prewarm, rebuild, evaluation
├─ backend/data/             # gitignored raw FIRMS pulls, manifests, caches, demo pack
├─ frontend/src/             # React app (Calendar, Evidence, Lab, Investigator)
├─ docs/                     # method, model/data cards, architecture, audit, submission
├─ Makefile                  # install, dev, test, fetch, prewarm
└─ ecosystem.config.cjs      # PM2 serving config
```

## Documentation

- [docs/STAN_ARCHITECTURE.md](docs/STAN_ARCHITECTURE.md) — STAN graph, tensor flow, parameter budget
- [docs/FIRMS_MODEL_CARD.md](docs/FIRMS_MODEL_CARD.md) — served models, evaluation, caveats
- [docs/FIRMS_DATASET_CARD.md](docs/FIRMS_DATASET_CARD.md) — local raw holdings and field semantics
- [docs/METRIC_POLICY.md](docs/METRIC_POLICY.md) — counts-vs-band gate and confidence-interval policy
- [docs/FIRMS_INTEGRATION.md](docs/FIRMS_INTEGRATION.md) — endpoint guide, filters, serving
- [docs/DEMO.md](docs/DEMO.md) — demo script and failure handling
- [docs/SUBMISSION.md](docs/SUBMISSION.md) — NASA Space Apps 2026 submission template
- [docs/TRUTH_CONTRACT.md](docs/TRUTH_CONTRACT.md) — display rules and evidence labels

## Development

```bash
make install-dev    # once: serving + tests + dataframes, no torch
make agent-check    # fast gate (~90s): backend clean tests + frontend lint + unit + build
make check-release  # release gate (slow): clean tests + raw subset + eval + docs
```

Notes: the system `python3` may be 3.14 without deps — always use `make` or `.venv/bin/python`. Run slow/release commands only when needed (see [AGENTS.md](AGENTS.md)).

Conventions: read [AGENTS.md](AGENTS.md) and [docs/AGENT_CLAIMS.md](docs/AGENT_CLAIMS.md) before multi-file edits, never invent fire numbers, keep the statistical path working without torch, and keep `backend/.env` out of git. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Ha Tri Kien. NASA FIRMS data is subject to [NASA FIRMS terms of use](https://firms.modaps.eosdis.nasa.gov/).
