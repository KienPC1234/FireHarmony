"""Evidence cards for one AOI-month (audit P2.6 / LLM grounding).

The card is computed from the same harmonized cells as the calendar, so the
LLM can only quote numbers that the dashboard can also show.
"""
from __future__ import annotations



def build_evidence(cal_out: dict, daily: list[dict], aoi: str, data: str,
                   method: str, year: int, month: int) -> dict:
    ym = f"{year}-{month:02d}"
    cells = [c for c in daily if str(c.get("date", ""))[:7] == ym]
    total = round(sum(float(c.get("harmonized_count", 0.0) or 0.0) for c in cells), 3)
    observed = sum(1 for c in cells if c.get("estimate_type") == "viirs_observed")
    # Any non-observed cell is an estimate, including the HTS/STAN labels
    # ("hts_predicted"). The old whitelist silently reported estimated_cells=0
    # for method=stan, which made a fully modelled month look fully observed.
    estimated = sum(1 for c in cells if c.get("estimate_type") != "viirs_observed")
    ml_cells = sum(1 for c in cells if c.get("estimate_type") == "ml_predicted")
    ts_cells = sum(1 for c in cells if c.get("estimate_type") == "ts_predicted")
    model_cells = sum(1 for c in cells
                      if c.get("estimate_type") in ("hts_predicted", "stan_predicted"))
    band_low = [float(c["harmonized_count_low"]) for c in cells
                if c.get("harmonized_count_low") is not None]
    band_high = [float(c["harmonized_count_high"]) for c in cells
                 if c.get("harmonized_count_high") is not None]
    band = ({"low": round(sum(band_low), 3), "high": round(sum(band_high), 3),
             "cells": len(band_low),
             "status": next((c.get("uncertainty_status") for c in cells
                             if c.get("uncertainty_status")), None)}
            if band_low and len(band_low) == len(band_high) else None)
    modis = sum(int(c.get("modis_count", 0) or 0) for c in cells)
    viirs = sum(int(c.get("viirs_count", 0) or 0) for c in cells)
    platforms: dict[str, int] = {}
    for c in cells:
        for sat, n in (c.get("platform_counts") or {}).items():
            platforms[str(sat)] = platforms.get(str(sat), 0) + int(n or 0)
    calendar = cal_out.get("calendar") or {}
    years = calendar.get("years") or []
    z = None
    anomaly_label = "no_data"
    if year in years:
        yi = years.index(year)
        z = (calendar.get("anomalies") or [])[yi][month - 1] if month <= 12 else None
        if z is not None:
            anomaly_label = ("above_history" if z >= 2 else
                             "below_history" if z <= -2 else "near_history")
    comp = (calendar.get("completeness") or {}).get(ym, {})
    ratios = cal_out.get("ratios") or {}
    k = ratios.get(ym, ratios.get("_fallback"))
    coverage = (cal_out.get("coverage") or {}).get("months_detail", {}).get(ym)
    if coverage is None:
        coverage = {"status": comp.get("coverage_status", "unknown"),
                    "paired_days": comp.get("paired_days"),
                    "coverage_ratio": comp.get("coverage_ratio"),
                    "coverage_by_sensor": comp.get("coverage_by_sensor"),
                    "coverage_class": comp.get("coverage_class", "unknown"),
                    "days_in_month": comp.get("days_in_month"),
                    "missing_days": comp.get("missing_days", [])}
    method_id = cal_out.get("method_id")
    cell_effective = next((c.get("effective_method") for c in cells
                           if c.get("effective_method")), None)
    effective = cell_effective or cal_out.get("effective_method") or method_id
    notes = [
        "Units are hotspot detections / sensor-adjusted activity index, not confirmed fires.",
        "VIIRS is authoritative where it recorded a detection; MODIS-only cells are estimates.",
        "Anomaly z uses a leave-one-year-out median/MAD baseline.",
    ]
    if not cells:
        notes.append("No harmonized cells for this month; missing data is not zero fire.")
    if comp.get("partial") is True:
        notes.append(f"Coverage is partial: {coverage.get('paired_days')} paired "
                     f"MODIS/VIIRS days of {coverage.get('days_in_month')}; "
                     f"missing {coverage.get('missing_days')}.")
    if method == "stan" and effective == "hts_anchor_v1":
        notes.append("This month predates 2024 and uses the HTS fallback; "
                     "STAN monthly targets start in 2024.")
    if band:
        notes.append(f"Model band ({band['status']}) for the estimated part: "
                     f"{band['low']}–{band['high']} activity-index units; it is a "
                     "predictive interval, not a confidence interval.")
    if platforms and len(platforms) > 1:
        notes.append("Multiple satellite platforms contributed; a platform change "
                     "is not the same as a fire change.")
    return {
        "aoi": aoi, "data": data, "method_requested": method,
        "method_id": method_id, "effective_method": effective,
        "year": year, "month": month, "ym": ym,
        "total_activity_index": total,
        "modis_detections": modis, "viirs_detections": viirs,
        "observed_cells": observed, "estimated_cells": estimated,
        "ml_predicted_cells": ml_cells, "ts_predicted_cells": ts_cells,
        "model_predicted_cells": model_cells,
        "model_band": band,
        "coverage": coverage,
        "z": z, "anomaly_label": anomaly_label,
        "k_used": k, "ratio_mode": ratios.get("_mode"),
        "calibration_window": ratios.get("_calibration_window"),
        "platform_counts": dict(sorted(platforms.items())),
        "data_source": cal_out.get("data_source"),
        "artifact_eval": (cal_out.get("ml_meta") or {}).get("unified_eval"),
        "citations": [
            f"/api/firms/calendar?aoi={aoi}&data={data}&method={method}",
            f"/api/firms/evidence?aoi={aoi}&data={data}&year={year}&month={month}",
            "/api/firms/backtest?data=" + data,
            "/api/firms/coverage?aoi=" + aoi,
        ],
        "notes": notes,
    }


