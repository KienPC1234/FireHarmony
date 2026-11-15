"""FIRMS harmonization tests — schema, harmonization, calendar, DL describe."""
from __future__ import annotations

import math
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.firms import calendar as cal
from app.firms import dl, harmonize
from app.firms import store as _store
from app.firms.schema import FirmsRecord
from app.main import app

client = TestClient(app)

BACKEND_DIR = Path(__file__).resolve().parents[1]

_DIST_INDEX = Path(__file__).resolve().parents[2] / "frontend" / "dist" / "index.html"
_RAW_AVAILABLE = (bool(list(_store.RAW_DIR.glob("*_*.csv")))
                  if _store.RAW_DIR.exists() else False) and \
                 os.getenv("FIRMS_SKIP_RAW") != "1"
_NEEDS_RAW = pytest.mark.skipif(not _RAW_AVAILABLE,
                                reason="raw FIRMS data not bundled; run fetch_full_month")
_NEEDS_DIST = pytest.mark.skipif(not _DIST_INDEX.exists() or
                                 os.getenv("FIRMS_SKIP_DIST") == "1",
                                 reason="frontend not built (or FIRMS_SKIP_DIST=1)")
try:  # CI serves with requirements-serve.txt, which has no torch
    import torch as _torch  # noqa: F401
    _HAS_TORCH = True
except Exception:
    _HAS_TORCH = False
_NEEDS_TORCH = pytest.mark.skipif(not _HAS_TORCH,
                                  reason="torch not installed (serving-only CI)")


def _recs() -> list[dict]:
    rows = []
    for i in range(10):
        rows.append({"latitude": 12.0 + i * 0.01, "longitude": 106.0,
                     "brightness": 320.0, "scan": 1.0, "track": 1.0,
                     "acq_date": "2019-03-05", "acq_time": "1330",
                     "satellite": "Terra", "instrument": "MODIS",
                     "confidence": "h", "version": "C6.1",
                     "bright_t31": 290.0, "frp": 12.0,
                     "daynight": "D", "type": 0})
    for i in range(30):
        rows.append({"latitude": 12.0 + i * 0.005, "longitude": 106.01,
                     "brightness": 310.0, "scan": 1.0, "track": 1.0,
                     "acq_date": "2019-03-05", "acq_time": "1345",
                     "satellite": "NPP", "instrument": "VIIRS",
                     "confidence": "n", "version": "V2",
                     "bright_t31": 285.0, "frp": 5.0,
                     "daynight": "D", "type": 0})
    return rows


def test_schema_qa():
    r = FirmsRecord(latitude=12.5, longitude=106.1, brightness=320.0,
                    scan=1.0, track=1.0, acq_date="2019-03-05",
                    acq_time="1330", satellite="Terra", instrument="MODIS",
                    confidence="h", version="C6.1", bright_t31=290.0,
                    frp=12.0, daynight="D", type=0)
    assert r.qa() == "keep"
    assert r.cell_id().count("_") == 1


def test_harmonize_blend_positive():
    agg = harmonize.aggregate(_recs())
    ratios = harmonize.estimate_efficiency_ratio(agg, min_months=1)
    daily = harmonize.harmonize_daily(agg, ratios)
    assert daily, "expected at least one harmonized cell"
    c = daily[0]
    assert c["harmonized_count"] >= c["modis_count"]
    assert c["harmonized_count"] < c["modis_count"] + c["viirs_count"] + 1e-9


def test_calendar_matrix_and_anomaly():
    # P0-10: completeness needs >=15 distinct days; use full months here.
    daily = [{"date": f"{y}-{m:02d}-{d:02d}",
              "harmonized_count": 10.0 + (50.0 if (y, m) == (2019, 3) else 0.0)}
             for y in (2016, 2017, 2018, 2019, 2020) for m in range(1, 13) for d in range(1, 21)]
    calen = cal.build_calendar(daily)
    assert calen["years"] == [2016, 2017, 2018, 2019, 2020]
    crit = cal.critical_periods(calen, z_thresh=1.5)
    assert any(p["year"] == 2019 and p["month"] == 3 for p in crit)


def test_models_endpoint_declares_one_primary():
    r = client.get("/api/firms/models")
    assert r.status_code == 200
    d = r.json()
    assert d["primary_method_id"] == "stan_safe_v1"
    primaries = [m for m in d["models"] if m["role"] == "primary"]
    assert len(primaries) == 1 and primaries[0]["method_id"] == "stan_safe_v1"
    assert set(d["served"]) == {"stan_safe_v1", "b2_seasonal_ratio",
                                "hts_anchor_v1"}
    assert client.get("/api/health").json()["primary_method_id"] == "stan_safe_v1"


def test_api_health_and_schema():
    assert client.get("/api/health").json()["status"] == "ok"
    assert "latitude" in client.get("/api/firms/schema").json()["fields"]


def test_api_validate_and_harmonize():
    v = client.post("/api/firms/validate", json={"records": _recs()}).json()
    assert v["clean"] == 40 and v["rejected"] == 0
    h = client.post("/api/firms/harmonize", json={"records": _recs()}).json()
    assert h["daily_cells"] >= 1
    assert h["calendar"]["years"] == [2019]


def test_dl_describe_names_one_primary_model():
    """The runtime advertises exactly one served model; prototypes are gone."""
    info = dl.describe()
    assert info["primary_method_id"] == "stan_safe_v1"
    assert info["active_served_model"].startswith("STAN")
    served = [m for m in info["models"] if m["used_in_pipeline"]]
    assert len(served) == 1 and served[0]["method_id"] == "stan_safe_v1"
    assert info["archived"] == []
    assert {m["method_id"] for m in info["models"]} == {
        "stan_safe_v1", "b2_seasonal_ratio", "hts_anchor_v1"}
    # The deleted torch prototypes must not silently come back.
    assert not hasattr(dl, "CrossSensorCalibrator")
    assert not hasattr(dl, "FireSeasonAE")


def test_api_bbox_filters_and_latest():
    full = client.get("/api/firms/calendar").json()
    assert full["calendar"]["years"] == list(range(2001, 2026))
    assert full["latest"]["date"].startswith("2025-")
    # AOI covering only the northern half roughly halves the cells
    north = client.get("/api/firms/calendar",
                       params={"bbox": "104,13,109,16"}).json()
    assert 0 < north["daily_cells"] < full["daily_cells"]
    assert north["bbox"] == "104,13,109,16"
    bad = client.get("/api/firms/calendar", params={"bbox": "1,2,3"})
    assert bad.status_code == 400
    empty = client.get("/api/firms/calendar", params={"bbox": "-10,-10,-5,-5"})
    assert empty.status_code == 404


def _same_cell_recs() -> list[dict]:
    base = {"latitude": 12.02, "longitude": 106.02, "brightness": 320.0,
            "scan": 1.0, "track": 1.0, "acq_date": "2019-03-05",
            "acq_time": "1330", "confidence": "h", "version": "C6.1",
            "bright_t31": 290.0, "frp": 10.0, "daynight": "D", "type": 0}
    rows = [{**base, "satellite": "Terra", "instrument": "MODIS", "frp": 12.0}]
    # 3 VIIRS detections in the same 0.05° cell but distinct sub-pixel spots
    # (dedup key rounds to 4 decimals, so offsets of 1e-4 survive dedup).
    rows += [{**base, "latitude": 12.02 + i * 0.0002, "longitude": 106.02 + i * 0.0002,
              "satellite": "NPP", "instrument": "VIIRS", "frp": 5.0}
             for i in range(3)]
    return rows


def test_forward_rule_uses_viirs_where_it_flew():
    """VIIRS authoritative on shared cells; MODIS-era upscaled by 1/k."""
    daily = harmonize.harmonize_daily(
        harmonize.aggregate(_same_cell_recs()), {"_fallback": 0.5})
    assert len(daily) == 1
    c = daily[0]
    assert c["harmonized_count"] == 3  # VIIRS kept, MODIS not added on top
    assert c["harmonized_frp"] == 15.0
    assert c["estimate_type"] == "viirs_observed"
    assert c["coverage_status"] == "observed"
    only_modis = harmonize.harmonize_daily(
        harmonize.aggregate([_same_cell_recs()[0]]), {"_fallback": 0.5})
    assert only_modis[0]["harmonized_count"] == 2.0  # 1 / 0.5, labeled estimated
    assert only_modis[0]["estimate_type"] == "modis_upscaled_estimated"
    assert only_modis[0]["harmonized_frp"] is None  # P0-06: count-k never rescales FRP
    assert only_modis[0]["coverage_status"] == "unknown"


def test_full_sample_era_consistent_and_catches_2019():
    """Guards the demo story: no 2012 step, 2019 anomaly is critical."""
    full = client.get("/api/firms/calendar").json()
    rt = full["calendar"]["row_totals"]
    ys = full["calendar"]["years"]
    pre = [t for y, t in zip(ys, rt) if y < 2012]
    post = [t for y, t in zip(ys, rt) if y >= 2012]
    ratio = (sum(post) / len(post)) / (sum(pre) / len(pre))
    assert 0.7 < ratio < 1.4, f"era step detected: {ratio}"
    assert any(p["year"] == 2019 and p["month"] in (2, 3)
               for p in full["critical_periods"]), "planted 2019 anomaly lost!"


def test_ask_answers_from_live_numbers():
    r = client.post("/api/firms/ask", json={"question": "Độ chính xác thế nào?"}).json()
    assert "era ratio" in r["answer"] or "Tỷ lệ" in r["answer"]
    assert str(r["facts"]["era_ratio"]) in r["answer"]  # no invented numbers
    assert r["suggestions"]
    r2 = client.post("/api/firms/ask", json={"question": "how does harmonization work?"}).json()
    assert "VIIRS" in r2["answer"]
    r3 = client.post("/api/firms/ask", json={"question": "blabla xyz"}).json()
    assert "gợi ý" in r3["answer"] or "suggestion" in r3["answer"]
    bad = client.post("/api/firms/ask", json={"question": ""})
    assert bad.status_code == 400


def test_aois_all_era_consistent_and_catch_their_anomalies():
    aois = client.get("/api/firms/aois").json()["aois"]
    assert {a["id"] for a in aois} == {"vietnam", "amazon", "australia"}
    expected = {"vietnam": {(2019, 2), (2019, 3)},
                "amazon": {(2019, 8), (2019, 9)},
                "australia": {(2019, 12), (2020, 1)}}
    for aoi in ("vietnam", "amazon", "australia"):
        cal = client.get("/api/firms/calendar", params={"aoi": aoi}).json()
        assert cal["calendar"]["years"] == list(range(2001, 2026)), aoi
        rt, ys = cal["calendar"]["row_totals"], cal["calendar"]["years"]
        pre = [t for y, t in zip(ys, rt) if y < 2012]
        post = [t for y, t in zip(ys, rt) if y >= 2012]
        ratio = (sum(post) / len(post)) / (sum(pre) / len(pre))
        assert 0.7 < ratio < 1.4, (aoi, ratio)
        hits = {(p["year"], p["month"]) for p in cal["critical_periods"]}
        assert expected[aoi] & hits, (aoi, hits)
    bad = client.get("/api/firms/calendar", params={"aoi": "atlantis"})
    assert bad.status_code == 400


def test_data_status_and_ingest_roundtrip(tmp_path):
    st = client.get("/api/firms/data-status").json()
    assert {d["aoi"] for d in st["datasets"]} == {"vietnam", "amazon", "australia"}
    assert all(d["sample_rows"] > 10000 for d in st["datasets"])
    sample = client.get("/api/firms/sample", params={"aoi": "amazon", "limit": 30}).json()
    assert sample["count"] == 30
    import io as _io
    buf = _io.StringIO()
    import csv as _csv
    w = _csv.DictWriter(buf, fieldnames=list(sample["records"][0].keys()))
    w.writeheader()
    w.writerows(sample["records"])
    files = {"file": ("amazon_test.csv", buf.getvalue(), "text/csv")}
    r = client.post("/api/firms/ingest", params={"aoi": "amazon", "source": "test"},
                    files=files).json()
    assert r["rows"] == 30 and r["clean"] == 30 and r["rejected"] == 0
    assert r["file"].startswith("amazon_test_")
    st2 = client.get("/api/firms/data-status").json()
    assert st2["raw_count"] >= 1
    from pathlib import Path as _P
    for f in (BACKEND_DIR / "data" / "firms" / "raw").glob("amazon_test_*.csv"):
        f.unlink()
    import json as _json
    from app.firms.store import MANIFEST as _M
    if _M.exists():
        entries = _json.loads(_M.read_text(encoding="utf-8"))
        _M.write_text(_json.dumps([e for e in entries if "test" not in e.get("source", "")],
                                  indent=1), encoding="utf-8")
    assert client.post("/api/firms/validate",
                       json={"records": sample["records"]}).json()["clean"] == 30


