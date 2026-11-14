# Tile hierarchy: the strongest candidate, and why more GPU did not help

> **Historical analysis (pre-2026-11-14).** Numbers below were computed before
> the Australia full-month backfill. Current, reproducible numbers are in
> `docs/FIRMS_MODEL_CARD.md` (`eval-v3`); this file is kept as the experiment
> trail, not as the served-metrics source.

This is the audit trail for the data-expansion experiment requested after the
second audit. It answers three questions with numbers:

1. Can the existing raw pull support more than 231 training windows?
2. Does a region-agnostic network use that extra data to beat B2?
3. Does more capacity (RTX 4070 SUPER, 22k → 258k params) close the gap?

Short answer: yes to (1), no to (2) and (3). The gain came from a **hierarchical
tile-month anchor**, not from a bigger network.

## 1. Data expansion without new downloads

The raw pull is 823 MB / 9.8M hotspot rows. The old benchmark aggregated it to
one pair per AOI-month (337 rows, 231 model windows). `build_tiles.py` keeps the
same rows but aggregates at 1-degree tiles:

| Quantity | Value |
|---|---:|
| Tile-months with either sensor | 42,327 |
| Tile-months with both sensors | 28,769 |
| Strong tile-months (≥20 MODIS and ≥20 VIIRS) | 10,315 |
| Tiles | 1,060 |
| Training windows (12-month context) | 3,924 |

That is ~17× more model windows and ~350× more spatial units than the AOI-only
design, from data already on disk. The committed CSV is 1.7 MB:
`backend/data/firms/benchmark/tile_pairs_raw.csv` (sha256
`324e8495…b833d`), reproducible with:

```bash
cd backend
python -m scripts.firms.build_tiles
```

## 2. Hierarchical tile-seasonal anchor (HTS)

Each tile-month gets a seasonal log-ratio, shrunk toward the AOI-month B2 ratio:

```
w = n / (n + 3)
anchor(tile, month) = w * median(log-ratio of that tile-month over train years)
                    + (1 - w) * B2(aoi, month)
```

`n` is the number of co-observed years for that tile-month. Sparse tiles fall
back to the tile's overall ratio, then to B2. A single level factor is
calibrated on 2023 (`sum(actual)/sum(predicted)`); it is 0.997, so it is not
doing hidden work.

Calendar totals sum the per-tile VIIRS-equivalent counts over all tiles of the
AOI-month. Scored on the official 72 holdout rows:

| Method | Pooled MAE | Vietnam | Amazon | Australia |
|---|---:|---:|---:|---:|
| B2 seasonal anchor | 2,386.9 | 844.2 | 4,647.7 | 1,668.8 |
| **HTS (candidate)** | **2,230.7** | **790.9** | **4,297.1** | **1,604.1** |

- ΔMAE = **−156.2** (−6.5%), AOI-month bootstrap CI **[−362.0, +44.0]**,
  P(HTS better) = **0.93**.
- Year-block CI **[−366.9, +54.5]** (2 blocks; coarse).
- All three AOIs improve. That consistency matters more than the pooled
  number, because earlier TS gains were region-mixed.
- The pre-registered gate (≥2% and CI upper < 0) is **not passed** because the
  CI still includes zero. Status: candidate, not deployed. It is not called a
  win over B2.

Artifact: `backend/data/firms/models/hts_anchor_raw.json`.
Reproduce: `python -m scripts.firms.evaluate_hts`.

## 3. TileFormer: region-agnostic residual on HTS

Architecture (`app/firms/sf_tile.py`, code removed in STAN cleanup):

- 12-month window of `[log MODIS, sin/cos month, day_frac, terra_frac]`;
- 2 dilated convolutions (1, 2) + one transformer encoder layer, d=64, 4 heads;
- context = smooth geographic basis (lat/lon harmonics), window-mean MODIS,
  HTS anchor, month phase; **no AOI one-hot**;
- gated residual on HTS; monotone 0.1/0.5/0.9 quantiles;
- 5 seeds, early stopping on 2023 in eval mode, refit on `< 2024`, one global
  level calibration chosen on 2023.

Temporal holdout (2024–25, 940 tile-months / 59 AOI-months):

| Method | Tile MAE | AOI-aggregate MAE |
|---|---:|---:|
| HTS anchor | **137.0** | **1,217.8** |
| TileFormer d=32 | 143.2 | +228.9 vs anchor |
| TileFormer d=64 | 141.6 | +201.3 vs anchor |
| TileFormer d=128 | 139.5 | +150.7 vs anchor |

The network is close but always worse. Empirical 80% band coverage is 72.5%;
the band is reported, not called calibrated.

### Leave-one-region-out (train on 2 AOIs, test the third)

