# FireHarmony

> **FireHarmony: Satellite Fire Intelligence Lab**
> **NASA Space Apps 2026: Harmonization of MODIS and VIIRS Hot Spots**

MODIS (Terra/Aqua, 1 km, since 2000) and VIIRS (Suomi-NPP/NOAA-20/21, 375 m, since 2012) do not have equal detection sensitivity: VIIRS detects roughly 3-5x more hotspots, especially small agricultural burns. Summing raw counts creates an artificial ~4x jump in 2012.

FireHarmony constructs a single **hotspot-detection activity index** on a daily `0.05°` grid:

1. **Strict schema & QA:** Rejects unknown instruments, invalid `HHMM`, and platform/date anachronisms (never silently repaired).
2. **Deduplication:** Removes duplicate detections across overlapping raw pulls.
3. **Monthly empirical calibration (`k = MODIS / VIIRS`):** Estimated from AOI totals (fusion) or training months only (predictive evaluation).
4. **Forward harmonization:** Keeps VIIRS authoritative wherever observed; upscales MODIS-only cells by `1/k`, labelled **estimated** with an uncertainty interval.
5. **Calendar & anomaly analysis:** Month x year matrix, leave-one-year-out robust MAD z-scores, CSV/brief exports, and a grounded AI investigator.

Units are **hotspot detections / sensor-adjusted activity index**, never confirmed fire counts or burned area. VIIRS is a sensor reference, not fire ground truth.

---

## Quick Start

```bash
make install         # backend venv + frontend deps
make sample          # deterministic synthetic sample (offline demo)
make dev             # FastAPI (:8000) + Vite (:5173)
make demo            # build frontend/dist and serve API + SPA on :8000
make agent-check     # fast gate: backend + frontend lint/unit/build (~90 s)
```

Release verification (full raw / SPA):

```bash
make test-full       # real raw data + Playwright SPA (~40 min)
make check-release   # clean tests + raw subset + eval + docs + artifact health
```

---

## Data, Demo Pack & Caching

### 1. Real NASA data without the 1.4 GB pull

The submission ships a checksum-pinned **24-month Vietnam demo pack** (`2024-01..2025-12`, 362 FIRMS CSVs, 459,832 rows) in `backend/data/firms/demo_pack/`:

```bash
make demo-verify     # verify SHA-256 against demo_pack/manifest.json
make demo-install    # copy into backend/data/firms/raw -> dataset_ready=true
```

After installation, `GET /api/firms/calendar?data=raw&method=stan` serves 24 real months end to end (first cold pass takes 16-21 s; months outside the pack stay absent, never zero).

### 2. Full NASA FIRMS pull (free `FIRMS_MAP_KEY`)

`fetch_full_month` stitches 5-day windows across every day of each month (including day 31 and leap years) and logs every request in a ledger. `fetch_missing` diffs that ledger and downloads only missing intervals:

```bash
export FIRMS_MAP_KEY=<key>   # https://firms.modaps.eosdis.nasa.gov/api/area/
cd backend
../.venv/bin/python -m scripts.firms.fetch_full_month \
  --aoi vietnam --bbox 104,10,109,16 --start-year 2012 --end-year 2025 --workers 4
../.venv/bin/python -m scripts.firms.fetch_missing --aoi australia --start-year 2019 --end-year 2025
```

### 3. Request latency & filters

| Path (full Vietnam pull) | Cold | Warm (disk cache) |
|---|---:|---:|
| `/api/firms/calendar?method=stat` | 153.7 s | 118 ms |
| `/api/firms/calendar?method=stan` | 215.3 s | 91 ms |
| `/api/firms/map-cells` | 94-171 ms | 85-91 ms |

Every response includes `X-Elapsed-Ms`; use `make prewarm` (`AOI=... METHODS=...`) to populate disk caches upfront. Supported filters: `qa_min` (`all|nominal|high`), `platform_set` (`all|snpp`), `source_type` (`all|land|vegetation`), `from_date`/`to_date`, `bbox`, and GeoJSON `geometry` (point-in-polygon, `method=stat` only).

---

## Models & Evaluation

![STAN architecture](docs/stan_architecture.svg)

