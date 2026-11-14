# FIRMS model card — CrossSensorCalibrator + FireSeasonAE

- **CrossSensorCalibrator:** MLP residual 6→32→32→1 (~2.3k params). Input:
  [log1p(viirs_count), log1p(viirs_frp), log1p(climatology), month_sin, month_cos, lat/90].
  Target: MODIS-equivalent count on overlap cell-days. Loss: Huber. CPU-trainable
  in seconds; refuses (<16 pairs or no torch) and the statistical blend stands alone.
- **FireSeasonAE:** Conv1d autoencoder (1→8→4→8→1, ~0.4k params) over the 12-month
  harmonized season vector per cell-year. Score: MAE reconstruction error —
  flags unusual *season shapes* even when annual totals look normal.
- **Fallbacks:** no torch → statistical path only (`has_torch=false` in
  `GET /api/firms/dl-info`); thin data → `{"trained": false}` with reason.
  No model output is ever presented as a certified prediction — anomalies are
  ranked deviations from history, not forecasts.
- **Reproduce:** `pytest backend/tests/test_firms.py -q` (6 tests, no network, no GPU).