| Held out | Tile MAE model | Tile MAE HTS | Aggregate ΔMAE |
|---|---:|---:|---:|
| Vietnam | 118.9 | **116.3** | +134.4 |
| Amazon | 185.1 | **146.4** | +1,458.0 |
| Australia | **72.4** | 74.1 | **−3.5** |

The network transfers to Australia slightly but not to Vietnam/Amazon. A
one-hot AOI embedding would have hidden this; the geographic basis exposes it.
Region transfer is still unsolved, and the doc says so.

## 4. Capacity sweep (GPU is not the bottleneck)

All runs use CUDA (`torch 2.14.1+cu130`, RTX 4070 SUPER, 12 GB).

| Model | Params | Tile MAE | vs HTS (137.0) |
|---|---:|---:|---:|
| d=32 | 22,574 | 143.2 | +6.2 |
| d=64 | 72,462 | 141.6 | +4.6 |
| d=128 | 258,254 | 139.5 | +2.5 |
| HTS anchor | 0 learned | **137.0** | — |

An 11× parameter increase buys 3.7 MAE at tile level and still loses to the
anchor, while AOI aggregates get worse in every configuration. The binding
constraint is sample structure and label noise, not FLOPs. Buying a bigger GPU
would not change this conclusion; more **co-observed months and platforms**
would.

## 5. Limits

- FIRMS reports detected hotspots only; missed fires and cloud/overpass
  footprints are absent. No model here estimates detection probability.
- 1-degree tiles are a compromise: smaller tiles are noisier, larger tiles lose
  the spatial signal. The 20-count threshold drops thin months; HTS handles the
  rest by shrinkage.
- The AOI aggregate is a sum over tiles present in the CSV; it is compared
  against the official totals and can differ by a small boundary/rounding term.
  The scale factor is calibrated on 2023 to remove a constant level offset.
- NOAA-20/21 rows remain sparse (Vietnam 258/378 rows). Platform-specific bias
  is not identifiable from the current pull.
- Three AOIs still cannot establish global transfer; LOO is the honest test and
  it fails for two of three regions.

## 6. Serving path (implemented)

HTS is now a first-class method, not a notebook:

- `python -m scripts.firms.build_hts_series` writes monthly HTS targets with an
  expanding cutoff (year `< Y` for historical years, fixed 2024 for 2024–25).
- `GET /api/firms/calendar?data=raw&method=hts` rescales MODIS-only cells to the
  HTS monthly target; VIIRS-observed cells are never changed. The same method
  works for `/export`, `/brief`, `/evidence`, `/explain-month` and `/ask`.
- `GET /api/firms/hts-status` reports the artifact, and every response carries
  `candidate=true`, `gate_passed=false` plus `effective_method=hts_anchor_v1`.
- The synthetic sample has no 1-degree tiles, so `method=hts&data=sample`
  returns **409** instead of inventing a result.
- Cold raw calendar ≈ 4 min (same pipeline as stat, 1.4M rows); a focused
  evidence month is ~4 s. Results are cached by data/method fingerprint.
- Frontend badge must say **candidate / chưa vượt gate 95%** when HTS is shown.

## 7. What to do next

1. Keep the candidate badge until a larger holdout pushes the CI upper bound
   below zero.
2. Do not scale TileFormer further. If the residual is revisited, the useful
   direction is more co-observed tile-months, not more layers.
3. Fetch NOAA-20/21 and more regions before claiming regional generalization.

## Next data pull (not mixed into this evidence)

Adding NOAA-20/21 or new regions changes every B2/HTS number, so it must be a
new benchmark cycle, not a silent merge. The downloader already supports it:

```bash
cd backend
# NOAA-20/21 for the three current AOIs (archive sources)
python -m scripts.firms.fetch_missing --aoi vietnam --start-year 2019 --end-year 2025 \
  --sources VIIRS_NOAA20_SP,VIIRS_NOAA21_SP --workers 4
python -m scripts.firms.fetch_missing --aoi amazon --start-year 2019 --end-year 2025 \
  --sources VIIRS_NOAA20_SP,VIIRS_NOAA21_SP --workers 4
python -m scripts.firms.fetch_missing --aoi australia --start-year 2019 --end-year 2025 \
  --sources VIIRS_NOAA20_SP,VIIRS_NOAA21_SP --workers 4
# then rebuild, re-evaluate and update docs in one commit
python -m scripts.firms.build_tiles && python -m scripts.firms.evaluate_hts
python -m scripts.firms.build_hts_series
```

New AOIs additionally need a bbox in `store.AOIS` and a new raw pull; do that
before any claim of regional generalization.

## Reproduce

```bash
cd backend
python -m scripts.firms.build_tiles          # 1.7 MB tile CSV
python -m scripts.firms.evaluate_hts         # HTS vs B2 on 72 rows
# python -m app.firms.sf_tile --epochs 120   # TileFormer + LOO (code removed)
python -m pytest tests/test_firms.py -q -k "T40 or T41 or T42 or T43"
```

