# Demo script — 3 minutes, real data first

Server: `make demo` → http://127.0.0.1:8000 (API + SPA). No external network is
needed for the data; map tiles need OSM.

## 0:00–0:25 — The problem, with the defects we found

MODIS 1 km vs VIIRS 375 m: VIIRS sees ~3–5× more hotspots, so adding raw counts
fakes a 2012 step. Our first pulls also measured **5 days per month**, and the
first “full month” fetcher never requested **day 31**. Both are now visible:
`/api/firms/coverage` shows `requested_days`, `missing_days`, and failed
requests. The fixed fetcher derives windows from the real month length.

## 0:25–0:55 — Real data, real coverage

Open **/xray?aoi=vietnam&data=raw**. Say:

- vietnam 1.39M rows / 85 manifest months; amazon 4.46M; australia only
  5-day windows and therefore flagged partial.
- units are **hotspot detections**, not confirmed fires.
- the point is not “more AI”; it is that every displayed number traces to a
  request ledger and an artifact fingerprint.

## 0:55–1:40 — The unified table (same sample IDs for every method)

Read the 2025 holdout (n=36, train ≤2024):

| method | pooled MAE | vietnam | amazon | australia |
|---|---|---|---|---|
| B0 raw MODIS | 10262.5 | 8665.2 | 9670.2 | 12452.3 |
| B1 global ratio | 2037.7 | 2426.8 | 2019.8 | **1666.3** |
| B2 seasonal ratio | 1282.6 | **867.6** | **1255.1** | 1725.1 |
| HGB `ml_b2res_v4` | **1263.0** | 867.6 | 1255.1 | 1666.3 |
| Transformer `ts_logratio_pool_v2` | 1798.0 | 1225.4 | 2338.2 | 1830.5 |

Two honest claims: the gated HGB wins pooled only because it **abstains** to
the best per-AOI baseline, and the Transformer **loses to B2** even though it
beats B1. No model wins every region.

## 1:40–2:15 — Why the losses are credible

1. HGB predicts a residual on B2 and runs a blocked-CV gate: ≥2% gain, a
   majority of folds, no regression on the latest fold. It abstains on all
   three AOIs; the API returns `residual_enabled=false` and the fallback.
2. Transformer target is the log ratio, pooled 3-AOI + AOI embedding, early
   stop on the last train year, 5 seeds. It still does not beat B2.
3. Leave-one-region-out (no AOI embedding): vietnam 4193 vs B1 3451 (loses),
   amazon 20445 vs B1 24319 (beats B1 but loses to raw MODIS 7061),
   australia 4694 vs B1 5611 (beats). Spatial transfer is not reliable.

## 2:15–2:45 — Use it

Calendar → method `stat` (default), draw an AOI, download CSV and the brief.
Switch to `method: ml` and show the badge:
`ABSTAINS → serves b2_seasonal_ratio`. Switch to `ts` and show
`months_scored` / `months_missing_context`. The badge is the point: the app
tells you which model actually produced the number.

## 2:45–3:00 — Close

“We do not invent fires where the satellite never looked, and we do not put a
learned model in front of a baseline it cannot beat. We publish the ledger,
the artifact fingerprint, the losing table, and the region where all methods
are weak.”

## Reproduce (no network for the committed evaluation)

```bash
cd backend
../.venv/bin/python -m scripts.firms.evaluate --data raw --verify
../.venv/bin/python -m scripts.firms.make_benchmark --check
../.venv/bin/python -m pytest tests/test_firms.py -q
```