def test_raw_mode_merges_downloads(tmp_path, monkeypatch):
    import app.firms.store as store
    monkeypatch.setattr(store, "RAW_DIR", tmp_path)
    rows = ("latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,"
            "instrument,confidence,version,bright_t31,frp,daynight\n")
    body = (rows + "12.5,106.1,320.0,1.0,1.0,2019-03-05,1330,Terra,MODIS,h,C6.1,290.0,12.0,D\n")
    (tmp_path / "vietnam_MODIS_SP_2019-03-05_5d_abc123.csv").write_text(body)
    body2 = (rows + "12.5,106.1,310.0,1.0,1.0,2019-03-05,1345,NPP,VIIRS,n,V2,285.0,5.0,D\n")
    (tmp_path / "vietnam_VIIRS_SNPP_SP_2019-03-05_5d_def456.csv").write_text(body2)
    r = client.get("/api/firms/calendar",
                   params={"aoi": "vietnam", "data": "raw"}).json()
    assert r["daily_cells"] == 1
    assert r["calendar"]["years"] == [2019]
    assert r["daily"][0]["harmonized_count"] == 1  # VIIRS kept, MODIS not added
    bad = client.get("/api/firms/calendar", params={"data": "nope"})
    assert bad.status_code == 422


def test_forecast_is_same_month_history():
    full = client.get("/api/firms/calendar").json()
    f = full["forecast"]
    assert f["method"].startswith("seasonal-naive")
    assert f["n_years"] == len(full["calendar"]["years"])
    mi = f["month"] - 1
    col = sorted(full["calendar"]["matrix"][yi][mi] for yi in range(f["n_years"]))
    assert f["median"] == round(col[f["n_years"] // 2], 2)
    assert f["p25"] <= f["median"] <= f["p75"]


def test_brief_download_has_sections():
    r = client.get("/api/firms/brief", params={"aoi": "amazon"})
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    body = r.text
    # P0-10: sparse months are partial, so amazon's January climatology is
    # suppressed; the outlook line appears iff /calendar reports a forecast.
    for section in ("# Fire-activity brief", "Period:", "Top anomalous months", "## Limits & safety"):
        assert section in body, section
    f = client.get("/api/firms/calendar", params={"aoi": "amazon"}).json()["forecast"]
    assert ("Climatology outlook" in body) == (f is not None)
    if f is not None:
        assert "Climatology outlook" in body
    assert "2019-08" in body  # planted synthetic spike must be named
    assert "synthetic" in body.lower()
    assert "NOT" in body and "sole basis" in body


def test_no_noaa20_before_2018_04_in_samples():
    import csv
    from pathlib import Path
    for f in (BACKEND_DIR / "data" / "firms" / "samples").glob("*.csv"):
        with f.open() as fh:
            for r in csv.DictReader(fh):
                assert not (r["satellite"] == "NOAA-20" and r["acq_date"] < "2018-04-01"), f


def test_schema_rejects_bad_instrument_time_confidence():
    from app.firms.schema import FirmsRecord
    import pytest
    base = dict(latitude=12.5, longitude=106.1, brightness=320.0, scan=1.0, track=1.0,
                acq_date="2019-03-05", acq_time="1330", satellite="Terra", instrument="MODIS",
                confidence="h", version="C6.1", bright_t31=290.0, frp=12.0, daynight="D")
    with pytest.raises(Exception):
        FirmsRecord(**{**base, "instrument": "AVHRR"})
    with pytest.raises(Exception):
        FirmsRecord(**{**base, "acq_time": "2461"})
    with pytest.raises(Exception):
        FirmsRecord(**{**base, "confidence": "150"})
    r = FirmsRecord(**{**base, "type": None})
    assert r.type is None  # unknown type stays unknown, not 0


def test_partial_months_never_enter_anomaly_baseline():
    """Audit V6 P0-01: a verified-partial month cannot move a full month's z."""
    daily = []
    # Four full years at 100, four verified-partial years at 1.
    for y in (2018, 2019, 2020, 2021, 2022):
        daily.append({"date": f"{y}-01-10", "harmonized_count": 100.0})
    for y in (2014, 2015, 2016, 2017):
        daily.append({"date": f"{y}-01-10", "harmonized_count": 1.0})
    coverage = {}
    for y in (2018, 2019, 2020, 2021, 2022):
        coverage[f"{y}-01"] = {"status": "verified", "partial": False,
                               "paired_coverage_ratio": 1.0}
    for y in (2014, 2015, 2016, 2017):
        coverage[f"{y}-01"] = {"status": "verified", "partial": True,
                               "paired_coverage_ratio": 0.1}
    c = cal.build_calendar(daily, coverage=coverage)
    y2022 = c["years"].index(2022)
    assert c["anomalies"][y2022][0] == 0.0
    assert c["anomaly_reason"][y2022][0] is None
    y2017 = c["years"].index(2017)
    assert c["anomalies"][y2017][0] is None
    assert c["anomaly_reason"][y2017][0] == "ineligible_coverage"
    assert c["anomaly_eligibility"]["excluded_months"] == [
        "2014-01", "2015-01", "2016-01", "2017-01"]


def test_no_overlap_never_emits_zero_width_uncertainty():
    """Audit V6 P0-02: no co-observed months => no fake [x, x] band."""
    from app.firms.harmonize import DailyAgg, estimate_efficiency_ratio
    agg = {("10.00_104.00", "2020-01-02", "MODIS"): DailyAgg(count=1, frp=3.0)}
    ratios = estimate_efficiency_ratio(agg)
    assert ratios["_n_months"] == 0
    assert ratios["_calibration_status"] == "insufficient_overlap"
    rows = harmonize.harmonize_daily(agg, ratios)
    assert rows[0]["harmonized_count_low"] is None
    assert rows[0]["harmonized_count_high"] is None
    assert rows[0]["uncertainty_status"] == "not_calibrated"


def test_missing_months_are_null_not_zero():
    daily = [{"date": "2020-01-10", "harmonized_count": 5.0}]
    calen = cal.build_calendar(daily)
    assert calen["years"] == [2020]
    assert calen["matrix"][0][0] == 5.0
    assert all(v is None for v in calen["matrix"][0][1:])
    assert all(z is None for z in calen["anomalies"][0][1:])
    assert cal.critical_periods(calen) == []
    # forecast needs >=3 covered years for that month
    assert _forecast_like(calen) is None


def _forecast_like(calen):
    col = [calen["matrix"][yi][1] for yi in range(len(calen["years"]))
           if calen["matrix"][yi][1] is not None]
    return {"n": len(col)} if len(col) >= 3 else None


def test_dedup_across_overlapping_raw_files(tmp_path, monkeypatch):
    import app.firms.store as store
    monkeypatch.setattr(store, "RAW_DIR", tmp_path)
    header = ("latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,"
              "instrument,confidence,version,bright_t31,frp,daynight\n")
    body = (header + "12.5,106.1,320.0,1.0,1.0,2019-03-05,1330,Terra,MODIS,h,C6.1,290.0,12.0,D\n")
    (tmp_path / "vietnam_MODIS_a.csv").write_text(body)
    (tmp_path / "vietnam_MODIS_b.csv").write_text(body)
    rows = store.load_raw_merged("vietnam")
    assert len(rows) == 1  # same detection in 2 files counted once


def test_calendar_response_marks_synthetic_and_qa():
    full = client.get("/api/firms/calendar").json()
    assert "synthetic" in full["data_source"].lower()
    assert full["qa"]["clean"] > 10000
    assert full["forecast"]["method"].startswith("seasonal-naive climatology")
    assert full["calendar"].get("z_unit", "").startswith("robust MAD")


def test_ask_llm_grounded_or_fallback():
    r = client.post("/api/firms/ask-llm", json={"question": "Độ chính xác thế nào?"}).json()
    assert r["answer"] and isinstance(r["llm_used"], bool)
    assert "facts" in r and "suggestions" in r
    s = client.get("/api/firms/llm-status").json()
    assert s["provider"] == "ollama" and "model" in s


@pytest.mark.skipif(not _DIST_INDEX.exists(), reason="no SPA build")
def test_backtest_has_baselines_and_spa_fallback():
    b = client.get("/api/firms/backtest", params={"aoi": "vietnam", "data": "sample"}).json()
    metrics = b["metrics"]
    assert "b2_seasonal_ratio" in metrics
    assert b["eval_unit"].startswith("aoi-month")
    assert b["months"] and "b2_pred" in b["months"][0]
    assert client.get("/calendar").status_code == 200
    assert client.get("/logo.svg").headers["content-type"].startswith("image/svg")
    assert client.get("/api/does-not-exist").status_code == 404


def test_raw_interleave_is_representative(tmp_path, monkeypatch):
    import app.firms.store as store
    monkeypatch.setattr(store, "RAW_DIR", tmp_path)
    modis = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight\n" + \
        "12.5,106.1,320,1,1,2019-02-15,1330,Terra,MODIS,h,C6.1,290,12,D\n" * 50
    viirs = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n" + \
        "12.5,106.1,310,1,1,2019-02-15,1345,NPP,VIIRS,n,V2,285,5,D\n" * 50
    (tmp_path / "vietnam_MODIS_x.csv").write_text(modis)
    (tmp_path / "vietnam_VIIRS_y.csv").write_text(viirs)
    first25 = store.load_raw_merged("vietnam", 25)
    insts = {r["instrument"] for r in first25}
    assert insts == {"MODIS", "VIIRS"}  # prefix must mix sources, not one file


def _modis_rows(acq_dates: list[str], lat0: float = 12.0) -> list[dict]:
    return [{"latitude": lat0 + (i % 25) * 0.001, "longitude": 106.0,
             "brightness": 320.0, "scan": 1.0, "track": 1.0,
             "acq_date": d, "acq_time": "1330",
             "satellite": "Terra", "instrument": "MODIS",
             "confidence": "h", "version": "C6.1",
             "bright_t31": 290.0, "frp": 12.0,
             "daynight": "D", "type": 0}
            for i, d in enumerate(acq_dates)]


def test_xray_matches_calendar():
    """P0-02: xray adjusted_calendar == calendar month total (stat, same aoi/data)."""
    x = client.get("/api/firms/xray", params={"aoi": "vietnam", "data": "sample"}).json()
    c = client.get("/api/firms/calendar",
                   params={"aoi": "vietnam", "data": "sample", "method": "stat"}).json()
    assert x["months"], "xray must report overlap months"
    assert "adjusted_calendar" in x["months"][0]
    mat = {(y, mi + 1): c["calendar"]["matrix"][yi][mi]
           for yi, y in enumerate(c["calendar"]["years"]) for mi in range(12)}
    for mo in x["months"]:
        assert abs(mo["adjusted_calendar"] - mat[(mo["year"], mo["month"])]) < 0.02


def test_completeness_partial():
    """P0-06: detection days are not observation days.

    A POSTed 5-day record set has UNKNOWN observation coverage, so `partial`
    must be None (not True/False), while detection_days is 5. Verified
    coverage can still mark a month partial — tested separately.
    """
    rows = _modis_rows([f"2021-06-{d:02d}" for d in range(1, 6)])
    h = client.post("/api/firms/harmonize", json={"records": rows}).json()
    comp = h["calendar"]["completeness"]["2021-06"]
    assert comp["partial"] is None
    assert comp["coverage_status"] == "unknown"
    assert comp["detection_days"] == 5
    assert comp["observed_days"] is None
    assert comp["span"] == ["2021-06-01", "2021-06-05"]
    assert h["latest"] is None


def test_verified_coverage_marks_partial_not_detection_days():
    """P0-06: one detection day with full fetch coverage is NOT partial."""
    daily = [{"date": "2021-06-10", "harmonized_count": 5.0}]
    full = {"2021-06": {"status": "verified", "requested_days": 30,
                        "days_in_month": 30, "coverage_ratio": 1.0,
                        "missing_days": [], "partial": False}}
    c = cal.build_calendar(daily, coverage=full)
    assert c["completeness"]["2021-06"]["partial"] is False
    assert c["completeness"]["2021-06"]["detection_days"] == 1
    assert cal.critical_periods(c) == []  # only one year, z has no history
    sparse = {"2021-06": {"status": "verified", "requested_days": 5,
                          "days_in_month": 30, "coverage_ratio": 0.167,
                          "missing_days": list(range(6, 31)), "partial": True}}
    c2 = cal.build_calendar(daily, coverage=sparse)
    assert c2["completeness"]["2021-06"]["partial"] is True


def test_platform_mismatch_quarantined():
    """P0-12: MODIS on NPP is anachronistic -> rejected, never in daily."""
    row = {"latitude": 12.5, "longitude": 106.1, "brightness": 320.0,
           "scan": 1.0, "track": 1.0, "acq_date": "2019-03-05", "acq_time": "1330",
           "satellite": "NPP", "instrument": "MODIS",
           "confidence": "h", "version": "C6.1", "bright_t31": 290.0,
           "frp": 12.0, "daynight": "D", "type": 0}
    h = client.post("/api/firms/harmonize", json={"records": [row]}).json()
    assert h["qa"]["rejected"] == 1
    assert h["qa"]["qa_counts"].get("anachronistic_platform") == 1
    assert h["daily"] == []


def test_export_method_param():
    """P0-06: export honors method= and matches the dashboard; archived -> 422."""
    r = client.get("/api/firms/export", params={"aoi": "vietnam", "method": "stat"})
    assert r.status_code == 200
    assert "X-Data-Source" in r.headers
    assert "cell_id" in r.text.splitlines()[0]
    if _RAW_AVAILABLE:
        good = client.get("/api/firms/export",
                          params={"aoi": "vietnam", "data": "raw", "method": "hts"})
        assert good.status_code == 200
        assert "cell_km2" in good.text.splitlines()[0]
    removed = client.get("/api/firms/export",
                         params={"aoi": "vietnam", "method": "ml"})
    assert removed.status_code == 422
    bad2 = client.get("/api/firms/export",
                      params={"aoi": "vietnam", "data": "raw", "method": "nonsense"})
    assert bad2.status_code == 422


def test_equal_area_fields_present():
    r = client.get("/api/firms/calendar", params={"aoi": "vietnam"}).json()
    d0 = r["daily"][0]
    assert d0["cell_km2"] > 20 and d0["cell_km2"] < 40
    assert d0["harmonized_per_km2"] >= 0


def test_upload_dataset_roundtrip():
    sample = client.get("/api/firms/sample", params={"aoi": "vietnam", "limit": 30}).json()
    import io as _io, csv as _csv
    buf = _io.StringIO()
    w = _csv.DictWriter(buf, fieldnames=list(sample["records"][0].keys()))
    w.writeheader(); w.writerows(sample["records"])
    up = client.post("/api/firms/upload-dataset",
                     files={"file": ("mini.csv", buf.getvalue(), "text/csv")}).json()
    assert up["dataset_id"].startswith("upload:") and up["clean"] == 30
    cal = client.get("/api/firms/calendar", params={"dataset": up["dataset_id"]}).json()
    assert cal["dataset"] == up["dataset_id"]
    assert "user-uploaded" in cal["data_source"]
    bad = client.get("/api/firms/calendar", params={"dataset": "upload:deadbeefdeadbeef"})
    assert bad.status_code == 404


def test_noaa_abbrev_satellites_normalized_and_kept():
    from app.firms.schema import FirmsRecord
    for sat, inst in [("N20", "VIIRS"), ("N21", "VIIRS"), ("NPP", "VIIRS"),
                      ("Terra", "MODIS"), ("Aqua", "MODIS")]:
        r = FirmsRecord(latitude=12.5, longitude=106.1, brightness=320.0, scan=1.0,
                        track=1.0, acq_date="2026-11-05", acq_time="1330",
                        satellite=sat, instrument=inst, confidence="n", version="V2",
                        bright_t31=285.0, frp=5.0, daynight="D")
        assert r.qa() == "keep", (sat, r.qa())
    assert FirmsRecord(latitude=12.5, longitude=106.1, brightness=320.0, scan=1.0,
                       track=1.0, acq_date="2026-11-05", acq_time="1330",
                       satellite="N20", instrument="VIIRS", confidence="n", version="V2",
                       bright_t31=285.0, frp=5.0, daynight="D").satellite == "NOAA-20"


# ---------------------------------------------------------------------------
# Audit V4 regression tests (T01-T14). These are intentionally explicit about
# the failure modes the review found; each one fails on the pre-fix code.
# ---------------------------------------------------------------------------

def _synthetic_pairs(n_months: int = 48) -> list[dict]:
    pairs = []
    for i in range(n_months):
        y = 2019 + i // 12
        m = i % 12 + 1
        modis = 100 + 40 * ((m * 7) % 11) + i
        viirs = int(modis * 4.2 + 15 * math.sin(m))
        pairs.append({"year": y, "month": m, "modis": modis, "viirs": viirs,
                      "day_frac": 0.8, "terra_frac": 0.5})
    return pairs


def test_T03_full_month_windows_cover_every_day():
    """T03: 28/29/30/31-day months are fully requested, with no spill."""
    from scripts.firms.fetch_full_month import windows_for_month
    for year, month, last in [(2021, 2, 28), (2020, 2, 29), (2021, 4, 30),
                              (2021, 1, 31), (2021, 12, 31)]:
        wins = windows_for_month(year, month)
        covered = []
        for start, ndays in wins:
            assert 1 <= ndays <= 5
            assert start + ndays - 1 <= last
            covered += list(range(start, start + ndays))
        assert covered == list(range(1, last + 1)), (year, month, wins)


def test_T05_missing_month_is_null_not_zero():
    daily = [{"date": "2020-01-10", "harmonized_count": 5.0}]
    c = cal.build_calendar(daily)
    assert c["matrix"][0][0] == 5.0
    assert all(v is None for v in c["matrix"][0][1:])
    assert c["completeness"]["2020-01"]["coverage_status"] == "unknown"


def test_T07_unified_evaluation_manifest():
    """T07: every method is scored on the same IDs in one manifest."""
    from app.firms import evaluation
    m = evaluation.load_manifest("sample")
    if not m:
        pytest.skip("run scripts.firms.evaluate --data sample first")
    ids = [s["id"] for s in m["samples"]]
    assert len(ids) == len(set(ids)) == m["n_eval"]
    assert sum(i.get("n_eval", 0) for i in m["per_aoi"].values()) == m["n_eval"]
    assert set(m["pooled"]["metrics"]) <= set(m["methods"])
    verified = evaluation.verify_manifest(m)
    for method, got in verified["all"].items():
        want = m["pooled"]["metrics"][method]
        assert abs(got["mae"] - want["mae"]) < 1e-3


def test_T07b_unified_table_includes_the_primary_model():
    """The served model must be in the same table as its baselines."""
    from app.firms import evaluation
    m = evaluation.load_manifest("raw")
    if not m:
        pytest.skip("run scripts.firms.unify_eval --data raw first")
    assert m["evaluation_version"] == "eval-v4"
    assert m["primary_method_id"] == "stan_safe_v1"
    for method in evaluation.ARTIFACT_METHODS:
        assert method in m["methods"], method
        assert method in m["pooled"]["metrics"], method
    # Same sample IDs for every method: no per-model sample set.
    ids = [s["id"] for s in m["samples"]]
    assert len(ids) == len(set(ids)) == m["n_eval"]
    verified = evaluation.verify_manifest(m)
    for method, got in verified["all"].items():
        want = m["pooled"]["metrics"][method]
        assert abs(got["mae"] - want["mae"]) < 1e-3
    table = evaluation.unified_table("raw")
    assert table["available"] is True
    assert table["primary_method_id"] == "stan_safe_v1"


def test_T07c_registry_declares_exactly_one_primary():
    from app.firms import registry
    primary = [m for m in registry.MODELS if m["role"] == "primary"]
    assert len(primary) == 1
    assert primary[0]["method_id"] == registry.PRIMARY == "stan_safe_v1"
    assert registry.BASELINE in registry.served_methods()
    assert registry.FALLBACK in registry.served_methods()
    assert registry.archived() == []
    assert {m["method_id"] for m in registry.MODELS} == {
        "stan_safe_v1", "b2_seasonal_ratio", "hts_anchor_v1"}


def test_T07e_model_band_propagates_to_estimated_cells():
    """A model interval rescales only the estimated part, never VIIRS cells."""
    from app.firms.ml_core import apply_monthly_targets
    cells = [
        {"date": "2025-01-02", "harmonized_count": 10.0,
         "estimate_type": "viirs_observed"},
        {"date": "2025-01-03", "harmonized_count": 5.0,
         "estimate_type": "modis_upscaled_estimated"},
        {"date": "2025-01-04", "harmonized_count": 5.0,
         "estimate_type": "modis_upscaled_estimated"},
    ]
    out, diag = apply_monthly_targets(
        cells, {"2025-01": 30.0}, estimate_label="stan_predicted",
        method_id="stan_safe_v1", requested="stan", gate_passed=True,
        targets_low={"2025-01": 20.0}, targets_high={"2025-01": 40.0})
    assert diag["months_with_band"] == 1
    assert out[0]["harmonized_count"] == 10.0
    assert abs(sum(c["harmonized_count_low"] for c in out[1:]) - 10.0) < 1e-6
    assert abs(sum(c["harmonized_count_high"] for c in out[1:]) - 30.0) < 1e-6
    assert all(c["uncertainty_status"] == "model_band" for c in out[1:])
    assert out[1]["harmonized_count_low"] <= out[1]["harmonized_count"] \
        <= out[1]["harmonized_count_high"]


def test_T07f_stan_series_carries_a_measured_band():
    """The served STAN series publishes low/high + honest empirical coverage."""
    import json
    from app.firms import stan
    intervals = stan.interval_status()
    if not intervals.get("kind"):
        pytest.skip("regenerate stan_series_raw.json with intervals")
    bands = stan.bands("vietnam")
    assert bands, "no band for vietnam"
    for ym, (lo, hi) in list(bands.items())[:12]:
        assert 0 <= lo <= hi
    meta = json.loads((BACKEND_DIR / "data/firms/models/stan_series_raw.json")
                      .read_text(encoding="utf-8"))
    assert 0.0 <= meta["interval"]["validation_coverage80"] <= 1.0
    # Coverage is measured, not assumed: an 80% nominal band that undercovers
    # must say so instead of pretending.
    assert "empirical_coverage80" in meta["interval"]


def test_T07d_monthly_targets_conservation_is_shared():
    """STAN/HTS/ML/TS all use one rescale implementation."""
    from app.firms.ml_core import apply_monthly_targets
    cells = [
        {"date": "2025-01-02", "harmonized_count": 10.0,
         "estimate_type": "viirs_observed"},
        {"date": "2025-01-03", "harmonized_count": 5.0,
         "estimate_type": "modis_upscaled_estimated"},
        {"date": "2025-01-04", "harmonized_count": 5.0,
         "estimate_type": "modis_upscaled_estimated"},
    ]
    out, diag = apply_monthly_targets(
        cells, {"2025-01": 30.0}, estimate_label="stan_predicted",
        method_id="stan_safe_v1", requested="stan", gate_passed=True)
    assert out[0]["harmonized_count"] == 10.0  # observed cells untouched
    assert abs(sum(c["harmonized_count"] for c in out) - 30.0) < 1e-6
    assert out[1]["estimate_type"] == "stan_predicted"
    assert diag["months_scored"] == 1
    assert diag["conservation_max_abs_error"] < 1e-6


def test_T07g_evidence_counts_model_cells_and_band():
    """A STAN/hts_predicted cell is an estimate, not an observation."""
    from app.firms import evidence
    cells = [{"date": "2025-01-02", "harmonized_count": 10.0,
              "estimate_type": "hts_predicted",
              "effective_method": "stan_safe_v1",
              "harmonized_count_low": 8.0, "harmonized_count_high": 12.0,
              "uncertainty_status": "model_band"}]
    ev = evidence.build_evidence({}, cells, "vietnam", "raw", "stan", 2025, 1)
    assert ev["observed_cells"] == 0
    assert ev["estimated_cells"] == 1
    assert ev["model_predicted_cells"] == 1
    assert ev["model_band"]["low"] == 8.0 and ev["model_band"]["high"] == 12.0
    assert any("predictive interval" in n for n in ev["notes"])


def test_partial_month_never_gets_a_full_month_model_target(monkeypatch):
    """A verified-partial month keeps its statistical value, not the model target."""
    import app.main as _m
    monkeypatch.setattr(_m.cov, "coverage_for_aoi",
                        lambda aoi: {"2025-01": {"partial": True},
                                     "2025-02": {"partial": False}})
    kept, n, examples = _m._covered_targets(
        "vietnam", {"2025-01": 10.0, "2025-02": 20.0})
    assert kept == {"2025-02": 20.0}
    assert n == 1 and examples == ["2025-01"]


def test_T08b_artifact_flags_are_measured_not_hardcoded(tmp_path, monkeypatch):
    from app.firms import store
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    assert store.model_artifacts_ready("vietnam") is False
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "stan_series_raw.json").write_text("{}")
    assert store.model_artifacts_ready("vietnam") is True


def test_T08c_backtest_cache_key_tracks_artifact_rewrites(tmp_path, monkeypatch):
    from app.firms import evaluation
    monkeypatch.setattr(evaluation, "MODEL_DIR", tmp_path)
    p = tmp_path / "stan_series_raw.json"
    p.write_text('{"a": 1}')
    k1 = evaluation.cache_key("vietnam", "sample", 2)
    p.write_text('{"a": 2, "longer": true}')
    k2 = evaluation.cache_key("vietnam", "sample", 2)
    assert k1 != k2


def test_T08d_stale_tile_series_is_rejected(tmp_path, monkeypatch):
    """A series built from different tiles must 409, not serve quietly."""
    from fastapi import HTTPException
    import app.main as _m
    models = tmp_path / "models"
    tile = tmp_path / "data" / "firms" / "benchmark" / "tile_pairs_raw.csv"
    tile.parent.mkdir(parents=True)
    models.mkdir()
    tile.write_text("aoi,tile_id\nvietnam:v:0,1\n")
    (models / "stan_series_raw.json").write_text('{"dataset_sha256": "deadbeef"}')
    (models / "hts_series_raw.json").write_text('{"dataset_sha256": "deadbeef"}')
    monkeypatch.setattr(_m, "MODEL_DIR", models)
    monkeypatch.setattr(_m, "PROJECT_ROOT", tmp_path)
    with pytest.raises(HTTPException) as e:
        _m._block_raw_ml_ts("stan", "raw")
    assert e.value.status_code == 409
    with pytest.raises(HTTPException) as e2:
        _m._block_raw_ml_ts("hts", "raw")
    assert e2.value.status_code == 409


def test_T07h_primary_recommendation_tracks_the_gate():
    """Point-estimate winner and statistical significance are reported separately."""
    from app.firms import evaluation
    st = evaluation.primary_status("raw")
    if not st.get("evaluation_version"):
        pytest.skip("no raw evaluation manifest")
    assert st["recommended_primary"] in (
        "stan_safe_v1", "hts_anchor_v1", "b2_seasonal_ratio")
    assert isinstance(st["statistically_established"], bool)
    if st["recommended_primary"] != "b2_seasonal_ratio":
        assert st["delta_mae_vs_b2"] is not None and st["delta_mae_vs_b2"] < 0
        m = evaluation.load_manifest("raw")
        name = st["recommended_primary"]
        for info in (m.get("per_aoi") or {}).values():
            metrics = info.get("metrics") or {}
            assert metrics[name]["mae"] < metrics["b2_seasonal_ratio"]["mae"]


def test_T09_xray_uses_unified_manifest_not_legacy():
    """T09: xray scores the V4 manifest and never loads sample for raw."""
    x = client.get("/api/firms/xray", params={"aoi": "vietnam", "data": "sample"}).json()
    assert "backtest_metrics" in x
    assert "primary_gate" in x
    assert x["months"] and "ratio_source" in x["months"][0]
    if x.get("evaluation_version"):
        assert x["backtest_metrics"] is not None
        assert "b2_seasonal_ratio" in x["backtest_metrics"]


def test_T09a_backtest_uses_unified_manifest_for_served_predictions():
    """Published STAN/HTS rows and summaries come from eval-v4, not sidecars."""
    from app.firms import evaluation
    from app.main import _backtest_from_manifest

    manifest = evaluation.load_manifest("raw")
    assert manifest and manifest.get("n_eval") == 72
    payload = _backtest_from_manifest(manifest, "amazon", "raw", 2)
    sample = next(x for x in manifest["samples"] if x["aoi"] == "amazon")
    first = payload["months"][0]
    assert first["year"] == sample["year"] and first["month"] == sample["month"]
    assert first["stan_pred"] == sample["stan_safe_v1"]
    assert first["hts_pred"] == sample["hts_anchor_v1"]
    assert payload["stan_official"]["metrics"] == manifest["pooled"]["metrics"]["stan_safe_v1"]
    assert payload["stan"]["official"] == payload["stan_official"]
    assert payload["hts"]["metrics"] == manifest["pooled"]["metrics"]["hts_anchor_v1"]
    assert payload["hts"]["per_aoi"]["amazon"]["mae"] == (
        manifest["per_aoi"]["amazon"]["metrics"]["hts_anchor_v1"]["mae"])


def test_T09b_pipeline_facts_use_unified_manifest_for_official_metrics():
    """Evidence/LLM facts cannot read stale model-sidecar holdout summaries."""
    from app.firms import evaluation
    from app.firms.pipeline import _evaluation_facts

    manifest = evaluation.load_manifest("raw")
    facts = _evaluation_facts("amazon", "raw")
    expected = manifest["pooled"]["metrics"]["stan_safe_v1"]
    assert facts["stan_official"]["metrics"] == expected
    assert facts["stan_vs_b2"] == manifest["comparisons"]["stan_vs_b2"]
    assert facts["stan_per_aoi"]["stan"] == (
        manifest["per_aoi"]["amazon"]["metrics"]["stan_safe_v1"])


def test_T09c_xray_raw_metrics_not_overridden_by_training_sidecars(monkeypatch):
    """Raw X-Ray must publish the same AOI metrics as the eval-v4 backtest."""
    from app.firms import evaluation
    from app.routers import models

    manifest = evaluation.load_manifest("raw")
    assert manifest and manifest.get("n_eval") == 72
    monkeypatch.setattr(
        models, "_harmonize_stream",
        lambda *args, **kwargs: {
            "monthly": {"2024-01": {"modis": 100, "viirs": 250}},
            "calendar": {"years": [2024],
                         "matrix": [[250.0] + [None] * 11]},
        },
    )
    response = client.get("/api/firms/xray", params={"aoi": "amazon", "data": "raw"})
    assert response.status_code == 200
    actual = response.json()["backtest_metrics"]
    expected = manifest["per_aoi"]["amazon"]["metrics"]
    assert actual["stan_safe_v1"] == expected["stan_safe_v1"]
    assert actual["hts_anchor_v1"] == expected["hts_anchor_v1"]
    assert actual["b2_seasonal_ratio"] == expected["b2_seasonal_ratio"]


def test_T10_raw_absent_is_explicit_404(tmp_path, monkeypatch):
    import app.firms.store as store
    monkeypatch.setattr(store, "RAW_DIR", tmp_path)
    r = client.get("/api/firms/calendar", params={"aoi": "vietnam", "data": "raw"})
    assert r.status_code == 404
    body = r.json()
    detail = body.get("detail") or {}
    assert detail.get("error_code") == "no_raw_data"


def test_T11_export_matches_calendar():
    """T11: CSV monthly sums equal the calendar matrix for the same slice."""
    import csv as _csv
    import io as _io
    params = {"aoi": "vietnam", "data": "sample", "method": "stat",
              "bbox": "104,10,105,11"}
    calr = client.get("/api/firms/calendar", params={**params, "limit": 5000}).json()
    exp = client.get("/api/firms/export", params=params)
    assert exp.status_code == 200
    sums: dict[str, float] = {}
    for row in _csv.DictReader(_io.StringIO(exp.text)):
        ym = row["date"][:7]
        sums[ym] = sums.get(ym, 0.0) + float(row["harmonized_count"])
    years = calr["calendar"]["years"]
    for yi, y in enumerate(years):
        for mi in range(12):
            v = calr["calendar"]["matrix"][yi][mi]
            if v is None:
                continue
            got = round(sums.get(f"{y}-{mi + 1:02d}", 0.0), 2)
            assert abs(got - v) < 0.02, (y, mi + 1, got, v)


def test_T12_brief_matches_calendar_method_and_scope():
    b = client.get("/api/firms/brief", params={"aoi": "vietnam", "method": "stat"}).text
    assert "requested `stat`" in b
    assert "effective `seasonal_ratio_v1`" in b
    assert "Period:" in b
    assert "synthetic" in b.lower()


def test_T15_platform_mix_is_explicit():
    """T15: adding a platform must not look like more fire by default."""
    r = client.get("/api/firms/platform-series",
                   params={"aoi": "vietnam", "data": "sample"}).json()
    assert r["series"]
    for row in r["series"]:
        assert row["snpp_only"] <= row["all_platforms"]
        assert "N20" not in row["by_platform"]  # normalised to NOAA-20
    cal = client.get("/api/firms/calendar", params={"aoi": "vietnam"}).json()
    assert "platform_mix" in cal["calendar"]


@_NEEDS_DIST
def test_T16_production_smoke_routes_and_assets():
    assert client.get("/calendar").status_code == 200
    assert client.get("/method").status_code == 200
    logo = client.get("/logo.svg")
    assert logo.status_code == 200 and logo.headers["content-type"].startswith("image/svg")
    man = client.get("/manifest.webmanifest")
    assert man.status_code == 200
    csvr = client.get("/api/firms/export", params={"aoi": "vietnam", "method": "stat"})
    assert csvr.status_code == 200 and "cell_id" in csvr.text.splitlines()[0]


def test_T17_production_requires_admin_token(monkeypatch):
    """T17: APP_ENV=production with no ADMIN_TOKEN must not expose writes."""
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    r = client.get("/api/firms/backtest",
                   params={"aoi": "vietnam", "data": "sample", "refresh": 1})
    assert r.status_code == 503


@_NEEDS_RAW
def test_T18_provenance_traceable():
    """T18: metrics trace to a dataset hash and artifact id."""
    from app.firms import evaluation
    m = evaluation.load_manifest("raw")
    if not m:
        pytest.skip("no raw evaluation manifest")
    assert m["dataset_sha256"] and m["evaluation_version"]
    for s in m["samples"]:
        assert s["id"] == f"{s['aoi']}:{s['year']}-{s['month']:02d}"
    x = client.get("/api/firms/xray", params={"aoi": "vietnam", "data": "raw"}).json()
    assert x["evaluation_version"] == m["evaluation_version"]
    assert x["months"][0]["ratio_source"].startswith("train_only")


def test_T19_qa_and_platform_filters_are_explicit():
    rows = _recs()
    rows[0] = {**rows[0], "confidence": "l", "frp": 0.1}  # low confidence
    h = client.post("/api/firms/harmonize",
                    json={"records": rows, "qa_min": "nominal",
                          "platform_set": "all"}).json()
    assert h["filters"]["qa_min"] == "nominal"
    assert h["qa"]["filtered_low_confidence"] >= 1
    cal = client.get("/api/firms/calendar",
                     params={"aoi": "vietnam", "data": "sample",
                             "qa_min": "high", "platform_set": "snpp"}).json()
    assert cal["filters"]["qa_min"] == "high"
    assert cal["filters"]["platform_set"] == "snpp"
    assert cal["daily_cells"] > 0


def test_T20_evidence_card_and_explain_month():
    ev = client.get("/api/firms/evidence",
                    params={"aoi": "vietnam", "data": "sample",
                            "year": 2019, "month": 3}).json()
    assert ev["total_activity_index"] > 0
    assert ev["observed_cells"] + ev["estimated_cells"] > 0
    assert ev["citations"] and ev["notes"]
    r = client.post("/api/firms/explain-month",
                    json={"aoi": "vietnam", "data": "sample", "year": 2019,
                          "month": 3, "use_llm": False}).json()
    assert r["llm_used"] is False
    assert "evidence" in r and r["evidence"]["ym"] == "2019-03"
    assert "hotspot" in r["answer"].lower() or "điểm nóng" in r["answer"].lower()


def test_fetch_one_rejects_a_plaintext_api_error(monkeypatch):
    """An HTTP-200 error body must never be saved as a raw CSV."""
    from scripts.firms import fetch_firms as ff

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"Invalid MAP_KEY."

    monkeypatch.setattr(ff.urllib.request, "urlopen", lambda *a, **k: _Resp())
    monkeypatch.setattr(ff.time, "sleep", lambda _s: None)
    with pytest.raises(ff.FetchError):
        ff.fetch_one("k", "MODIS_SP", "1,2,3,4", 5, retries=2)


def test_T21_qa_summary_and_missing_interval_planner():
    from scripts.firms.fetch_missing import intervals
    assert intervals([31]) == [(31, 1)]
    assert intervals([1, 2, 3, 6, 7]) == [(1, 3), (6, 2)]
    q = client.get("/api/firms/qa-summary",
                   params={"aoi": "vietnam", "data": "sample"}).json()
    assert q["sampled_rows"] > 10000
    assert "by_confidence" in q and "warnings" in q


def test_T22_evidence_reports_coverage_unknown_for_sample():
    ev = client.get("/api/firms/evidence",
                    params={"aoi": "vietnam", "data": "sample",
                            "year": 2019, "month": 3}).json()
    assert ev["coverage"].get("status") in ("unknown", None)
    assert ev["ratio_mode"] in ("fusion", "predictive", None)


def test_T23_llm_grounding_guard_rejects_invented_large_numbers():
    from app.firms import llm
    ok, bad = llm._large_numbers_grounded("MAE 99999 on 2025", {"mae": 1282.6, "year": 2025})
    assert ok is False and "99999" in bad
    ok2, bad2 = llm._large_numbers_grounded("MAE 1282.6 on 2025", {"mae": 1282.6, "year": 2025})
    assert ok2 is True and bad2 == []


def test_T32_llm_guard_catches_wrong_small_numbers_and_percentages():
    """Audit V6 P0-07: a wrong 75 (below 1000) must not slip through."""
    from app.firms import llm
    facts = {"coverage_ratio": 0.62, "month_total": 64, "year": 2025}
    ok, bad = llm._large_numbers_grounded("Coverage is 75% this month.", facts)
    assert ok is False and "75" in bad
    ok2, _ = llm._large_numbers_grounded("Coverage is 62% this month.", facts)
    assert ok2 is True
    ok3, bad3 = llm._large_numbers_grounded("The total is 65 detections.", facts)
    assert ok3 is False and "65" in bad3


def test_T32b_streaming_llm_obeys_the_grounding_guard(monkeypatch):
    """Streaming must not emit a number the facts never contained."""
    import json
    from app.firms import llm

    class _Resp:
        def __init__(self, lines):
            self.lines = lines

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def __iter__(self):
            return iter(self.lines)

    payload = [json.dumps({"message": {"content": "MAE is 99999 detections."},
                           "done": False}).encode(),
               json.dumps({"done": True}).encode()]
    monkeypatch.setattr(llm.urllib.request, "urlopen",
                        lambda *a, **k: _Resp(payload))
    out = list(llm.stream_llm("how accurate?", {"mae": 1.0}, "rule answer"))
    assert out and out[-1]["delta"] == "rule answer"
    assert out[-1]["llm_used"] is False
    assert "ungrounded" in out[-1]["reason"]


def test_T35_srf_artifacts_were_removed():
    """SRF was deleted (srf.py + srf_raw.*); nothing may resurrect it."""
    assert not (BACKEND_DIR / "data/firms/models/srf_raw.pt").exists()
    assert not (BACKEND_DIR / "data/firms/models/srf_raw.json").exists()
    assert not (BACKEND_DIR / "app/firms/srf.py").exists()





def test_T40_hts_artifact_reconciles_its_model_specific_holdout():
    """A candidate's own MAE, B2 comparator, gain and CI must agree.

    This model-specific cohort need not equal the served-series holdout.
    A negative point gain is not a test failure; misreporting its sign is.
    """
    import json
    meta = json.loads((BACKEND_DIR / "data/firms/models/hts_anchor_raw.json")
                      .read_text(encoding="utf-8"))
    assert meta["method_id"] == "hts_anchor_v1"
    n = int(meta["n_test"])
    assert n > 0
    assert n == int(meta["metrics"]["n"]) == int(meta["b2_metrics"]["n"])
    assert n == sum(int(row["n"]) for row in meta["per_aoi"].values())
    delta = float(meta["hts_mae"]) - float(meta["b2_mae"])
    comparison = meta["comparisons"]["hts_vs_b2"]
    assert abs(float(comparison["delta_mae"]) - delta) < 0.05
    assert int(comparison["n"]) == n
    ci = comparison["ci95"]
    assert ci[0] <= float(comparison["delta_mae"]) <= ci[1]
    gain = -delta / float(meta["b2_mae"])
    assert abs(float(meta["mean_gain_vs_b2"]) - gain) < 0.0002
    assert meta["gate"]["passed"] is (gain >= 0.02 and ci[1] < 0)
    for row in meta["per_aoi"].values():
        assert abs(float(row["mae"]) - float(row["hts_mae"])) < 0.02

def test_T41_tileformer_artifacts_were_removed():
    """TileFormer training outputs were deleted; the tile dataset stays."""
    base = BACKEND_DIR / "data/firms/models"
    for name in ("tileformer_raw.json", "tileformer_d32.json",
                 "tileformer_d128.json"):
        assert not (base / name).exists(), name
    assert (base / "hts_anchor_raw.json").exists()


def test_T44_hts_status_labels_its_model_specific_result_truthfully():
    st = client.get("/api/firms/hts-status").json()
    assert st["trained"] is True
    assert st["candidate"] is True and st["served"] is False
    assert st["evaluation_protocol"] == "model_specific_candidate_holdout"
    assert int(st["n_test"]) == int(st["metrics"]["n"]) > 0
    assert st["gate"]["passed"] is False
    if float(st["hts_mae"]) > float(st["b2_mae"]):
        assert "underperforms" in st["status"]
    elif float(st["hts_mae"]) < float(st["b2_mae"]):
        assert "improves" in st["status"]
    else:
        assert "equals" in st["status"]

def test_T45_hts_requires_raw_and_corrects_only_estimated_cells():
    from app.firms import hts
    r = client.get("/api/firms/calendar",
                   params={"aoi": "vietnam", "data": "sample", "method": "hts"})
    assert r.status_code == 409
    # Observed VIIRS cells keep their count; MODIS-only cells are rescaled to
    # the monthly target (conservation is checked by the caller).
    cells = [
        {"date": "2025-01-02", "harmonized_count": 10.0,
         "estimate_type": "viirs_observed"},
        {"date": "2025-01-03", "harmonized_count": 5.0,
         "estimate_type": "modis_upscaled_estimated"},
        {"date": "2025-01-04", "harmonized_count": 5.0,
         "estimate_type": "modis_upscaled_estimated"},
    ]
    out, diag = hts.apply_monthly(cells, {"2025-01": 30.0})
    assert out[0]["harmonized_count"] == 10.0
    assert out[1]["estimate_type"] == "hts_predicted"
    total = sum(c["harmonized_count"] for c in out)
    assert abs(total - 30.0) < 1e-6
    assert diag["months_scored"] == 1 and diag["gate_passed"] is False


def test_T46_hts_series_is_expanding_and_hash_pinned():
    import hashlib
    import json
    base = BACKEND_DIR / "data/firms/models"
    series = json.loads((base / "hts_series_raw.json").read_text(encoding="utf-8"))
    assert series["months"]["vietnam"] > 150
    assert series["months"]["amazon"] > 80
    assert series["series"]["vietnam"]["2024-01"]["cutoff"] == 2024
    assert series["series"]["vietnam"]["2020-06"]["cutoff"] == 2020
    tile = BACKEND_DIR / "data/firms/benchmark/tile_pairs_raw.csv"
    assert hashlib.sha256(tile.read_bytes()).hexdigest() == series["dataset_sha256"]


@_NEEDS_RAW
def test_T47_hts_evidence_serves_a_candidate_month():
    ev = client.get("/api/firms/evidence",
                    params={"aoi": "vietnam", "data": "raw", "method": "hts",
                            "year": 2025, "month": 1}).json()
    assert ev["method_id"] == "hts_anchor_v1"
    assert ev["effective_method"] == "hts_anchor_v1"
    st = client.get("/api/firms/hts-status").json()
    assert st["series"]["available"] is True
    assert st["served"] is False and st["candidate"] is True


def test_T50_stan_safe_model_holdout_reports_its_actual_comparison():
    """Validate leakage flags and model-specific metrics without inventing a win."""
    import json
    meta = json.loads((BACKEND_DIR / "data/firms/models/stan_safe_raw.json")
                      .read_text(encoding="utf-8"))
    assert meta["variant"] == "forecast_safe"
    assert meta["retrospective"] is False
    assert meta["uses_neighbour_viirs_same_month"] is False
    off = meta["official"]
    n = int(off["n"])
    assert n > 0
    for method in ("metrics", "b2_metrics", "hts_metrics"):
        assert int(off[method]["n"]) == n
    for method in ("stan", "hts", "b2"):
        assert sum(int(row[method]["n"]) for row in off["per_aoi"].values()) == n
        metric = "metrics" if method == "stan" else f"{method}_metrics"
        pooled = sum(float(row[method]["mae"]) * int(row[method]["n"])
                     for row in off["per_aoi"].values()) / n
        assert abs(pooled - float(off[metric]["mae"])) < 0.02
    for compared, reference, key in (
        ("metrics", "b2_metrics", "stan_vs_b2"),
        ("metrics", "hts_metrics", "stan_vs_hts"),
    ):
        comp = off["comparisons"][key]
        actual_delta = float(off[compared]["mae"]) - float(off[reference]["mae"])
        assert abs(float(comp["delta_mae"]) - actual_delta) < 0.03
        assert int(comp["n"]) == n
        assert comp["ci95"][0] <= actual_delta <= comp["ci95"][1]
    retro = json.loads((BACKEND_DIR / "data/firms/models/stan_retro_raw.json")
                       .read_text(encoding="utf-8"))
    assert retro["retrospective"] is True
    assert retro["uses_neighbour_viirs_same_month"] is True
    loo = meta["loo_region"]
    assert set(loo) == {"vietnam", "amazon", "australia"}

def test_T51_stan_status_exposes_both_variants():
    st = client.get("/api/firms/stan-status").json()
    assert st["trained"] is True
    assert st["served"] is True and st["role"] == "main"
    assert st["safe"]["variant"] == "forecast_safe"
    assert st["retrospective"]["retrospective"] is True


def test_T52_stan_served_series_reconciles_to_served_series_holdout():
    """Recompute the served 72-row evaluation, not a different 60-row model run."""
    import csv
    import json
    import numpy as np
    base = BACKEND_DIR / "data/firms/models"
    series = json.loads((base / "stan_series_raw.json").read_text(encoding="utf-8"))
    evaluation = json.loads((base / "evaluation_raw.json").read_text(encoding="utf-8"))
    assert series["role"] == "main"
    assert series["months"]["vietnam"] > 150
    assert series["series"]["vietnam"]["2025-01"]["source"] == "stan"
    assert series["series"]["vietnam"]["2023-01"]["source"] == "hts"
    y, p = [], []
    with (BACKEND_DIR / "data/firms/benchmark/evaluation_samples_raw.csv").open(
            encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            ym = f"{r['year']}-{int(r['month']):02d}"
            tgt = series["series"][r["aoi"]].get(ym, {}).get("target")
            assert tgt is not None, (r["aoi"], ym)
            y.append(float(r["viirs_ref"]))
            p.append(float(tgt))
    assert len(y) == int(evaluation["n_eval"])
    served_metrics = evaluation["headline"]["metrics"]
    assert int(served_metrics["stan_safe_v1"]["n"]) == len(y)
    mae = float(np.mean(np.abs(np.array(p) - np.array(y))))
    assert abs(mae - float(served_metrics["stan_safe_v1"]["mae"])) < 0.02
    # STAN's model-specific official holdout may have a different cohort.
    # Its MAE must never be substituted for this served-series metric.

def test_T53_stan_rejects_the_synthetic_sample():
    r = client.get("/api/firms/evidence",
                   params={"aoi": "vietnam", "data": "sample", "method": "stan",
                           "year": 2025, "month": 1})
    assert r.status_code == 409


@_NEEDS_RAW
def test_T54_stan_method_serves_raw():
    ev = client.get("/api/firms/evidence",
                    params={"aoi": "vietnam", "data": "raw", "method": "stan",
                            "year": 2025, "month": 1}).json()
    assert ev["method_id"] == "stan_safe_v1"
    assert ev["effective_method"] == "stan_safe_v1"


def test_T24_dedup_and_qa_sensitivity_are_measured():
    from app.firms import harmonize
    rows = [
        {"instrument": "VIIRS", "satellite": "NPP", "acq_date": "2025-03-01",
         "acq_time": "1345", "latitude": 12.5, "longitude": 106.1,
         "version": "V2"},
        {"instrument": "VIIRS", "satellite": "NPP", "acq_date": "2025-03-01",
         "acq_time": "1346", "latitude": 12.5, "longitude": 106.1,
         "version": "V2"},
    ]
    out = harmonize.dedup_sensitivity(rows)
    assert out["unique_exact"] == 2
    assert out["unique_pixel_day"] == 1
    assert out["extra_merged_by_pixel_day"] == 1
    q = client.get("/api/firms/qa-summary",
                   params={"aoi": "vietnam", "data": "sample"}).json()
    assert set(q["retained_fraction"]) == {
        "qa_all", "qa_nominal", "qa_high", "platform_snpp"}
    d = client.get("/api/firms/dedup-sensitivity",
                   params={"aoi": "vietnam", "data": "sample",
                           "limit": 5000}).json()
    assert d["rows_examined"] > 0
    assert d["unique_pixel_day"] <= d["unique_exact"]


def test_T25_paired_sensor_coverage_not_union():
    """V5 P0-04: MODIS 31/31 + VIIRS 5/31 is NOT full harmonization coverage."""
    from app.firms import coverage
    c = coverage.coverage_from_day_sets(set(range(1, 32)), set(range(1, 6)), 31)
    assert c["union_days"] == 31
    assert c["paired_days"] == 5
    assert c["paired_coverage_ratio"] < 0.2
    assert c["coverage_status"] == "incomplete"
    assert c["partial"] is True


def test_T25b_nrt_windows_end_at_the_file_date_and_split_months():
    """NRT pulls cover the days BEFORE the date tag; archive pulls go forward."""
    from app.firms import coverage
    manifest = [
        {"aoi": "australia", "file": "australia_MODIS_NRT_2025-03-05_5d_aa.csv",
         "source": "MODIS_NRT", "days": 5},
        {"aoi": "australia", "file": "australia_MODIS_SP_2025-03-28_5d_bb.csv",
         "source": "MODIS_SP", "days": 5},
    ]
    days = coverage.requested_days("australia", manifest)
    assert days["2025-03"]["MODIS_NRT"] == {1, 2, 3, 4, 5}
    assert days["2025-03"]["MODIS_SP"] == {28, 29, 30, 31}
    assert days["2025-04"]["MODIS_SP"] == {1}


def test_T26_content_fingerprint_detects_same_size_edit(tmp_path, monkeypatch):
    """V5 P0-05: name+size+mtime is not identity; content SHA is."""
    import os
    import app.firms.store as store
    monkeypatch.setattr(store, "RAW_DIR", tmp_path)
    p = tmp_path / "vietnam_MODIS_test.csv"
    p.write_text("a,b\n1,2\n")
    fp1 = store.raw_fingerprint("vietnam", tmp_path)
    st = p.stat()
    p.write_text("a,b\n1,3\n")
    os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns))
    fp2 = store.raw_fingerprint("vietnam", tmp_path)
    assert fp1 != fp2


