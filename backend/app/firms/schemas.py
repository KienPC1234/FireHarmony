"""Loose Pydantic v2 contract schemas for FIRMS API payloads (CLAIM-020).

Documentation + test validation only. NOT wired into routes (no
``response_model=``). Every model allows extras and every field is
Optional so a missing optional key never fails validation; tighten only
after the contract stabilises.
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


class _Loose(BaseModel):
    model_config = ConfigDict(extra="allow")


class CalendarMatrixEntry(_Loose):  # placeholder for matrix cell docs
    value: Optional[float] = None


class CalendarCalendar(_Loose):
    years: Optional[list[int]] = None
    months: Optional[list[int]] = None
    matrix: Optional[list[list[Optional[float]]]] = None
    anomalies: Optional[list[list[Optional[float]]]] = None
    row_totals: Optional[list[float]] = None
    col_medians: Optional[list[Optional[float]]] = None
    coverage: Optional[Any] = None
    eligible_mask: Optional[Any] = None
    z_unit: Optional[str] = None
    platform_mix: Optional[dict[str, Any]] = None
    anomaly_n_years: Optional[Any] = None
    anomaly_reason: Optional[Any] = None
    anomaly_eligibility: Optional[Any] = None
    anomaly_baseline: Optional[Any] = None
    completeness: Optional[dict[str, Any]] = None


class CriticalPeriod(_Loose):
    year: Optional[int] = None
    month: Optional[int] = None
    count: Optional[float] = None
    z: Optional[float] = None
    label: Optional[str] = None
    coverage_status: Optional[str] = None
    coverage_ratio: Optional[float] = None


class LatestSummary(_Loose):
    date: Optional[str] = None
    month: Optional[int] = None
    month_total: Optional[float] = None
    hist_median: Optional[float] = None
    hist_years: Optional[int] = None
    ratio: Optional[float] = None
    coverage_status: Optional[str] = None
    coverage_ratio: Optional[float] = None
    verdict: Optional[str] = None


class ForecastSummary(_Loose):
    year: Optional[int] = None
    month: Optional[int] = None
    median: Optional[float] = None
    p25: Optional[float] = None
    p75: Optional[float] = None
    n_years: Optional[int] = None
    method: Optional[str] = None


class CalendarResponse(_Loose):
    daily_cells: Optional[int] = None
    ratios: Optional[dict[str, Any]] = None
    calendar: Optional[CalendarCalendar] = None
    critical_periods: Optional[list[CriticalPeriod]] = None
    latest: Optional[LatestSummary] = None
    forecast: Optional[ForecastSummary] = None
    aoi: Optional[str] = None
    data: Optional[str] = None
    data_source: Optional[str] = None
    dataset: Optional[str] = None
    method_id: Optional[str] = None
    effective_method: Optional[str] = None
    ml_meta: Optional[Any] = None
    coverage: Optional[Any] = None
    platform_mix: Optional[dict[str, Any]] = None
    monthly: Optional[dict[str, Any]] = None
    filters: Optional[dict[str, Any]] = None
    validation_unit: Optional[str] = None
    spatial_validation: Optional[Any] = None
    anomaly_n_years: Optional[Any] = None
    anomaly_reason: Optional[Any] = None
    anomaly_eligibility: Optional[Any] = None
    anomaly_baseline: Optional[Any] = None
    empty_filter: Optional[bool] = None
    calibration: Optional[dict[str, Any]] = None
    qa: Optional[dict[str, Any]] = None
    bbox: Optional[str] = None
    daily: Optional[list[dict[str, Any]]] = None
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    geometry_hash: Optional[str] = None
    summary: Optional["CalendarSummary"] = None
    ms: Optional[float] = None


class CalendarSummary(_Loose):
    modis_detections: Optional[float] = None
    viirs_detections: Optional[float] = None
    sensor_detections_total: Optional[float] = None
    harmonized_total: Optional[float] = None
    paired_cells: Optional[int] = None
    modis_only_cells: Optional[int] = None
    viirs_only_cells: Optional[int] = None
    estimated_cells: Optional[int] = None
    estimated_index: Optional[float] = None
    n_daily_cells_total: Optional[int] = None
    n_daily_cells_returned: Optional[int] = None
    period: Optional[dict[str, Any]] = None
    source_scope: Optional[str] = None
    data_source: Optional[str] = None
    method: Optional[str] = None
    method_id: Optional[str] = None
    effective_method: Optional[str] = None
    filter_hash: Optional[str] = None
    filters: Optional[dict[str, Any]] = None
    note: Optional[str] = None


class MapCell(_Loose):
    cell_id: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    modis_count: Optional[float] = None
    viirs_count: Optional[float] = None
    harmonized_count: Optional[float] = None
    days: Optional[int] = None
    estimate_type: Optional[str] = None


class MapCellsResponse(_Loose):
    aoi: Optional[str] = None
    data: Optional[str] = None
    ym: Optional[str] = None
    zoom: Optional[int] = None
    bbox: Optional[str] = None
    geometry_hash: Optional[str] = None
    method_id: Optional[str] = None
    effective_method: Optional[str] = None
    cells: Optional[list[MapCell]] = None
    returned: Optional[int] = None
    total: Optional[int] = None
    preview: Optional[bool] = None
    aggregation_level: Optional[str] = None
    aggregation_note: Optional[str] = None
    capped_at: Optional[int] = None
    filter_hash: Optional[str] = None
    source_scope: Optional[str] = None
    from_date: Optional[str] = None
    to_date: Optional[str] = None


class SimRow(_Loose):
    sensor_config: Optional[str] = None
    allowed_platforms: Optional[list[str]] = None
    year: Optional[int] = None
    year_total: Optional[float] = None
    delta_vs_all: Optional[float] = None
    months: Optional[dict[str, Any]] = None
    k_measured_months: Optional[int] = None
    months_total: Optional[int] = None
    k_fallback: Optional[float] = None
    viirs_available: Optional[bool] = None
    modis_available: Optional[bool] = None
    observed_cells: Optional[int] = None
    estimated_cells: Optional[int] = None
    n_cells: Optional[int] = None
    dropped_cells: Optional[int] = None
    months_with_both_sensors: Optional[int] = None
    k_by_month: Optional[dict[str, Any]] = None
    ratio_mode: Optional[str] = None
    calendar: Optional[Any] = None


class SimResponse(_Loose):
    aoi: Optional[str] = None
    data: Optional[str] = None
    year: Optional[int] = None
    validation_unit: Optional[str] = None
    note: Optional[str] = None
    platforms_present: Optional[list[str]] = None
    coverage: Optional[Any] = None
    simulations: Optional[list[SimRow]] = None


class BlindSpotDay(_Loose):
    day: Optional[int] = None
    date: Optional[str] = None
    modis_requested: Optional[bool] = None
    viirs_requested: Optional[bool] = None
    modis_detections: Optional[int] = None
    viirs_detections: Optional[int] = None
    status: Optional[str] = None
    clear_sky_verified: Optional[bool] = None


class BlindSpotResponse(_Loose):
    aoi: Optional[str] = None
    data: Optional[str] = None
    ym: Optional[str] = None
    coverage_class: Optional[str] = None
    coverage: Optional[Any] = None
    paired_coverage_ratio: Optional[float] = None
    coverage_metric: Optional[str] = None
    observation_footprint: Optional[str] = None
    eligibility_threshold: Optional[float] = None
    status_counts: Optional[dict[str, Any]] = None
    days: Optional[list[BlindSpotDay]] = None
    note: Optional[str] = None


class SpatialResponse(_Loose):
    validation_kind: Optional[str] = None
    claim: Optional[str] = None
    coarse_cells: Optional[int] = None
    co_observed_cells: Optional[int] = None
    pearson: Optional[float] = None
    spearman: Optional[float] = None
    top_decile_jaccard: Optional[float] = None
    modis_only_coarse_cells: Optional[int] = None
    modis_detections: Optional[float] = None
    viirs_detections: Optional[float] = None
    mae_coarse_cell: Optional[float] = None
    aoi_month: Optional[str] = None
    res_deg: Optional[float] = None
    k_used: Optional[Any] = None


class BacktestMonthRow(_Loose):
    year: Optional[int] = None
    month: Optional[int] = None
    modis: Optional[float] = None
    viirs_ref: Optional[float] = None
    stan_pred: Optional[float] = None
    hts_pred: Optional[float] = None
    b2_pred: Optional[float] = None


class BacktestResponse(_Loose):
    aoi: Optional[str] = None
    data: Optional[str] = None
    data_source: Optional[str] = None
    evaluation_version: Optional[str] = None
    dataset_sha256: Optional[str] = None
    metrics: Optional[dict[str, Any]] = None
    pooled_metrics: Optional[dict[str, Any]] = None
    headline: Optional[Any] = None
    comparisons: Optional[dict[str, Any]] = None
    hgb_residual_enabled: Optional[bool] = None
    hgb_gate: Optional[Any] = None
    primary_method_id: Optional[str] = None
    primary_gate: Optional[Any] = None
    pooled_full_month: Optional[Any] = None
    excluded_months: Optional[Any] = None
    coverage_class: Optional[str] = None
    coverage: Optional[Any] = None
    n_test_full: Optional[int] = None
    note: Optional[str] = None
    hts: Optional[Any] = None
    hts_comparison: Optional[Any] = None
    hts_candidate: Optional[bool] = None
    spatial: Optional[Any] = None
    spatial_comparison: Optional[Any] = None
    spatial_retrospective: Optional[bool] = None
    stan: Optional[Any] = None
    stan_official: Optional[Any] = None
    stan_candidate: Optional[bool] = None
    evaluated: Optional[bool] = None
    scored_years: Optional[list[int]] = None
    candidate_holdout_years: Optional[list[int]] = None
    n_eval: Optional[int] = None
    n_eval_intersection: Optional[int] = None
    train_years: Optional[list[int]] = None
    test_years: Optional[list[int]] = None
    months: Optional[list[BacktestMonthRow]] = None


class HealthResponse(_Loose):
    status: Optional[str] = None
    torch: Optional[bool] = None
    service: Optional[str] = None
    uptime_s: Optional[float] = None
    primary_method_id: Optional[str] = None
    baseline_method_id: Optional[str] = None
    methods_available: Optional[Any] = None


class EvidenceResponse(_Loose):
    aoi: Optional[str] = None
    data: Optional[str] = None
    method_requested: Optional[str] = None
    method_id: Optional[str] = None
    effective_method: Optional[str] = None
    year: Optional[int] = None
    month: Optional[int] = None
    ym: Optional[str] = None
    total_activity_index: Optional[float] = None
    modis_detections: Optional[float] = None
    viirs_detections: Optional[float] = None
    observed_cells: Optional[int] = None
    estimated_cells: Optional[int] = None
    z: Optional[float] = None
    coverage: Optional[Any] = None
    calibration_window: Optional[Any] = None
    k_used: Optional[Any] = None


class XrayMonthRow(_Loose):
    year: Optional[int] = None
    month: Optional[int] = None
    modis_raw: Optional[float] = None
    viirs_ref: Optional[float] = None
    adjusted_stat: Optional[float] = None
    adjusted_calendar: Optional[float] = None
    k_used: Optional[float] = None
    ratio_source: Optional[str] = None


class XrayResponse(_Loose):
    aoi: Optional[str] = None
    data: Optional[str] = None
    data_source: Optional[str] = None
    units: Optional[str] = None
    evaluation_version: Optional[str] = None
    eval_unit: Optional[str] = None
    backtest_metrics: Optional[Any] = None
    primary_method_id: Optional[str] = None
    primary_gate: Optional[Any] = None
    stan_trained: Optional[bool] = None
    hts_trained: Optional[bool] = None
    months: Optional[list[XrayMonthRow]] = None


CalendarResponse.model_rebuild()