## 8. Re-review after the "architecture or data" challenge

The earlier conclusion ("compute is not the bottleneck") was too narrow. A
second sweep separated data quality, loss, architecture and information source.

### 8.1 Is the error just counting noise?

For a Poisson count with mean λ, E|X−λ| ≈ √(2λ/π). On the 72 official
AOI-months this floor averages **95.5 MAE**, while B2 is **2,386.9** — about
**25× the irreducible noise**. At tile level the floor is 17.3 vs HTS 137.0
(8×). So the error is model/feature error, not only Poisson noise.

### 8.2 Loss and architecture sweep (rolling-origin, AOI aggregates)

Trained on tile-months before each cutoff; scored on that year's AOI-months
(2024–25 is the two-year holdout).

| Cutoff / test | B2 | HTS | HGB Poisson (count) | Ridge (log) | Poisson GLM | HGB log-ratio (tile) | **Spatial HGB** |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2021 | 2,211 | 1,721 | 8,289 | 2,690 | 1,867 | 1,565 | **1,014** |
| 2022 | 2,922 | 2,754 | 8,247 | 4,079 | 3,148 | 3,254 | **2,257** |
| 2023 | 2,079 | 1,460 | 7,530 | 2,199 | 1,450 | 1,876 | **1,265** |
| 2024–25 | 2,507 | 2,211 | 8,272 | 2,543 | 2,233 | 2,092 | **1,313** |

- Direct count losses did **not** help; HGB Poisson was unstable and badly
  over-predicted. Ridge and Poisson GLM were no better than HTS.
- A tile-level HGB on log-ratio beat HTS in 2021/2024 but lost in 2022/2023:
  architecture alone was not a reliable win.
- Adding **neighbouring-tile features** was the decisive change.

### 8.3 Spatial HGB — and the honest catch

Features add the eight neighbouring 1° tiles: same-month neighbour MODIS and
VIIRS, previous-month neighbour ratio, plus HTS anchor and tile climatology.

On the official 72 holdout months:

| Method | Pooled MAE | Vietnam | Amazon | Australia |
|---|---:|---:|---:|---:|
| B2 | 2,386.9 | 844.2 | 4,647.7 | 1,668.8 |
| HTS | 2,211.1 | 783.9 | 4,250.1 | 1,599.2 |
| **Spatial HGB** | **1,312.8** | **467.1** | **2,169.8** | **1,301.6** |
| Spatial HGB, forecast-safe | 2,302.5 | 644.5 | 4,439.1 | 1,823.8 |

- Spatial−B2 ΔMAE = **−1,074**, CI **[−1,832, −467]**, P=1.0; year-block CI
  [−1,765, −383].
- Spatial−HTS ΔMAE = **−898**, CI **[−1,516, −383]**, P=1.0.
- Spatial holdout (210 whole tiles never seen in training, 2024–25):
  **640.6 vs HTS 869.6**, better in all three AOIs. It is not tile memorisation.
- **Catch:** the forecast-safe variant (previous-month neighbour VIIRS only,
  no same-month neighbour VIIRS) scores **2,302.5**, *worse* than HTS. The entire
  gain comes from contemporaneous VIIRS in adjacent tiles.

That means the model is a **retrospective spatial imputation / gap-fill**, not a
better MODIS→VIIRS calibration. It is valid for a calendar that already contains
observed VIIRS in the month being reconstructed, and invalid for forecasting or
for months with no neighbouring VIIRS. The model card says this explicitly.

### 8.4 Revised conclusion

1. The old one-line conclusion was wrong: **feature/information design matters
   far more than adding parameters**. Spatial context cuts MAE ~45%.
2. More compute alone still does not help (22k→258k params changed little), and
   count-loss models were unstable. "Bigger model" is not the lever either.
3. The lever is **information**: observed neighbour VIIRS. Without it, HTS
   remains the most stable calibration baseline.
4. Data quality is not merely Poisson noise (25× floor), but sparse tile labels
   and missing platforms do add variance; a denser NOAA-20/21 pull would test
   whether the safe variant can recover part of the gain.

The retrospective spatial model and its artifact were removed on 2026-11-14
(non-served cleanup); the evidence above is historical and lives in git history.

## 9. STAN: a network tuned to the count/season/space structure

The audit challenge was right that the earlier model was a generic residual net
with patches. STAN (`app/firms/stan.py`) is designed from the problem:

