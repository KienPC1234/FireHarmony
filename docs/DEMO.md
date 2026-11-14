# Demo script — 3 minutes, real data first

> Numbers below are `eval-v4` post 2026-11-13 Australia full-month
> backfill (STAN MAE 3765.8, 95% CI [-1452.9, +81.8] vs B2, n=72);
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

- vietnam 3.41M rows / 169 manifest months (168 paired-complete, 2026 NRT
  partial); amazon 84/85 paired months (full 2019–2025); australia 84/85 paired
  months (backfilled 2026-11-13, full 2019–2025).
- units are **hotspot detections**, not confirmed fires.
- the point is not “more AI”; it is that every displayed number traces to a
  request ledger and an artifact fingerprint.

## 0:55–1:40 — The unified table (same sample IDs for every method)

Read the 2024–2025 holdout (n=72, train ≤2023, `eval-v4` post-Australia backfill):

| method | pooled MAE | vietnam | amazon | australia |
|---|---|---|---|---|
| B0 raw MODIS | 38,119.8 | 11,112.1 | 32,134.6 | 71,112.8 |
| B1 global ratio | 6,386.6 | 3,493.2 | 7,095.9 | 8,570.5 |
| B2 seasonal ratio | 4,411.8 | 844.2 | 4,647.7 | 7,743.6 |
| HTS `hts_anchor_v1` (fallback) | 4,154.4 | 783.9 | 4,250.1 | 7,429.3 |
| **STAN `stan_safe_v1` (main)** | **3,765.8** | **694.2** | **3,391.4** | **7,211.9** |

Read it honestly: STAN is `recommended_primary` (lowest pooled MAE, −14.6% vs
B2, improves all 3 AOIs), while the 95% bootstrap CI `[-1,452.9, +81.8]`
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
