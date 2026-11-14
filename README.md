# FireHarmony

> **FireHarmony: Satellite Fire Intelligence Lab.**
> **NASA Space Apps 2026: Harmonization of MODIS and VIIRS Hot Spots.**
> One burning-activity calendar where the sensor of origin no longer matters.

MODIS (Terra/Aqua, 1 km, since 2000) and VIIRS (Suomi-NPP/NOAA-20/21, 375 m,
since 2012) do not see the same fires: VIIRS detects roughly 3-5x more hotspots.
Adding the two raw counts fakes a step change in 2012. FireHarmony builds a
single **hotspot-detection activity index** on a daily 0.05 deg grid:

1. strict schema + QA (unknown instruments, impossible HHMM, platform/date
   anachronisms rejected: never silently repaired);
2. dedup across overlapping raw pulls;
3. per-month empirical ratio `k = MODIS / VIIRS` from AOI totals (fusion) or
   from **train months only** (predictive evaluation);
4. VIIRS is authoritative where it recorded a detection; MODIS-only cells are
   upscaled by `1/k` and labelled **estimated**, with an uncertainty interval;
5. month x year calendar, leave-one-year-out robust z anomalies, CSV/brief
   export, and an offline explainer.

Units are **hotspot detections / sensor-adjusted activity index**, never
confirmed fires. VIIRS is a sensor reference, not fire ground truth.

## Quick start

```bash
make install
make sample          # deterministic synthetic sample (offline demo)
make agent-check     # fast gate: backend + lint/unit/build (~90 s)
make dev             # API :8000 + Vite :5173
make demo            # build frontend and serve API+SPA on :8000

# Release-only (do not use as a dev loop):
make test-full       # real raw data + SPA, can take ~40 min
make check-release   # clean tests + raw subset + eval + docs
```

Real NASA data (free FIRMS MAP_KEY):

```bash
export FIRMS_MAP_KEY=<key>   # https://firms.modaps.eosdis.nasa.gov/api/area/
cd backend
../.venv/bin/python -m scripts.firms.fetch_full_month \
  --aoi vietnam --bbox 104,10,109,16 --start-year 2012 --end-year 2025 --workers 4
```

### Request cost (full Vietnam pull, measured)

| path | cold | warm (disk cache) |
|---|---:|---:|
| `/api/firms/calendar?method=stat` | 153.7 s | 118 ms |
| `/api/firms/calendar?method=stan` | 215.3 s | 91 ms |
| `/api/firms/map-cells` | 94-171 ms | 85-91 ms |

Every response carries `X-Elapsed-Ms`. `make prewarm` (AOI=... METHODS=...) pays the
cold cost deliberately and prints the numbers; the 24-month demo pack answers
its first raw request in 16-21 s.

### Real NASA data without the 820 MB pull

The submission ZIP ships a **24-month Vietnam demo pack** (2024-01..2025-12,
362 FIRMS CSVs, 459,832 rows) under `backend/data/firms/demo_pack/`. It is a
real NASA subset, not the synthetic sample, and it is checksum-pinned:

```bash
make demo-verify     # re-hash every file against demo_pack/manifest.json
make demo-install    # copy it into data/firms/raw -> dataset_ready=true
```

After that, `GET /api/firms/calendar?data=raw&method=stan` serves 24 real
months end to end. Months outside the pack stay absent, not zero. The pack's
`manifest.json` also states that request coverage is **not** inferred from it.

`fetch_full_month` stitches 5-day windows covering **every** day of each month
(including the 31st and leap Februaries) and writes a request ledger.
`fetch_missing` diffs that ledger against the calendar and fetches only the
missing intervals (day 31, australia windows) instead of re-downloading months:

```bash
cd backend
../.venv/bin/python -m scripts.firms.fetch_missing --aoi vietnam --start-year 2019 --end-year 2025
../.venv/bin/python -m scripts.firms.fetch_missing --aoi australia --start-year 2019 --end-year 2025
```

Filters: `qa_min` drops low-confidence rows (`nominal`/`high`) and
`platform_set=snpp` keeps MODIS + SNPP VIIRS only, so a new NOAA-20/21 overpass
is not reported as more fire. `/qa-summary` shows the mix and warns when a
filter changes the answer.

## Models (all numbers are from the committed artifacts)