| Problem property | STAN design |
|---|---|
| VIIRS detections are over-dispersed counts | negative-binomial (NB2) likelihood; mean = `anchor_count * exp(delta)`; Poisson ablation |
| annual cycle, short memory | 12-month window, dilated causal TCN (1/2/4) + **seasonal FiLM** modulation |
| need the target month, not generic context | learned **target-month query** cross-attends over the window (no 12×12 self-attention) |
| fire is spatially correlated | neighbour-tile context: same-month MODIS, previous-month VIIRS ratio; optional same-month neighbour VIIRS only in the retrospective twin |
| exposure differs | `days_modis` enters the sequence; anchor offset handles level |
| small n | 82k (d=64) / 171k (d=96) parameters, 5 seeds, early stop on 2023 |

### 9.1 Tuning (subset of 60 AOI-months, 3 seeds, 140 epochs)

| Variant | MAE | vs HTS |
|---|---:|---:|
| HTS anchor | 1,196 | — |
| STAN d=64, NB, FiLM, 3 layers | 1,150 | −47 |
| STAN d=32 | 1,131 | −65 |
| **STAN d=96** | **985** | **−211** (3-seed run) |
| no FiLM | 1,300 | +104 |
| 2 layers | 1,214 | +18 |
| 4 layers | 1,195 | −2 |
| Poisson instead of NB | 1,150 | −46 |
| forecast-safe (no same-month neighbour VIIRS) | 1,161 | −35 |

FiLM is the largest structural win; depth beyond 3 and Poisson-vs-NB are not.
d=96 is the selected width.

### 9.2 Official 72-month holdout (5 seeds, d=96)

| Variant | Pooled MAE | Vietnam | Amazon | Australia | Δ vs B2 | 95% CI vs B2 |
|---|---:|---:|---:|---:|---:|---|
| B2 | 2,386.9 | 844.2 | 4,647.7 | 1,668.8 | — | — |
| HTS | 2,211.1 | 783.9 | 4,250.1 | 1,599.2 | −175.8 | — |
| **STAN forecast-safe** | **2,128.7** | **646.0** | **4,151.9** | **1,588.2** | **−258.2** | **[−534.8, −19.1]** |
| STAN retrospective (uses neighbour VIIRS) | 2,170.1 | 730.6 | 4,190.9 | 1,588.9 | −216.8 | — |

STAN forecast-safe **beats B2 with a CI that excludes zero** and improves all
three AOIs. It beats HTS on the point estimate (Δ −82), but the HTS CI still
includes zero, so that comparison is not conclusive. Headline (VN+AM, 48):
2,398.9 vs B2 2,746.0 (−12.6%).

The retrospective twin is **not** better in the deterministic run (2,170.1), so
no retrospective gain is claimed. Earlier nondeterministic runs differed by
~40 MAE; the safe variant is the one reported.

### 9.2b Leave-one-region-out (train on 2 AOIs, test the third)

| Held out | STAN MAE | HTS MAE | B2 MAE | STAN−HTS CI |
|---|---:|---:|---:|---|
| Vietnam | 948.4 | **783.9** | 844.2 | [−122.3, +456.7] |
| Amazon | 5,292.9 | **4,250.1** | 4,647.7 | [−316.9, +2,875.5] |
| Australia | **1,594.8** | 1,599.2 | 1,668.8 | [−9.3, −0.4] |

Region transfer still fails for Vietnam and Amazon; Australia is a near-tie that
barely excludes zero. So the in-region gain is real, but a new region is not
solved — the same limitation as the HGB LOO.

### 9.3 Serving decision (product choice, with caveats)

STAN forecast-safe is now the **served main model** for raw data
(`method=stan`), by an explicit product decision:

- `GET /api/firms/calendar?data=raw&method=stan` rescales MODIS-only cells to
  the STAN monthly target; VIIRS-observed cells are untouched.
- The target series is `models/stan_series_raw.json`: **STAN for 2024+**, and
  **HTS fallback for earlier months** (STAN needs a 12-month window and an
  anchor fitted before the holdout).
- The synthetic sample has no 1° tiles, so STAN is disabled there (B2 anchor is
  used); `method=stan&data=sample` returns 409.
- `GET /api/firms/stan-status` reports `served=true, role=main`.
- Weights: `models/stan_safe_raw.pt` (sha256 in the JSON).

This is a product decision, not a claim that the statistical debate is closed:

1. STAN beats B2 with CI [−534.8, −19.1], and improves all three AOIs.
2. It only edges HTS on the point estimate; the HTS CI still includes zero.
3. LOO fails for Vietnam and Amazon; Australia is a near-tie. A new region is
   not solved.
4. Retrospective spatial HGB (section 8) is stronger (1,313) but requires
   observed neighbour VIIRS and is not a forecast.

### 9.4 Limits

- STAN needs a 12-month window; months without one fall back to HTS in the
  official evaluation (serve simulation), so the gain is diluted, not inflated.
- Three AOIs; leave-one-region-out for STAN is not yet run (the HGB LOO and
  spatial holdout are the current transfer evidence).
- NOAA-20/21 and cloud/overpass remain missing; no claim of physical detection
  probability.