def test_T27_mission_simulator_and_blind_spots():
    sim = client.get("/api/firms/simulate", params={
        "aoi": "vietnam", "data": "sample", "year": 2019}).json()
    rows = {r["sensor_config"]: r for r in sim["simulations"]}
    assert rows["all_sensors"]["viirs_available"] is True
    assert rows["modis_only"]["viirs_available"] is False
    assert rows["modis_only"]["year_total"] < rows["all_sensors"]["year_total"]
    custom = client.get("/api/firms/simulate", params={
        "aoi": "vietnam", "data": "sample", "year": 2019,
        "sensors": "MODIS"}).json()["simulations"]
    row = next(r for r in custom if r["sensor_config"] == "custom")
    assert row["viirs_available"] is False and row["allowed_platforms"] == ["MODIS"]
    bs = client.get("/api/firms/blind-spots", params={
        "aoi": "vietnam", "data": "sample", "year": 2019, "month": 3}).json()
    assert bs["status_counts"].get("unknown_coverage") == 31
    assert bs["note"]


def test_T28_investigator_returns_tools_and_limits():
    r = client.post("/api/firms/investigate", json={
        "question": "Why is 2019 anomalous?", "aoi": "vietnam",
        "data": "sample", "year": 2019, "month": 3, "use_llm": False}).json()
    assert r["llm_used"] is False
    assert "calendar" in r["tools_used"] and "evidence" in r["tools_used"]
    assert r["limitations"] and r["evidence"]["ym"] == "2019-03"