<!-- BEGIN GENERATED README METRICS -->
_Generated from `evaluation_raw.json` (eval-v3); headline = full-month AOIs ['vietnam', 'amazon', 'australia'], n=72. Primary: `stan_safe_v1`._

| Method | MAE (headline) |
|---|---:|
| `b0_raw_modis` | 38119.8 |
| `b1_global_ratio` | 6386.6 |
| `b2_seasonal_ratio` | 4411.8 |
| `hgb_b2res_v4` | 4687.5 |
| `ts_logratio_pool_v2` | 5322.9 |
| `stan_safe_v1` | 3765.8 |
| `hts_anchor_v1` | 4154.4 |
| `spatial_hgb_v1` | 3076.4 |

`stan_safe_v1` − `b2_seasonal_ratio` ΔMAE -646.0, 95% CI [-1452.9, +81.8] — CI includes 0, so the gain is not established.
<!-- END GENERATED README METRICS -->

**Tile hierarchy and STAN are the primary advances.** Aggregating
the raw pull at 1-degree tiles gives 56,187 tile-months (17,742 strong) over
1,125 tiles instead of 231 AOI-months. A hierarchical tile-seasonal anchor (HTS)
reaches MAE **4,218.8 vs B2 4,411.8** on the 72 holdout rows (−4.4%; all three
AOIs improve, CI [−743.8, +358.6]). It is served as `method=hts` on raw data and
as STAN's pre-2024 fallback; `/api/firms/hts-status` marks the gate as not passed.

**STAN is the served main model for raw data.** A
negative-binomial spatial-temporal network (seasonal FiLM + dilated TCN +
target-month query + neighbour context) reaches MAE **3,765.8 vs B2 4,411.8**
on the 72 holdout months (−14.6%, CI [−1,452.9, +81.8]; every AOI improves and
it beats HTS 4,154.4). The point-estimate win is real, the 95% CI is not
strictly below zero, and `/api/firms/models` exposes that split
(`recommended_primary` vs `statistically_established`). `method=stan` serves
STAN for 2024+ with HTS fallback before 2024. See `docs/TILE_HIERARCHY.md` and
`/api/firms/stan-status`.

**Spatial context is the strongest lever (retrospective only).** A neighbour-tile
HGB reaches MAE **3,076.4 vs B2 4,411.8** on the 72 holdout months (all three
AOIs, CI excludes 0, and a 222-tile spatial holdout also wins: 789.7 vs 1,305.3).
The catch: the gain needs same-month VIIRS in adjacent tiles; without it the
model scores 4,611.0, worse than HTS. It is spatial reconstruction/gap-fill, not
a forecast or a pure MODIS→VIIRS calibration. See `docs/TILE_HIERARCHY.md`.

**No model transfers across regions.** Leave-one-region-out still favours HTS
over STAN on all three held-out AOIs, and the HGB/Transformer gates abstain on
the current data. Point estimates and statistical significance are reported
separately; no gain is called “proven”. See `docs/FIRMS_MODEL_CARD.md`
(generated from the evaluation artifact) for per-AOI numbers, CI, seed spread
and the leave-one-region-out test.

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
| `GET /api/firms/qa-summary` | confidence/platform mix + filter warnings |
| `GET /api/firms/platform-series` | platform mix + SNPP-only comparable series |
| `GET /api/firms/evidence` | AOI-month evidence card (total, observed/estimated cells, coverage, z, k) |
| `GET /api/firms/simulate` | sensor-subset calendar (Mission Simulator) |
| `GET /api/firms/blind-spots` | day × sensor request/detection states |
| `GET /api/firms/spatial-check` | coarse co-observation consistency |
| `POST /api/firms/cross-validate` | correlate a user-supplied burned-area series |
| `POST /api/firms/explain-month` | LLM/rule explanation grounded on that evidence card |
| `POST /api/firms/investigate` | tool-backed scientific investigator |
| `GET /api/firms/calendar` | calendar + server-side `summary`; filters `qa_min`, `platform_set`, `from_date`, `to_date`, GeoJSON `geometry` (stat only); 404 `no_raw_data` when raw is absent |
| `GET /api/firms/map-cells` | one month of 0.05° cells with `returned`/`total`/`preview`; independent from the calendar daily cap |
| `GET /api/firms/export` | full CSV with `X-Filter-Hash`, `X-From-Date`, `X-To-Date`, `X-Geometry-Hash`; no silent row cap |
| `GET /api/firms/brief` | one-page Markdown brief for the same method/data |
| `GET /api/firms/backtest` | frozen unified evaluation (503 until built) |
| `GET /api/firms/xray` | MODIS vs VIIRS vs adjusted, same split |
| `GET /api/firms/data-status` | samples + raw + cache |
| `POST /api/firms/ml-train`, `/ts-train` | admin/offline training |

