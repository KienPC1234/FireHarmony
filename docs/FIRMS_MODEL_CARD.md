# FIRMS model card — what is actually trained, on what, and how it scores

> All artifacts below are trained on the **dense synthetic sample** (168 overlap months/AOI),
> because the real NASA pulls are sparse 5-day snapshots (2–3 overlap months — training
> correctly refuses with `422 small_data`). Retrain on denser real data with the same
> commands whenever coverage allows; artifacts + metrics are replaced, code unchanged.

## HGB calibrator (`ml_hgb_v1`) — the one used by `?method=ml`

- **Model:** sklearn `HistGradientBoostingRegressor(max_iter=200, max_depth=3, random_state=7)`.
  Features per year-month: `[log1p(modis_count), month_sin, month_cos]` → target `log1p(viirs_count)`.
  Metrics reported in **original count space** (MAE / WAPE / bias).
- **Split:** temporal — last 3 distinct years = holdout, never used for fitting or baselines.
- **Baselines (same split):** B0 raw MODIS, B1 global median ratio (train), B2 per-month median ratio (train).
- **Holdout (synthetic sample):** vietnam ML MAE 10.52 vs B1 10.48 / B2 10.67;
  amazon 11.49 vs B2 11.58; australia 11.01 vs B2 9.07 — ML ≈ seasonal ratio, honestly reported.
- **Artifacts:** `backend/data/firms/models/cal_{aoi}.joblib + .json`
  (method_id, seed 7, train/test years, metrics, sklearn version, timestamp).
- **Reproduce:** `python -m scripts.firms.train_ml --aoi vietnam`
  (`--test-years 3`); served via `POST /api/firms/ml-train`, inspected via `GET /api/firms/ml-status`.

## SeasonTransformer (`ts_win12_v1`) — the one used by `?method=ts`

- **Model:** 12-month MODIS window → last-month VIIRS. TransformerEncoder
  (d_model 32, 4 heads, 2 layers, ff 64 — **17,633 params**), z-scored log target, Adam 120 epochs, CPU ~7 s.
- **Why windows:** fire seasons have memory (fuel/drought carryover) — the same MODIS count
  maps differently in dry vs wet season context. Sliding windows give ~157 samples/AOI
  (vs 14 yearly points), the only way to feed a sequence model here.
- **Split:** by window end-year, same holdout years as HGB for direct comparison.
- **Holdout (synthetic sample):** vietnam TS MAE 11.96 vs B2 11.10; amazon 12.54 vs B2 11.76;
  australia 10.27 vs B2 9.27 — the Transformer **does not beat the seasonal ratio** on 121
  training windows. Kept as an evaluated alternative (see `/xray`), not as a claimed win.
- **Artifacts:** `backend/data/firms/models/ts_{aoi}.pt + .json` (state_dict, log_mean/log_std, metrics).
- **Reproduce:** `python -m scripts.firms.train_ts --aoi vietnam` (`--test-years`, `--epochs`).

## Legacy / experimental (NOT used by any pipeline)

- **CrossSensorCalibrator (torch MLP, 1,313 params):** `POST /api/firms/train-calibrator` trains
  ephemerally and discards the model — kept only for the old experiment trail.
- **FireSeasonAE (Conv1d, 261 params):** defined, never trained — no anomaly claims from it.

## Backtest & X-Ray

- `GET /api/firms/backtest?aoi=&data=` — time-travel: hide VIIRS in holdout years, predict from
  MODIS, compare B0/B1/B2/ML/Transformer vs the VIIRS **sensor reference** (not fire ground truth).
- `GET /api/firms/xray?aoi=&data=` — MODIS raw vs VIIRS reference vs adjusted + holdout table.
- **Fallbacks:** no torch → statistical path only; thin data → `{"trained": false}` with reason;
  `data=raw` training attempts return `422`. No output is presented as a certified prediction.
- **Tests:** `pytest backend/tests/test_firms.py -q` (23 tests, no network, no GPU) + `python scripts/check_data.py`.