def test_T29_spatial_coobservation_is_not_a_holdout():
    r = client.get("/api/firms/spatial-check", params={
        "aoi": "vietnam", "data": "sample", "year": 2019, "month": 3}).json()
    assert r["validation_kind"] == "co_observation_consistency"
    assert "NOT a spatial holdout" in r["claim"]
    assert r["coarse_cells"] > 0
    assert r["co_observed_cells"] > 0


def test_T30_cross_dataset_check_is_user_supplied_and_caveated():
    series = [{"year": 2019, "month": m, "burned_area": 100.0 + m} for m in range(1, 13)]
    r = client.post("/api/firms/cross-validate", json={
        "aoi": "vietnam", "data": "sample", "series": series}).json()
    assert r["available"] is True and r["n"] == 12
    assert "not independent ground truth" in r["caveat"]
    empty = client.post("/api/firms/cross-validate", json={
        "aoi": "vietnam", "data": "sample", "series": []}).json()
    assert empty["available"] is False and empty["reason"] == "no_series"


def test_T31_data_gap_ledger_is_explicit():
    from app.firms import coverage
    g = coverage.coverage_gaps("vietnam")
    assert g["verified"] is True
    assert isinstance(g["missing_months"], int) and g["missing_months"] >= 0
    if g["missing_months"] > 0:
        assert g["missing_by_year"]  # unfetched year/months, not quiet fire
    assert "not zero fire" in g["note"]
    r = client.get("/api/firms/coverage", params={"aoi": "amazon"}).json()
    assert "gaps" in r and r["gaps"] == coverage.coverage_gaps("amazon")
    assert r["gaps"]["verified"] is True
    assert "not zero fire" in r["gaps"]["note"]


