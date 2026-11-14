# Audit-2 response — AI / SensorFormer

Scope: the second external audit of the submission ZIP. Each item is mapped to
the code change, the regression test, and the evidence a reviewer can rerun.

## Fixed

| Audit item | Fix | Test |
|---|---|---|
| **P0** validation leakage: B2 fit through 2023 while 2023 was validation | Two-phase protocol: selection fits B2/network on `< 2023`, validates on 2023; final refit uses `< 2024` for both anchor and network. Metadata records `selection.baseline_fit_years`, `validation_years`, `baseline_fit_years`. | `T36` asserts the 2023-06 Vietnam `b2_log` equals the `< 2023` median (1.21260) and differs from the leaky 1.18391. |
| **P0** early stopping ran with dropout on | `_val_mae()` switches to `model.eval()`, monitors MAE in hotspot counts, then the next epoch returns to `train()`. Epoch budget is stored per seed. | `T37` checks `model.training is False` after fit and that repeated validation MAE is identical. |
| **P1** `observed` feature was always 1.0 | Removed from `FEATURES` (now 5 features, `sf-features-v2`). Incomplete windows are dropped, never zero-filled. Model card states that no observation footprint exists in FIRMS CSV. | `T34` asserts `observed` is absent and the window shape is `(12, 5)`. |
| **P1** `median_interval_width` stored a mean | Both `mean_interval_width` and `median_interval_width` are stored; Methods page prints both with correct labels. New artifact: mean 8,894, median 4,296. | `T33` asserts `mean >= median > 0`. |
| **P1** “sensor-aware” overstated | Name kept for continuity, claims narrowed: context-conditioned residual, not full observation-bias physics. No cloud/footprint/overpass inputs. | `docs/SENSORFORMER.md` “Limits”. |
| **P1** `/sf-status` implied raw data was ready | Response now separates `model_artifact_available`, `live_data_available`, and `artifact` (hash/feature checks). | `T39`. |
| **P1** no dataset fingerprint | `dataset_sha256` (training pairs) and `evaluation_sha256` (evaluation manifest) are stored. | `T33`/metadata. |
| **P1** weights loaded without hash check | `artifact_status()` verifies SHA-256 and feature version; `load_artifact()` refuses a mismatch. | `T38` tampers with the weights and asserts rejection. |
| **P1** `train_years` included 2023 though fit stopped before it | `fit_years`, `validation_years`, `baseline_fit_years` are explicit; `train_years` is the final refit set (`< 2024`). | Metadata in `sf_lite_raw.json`. |
| **P1** quantile crossing unconstrained | Monotone head: `low = mid − softplus(a)`, `high = mid + softplus(b)`. | `T33` asserts `low <= mid <= high`; `quantile_crossings == 0`. |
| **P1** bootstrap treated AOI-months as independent | Added a year-block cluster bootstrap beside the row bootstrap; both are published. | `comparisons.sf_vs_b2_year_block`. |
| **P0 demo** raw calendar 404 on a clean ZIP | Calendar detects `raw_count == 0`, disables the raw option, falls back to the sample with a visible notice. Methods benchmark also falls back and labels the sample run. | Manual + Playwright smoke. |

## Retrained result (raw, 72 AOI-months)

| Method | MAE | Δ vs anchor | CI (row) | CI (year block) |
|---|---:|---:|---|---|
| Seasonal anchor | 2,386.9 | — | — | — |
| SensorFormer | 2,458.5 | +71.6 | [−46.7, +213.4] | [+33.9, +109.2] |

Gate stays OFF; the calendar serves the anchor and labels the state. This is the
honest outcome: the residual network still does not beat the anchor.

## Not fixed (data limits, stated as limits)

- Per-cell cloud masks, footprint overlap, view angles and overpass counts are
  not in the FIRMS CSV feed; the model cannot learn them.
- NOAA-20/21 rows are absent from the current raw pull, so platform-specific
  bias is not identifiable.
- The AOI embedding is a one-hot over three regions; leave-one-region-out
  remains future work.

## Reproduce

```bash
cd backend
python -m scripts.firms.train_sf --data raw --epochs 240
python -m scripts.firms.train_sf --data sample --epochs 240
python -m pytest tests/test_firms.py -q -k "T33 or T34 or T36 or T37 or T38 or T39"
```

## Follow-up work (post-audit)

The audit's core question was whether the model was region-limited and whether
more compute would help. Both were tested:

- `scripts.firms.build_tiles` creates 42,327 tile-months (3,924 windows) from
  the existing raw pull, removing the 231-window ceiling.
- HTS (hierarchical tile-seasonal anchor) reaches 2,230.7 MAE vs B2 2,386.9 on
  the 72 holdout rows, improving all three AOIs; CI [−362, +44], so it remains a
  candidate rather than a gated win.
- A region-agnostic TileFormer on CUDA does not beat HTS; scaling 22k → 258k
  parameters still loses. Compute was not the bottleneck.
- Full evidence: `docs/TILE_HIERARCHY.md`.