*STAN (`stan_safe_v1`), the served model: 171,362 parameters, NB2 count loss,
residual on the HTS anchor, 12-month MODIS window, forecast-safe context (no
same-month neighbour VIIRS). The figure reads as three converging streams —
seasonal conditioning (`month` → embedding → FiLM), the causal TCN backbone
(`K, V`), and the forecast-safe context that forms the single target query — plus
the tensor-shape table and parameter budget. Source: `docs/stan_architecture.tex`
(rebuild with `docs/render_stan_figure.sh`); full auto-generated TorchView graph:
`docs/stan_torchview.dot`; details:
[`docs/STAN_ARCHITECTURE.md`](docs/STAN_ARCHITECTURE.md).*

<!-- BEGIN GENERATED README METRICS -->
_Generated from `evaluation_raw.json` (eval-v4); headline = full-month AOIs ['vietnam', 'amazon', 'australia'], n=72. Primary: `stan_safe_v1`._

| Method | MAE (headline) |
|---|---:|
| `b0_raw_modis` | 38119.8 |
| `b1_global_ratio` | 6386.6 |
| `b2_seasonal_ratio` | 4411.8 |
| `stan_safe_v1` | 3765.8 |
| `hts_anchor_v1` | 4154.4 |

`stan_safe_v1` − `b2_seasonal_ratio` ΔMAE -646.0, 95% CI [-1452.9, +81.8] — CI includes 0, so the gain is not established.
<!-- END GENERATED README METRICS -->

* **1-degree tile hierarchy (`hts_anchor_v1`):** Aggregates raw pulls into `1,125` 1-degree tiles (`56,187` tile-months). Empirical Bayes shrinkage toward B2 achieves MAE **4,154.4 vs B2 4,411.8** (`-5.8%`, `95% CI [-777.1, +266.2]`) across the 72 holdout AOI-months (`2024-2025`), improving all three AOIs. The CI includes 0, so the gain is not statistically established. Serves as `method=hts` and as STAN's pre-2024 fallback.
* **Primary served model (`stan_safe_v1`):** Negative-binomial spatio-temporal network (dilated causal TCN + seasonal FiLM + target-month query + forecast-safe neighbour context). Point-estimate winner at MAE **3,765.8 vs B2 4,411.8** (`-14.6%`, bootstrap P(STAN better) `0.96`, improves Vietnam `694.2`, Amazon `3,391.4`, and Australia `7,211.9`). The 95% bootstrap CI `[-1,452.9, +81.8]` includes 0, so the win is not statistically established: `/api/firms/models` reports `recommended_primary` separately from `statistically_established`. Serves `2024+` with HTS fallback before 2024.
* **Regional transfer & integrity:** Leave-one-region-out still favours HTS over STAN on held-out AOIs. All methods share frozen `evaluation_manifest.json` sample IDs, and `/api/firms/backtest` reads committed artifacts without training on live requests.

---

## Satellite Fire Intelligence Lab (`/lab`) & AI Investigator

| Tool | Capability |
|---|---|
| **Satellite Mission Simulator** | Toggle MODIS / SNPP / NOAA-20 / NOAA-21 to measure sensor-upgrade impact on the calendar (not a fire forecast). |
| **Sensor Blind Spot Explorer** | Day x sensor coverage matrix distinguishing `not_requested`, `requested_no_hotspot_record`, and `detected`. |
| **AI Scientific Investigator** | Deterministic tool-backed Q&A (`/api/firms/investigate`, SSE `/api/firms/investigate-stream`) with citations, limits, and offline rule-based fallback when Ollama is unavailable. |
| **Month Evidence & Explainer** | `/api/firms/evidence` and `POST /api/firms/explain-month` ground every number on the AOI-month evidence card. |
| **Spatial Co-Observation** | Coarse-grid Pearson/Spearman/Jaccard consistency check (explicitly labelled consistency, not a spatial holdout). |
| **Cross-Dataset Check** | Correlates a user-supplied monthly burned-area series (e.g. MCD64A1) against the activity index. |

---

## API Reference (Selected)

