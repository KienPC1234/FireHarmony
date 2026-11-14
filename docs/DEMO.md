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

- vietnam 3.41M rows / 169 manifest months (168 paired-complete, 2026 NRT
  partial); amazon 84/85 paired months (full 2019–2025); australia still only
  5-day windows and therefore flagged partial.
- units are **hotspot detections**, not confirmed fires.
- the point is not “more AI”; it is that every displayed number traces to a
  request ledger and an artifact fingerprint.

## 0:55–1:40 — The unified table (same sample IDs for every method)

Read the 2024–2025 holdout (n=72, train ≤2023):

| method | pooled MAE | vietnam | amazon | australia |
|---|---|---|---|---|
| B0 raw MODIS | 21623.4 | 11112.1 | 32134.6 | 11415.2 |
| B1 global ratio | 5294.6 | 3493.2 | 7095.9 | 1697.3 |
| B2 seasonal ratio | **2746.0** | **844.2** | 4647.7 | **1668.8** |
| HGB `ml_b2res_v4` | 2746.0 | 844.2 | 4647.7 | 1697.3 |
| Transformer `ts_logratio_pool_v2` | 2934.4 | 1329.6 | **4539.1** | 1852.8 |

Read it honestly: HGB abstains on all three AOIs (gate off), so it serves B2/B1.
B2 wins the headline and pooled table; the Transformer wins amazon narrowly
but loses the headline and vietnam/australia. The HGB−B2 and TS−B2 bootstrap
CIs include 0: no gain is called “proven”.

## 1:40–2:15 — Why the losses are credible

Both HGB−B2 and TS−B2 bootstrap CIs include 0; present the point estimates,
not “proven superiority”. B2 is the pooled winner, the Transformer is not
significantly different, and HGB abstains.

1. HGB predicts a residual on B2 and runs a blocked-CV gate: ≥2% gain, a
   majority of folds, no regression on the latest fold. It abstains on all
   three AOIs; the API returns `residual_enabled=false` and the fallback.
2. Transformer target is the log ratio, pooled 3-AOI + AOI embedding, early
   stop on the last train year, 5 seeds. It still does not beat B2.
3. Leave-one-region-out (no AOI embedding): vietnam 3918 vs B1 4400 (beats B1, loses raw MODIS 5457),
   amazon 10118 vs B1 17005 (beats B1 but loses to raw MODIS 6548),
   australia 5501 vs B1 5279 (loses). Spatial transfer is not reliable.

## 2:15–2:45 — Use it

Calendar → method `stat` (default), draw an AOI, download CSV and the brief.
Switch to `method: ml` and show the badge:
`ABSTAINS → serves b2_seasonal_ratio`. Switch to `ts` and show
`months_scored` / `months_missing_context`. The badge is the point: the app
tells you which model actually produced the number.

Then show the QA/platform filters (`nominal+`, `SNPP-comparable`) and
`/api/firms/qa-summary`: the dashboard states how many low-confidence rows and
which platforms were removed.

Open **/lab** (mission-control layout with KPI tiles and charts):
1. **Mission Simulator** — toggle MODIS / SNPP / NOAA-20 / NOAA-21, run, and
   point at the Δ tile + scenario bar chart. Removing VIIRS drops the year
   total and turns cells into estimates; this is what the sensor upgrade added,
   not a forecast of fires.
2. **Blind Spots** — the day × sensor heatmap distinguishes `not_requested`,
   `observed_empty` and `detected`. Say out loud that unknown is not zero fire.
3. **Spatial Check** — show the Pearson/Spearman/Jaccard bars and read the
   “not a spatial holdout” caveat.
4. **Investigator** — ask “why is this month anomalous?”; show the tool chips,
   evidence tiles, and limitations list.

Press **Explain month** on the Ask page for a single-month narrative. The
answer is grounded on the evidence card and falls back to rule-based if Ollama
is offline or the model invents a large number.

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
