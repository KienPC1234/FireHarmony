# Tile hierarchy: the strongest candidate, and why more GPU did not help

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

Architecture (`app/firms/sf_tile.py`):

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
python -m app.firms.sf_tile --epochs 120     # TileFormer + LOO (CUDA)
python -m pytest tests/test_firms.py -q -k "T40 or T41 or T42 or T43"
```
