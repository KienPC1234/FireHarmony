"""Tests for W2 math, coverage, registry gate, and explain fixes."""
from __future__ import annotations

import json
from pathlib import Path

from app.firms import calendar as cal
from app.firms import explain, harmonize, ml_core, registry


def test_verified_zero_fire_months_included_in_medians_and_loo():
    """Verified 0-detection months become 0.0 and enter col_medians/LOO; missing stay None."""
    # 5 years (2020..2024): Jan has detections in all 5 years.
    # Feb has detections in 2020 (10), 2021 (20), 2022 (30), 2023 (40),
    # and 0 detections in 2024 with verified full coverage -> 0.0.
    # Mar has detections in 2020 (10), 0 detections in 2021 with NO coverage -> None,
    # and 0 detections in 2022 with partial coverage -> None.
    daily_cells = [
        {"date": f"{y}-01-05", "harmonized_count": 100.0} for y in range(2020, 2025)
    ] + [
        {"date": "2020-02-10", "harmonized_count": 10.0},
        {"date": "2021-02-10", "harmonized_count": 20.0},
        {"date": "2022-02-10", "harmonized_count": 30.0},
        {"date": "2023-02-10", "harmonized_count": 40.0},
        {"date": "2020-03-10", "harmonized_count": 10.0},
    ]
    coverage = {
        "2024-02": {"paired_coverage_ratio": 1.0, "partial": False, "requested_days": 29},
        "2022-03": {"paired_coverage_ratio": 0.5, "partial": True, "requested_days": 15},
        # 2021-03 intentionally absent -> unrequested/missing
    }
    res = cal.build_calendar(daily_cells, coverage=coverage)
    years = res["years"]
    yi_2024 = years.index(2024)
    yi_2021 = years.index(2021)
    yi_2022 = years.index(2022)

    # Feb (index 1) for 2024 is verified zero-fire -> 0.0, eligible True
    assert res["matrix"][yi_2024][1] == 0.0
    assert res["eligible_mask"][yi_2024][1] is True
    # Mar (index 2) for 2021 (unrequested) and 2022 (partial) remain None
    assert res["matrix"][yi_2021][2] is None
    assert res["matrix"][yi_2022][2] is None

    # Feb values: [0.0, 10.0, 20.0, 30.0, 40.0] -> median = 20.0 (not 25.0!)
    assert res["col_medians"][1] == 20.0
    # LOO for 2024 Feb: others = [10, 20, 30, 40] (4 years >= 3), so anomaly is computed
    assert res["anomalies"][yi_2024][1] is not None
    assert res["anomaly_n_years"][yi_2024][1] == 4
    # LOO for 2023 Feb: others = [0, 10, 20, 30] -> includes 0.0 from 2024!
    yi_2023 = years.index(2023)
    assert res["anomaly_n_years"][yi_2023][1] == 4
    assert res["anomalies"][yi_2023][1] is not None


def test_apply_monthly_targets_and_reconfigure_update_per_km2():
    """Both rescaling and simulation recompute harmonized_per_km2 from harmonized_count / cell_km2."""
    cells = [
        {
            "date": "2024-03-01",
            "harmonized_count": 10.0,
            "harmonized_per_km2": 0.4,
            "cell_km2": 25.0,
            "estimate_type": "viirs_observed",
            "modis_platform_counts": {},
            "viirs_platform_counts": {"NPP": 10},
            "viirs_platform_frp": {"NPP": 50.0},
        },
        {
            "date": "2024-03-02",
            "harmonized_count": 5.0,
            "harmonized_per_km2": 0.2,
            "cell_km2": 25.0,
            "estimate_type": "modis_upscaled_estimated",
            "modis_platform_counts": {"Terra": 2},
            "viirs_platform_counts": {},
            "viirs_platform_frp": {},
        },
    ]
    out, _ = ml_core.apply_monthly_targets(
        [dict(c) for c in cells],
        {"2024-03": 35.0},
        estimate_label="stan_predicted",
        method_id="stan_safe_v1",
        requested="stan",
    )
    # Observed cell untouched
    assert out[0]["harmonized_count"] == 10.0
    assert out[0]["harmonized_per_km2"] == 0.4
    # Estimated cell rescaled from 5.0 -> 25.0; 25.0 / 25.0 = 1.0
    assert out[1]["harmonized_count"] == 25.0
    assert out[1]["harmonized_per_km2"] == round(25.0 / 25.0, 4)

    # Reconfigure to MODIS-only
    reconf, _ = harmonize.reconfigure_daily(cells, ["Terra"], label="modis_only")
    assert len(reconf) == 1
    expected_per_km2 = round(reconf[0]["harmonized_count"] / 25.0, 4)
    assert reconf[0]["harmonized_per_km2"] == expected_per_km2