## Reproduce

```bash
cd backend
../.venv/bin/python -m scripts.firms.fetch_full_month --aoi vietnam --bbox 104,10,109,16 --start-year 2012 --end-year 2025 --workers 4
../.venv/bin/python -m scripts.firms.train_ml --aoi vietnam --data raw --test-years 2
../.venv/bin/python -m scripts.firms.train_ts --aoi vietnam --data raw --test-years 2
../.venv/bin/python -m scripts.firms.evaluate --data raw --test-years 2
../.venv/bin/python -m scripts.firms.evaluate --data raw --verify
../.venv/bin/python -m scripts.firms.make_benchmark --check
../.venv/bin/python -m scripts.firms.rebuild_subset   # 16 NASA CSVs, checksum-pinned
../.venv/bin/python -m scripts.firms.check_release    # full release gate
../.venv/bin/python -m pytest tests/test_firms.py -q
```

The committed `backend/data/firms/benchmark/evaluation_samples_*.csv` files are
the exact evaluation sample IDs; `make_benchmark --check` recomputes every
published MAE/WAPE/bias to 1e-4 without needing the ~820 MB raw pulls.

## SensorFormer (single served architecture)

`sf_lite_v1` is the only model in the runtime and UI: a seasonal B2 anchor plus
a small temporal CNN + one attention layer + context gate, with monotone
quantile heads. It is scored on the same 72 AOI-month holdout and **loses to the
anchor** (2,458 vs 2,387 MAE), so its gate is closed and the calendar serves the
anchor only. The loss, the 80% band (86.1% empirical coverage) and the ablations
are published in `docs/SENSORFORMER.md`; the API exposes `/api/firms/sf-status`.
HGB/TS are archived negative results, not user-selectable models. SRF and TileFormer were removed (code + artifacts + docs).

## Satellite Fire Intelligence Lab (`/lab`)

| Tool | What it does |
|---|---|
| **Satellite Mission Simulator** | choose MODIS / SNPP / NOAA-20 / NOAA-21; recompute the same calendar from per-platform counts. It answers “what changes when a sensor is removed”, not “how many fires exist”. |
| **Sensor Blind Spot Explorer** | day × sensor table: not requested / observed with no detection / detected. `unknown` is never rendered as no fire. |
| **AI Scientific Investigator** | question → deterministic tools (calendar, evaluation, coverage, evidence) → LLM/rule answer with `tools_used`, CI/limits and citations. No free-form number generation. |
| **Spatial co-observation** | coarse-grid Pearson/Spearman/top-decile Jaccard where both sensors saw detections; labelled consistency, **not** a spatial holdout. |
| **Cross-dataset check** | accepts a user-supplied monthly burned-area series (e.g. MCD64A1) and reports correlation with the activity index plus caveats. |

## LLM explainer (grounded, offline fallback)

`/api/firms/explain-month` builds an **evidence card** first (same cells as the
calendar: total, observed vs estimated cells, coverage ratio/missing days,
leave-one-year-out z, k, effective method, platform counts), then asks the
local Ollama model to explain it. The model receives only that JSON and must
quote it; if Ollama is down the rule-based answer is returned with
`llm_used=false`. `/api/firms/evidence` is the same card without an LLM call.
The Ask page exposes a month picker + "Explain month" button and shows the
evidence summary under the answer.

## Docs

- `docs/FIRMS_DATASET_CARD.md` - sources, coverage, request ledger, known defects
- `docs/FIRMS_MODEL_CARD.md` - architectures, unified table, losses, limits
- `docs/AUDIT_UIUX_RESPONSE.md` - UI/UX + data-truth audit: what was fixed and verified
- `docs/TRUTH_CONTRACT.md` - what may be shown, null vs label, anti-ratchet policy
- `docs/AUDIT_BACKLOG.md` - parked P1 items; do not re-open closed P0s
- `docs/DATA_GAPS.md` - exact unfetched months and resume commands
- `docs/DEMO.md` - 3-minute demo script using the real numbers
- `AGENTS.md` / `CONTRIBUTING.md` - repository conventions