# --------------------------------------------------------------------------
# Audit P0 contracts (UI/UX + data truth)
# --------------------------------------------------------------------------
def _cal(**kw):
    params = {"data": "sample", "aoi": "vietnam", "method": "stat"}
    params.update(kw)
    r = client.get("/api/firms/calendar", params=params)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def test_UX05_summary_is_invariant_to_limit():
    """The KPI must come from the full set, not the capped daily slice."""
    a = _cal(limit=10)["summary"]
    b = _cal(limit=100)["summary"]
    c = _cal(limit=5000)["summary"]
    for k in ("modis_detections", "viirs_detections",
              "sensor_detections_total", "paired_cells", "estimated_index",
              "n_daily_cells_total", "filter_hash"):
        assert a[k] == b[k] == c[k], k
    assert a["n_daily_cells_returned"] == 10
    assert b["n_daily_cells_returned"] == 100
    assert c["n_daily_cells_returned"] == 5000
    assert a["source_scope"] == "synthetic_demo_not_observed"
    assert "not fire counts" in a["note"]


def test_UX04_polygon_filters_beyond_bbox():
    poly = {"type": "Polygon",
            "coordinates": [[[104, 10], [109, 10], [106.5, 16], [104, 10]]]}
    base = _cal(limit=5000, bbox="104,10,109,16")
    tri = _cal(limit=5000, bbox="104,10,109,16", geometry=__import__("json").dumps(poly))
    assert tri["summary"]["n_daily_cells_total"] < base["summary"]["n_daily_cells_total"]
    assert tri["summary"]["filter_hash"] != base["summary"]["filter_hash"]
    assert tri["geometry_hash"] == base["geometry_hash"] == "none" or tri["geometry_hash"] != "none"