### Calendar, Map & Exports
| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Service status, PyTorch availability, primary method & gate state |
| `GET /api/firms/data-status` | Raw readiness, months, coverage, and dataset fingerprints |
| `GET /api/firms/calendar` | Harmonized calendar + summary (`qa_min`, `platform_set`, `source_type`, `from_date`/`to_date`, `bbox`, GeoJSON `geometry`) |
| `GET /api/firms/map-cells` | Monthly `0.05°` cells with `returned`/`total`/`preview` |
| `GET /api/firms/export` | Full filtered cell-day CSV with `X-Filter-Hash` and date/geometry headers |
| `GET /api/firms/export-detections` | Row-level original detections CSV |
| `GET /api/firms/brief` | One-page Markdown operational brief |
| `POST /api/firms/upload-dataset` | Upload a custom-region FIRMS CSV (up to 50 MB, session `upload:<hex>`) |

### Models, Coverage & Diagnostics
| Endpoint | Purpose |
|---|---|
| `GET /api/firms/models` | Unified registry: `primary`, `baseline`, `fallback`, and gate status |
| `GET /api/firms/stan-status` / `hts-status` / `spatial-status` | Model artifact metadata, holdout metrics, and serving rules |
| `GET /api/firms/backtest` | Frozen unified holdout leaderboard (`evaluation_raw.json`) |
| `GET /api/firms/xray` | MODIS vs VIIRS vs harmonized series on the same split |
| `GET /api/firms/coverage` | Request ledger: requested days, failures, and missing days |
| `GET /api/firms/qa-summary` / `platform-series` | Confidence/platform mix and SNPP-comparable series |
| `GET /api/firms/simulate` / `blind-spots` / `spatial-check` | Sensor Lab simulation and diagnostic endpoints |
| `POST /api/firms/cross-validate` | Correlate an external burned-area monthly series |
| `GET /api/firms/evidence` / `POST /api/firms/explain-month` | AOI-month evidence card and grounded explanation |
| `POST /api/firms/investigate` / `investigate-stream` | Tool-backed scientific investigator (JSON and SSE) |

---

## Reproducibility

```bash
cd backend
../.venv/bin/python -m scripts.firms.evaluate --data raw --test-years 2
../.venv/bin/python -m scripts.firms.evaluate --data raw --verify
../.venv/bin/python -m scripts.firms.make_benchmark --check
../.venv/bin/python -m scripts.firms.rebuild_subset   # 16 NASA CSVs, checksum-pinned
../.venv/bin/python -m scripts.firms.check_release    # full release gate
../.venv/bin/python -m pytest tests/test_firms.py -q
```

`make_benchmark --check` verifies every published MAE/WAPE/bias metric to `1e-4` using `backend/data/firms/benchmark/evaluation_samples_*.csv` without requiring the ~1.4 GB raw pulls.

---

## Documentation

* [docs/FIRMS_DATASET_CARD.md](docs/FIRMS_DATASET_CARD.md) - sources, coverage, request ledger, and known defects
* [docs/FIRMS_MODEL_CARD.md](docs/FIRMS_MODEL_CARD.md) - architectures, unified metrics (`eval-v4`), losses, and limits
* [docs/STAN_ARCHITECTURE.md](docs/STAN_ARCHITECTURE.md) - STAN graph, shapes, parameter budget (TorchView + Graphviz)
* [docs/TILE_HIERARCHY.md](docs/TILE_HIERARCHY.md) - 1-degree tile experiment trail (pre-backfill historical analysis)
* [docs/TRUTH_CONTRACT.md](docs/TRUTH_CONTRACT.md) - display rules, null vs label, and anti-ratchet policy
* [docs/DATA_GAPS.md](docs/DATA_GAPS.md) - coverage status and resume commands
* [docs/DEMO.md](docs/DEMO.md) - 3-minute demo script
* [docs/SUBMISSION.md](docs/SUBMISSION.md) - submission checklist
* [docs/AUDIT_UIUX_RESPONSE.md](docs/AUDIT_UIUX_RESPONSE.md) & [docs/AUDIT_BACKLOG.md](docs/AUDIT_BACKLOG.md) - UI/UX audit resolution & P1 backlog
* [AGENTS.md](AGENTS.md) / [CONTRIBUTING.md](CONTRIBUTING.md) - repository conventions