def test_estimate_efficiency_ratio_tracks_active_viirs_platforms():
    """estimate_efficiency_ratio exposes per-month active_viirs_platforms and pooling flag."""
    records = [
        {"latitude": 12.0, "longitude": 106.0, "acq_date": "2024-03-01",
         "instrument": "MODIS", "satellite": "Terra", "frp": 10.0},
        {"latitude": 12.0, "longitude": 106.0, "acq_date": "2024-03-01",
         "instrument": "VIIRS", "satellite": "NPP", "frp": 5.0},
        {"latitude": 12.1, "longitude": 106.1, "acq_date": "2024-03-02",
         "instrument": "VIIRS", "satellite": "NOAA-20", "frp": 6.0},
        {"latitude": 12.2, "longitude": 106.2, "acq_date": "2024-03-03",
         "instrument": "VIIRS", "satellite": "NOAA-21", "frp": 7.0},
    ]
    agg = harmonize.aggregate(records)
    ratios = harmonize.estimate_efficiency_ratio(agg, min_months=1)
    assert ratios["_multi_satellite_pooling"] is True
    active = ratios["_active_viirs_platforms"]["2024-03"]
    assert active["count"] == 3
    assert active["platforms"] == ["NOAA-20", "NOAA-21", "NPP"]


def test_registry_stan_gate_honesty(tmp_path: Path):
    """registry.status() reports statistically_established=False when CI includes 0."""
    ev_file = tmp_path / "evaluation_raw.json"
    ev_file.write_text(json.dumps({
        "comparisons": {
            "stan_vs_b2": {"delta_mae": -563.1, "ci95": [-1184.36, 50.80]},
            "hts_vs_b2": {"delta_mae": -289.9, "ci95": [-835.40, 252.78]},
        }
    }), encoding="utf-8")
    st = registry.status(tmp_path)
    assert st["stan_gate_passed"] is False
    assert st["stan_statistically_established"] is False
    stan_row = next(m for m in st["models"] if m["method_id"] == "stan_safe_v1")
    assert stan_row["gate_passed"] is False
    assert stan_row["statistically_established"] is False
    assert "includes 0" in stan_row["note"]


def test_explain_no_spatial_hgb_and_respects_data_source():
    """explain.py does not emit 'Spatial HGB' or hardcoded synthetic demo on raw data."""
    cal_stub = {"years": [2020, 2024], "row_totals": [100.0, 120.0], "col_medians": [10.0] * 12}
    ratios_stub = {"_fallback": 0.35, "_n_months": 12, "_mode": "fusion"}

    facts_raw = explain.gather_facts(
        cal_stub, 50, ratios_stub, 200, "104,10,109,16",
        method="stan_safe_v1", data_mode="raw",
    )
    assert facts_raw["data_source"] == "NASA FIRMS observed"
    assert "synthetic demo" not in facts_raw["data_source"].lower()

    facts_default = explain.gather_facts(cal_stub, 50, ratios_stub, 200, "104,10,109,16")
    assert facts_default["data_source"] == "unspecified"

    for q in ("How accurate is it?", "Độ chính xác ra sao?"):
        res = explain.answer(q, dict(facts_raw), [], None, {})
        ans = res["answer"]
        assert "Spatial HGB" not in ans
        assert "synthetic demo" not in ans.lower()