def test_UX04_map_cells_respect_polygon():
    import json as _json
    poly = {"type": "Polygon",
            "coordinates": [[[104, 10], [109, 10], [106.5, 16], [104, 10]]]}
    r = client.get("/api/firms/map-cells", params={
        "data": "sample", "aoi": "vietnam", "ym": "2015-03",
        "geometry": _json.dumps(poly), "max_cells": 200000})
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d["returned"] == d["total"] or d["preview"] is True
    assert d["returned"] <= d["total"]
    assert d["aggregation_level"].startswith("0.05deg")

    def inside(lon, lat):
        ring = poly["coordinates"][0]
        ins = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                ins = not ins
            j = i
        return ins
    assert all(inside(c["lon"], c["lat"]) for c in d["cells"])
    assert {c["date"] if "date" in c else "2015-03" for c in d["cells"]} == {"2015-03"}


def test_UX09_date_range_is_inclusive_and_month_safe():
    d = _cal(limit=5000, from_date="2019-01-01", to_date="2019-03-31")
    dates = [str(c["date"])[:10] for c in d["daily"]]
    assert dates and min(dates) >= "2019-01-01" and max(dates) <= "2019-03-31"
    assert d["summary"]["period"]["from"] == "2019-01"
    assert d["summary"]["period"]["to"] == "2019-03"
    # Leap February: 2020-02 must not spill into March.
    leap = _cal(limit=5000, from_date="2020-02-01", to_date="2020-02-29")
    assert all(str(c["date"]).startswith("2020-02") for c in leap["daily"])
    bad = client.get("/api/firms/calendar", params={
        "data": "sample", "from_date": "2020-03-01", "to_date": "2020-01-01"})
    assert bad.status_code == 400


def test_UX03_map_cells_has_explicit_scope_metadata():
    r = client.get("/api/firms/map-cells", params={
        "data": "sample", "aoi": "amazon", "ym": "2019-08", "max_cells": 50})
    assert r.status_code == 200
    d = r.json()
    assert d["total"] >= d["returned"] >= 1
    assert d["preview"] is (d["returned"] < d["total"])
    assert d["capped_at"] == 50
    assert d["filter_hash"]
    assert d["source_scope"] == "synthetic_demo_not_observed"


def test_UX01_raw_404_is_explicit_and_never_silently_served(monkeypatch):
    monkeypatch.setattr(_store, "raw_ready", lambda aoi: False)
    r = client.get("/api/firms/calendar", params={"data": "raw", "aoi": "vietnam"})
    assert r.status_code == 404
    body = r.json()["detail"]
    assert body["error_code"] == "no_raw_data"
    assert body["aoi"] == "vietnam"


