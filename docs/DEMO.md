# Demo script — 3 minutes, real data first

> Numbers below are `eval-v4` post 2026-11-14 full 180-month backfill
> (STAN MAE 4154.7, 95% CI [-1060.4, +216.3] vs B2, n=72);
> the current table is in `docs/FIRMS_MODEL_CARD.md` (`eval-v4`).

Server: `make demo` → http://127.0.0.1:8000 (API + SPA). No external network is
needed for the data; map tiles need OSM.

If you start from the submission ZIP (no full raw pull), install the verified
24-month demo pack first:

```bash
make demo-verify
make demo-install
```

That gives `data=raw` real NASA months 2024-01..2025-12; months outside the
pack stay absent, never zero.

## 0:00–0:25 — The problem, with the defects we found

MODIS 1 km vs VIIRS 375 m: VIIRS sees ~3–5× more hotspots, so adding raw counts
fakes a 2012 step. Our first pulls also measured **5 days per month**, and the
first “full month” fetcher never requested **day 31**. Both are now visible:
`/api/firms/coverage` shows `requested_days`, `missing_days`, and failed
requests. The fixed fetcher derives windows from the real month length.

## 0:25–0:55 — Real data, real coverage

Open **/xray?aoi=vietnam&data=raw**. Say:

- vietnam 3.57M rows / 180 manifest months (180 paired-complete); amazon
  8.43M rows / 180 paired months; australia 20.63M rows / 180 paired months
  (32.64M rows total across 2012–2026).
- units are **hotspot detections**, not confirmed fires.
- the point is not “more AI”; it is that every displayed number traces to a
  request ledger and an artifact fingerprint.

## 0:55–1:40 — The unified table (same sample IDs for every method)

Read the 2024–2025 holdout (n=72, train ≤2023, `eval-v4` post-Australia backfill):

| method | pooled MAE | vietnam | amazon | australia |
|---|---|---|---|---|
| B0 raw MODIS | 38,119.8 | 11,112.1 | 32,134.6 | 71,112.8 |
| B1 global ratio | 5,555.2 | 3,493.2 | 5,496.9 | 7,675.4 |
| B2 seasonal ratio | 4,581.1 | 844.2 | 4,800.0 | 8,099.2 |
| HTS `hts_anchor_v1` (fallback) | 4,524.8 | 783.9 | 4,304.9 | 8,485.6 |
| **STAN `stan_safe_v1` (main)** | **4,154.7** | **660.2** | **3,667.6** | **8,136.3** |

Read it honestly: STAN is `recommended_primary` (lowest pooled MAE, −9.3% vs
B2, P(STAN better) 0.919, beats HTS with 95% CI `[-719.3, -88.7]`), while the 95% bootstrap CI `[-1,060.4, +216.3]` vs B2
includes 0 (`statistically_established: false`). There is no archived model in
the table anymore; only the three served paths remain.

## 1:40–2:15 — Why the claim is credible

Present the point estimate and the CI separately; do not call the gain proven.

1. STAN is anchored on HTS and predicts the residual, so it cannot collapse to
   a worse-than-baseline scale by construction.
2. Leave-one-region-out still favours HTS on all three AOIs: vietnam 801 vs 784,
   amazon 4,511 vs 4,250, australia 7,493 vs 7,429. Spatial transfer is not
   solved; say so before showing the pooled win.
3. The predictive band is calibrated on 2023: validation coverage 0.81, 2024-25
   holdout coverage 0.72. It undercovers and the API reports both numbers.

## 2:15–2:45 — Use it

Calendar → STAN on raw (default; HTS fallback before 2024), draw a polygon and
confirm only in-polygon cells remain, pick a date range, then download the
harmonized cell-day CSV, the original-detection CSV or the brief.

> Note: a drawn polygon is `method=stat`-only — STAN/HTS need raw full-AOI
> monthly totals and return 409 on any bbox/polygon/date subset.
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
   `requested_no_hotspot_record` and `detected`. Say out loud that unknown is not zero fire.
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