def answer_month(ev: dict, vi: bool) -> str:
    cov = ev.get("coverage") or {}
    ratio = cov.get("coverage_ratio")
    covtxt = ("unknown" if ratio is None else
              f"{round(float(ratio) * 100)}% of days requested")
    plat = ", ".join(f"{k}:{v}" for k, v in ev.get("platform_counts", {}).items()) or "none"
    z = ev.get("z")
    ztxt = "no history" if z is None else f"z={z} ({ev.get('anomaly_label')})"
    if vi:
        return (
            f"Tháng {ev['ym']} của {ev['aoi']} ({ev['data']}): tổng chỉ số hoạt động "
            f"{ev['total_activity_index']} (KHÔNG phải số vụ cháy), từ "
            f"{ev['modis_detections']} detection MODIS và {ev['viirs_detections']} VIIRS. "
            f"{ev['observed_cells']} ô quan sát bởi VIIRS, {ev['estimated_cells']} ô ước lượng "
            f"(ML {ev['ml_predicted_cells']}, TS {ev['ts_predicted_cells']}). "
            f"Phương pháp yêu cầu `{ev['method_requested']}`, thực tế `{ev['effective_method']}`. "
            f"Coverage: {covtxt}; missing days {cov.get('missing_days', [])}. "
            f"Anomaly: {ztxt}. k dùng {ev.get('k_used')} ({ev.get('ratio_mode')}). "
            f"Nền tảng: {plat}. Nguồn: {ev.get('data_source')}. "
            f"Đây là chỉ số hoạt động điểm nóng, không phải số đám cháy xác nhận."
        )
    return (
        f"{ev['ym']} · {ev['aoi']} ({ev['data']}): activity index "
        f"{ev['total_activity_index']} (NOT fire counts), from {ev['modis_detections']} MODIS "
        f"and {ev['viirs_detections']} VIIRS detections. {ev['observed_cells']} VIIRS-observed "
        f"cells, {ev['estimated_cells']} estimated (ML {ev['ml_predicted_cells']}, "
        f"TS {ev['ts_predicted_cells']}). Requested method `{ev['method_requested']}` → "
        f"effective `{ev['effective_method']}`. Coverage: {covtxt}; missing days "
        f"{cov.get('missing_days', [])}. Anomaly: {ztxt}. k={ev.get('k_used')} "
        f"({ev.get('ratio_mode')}). Platforms: {plat}. Source: {ev.get('data_source')}. "
        f"Hotspot detections are not confirmed fires."
    )