def test_UX07_request_coverage_is_not_dataset_ready(monkeypatch):
    monkeypatch.setattr(_store, "raw_ready", lambda aoi: False)
    r = client.get("/api/firms/coverage", params={"aoi": "vietnam"})
    assert r.status_code == 200
    d = r.json()
    assert d["coverage_kind"] == "request_ledger_not_observation"
    assert d["observation_coverage"] == "unknown"
    assert d["dataset_ready"] is False
    if d["request_coverage"]:
        assert d["months"] > 0  # ledger exists, data does not


def test_UX14_empty_result_is_not_zero_fires():
    poly = {"type": "Polygon",
            "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
    import json as _json
    d = _cal(limit=100, bbox="104,10,109,16", geometry=_json.dumps(poly))
    assert d["summary"]["n_daily_cells_total"] == 0
    assert d["summary"]["sensor_detections_total"] == 0
    assert d["summary"]["estimated_index"] is None
    assert d["latest"] is None


def test_UX06_export_respects_the_same_filter_and_date_range():
    import csv as _csv
    import io as _io
    params = {"data": "sample", "aoi": "vietnam", "method": "stat",
              "from_date": "2019-01-01", "to_date": "2019-03-31",
              "bbox": "104,10,109,16", "limit": 2000000}
    r = client.get("/api/firms/export", params=params)
    assert r.status_code == 200
    rows = list(_csv.DictReader(_io.StringIO(r.text)))
    assert rows
    dates = [row["date"] for row in rows]
    assert min(dates) >= "2019-01-01" and max(dates) <= "2019-03-31"
    assert r.headers["X-Filter-Hash"]
    assert r.headers["X-From-Date"] == "2019-01-01"
    summary = _cal(limit=5000, from_date="2019-01-01",
                   to_date="2019-03-31", bbox="104,10,109,16")["summary"]
    assert len(rows) == summary["n_daily_cells_total"]
    assert r.headers["X-Filter-Hash"] == summary["filter_hash"]


def test_P1_09_export_original_detections_is_row_level():
    import csv as _csv
    import io as _io
    r = client.get("/api/firms/export-detections", params={
        "data": "sample", "aoi": "vietnam", "limit": 50,
        "from_date": "2019-01-01", "to_date": "2019-03-31"})
    assert r.status_code == 200
    assert r.headers["X-Row-Kind"] == "original_detection"
    rows = list(_csv.DictReader(_io.StringIO(r.text)))
    assert 0 < len(rows) <= 50
    assert {"latitude", "longitude", "acq_date", "instrument"} <= set(rows[0])
    assert all("2019-01-01" <= row["acq_date"] <= "2019-03-31" for row in rows)


def test_P0_03_geometry_is_stat_only_for_models():
    import json as _json
    poly = _json.dumps({"type": "Polygon",
                        "coordinates": [[[104, 10], [109, 10], [106.5, 16], [104, 10]]]})
    r = client.get("/api/firms/calendar", params={
        "data": "sample", "aoi": "vietnam", "method": "stan", "geometry": poly})
    assert r.status_code == 409
    assert r.json()["detail"]["error_code"] == "geometry_requires_stat_method"


def test_UX09_map_cells_respects_custom_day_range():
    full = client.get("/api/firms/map-cells", params={
        "data": "sample", "aoi": "vietnam", "ym": "2019-03"}).json()
    part = client.get("/api/firms/map-cells", params={
        "data": "sample", "aoi": "vietnam", "ym": "2019-03",
        "from_date": "2019-03-01", "to_date": "2019-03-10"}).json()
    assert part["total"] <= full["total"]
    assert part["from_date"] == "2019-03-01"
    assert part["to_date"] == "2019-03-10"
    assert max((c["days"] for c in part["cells"]), default=0) <= 10


def test_UX10_model_error_names_the_effective_constraint():
    r = client.get("/api/firms/calendar", params={
        "data": "sample", "aoi": "vietnam", "method": "stan"})
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert "requires raw NASA data" in detail
    assert "method=stat" in detail


def test_UX12_map_cells_echoes_zoom_and_aggregation():
    for zoom in (3, 6, 10):
        r = client.get("/api/firms/map-cells", params={
            "data": "sample", "aoi": "vietnam", "ym": "2019-03", "zoom": zoom})
        assert r.status_code == 200
        d = r.json()
        assert d["zoom"] == zoom
        assert d["aggregation_level"] == "0.05deg cell-month"
        assert "not fires" in d["aggregation_note"]


def test_P1_14_admin_fails_closed_in_production(monkeypatch):
    from fastapi import HTTPException
    from starlette.requests import Request
    from app.main import _require_admin
    req = Request({"type": "http", "headers": []})
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    with pytest.raises(HTTPException) as e:
        _require_admin(req)
    assert e.value.status_code == 503
    monkeypatch.setenv("ADMIN_TOKEN", "secret")
    with pytest.raises(HTTPException) as e2:
        _require_admin(req)
    assert e2.value.status_code == 403


def test_cache_key_cannot_escape_cache_dir(tmp_path, monkeypatch):
    """A bbox with `..`/`/` must stay inside CACHE_DIR, not write outside it."""
    monkeypatch.setattr(_store, "CACHE_DIR", tmp_path / "cache")
    key = "cal_vietnam_stat_fp_../../escaped"
    _store.cache_put(key, {"ok": True})
    assert _store.cache_get(key) == {"ok": True}
    assert not (tmp_path.parent / "escaped.json").exists()
    assert not (tmp_path / "escaped.json").exists()
    # ordinary tokens keep their stable, readable name
    assert _store._safe_cache_key("cal_vietnam_104,10,109,16") == "cal_vietnam_104,10,109,16"


def test_aggregate_rejects_unknown_instrument():
    """aggregate() and aggregate_iter() must agree: unknown != MODIS (P0-12)."""
    rows = _recs()
    bad = dict(rows[0], latitude=12.5, longitude=106.5, instrument="")
    typo = dict(rows[0], latitude=12.6, longitude=106.5, instrument="MODISX")
    agg = harmonize.aggregate(rows + [bad, typo])
    assert sum(a.count for a in agg.values()) == len(rows)
    modis = sum(a.count for (_, _, inst), a in agg.items() if inst == "MODIS")
    assert modis == 10



def _p1_rows_for_month(month: str, n_modis: int, n_viirs: int) -> list[str]:
    """Valid FIRMS rows: MODIS conf letters + VIIRS, spread over cell-days."""
    out = []
    for i in range(n_modis):
        out.append(f"12.{i:02d},106.1,320.0,1.0,1.0,{month}-05,1330,Terra,MODIS,h,C6.1,290.0,12.0,D,0")
    for i in range(n_viirs):
        out.append(f"13.{i:02d},106.2,310.0,1.0,1.0,{month}-06,1345,NPP,VIIRS,n,V2,285.0,5.0,D,0")
    return out


def test_P1_cache_serves_current_truth_labels(tmp_path, monkeypatch):
    """P1-1: disk cache must never return a pre-label payload.

    Fresh and cached calendar runs must both carry `uncertainty_label` on
    every daily cell and `_calibration_note` in ratios/calibration, and the
    cached payload must equal the fresh one.
    """
    import app.firms.store as store
    monkeypatch.setattr(store, "RAW_DIR", tmp_path)
    monkeypatch.setattr(store, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(store, "raw_fingerprint",
                        lambda aoi, raw_dir=None: "test-fp")
    header = ("latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,"
              "instrument,confidence,version,bright_t31,frp,daynight,type\n")
    body = []
    for m, nv in (("2024-01", 1), ("2024-02", 2), ("2024-03", 3), ("2024-04", 4)):
        body += _p1_rows_for_month(m, 2, nv)
    (tmp_path / "vietnam_test_20240101.csv").write_text(header + "\n".join(body) + "\n")
    params = {"aoi": "vietnam", "data": "raw", "method": "stat"}
    hits: list[str] = []
    orig_get = store.cache_get

    def _spy(key):
        v = orig_get(key)
        if v is not None:
            hits.append(key)
        return v

    monkeypatch.setattr(store, "cache_get", _spy)
    fresh = client.get("/api/firms/calendar", params=params).json()
    assert not hits  # first run computes
    assert "calibrated on 4 co-observed months" in fresh["calibration"]["_calibration_note"]
    assert "calibrated on 4 co-observed months" in fresh["ratios"]["_calibration_note"]
    assert fresh["daily"]
    assert all(c.get("uncertainty_label") for c in fresh["daily"])
    cached = client.get("/api/firms/calendar", params=params).json()
    assert hits  # second run is served from disk
    assert cached == fresh
    assert all(c.get("uncertainty_label") for c in cached["daily"])
    assert "calibrated on 4 co-observed months" in cached["calibration"]["_calibration_note"]
    assert harmonize.cache_behavior().startswith("beh-")
    assert harmonize.cache_behavior() == harmonize.cache_behavior()


def test_P1_export_detections_normalizes_numeric_confidence(tmp_path, monkeypatch):
    """P1-2: /export-detections must filter on FirmsRecord scales, not raw text.

    Real MODIS C6.1 NRT rows ship confidence as 0-100 ("54", "85", "30");
    the old raw-string compare dropped every numeric row under qa_min=high.
    Satellite aliases (SNPP, N) must count as NPP for platform_set=snpp.
    """
    import csv as _csv
    import io as _io
    import app.firms.store as store
    monkeypatch.setattr(store, "RAW_DIR", tmp_path)
    header = ("latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,"
              "instrument,confidence,version,bright_t31,frp,daynight,type\n")
    modis = "\n".join([
        "12.50,106.1,320.0,1.0,1.0,2024-01-05,1330,Terra,MODIS,54,C6.1,290.0,12.0,D,0",
        "12.51,106.1,320.0,1.0,1.0,2024-01-05,1330,Terra,MODIS,85,C6.1,290.0,12.0,D,0",
        "12.52,106.1,320.0,1.0,1.0,2024-01-05,1330,Terra,MODIS,30,C6.1,290.0,12.0,D,0",
    ])
    viirs = "\n".join([
        "12.60,106.2,310.0,1.0,1.0,2024-01-05,1345,SNPP,VIIRS,n,V2,285.0,5.0,D,0",
        "12.61,106.2,310.0,1.0,1.0,2024-01-05,1345,N,VIIRS,h,V2,285.0,5.0,D,0",
        "12.62,106.2,310.0,1.0,1.0,2024-01-05,1345,NOAA-20,VIIRS,n,V2,285.0,5.0,D,0",
    ])
    (tmp_path / "vietnam_MODIS_SP_2024-01-05_5d_a.csv").write_text(header + modis + "\n")
    (tmp_path / "vietnam_VIIRS_SNPP_SP_2024-01-05_5d_b.csv").write_text(header + viirs + "\n")

    def _get(**kw):
        r = client.get("/api/firms/export-detections",
                       params={"aoi": "vietnam", "data": "raw", **kw})
        assert r.status_code == 200, r.text[:300]
        return list(_csv.DictReader(_io.StringIO(r.text)))

    high = _get(qa_min="high")
    confs = {(row["latitude"], row["confidence"]) for row in high}
    assert ("12.51", "85") in confs  # numeric 85 -> h: kept (old code dropped it)
    assert ("12.61", "h") in confs  # sat alias N: kept
    assert all(row["confidence"] not in ("n", "54", "30") or row["latitude"] == "12.51"
               for row in high)
    assert not any(row["latitude"] in ("12.50", "12.52", "12.60", "12.62")
                   for row in high)
    nominal = _get(qa_min="nominal")
    assert {row["latitude"] for row in nominal} == {"12.50", "12.51", "12.60", "12.61", "12.62"}
    snpp = _get(platform_set="snpp")
    assert {row["latitude"] for row in snpp} == {"12.50", "12.51", "12.52", "12.60", "12.61"}


@_NEEDS_RAW
def test_P1_export_detections_high_on_vietnam_2024_01_raw():
    """P1-2 on real data: Vietnam 2024-01 keeps ~3377 rows under qa_min=high.

    Independent FirmsRecord-scale count on 2026-11-14: 58848 deduped rows,
    3377 with normalized confidence h (raw MODIS letters h + numerics >= 80).
    The old raw-string compare kept 44878 under high (every letter n/h row,
    while dropping ~1551 numeric-confidence detections >= 80) — it disagreed
    with the harmonize path, where high means normalized h only.
    """
    import csv as _csv
    import io as _io
    r = client.get("/api/firms/export-detections", params={
        "aoi": "vietnam", "data": "raw", "qa_min": "high",
        "from_date": "2024-01-01", "to_date": "2024-01-31", "limit": 2000000})
    assert r.status_code == 200, r.text[:300]
    rows = list(_csv.DictReader(_io.StringIO(r.text)))
    assert 3300 <= len(rows) <= 3450, len(rows)


def test_P1_ingest_visible_to_month_fast_path(tmp_path, monkeypatch):
    """P1-6: ingested uploads must survive the ym/year filename fast-path.

    POST /ingest writes `{aoi}_{src}_{stamp}_{digest}.csv` (no YYYY-MM tag),
    which the old `_{ym}-` filter excluded entirely. Manifest-listed files
    are now scanned with row-level date filtering instead.
    """
    import app.firms.store as store
    monkeypatch.setattr(store, "RAW_DIR", tmp_path)
    monkeypatch.setattr(store, "MANIFEST", tmp_path / "manifest.json")
    header = ("latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,"
              "instrument,confidence,version,bright_t31,frp,daynight,type\n")
    body = "\n".join(
        f"12.5{i},106.1,320.0,1.0,1.0,2024-02-05,1330,Terra,MODIS,h,C6.1,290.0,12.0,D,0"
        for i in range(5))
    rep = store.ingest_upload("small.csv", (header + body + "\n").encode(),
                              "vietnam", source="upload")
    assert rep["clean"] == 5 and rep["file"].startswith("vietnam_upload_")
    assert len(list(store.iter_raw_rows("vietnam", raw_dir=tmp_path))) == 5
    assert len(list(store.iter_raw_rows("vietnam", raw_dir=tmp_path, ym="2024-02"))) == 5
    assert list(store.iter_raw_rows("vietnam", raw_dir=tmp_path, ym="2024-01")) == []
    assert len(list(store.iter_raw_rows("vietnam", raw_dir=tmp_path, year=2024))) == 5


def test_CLAIM022_ops_caps_and_elapsed_header_are_served():
    """CLAIM-022 docs lock: caps + X-Elapsed-Ms must match the published docs.

    daily slice 5000 (min(limit, 5000)), map-cells max 200k, /validate max
    50k, geometry max 200kB / 5k vertices, every response carries X-Elapsed-Ms.
    """
    import json as _json
    # X-Elapsed-Ms on a cheap path.
    r = client.get("/api/health")
    assert r.status_code == 200
    assert "x-elapsed-ms" in {k.lower() for k in r.headers}
    # /validate cap: 50k rows max.
    big = [{"latitude": 12.5, "longitude": 106.1, "acq_date": "2024-01-05",
            "acq_time": "1330", "satellite": "Terra", "instrument": "MODIS",
            "confidence": "h"}] * 50001
    rv = client.post("/api/firms/validate", json={"records": big})
    assert rv.status_code == 400
    # geometry payload/vertex caps (unit-level: 5k-vertex polygons never
    # survive httpx query limits, so lock the parser directly).
    from fastapi import HTTPException as _HTTPException
    from app.main import _parse_geometry as _parse_geom
    try:
        _parse_geom(" " * 200001)
        raise AssertionError("expected 400 for >200kB geometry")
    except _HTTPException as e:
        assert e.status_code == 400
    many = [[104.0 + (i % 100) * 0.05, 10.0 + (i // 100) * 0.05] for i in range(5001)]
    many.append(many[0])
    try:
        _parse_geom(_json.dumps({"type": "Polygon", "coordinates": [many]}))
        raise AssertionError("expected 400 for >5000 vertices")
    except _HTTPException as e:
        assert e.status_code == 400
        assert "vertices" in e.detail
    # map-cells cap: max_cells <= 200000.
    rm = client.get("/api/firms/map-cells", params={
        "data": "sample", "aoi": "vietnam", "ym": "2019-03", "max_cells": 200001})
    assert rm.status_code == 422
    # custom geometry on sample still forces stat: no 409 for method=stat,
    # and empty ocean polygon is an empty 200 (not zero fires, latest None).
    ocean = _json.dumps({"type": "Polygon",
                         "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]})
    d = client.get("/api/firms/calendar", params={
        "data": "sample", "aoi": "vietnam", "method": "stat",
        "geometry": ocean, "limit": 100}).json()
    assert d["summary"]["n_daily_cells_total"] == 0
    assert d["summary"]["estimated_index"] is None
    assert d["latest"] is None


def test_CLAIM020_custom_aoi_with_manifest_serves_stat(tmp_path, monkeypatch):
    """CLAIM-020: a new AOI with manifest entries serves stat (200) and
    data-status reports dataset_ready; unknown ids stay 404 no_raw_data."""
    import json as _json
    header = ("latitude,longitude,brightness,scan,track,acq_date,acq_time,"
              "satellite,instrument,confidence,version,bright_t31,frp,daynight\n")
    modis = (header + "10.5,20.5,320.0,1.0,1.0,2021-06-15,1330,Terra,MODIS,h,"
             "C6.1,290.0,12.0,D\n")
    viirs = (header + "10.51,20.51,310.0,1.0,1.0,2021-06-15,1345,NPP,VIIRS,n,"
             "V2,285.0,5.0,D\n")
    raw = tmp_path / "raw"
    raw.mkdir()
    f1 = raw / "testland_MODIS_SP_2021-06-15_5d_aaa111.csv"
    f2 = raw / "testland_VIIRS_SNPP_SP_2021-06-15_5d_bbb222.csv"
    f1.write_text(modis)
    f2.write_text(viirs)
    man = tmp_path / "manifest.json"
    man.write_text(_json.dumps([
        {"file": f1.name, "aoi": "testland", "source": "MODIS_SP",
         "bbox": "20,10,21,11", "days": 5, "rows": 1},
        {"file": f2.name, "aoi": "testland", "source": "VIIRS_SNPP_SP",
         "bbox": "20,10,21,11", "days": 5, "rows": 1},
    ]))
    monkeypatch.setattr(_store, "RAW_DIR", raw)
    monkeypatch.setattr(_store, "MANIFEST", man)
    r = client.get("/api/firms/calendar",
                   params={"aoi": "testland", "data": "raw", "method": "stat"})
    assert r.status_code == 200, r.text[:500]
    assert r.json()["daily_cells"] >= 1
    aois = client.get("/api/firms/aois").json()["aois"]
    entry = next(a for a in aois if a["id"] == "testland")
    assert entry["months"] >= 1 and entry["coverage_class"]
    st = client.get("/api/firms/data-status").json()
    row = next(d for d in st["datasets"] if d["aoi"] == "testland")
    assert row["dataset_ready"] is True
    assert row["raw_ready"] is True
    missing = client.get("/api/firms/calendar",
                         params={"aoi": "nowhere_xyz", "data": "raw"})
    assert missing.status_code == 404
    assert missing.json()["detail"]["error_code"] == "no_raw_data"


def test_CLAIM023_post_aoi_registry_roundtrip(tmp_path, monkeypatch):
    """CLAIM-023: POST /api/firms/aois validates, persists to custom, GET sees
    it with dataset_ready=false; calendar stat on its bbox runs; unknown raw 404."""
    import json as _json
    import app.firms.store as store
    raw = tmp_path / "raw"
    raw.mkdir()
    tmp_aois = tmp_path / "aois.json"
    orig_path = BACKEND_DIR / "data" / "firms" / "aois.json"
    try:
        tmp_aois.write_text(orig_path.read_text(encoding="utf-8"), encoding="utf-8")
    except OSError:
        tmp_aois.write_text("{}", encoding="utf-8")
    store._registry_cached.cache_clear()
    store._manifest_aois_cached.cache_clear()
    monkeypatch.setattr(store, "AOIS_JSON", tmp_aois)
    monkeypatch.setattr(_store, "AOIS_JSON", tmp_aois)
    monkeypatch.setattr(store, "MANIFEST", tmp_path / "manifest.json")
    monkeypatch.setattr(_store, "MANIFEST", tmp_path / "manifest.json")
    monkeypatch.setattr(store, "RAW_DIR", raw)
    monkeypatch.setattr(_store, "RAW_DIR", raw)
    new_id = "claim023_e2e_probe"
    bad = client.post("/api/firms/aois", json={
        "id": new_id, "label": "CLAIM-023 E2E Probe",
        "bbox": [200, 0, 10, 10]})
    assert bad.status_code == 400, bad.text[:300]
    r = client.post("/api/firms/aois", json={
        "id": new_id, "label": "CLAIM-023 E2E Probe",
        "bbox": [104.5, 10.5, 105.5, 11.5]})
    assert r.status_code == 200, r.text[:500]
    body = r.json()
    assert body["id"] == new_id
    assert body["label"] == "CLAIM-023 E2E Probe"
    assert body["bbox"] == "104.5,10.5,105.5,11.5"
    dup = client.post("/api/firms/aois", json={
        "id": new_id, "label": "dup", "bbox": [104.5, 10.5, 105.5, 11.5]})
    assert dup.status_code == 409, dup.text[:300]
    aois = client.get("/api/firms/aois").json()["aois"]
    entry = next(a for a in aois if a["id"] == new_id)
    assert entry["label"] == "CLAIM-023 E2E Probe"
    assert entry["bbox"] == "104.5,10.5,105.5,11.5"
    assert entry["dataset_ready"] is False
    cal = client.get("/api/firms/calendar", params={
        "aoi": new_id, "data": "sample", "method": "stat"})
    assert cal.status_code == 200, cal.text[:500]
    assert cal.json()["daily_cells"] > 0
    missing = client.get("/api/firms/calendar",
                         params={"aoi": "nowhere_xyz_claim023", "data": "raw"})
    assert missing.status_code == 404
    assert missing.json()["detail"]["error_code"] == "no_raw_data"


def test_CLAIM033_upload_dataset_rejects_hts_stan():
    """CLAIM-033(a): upload + hts/stan is an explicit 409 naming method=stat."""
    sample = client.get("/api/firms/sample",
                        params={"aoi": "vietnam", "limit": 30}).json()
    import io as _io
    import csv as _csv
    buf = _io.StringIO()
    w = _csv.DictWriter(buf, fieldnames=list(sample["records"][0].keys()))
    w.writeheader()
    w.writerows(sample["records"])
    up = client.post("/api/firms/upload-dataset",
                     files={"file": ("mini.csv", buf.getvalue(), "text/csv")})
    assert up.status_code == 200, up.text[:300]
    ds = up.json()["dataset_id"]
    assert ds.startswith("upload:")
    for method in ("hts", "stan"):
        r = client.get("/api/firms/calendar",
                       params={"dataset": ds, "method": method})
        assert r.status_code == 409, (method, r.text[:300])
        assert "method=stat" in r.text


def test_CLAIM033_unknown_sample_id_points_to_registration():
    """CLAIM-033(b): unknown sample id names POST /aois + upload instead of
    implying only 3 presets exist."""
    r = client.get("/api/firms/calendar",
                   params={"aoi": "no_such_aoi_xyz", "data": "sample"})
    assert r.status_code == 400
    assert "upload" in r.text
    assert "POST /aois" in r.text


def test_CLAIM033_evidence_backtest_reject_upload_dataset():
    """CLAIM-033 guard test (TRUTH_CONTRACT): evidence/backtest must not
    silently ignore ?dataset=upload:<id>; they name the supported endpoints."""
    ev = client.get("/api/firms/evidence",
                    params={"aoi": "vietnam", "data": "sample",
                            "year": 2019, "month": 3,
                            "dataset": "upload:deadbeefdeadbeef"})
    assert ev.status_code == 400, ev.text[:300]
    assert "dataset only applies to calendar/map-cells/export/brief" in ev.text
    assert "method=stat" in ev.text
    bt = client.get("/api/firms/backtest",
                    params={"aoi": "vietnam", "data": "sample",
                            "dataset": "upload:deadbeefdeadbeef"})
    assert bt.status_code == 400, bt.text[:300]
    assert "dataset only applies to calendar/map-cells/export/brief" in bt.text
    assert "method=stat" in bt.text
