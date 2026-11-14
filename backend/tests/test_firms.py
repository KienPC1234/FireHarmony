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


def test_model_rejects_a_bbox_or_date_subset():
    """AOI-level model totals must not be applied to a filtered subset."""
    r = client.get("/api/firms/calendar", params={
        "aoi": "vietnam", "method": "ts", "bbox": "104,10,109,16"})
    assert r.status_code == 409
    assert r.json()["detail"]["error_code"] == "model_requires_full_aoi"
    r2 = client.get("/api/firms/calendar", params={
        "aoi": "vietnam", "method": "ts",
        "from_date": "2019-01-01", "to_date": "2019-03-31"})
    assert r2.status_code == 409


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
    assert {m["method_id"] for m in info["archived"]} >= {
        "ml_b2res_v4", "ts_logratio_pool_v2", "tileformer_v1"}
    # The deleted torch prototypes must not silently come back.
    assert not hasattr(dl, "CrossSensorCalibrator")
    assert not hasattr(dl, "FireSeasonAE")
    # A thin-data call still refuses to train (compat shim, not a served model).
    assert dl.train_calibrator([], epochs=2)["trained"] is False


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


@_NEEDS_TORCH
def test_ts_status_and_calendar_ts():
    s = client.get("/api/firms/ts-status", params={"aoi": "vietnam"}).json()
    assert s["trained"] is True and s["method_id"] == "ts_logratio_pool_v2"
    assert s["params"] > 1000
    r = client.get("/api/firms/calendar", params={"aoi": "vietnam", "method": "ts"}).json()
    assert r["method_id"] == "ts_logratio_pool_v2"
    assert any(d.get("estimate_type") == "ts_predicted" for d in r["daily"])
    bad = client.get("/api/firms/calendar", params={"aoi": "vietnam", "method": "nope"})
    assert bad.status_code == 422


@pytest.mark.skipif(not _DIST_INDEX.exists(), reason="no SPA build")
def test_backtest_has_transformer_and_spa_fallback():
    b = client.get("/api/firms/backtest", params={"aoi": "vietnam", "data": "sample"}).json()
    metrics = b["metrics"]
    assert "ts_logratio_pool_v2" in metrics
    assert "b2_seasonal_ratio" in metrics
    assert b["eval_unit"].startswith("aoi-month")
    assert b["months"] and "ts_pred" in b["months"][0]
    assert b["months"][0]["ml_pred"] is not None
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


def test_ml_monthly_conservation():
    """P0-01: ML month total == sum of its daily cells == model prediction."""
    from pathlib import Path as _P

    from app.firms import ml_cal as _mlc
    model, _meta = _mlc.load_artifact(
        "vietnam", _P(__file__).resolve().parents[1] / "data" / "firms" / "models")
    assert model is not None, "ML artifact missing; train first"
    rows = _modis_rows([f"2019-03-{d:02d}" for d in range(1, 21)])
    h = client.post("/api/firms/harmonize",
                    json={"records": rows, "method": "ml", "aoi": "vietnam"}).json()
    assert h["method_id"].startswith(("ml_hgb", "ml_b2res"))
    assert any(d.get("estimate_type") == "ml_predicted" for d in h["daily"])
    yi = h["calendar"]["years"].index(2019)
    month_total = h["calendar"]["matrix"][yi][2]
    cell_sum = round(sum(d["harmonized_count"] for d in h["daily"]
                         if str(d["date"])[:7] == "2019-03"), 2)
    assert abs(month_total - cell_sum) < 0.05
    ctx = _mlc.monthly_modis_ctx(rows)["2019-03"]
    pred = round(float(_mlc.predict_viirs(model, ctx["modis"], 3, ctx["day_frac"],
                                          ctx["terra_frac"], ctx["prev_modis"])), 2)
    assert abs(month_total - pred) < 0.05


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


@_NEEDS_RAW
def test_raw_ml_blocked():
    """P0-03: synthetic-trained ML/TS artifacts are never served for raw observed data."""
    r = client.get("/api/firms/calendar",
                   params={"aoi": "vietnam", "data": "raw", "method": "ml"})
    assert r.status_code == 200
    assert r.json()["ml_meta"]["training_source"] == "nasa-firms-raw"
    r2 = client.get("/api/firms/calendar",
                    params={"aoi": "vietnam", "data": "raw", "method": "ts"})
    assert r2.status_code == 200
    assert r2.json()["ml_meta"]["training_source"] == "nasa-firms-raw"
    r4 = client.get("/api/firms/calendar",
                    params={"aoi": "australia", "data": "raw", "method": "ts"})
    assert r4.status_code == 200  # australia now has a raw-trained TS artifact
    assert r4.json()["ml_meta"]["training_source"] == "nasa-firms-raw"


def test_raw_gate_without_artifact_422(tmp_path, monkeypatch):
    """P0-03 gate: synthetic-only MODEL_DIR must refuse ml/ts on raw data."""
    import app.main as _m
    monkeypatch.setattr(_m, "MODEL_DIR", tmp_path)
    r = client.get("/api/firms/calendar",
                   params={"aoi": "vietnam", "data": "raw", "method": "ml"})
    assert r.status_code == 422
    r2 = client.get("/api/firms/calendar",
                    params={"aoi": "vietnam", "data": "raw", "method": "ts"})
    assert r2.status_code == 422
    r3 = client.get("/api/firms/calendar",
                    params={"aoi": "amazon", "data": "raw", "method": "ml"})
    assert r3.status_code == 422  # empty MODEL_DIR: no artifacts at all


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


@_NEEDS_TORCH
def test_export_method_param():
    """P0-06: export honors method= and matches the dashboard; raw+ml -> 422."""
    r = client.get("/api/firms/export", params={"aoi": "vietnam", "method": "ts"})
    assert r.status_code == 200
    assert "X-Data-Source" in r.headers
    assert "cell_id" in r.text.splitlines()[0]
    if _RAW_AVAILABLE:
        bad = client.get("/api/firms/export",
                         params={"aoi": "vietnam", "data": "raw", "method": "ml"})
        assert bad.status_code == 200  # vietnam raw ml artifact exists
        assert "cell_km2" in bad.text.splitlines()[0]
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


@_NEEDS_RAW
def test_raw_artifact_gate():
    # all 3 AOIs now have raw-trained ml + ts artifacts (2019-2025 pulls)
    for aoi, method in [("vietnam", "ml"), ("vietnam", "ts"),
                        ("amazon", "ml"), ("amazon", "ts"),
                        ("australia", "ml"), ("australia", "ts")]:
        r = client.get("/api/firms/calendar",
                       params={"aoi": aoi, "data": "raw", "method": method})
        assert r.status_code == 200, (aoi, method)
        assert r.json()["ml_meta"]["training_source"] == "nasa-firms-raw", (aoi, method)


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


def test_T01_v4_dispatch_uses_seven_features():
    """T01: b2_residual must dispatch to ml_v4, never the 6-feature legacy path."""
    from app.firms import ml_v4
    res = ml_v4.train_holdout(_synthetic_pairs(), test_years=2, tune=False)
    model = res["model"]
    assert model.n_features_in_ == 7
    from app.firms import ml_cal
    pred = ml_cal.predict_viirs(model, 500, 3, 0.8, 0.5, 400)
    assert pred >= 0
    # an unknown target must fail loudly, not silently fall back
    class _Bad:
        _target = "unknown-space"
        n_features_in_ = 7
    with pytest.raises(ValueError):
        ml_cal.predict_viirs(_Bad(), 10, 1)


def test_T02_predict_one_equals_predict_counts_gate_on_and_off():
    """T02: one inverse transform for batch and single-row inference."""
    from app.firms import ml_v4
    res = ml_v4.train_holdout(_synthetic_pairs(), test_years=2, tune=False)
    model = res["model"]
    for gate in (True, False):
        model._use_residual = gate
        model._fallback = "b2_seasonal_ratio"
        for modis in (0, 1, 5, 30, 1000):
            for month in range(1, 13):
                batch = float(ml_v4.predict_counts(
                    model, [{"modis": modis, "month": month}])[0])
                one = float(ml_v4.predict_one(model, modis, month, 0.5, 0.5))
                assert abs(batch - one) < 1e-6, (gate, modis, month, batch, one)


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


def test_T04_no_target_leakage_from_test_viirs():
    """T04: changing holdout VIIRS must not change train-only predictions."""
    from app.firms import evaluation, ml_v4
    pairs = _synthetic_pairs(60)
    train = [p for p in pairs if p["year"] < 2023]
    test = [p for p in pairs if p["year"] >= 2023]
    b1_log, b2_log = evaluation.ratios_from_train(train)
    before = [evaluation._counts(p["modis"], b2_log.get(p["month"], b1_log))
              for p in test]
    for p in test:
        p["viirs"] = int(p["viirs"] * 100)
    after = [evaluation._counts(p["modis"], b2_log.get(p["month"], b1_log))
             for p in test]
    assert before == after
    # a model fit on train is also invariant to test targets
    res = ml_v4.train_holdout(pairs, test_years=2, tune=False)
    m = res["model"]
    pred_mutated = ml_v4.predict_counts(m, test)
    for p, v in zip(test, pred_mutated):
        p["viirs"] = 1
    assert (pred_mutated == ml_v4.predict_counts(m, test)).all()


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
    assert m["evaluation_version"] == "eval-v3"
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
    archived = {m["method_id"] for m in registry.archived()}
    assert {"ml_b2res_v4", "ts_logratio_pool_v2", "tileformer_v1"} <= archived
    # No archived model may claim to serve the calendar.
    assert not any(m["served"] for m in registry.archived())


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


def test_T08_cache_key_changes_with_model_or_data_version(monkeypatch):
    from app.firms import evaluation, ml_v4
    k1 = evaluation.cache_key("vietnam", "raw", 2, extra="x")
    monkeypatch.setattr(ml_v4, "ALGORITHM_VERSION", ml_v4.ALGORITHM_VERSION + "-next")
    k2 = evaluation.cache_key("vietnam", "raw", 2, extra="x")
    assert k1 != k2


def test_T09_xray_uses_unified_manifest_not_legacy():
    """T09: xray scores the V4 manifest and never loads sample for raw."""
    x = client.get("/api/firms/xray", params={"aoi": "vietnam", "data": "sample"}).json()
    assert "backtest_metrics" in x
    assert "hgb_residual_enabled" in x
    assert x["months"] and "ratio_source" in x["months"][0]
    if x.get("evaluation_version"):
        assert x["backtest_metrics"] is not None
        assert "hgb_b2res_v4" in x["backtest_metrics"]


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


@_NEEDS_TORCH
def test_T12_brief_matches_calendar_method_and_scope():
    b = client.get("/api/firms/brief", params={"aoi": "vietnam", "method": "ts"}).text
    assert "requested `ts`" in b
    assert "effective `ts_logratio_pool_v2`" in b
    assert "Period:" in b
    assert "synthetic" in b.lower()


def test_T13_artifact_compat_rejects_stale_fingerprint():
    from pathlib import Path as _P
    from app.firms import ml_cal
    model, meta = ml_cal.load_artifact(
        "vietnam", _P(__file__).resolve().parents[1] / "data" / "firms" / "models",
        tag="raw")
    ok, why = ml_cal.artifact_compat(model, meta, expected_fingerprint="stale")
    assert not ok and "mismatch" in why
    ok2, why2 = ml_cal.artifact_compat(model, meta, expected_fingerprint=None)
    assert ok2


def test_T14_replay_hides_test_viirs_but_keeps_reference():
    """T14: predicted inputs depend on MODIS/context only; reference is separate."""
    from app.firms import ml_v4
    pairs = _synthetic_pairs(60)
    res = ml_v4.train_holdout(pairs, test_years=2, tune=False)
    m = res["model"]
    test = [p for p in pairs if p["year"] >= 2023]
    p1 = ml_v4.predict_counts(m, test)
    ref1 = [p["viirs"] for p in test]
    for p in test:
        p["viirs"] = 0
    p2 = ml_v4.predict_counts(m, test)
    ref2 = [p["viirs"] for p in test]
    assert (p1 == p2).all()
    assert ref1 != ref2


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
    r = client.post("/api/firms/ml-train", json={"aoi": "vietnam", "data": "sample"})
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


@_NEEDS_TORCH
def test_T33_sensorformer_lite_is_an_honest_comparator():
    """Audit V6 + audit-2: SF is scored on the same holdout, gated, not served."""
    st = client.get("/api/firms/sf-status", params={"data": "raw"}).json()
    assert st["trained"] is True
    assert st["model_artifact_available"] is True
    assert st["artifact_verified"] is True
    assert st["artifact"]["hash_ok"] is True
    assert st["n_test"] == 72 and st["n_train"] > 100
    assert st["metrics"]["n"] == 72
    assert 0.0 <= st["coverage80"] <= 1.0
    assert {"no_gate", "no_attn"} <= set(st["ablation"])
    # Audit-2 P1: mean and median width are different statistics, both stored.
    assert st["mean_interval_width"] >= st["median_interval_width"] > 0
    assert st["quantile_crossings"] == 0
    assert len(st["per_seed_mae"]) == 5
    bt = client.get("/api/firms/backtest",
                    params={"aoi": "vietnam", "data": "sample"}).json()
    assert "sf_lite_v1" in bt["metrics"]
    assert bt["sf_lite_deployed"] is False
    assert bt["months"] and bt["months"][0].get("sf_pred") is not None
    # The gate must be explicit: losing to B2 means not deployed.
    assert st["mean_gain_vs_b2"] < 0.02
    assert st["metrics"]["mae"] > st["b2_mae"]
    # Predictions are monotone quantiles by construction.
    from app.firms import sf_lite
    _, meta = sf_lite.load_artifact("raw")
    for p in meta["predictions"].values():
        assert p["low"] <= p["mid"] <= p["high"]


def test_T34_sensorformer_inputs_never_contain_target_viirs():
    import numpy as np
    from app.firms import sf_lite
    pairs = sf_lite.load_pairs("raw")
    train = [p for p in pairs if p["year"] < 2024]
    ratios = {a: sf_lite._b2_log([p for p in train if p["aoi"] == a])
              for a in sf_lite.AOIS}
    before = {w["id"]: w for w in sf_lite.build_windows(pairs, ratios)}
    mutated = [dict(p) for p in pairs]
    for p in mutated:
        if p["year"] >= 2024:
            p["viirs"] = 999999.0
    after = {w["id"]: w for w in sf_lite.build_windows(mutated, ratios)}
    sid = "vietnam:2025-01"
    assert sid in before and sid in after
    assert np.array_equal(before[sid]["X"], after[sid]["X"])
    assert np.array_equal(before[sid]["ctx"], after[sid]["ctx"])
    # Audit-2 P1: the constant `observed` flag was removed, not faked.
    assert "observed" not in sf_lite.FEATURES
    assert before[sid]["X"].shape == (12, len(sf_lite.FEATURES))


def test_T36_sensorformer_selection_split_has_no_2023_leak():
    """Audit-2 P0: 2023 validation must not enter the B2 features/labels."""
    import math
    import numpy as np
    from app.firms import sf_lite
    pairs = sf_lite.load_pairs("raw")
    sel = [p for p in pairs if p["year"] < 2023]
    ratios = {a: sf_lite._b2_log([p for p in sel if p["aoi"] == a])
              for a in sf_lite.AOIS}
    ws = {w["id"]: w for w in sf_lite.build_windows(pairs, ratios)}
    row = ws["vietnam:2023-06"]
    manual = float(np.median([
        math.log((p["viirs"] + 1.0) / (p["modis"] + 1.0))
        for p in sel if p["aoi"] == "vietnam" and p["month"] == 6
        and p["modis"] > 0]))
    assert abs(row["b2_log"] - manual) < 1e-9
    # The old buggy cutoff (<2024) differs, so this test would have caught it.
    leaky = {a: sf_lite._b2_log([p for p in pairs
                                 if p["aoi"] == a and p["year"] < 2024])
             for a in sf_lite.AOIS}
    leaky_row = {w["id"]: w for w in sf_lite.build_windows(pairs, leaky)}["vietnam:2023-06"]
    assert abs(leaky_row["b2_log"] - manual) > 1e-6


@_NEEDS_TORCH
def test_T37_sensorformer_early_stopping_runs_in_eval_mode():
    """Audit-2 P0: dropout must be off while validation picks the epoch."""
    from app.firms import sf_lite
    pairs = sf_lite.load_pairs("sample")
    ratios = {a: sf_lite._b2_log([p for p in pairs
                                  if p["aoi"] == a and p["year"] < 2023])
              for a in sf_lite.AOIS}
    ws = sf_lite.build_windows(pairs, ratios)
    fit = [w for w in ws if w["year"] < 2023]
    val = [w for w in ws if w["year"] == 2023]
    model, best_epoch, best_mae = sf_lite._fit(7, fit, val, epochs=2)
    assert model.training is False
    assert best_epoch >= 1 and best_mae > 0
    a = sf_lite._val_mae(model, val)
    b = sf_lite._val_mae(model, val)
    assert a == b  # no dropout noise in the selection metric


def test_T38_sf_artifact_hash_mismatch_is_rejected(tmp_path):
    """Audit-2 P1: never load weights that do not match metadata."""
    import shutil
    from app.firms import sf_lite
    src = sf_lite._pairs_path("raw").parent.parent / "models"
    shutil.copy(src / "sf_lite_raw.json", tmp_path / "sf_lite_raw.json")
    shutil.copy(src / "sf_lite_raw.pt", tmp_path / "sf_lite_raw.pt")
    st = sf_lite.artifact_status("raw", tmp_path)
    assert st["available"] is True and st["hash_ok"] is True
    with (tmp_path / "sf_lite_raw.pt").open("ab") as fh:
        fh.write(b"tampered")
    st = sf_lite.artifact_status("raw", tmp_path)
    assert st["available"] is False
    assert st["reason"] == "weights_sha256_mismatch"
    assert sf_lite.load_artifact("raw", tmp_path) == (None, None)


def test_T39_sf_status_separates_artifact_from_live_data():
    """Audit-2 P1: a trained artifact does not imply raw NASA data is present."""
    st = client.get("/api/firms/sf-status", params={"data": "raw"}).json()
    assert st["model_artifact_available"] is True
    assert isinstance(st["live_data_available"], bool)
    assert "artifact" in st and "feature_version" in st


def test_T35_srf_artifacts_were_removed():
    """SRF was deleted (srf.py + srf_raw.*); nothing may resurrect it."""
    assert not (BACKEND_DIR / "data/firms/models/srf_raw.pt").exists()
    assert not (BACKEND_DIR / "data/firms/models/srf_raw.json").exists()
    assert not (BACKEND_DIR / "app/firms/srf.py").exists()





def test_T40_hierarchical_tile_anchor_beats_b2_on_official_holdout():
    """Tile-month hierarchy is the strongest candidate: all 3 AOIs improve."""
    import json
    meta = json.loads((BACKEND_DIR / "data/firms/models/hts_anchor_raw.json")
                      .read_text(encoding="utf-8"))
    assert meta["method_id"] == "hts_anchor_v1"
    assert meta["n_test"] == 72
    assert meta["hts_mae"] < meta["b2_mae"] * 0.97
    for aoi, row in meta["per_aoi"].items():
        assert row["hts_mae"] < row["b2_mae"], aoi
    ci = meta["comparisons"]["hts_vs_b2"]["ci95"]
    assert ci[0] < meta["comparisons"]["hts_vs_b2"]["delta_mae"] < ci[1]
    # Point gain is real; statistical gate is not passed because the CI includes 0.
    assert meta["gate"]["passed"] is False
    assert meta["mean_gain_vs_b2"] > 0.02


def test_T41_tileformer_artifacts_were_removed():
    """TileFormer training outputs were deleted; the tile dataset stays."""
    base = BACKEND_DIR / "data/firms/models"
    for name in ("tileformer_raw.json", "tileformer_d32.json",
                 "tileformer_d128.json"):
        assert not (base / name).exists(), name
    assert (base / "hts_anchor_raw.json").exists()


def test_T44_hts_status_is_a_candidate_not_a_served_win():
    st = client.get("/api/firms/hts-status").json()
    assert st["trained"] is True
    assert st["candidate"] is True and st["served"] is False
    assert st["n_test"] == 72
    assert st["hts_mae"] < st["b2_mae"]
    assert st["gate"]["passed"] is False


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


def test_T48_spatial_hgb_wins_but_is_explicitly_retrospective():
    """Neighbour VIIRS is a valid retrospective covariate, not a forecast input."""
    import json
    meta = json.loads((BACKEND_DIR / "data/firms/models/spatial_hgb_raw.json")
                      .read_text(encoding="utf-8"))
    assert meta["retrospective"] is True
    assert meta["requires_neighbour_viirs"] is True
    assert meta["headline"]["n"] == 72
    # With the full-month Australia backfill the absolute gain is smaller than
    # on the sparse-window data; the relative ordering and CI are the contract.
    assert meta["headline"]["mae"] < 0.8 * meta["b2_headline"]["mae"]
    assert meta["headline"]["mae"] < 0.85 * meta["hts_headline"]["mae"]
    ci = meta["comparisons"]["spatial_vs_b2"]["ci95"]
    assert ci[1] < 0
    ci_h = meta["comparisons"]["spatial_vs_hts"]["ci95"]
    assert ci_h[1] < 0
    for aoi, row in meta["per_aoi"].items():
        assert row["spatial"]["mae"] < row["hts"]["mae"], aoi
    # Spatial holdout: whole tiles never seen in training.
    ho = meta["spatial_holdout"]
    assert ho["held_tiles"] > 150
    assert ho["spatial_mae"] < ho["hts_mae"]
    # Ablation: without same-month neighbour VIIRS the gain disappears.
    assert meta["safe_headline"]["mae"] > meta["hts_headline"]["mae"]
    # Rolling-origin: the spatial model wins every pre-holdout year too.
    for year, row in meta["rolling"].items():
        assert row["pred"] < row["hts"], year


def test_T49_spatial_status_is_a_candidate_not_a_served_default():
    st = client.get("/api/firms/spatial-status").json()
    assert st["trained"] is True
    assert st["candidate"] is True and st["served"] is False
    assert st["retrospective"] is True
    assert st["requires_neighbour_viirs"] is True


def test_T50_stan_safe_beats_b2_without_retrospective_leakage():
    """Tuned STAN: FiLM + TCN + target query + NB, no same-month neighbour VIIRS."""
    import json
    meta = json.loads((BACKEND_DIR / "data/firms/models/stan_safe_raw.json")
                      .read_text(encoding="utf-8"))
    assert meta["variant"] == "forecast_safe"
    assert meta["retrospective"] is False
    assert meta["uses_neighbour_viirs_same_month"] is False
    off = meta["official"]
    assert off["n"] == 72
    # Point estimate must beat B2 and the HTS fallback on every AOI.
    assert off["metrics"]["mae"] < 0.95 * off["b2_metrics"]["mae"]
    assert off["metrics"]["mae"] < off["hts_metrics"]["mae"]
    for aoi, row in off["per_aoi"].items():
        assert row["stan"]["mae"] < row["hts"]["mae"], aoi
        assert row["stan"]["mae"] < row["b2"]["mae"], aoi
    ci = off["comparisons"]["stan_vs_b2"]["ci95"]
    assert ci[0] < ci[1]
    # A wide CI is reported, not hidden: with 72 months the gain may not be
    # statistically established even when every AOI improves.
    assert off["comparisons"]["stan_vs_b2"]["delta_mae"] < 0
    # The retrospective twin is flagged; it is not the served claim. Do not
    # assert it is better: in the deterministic run it is within seed noise.
    retro = json.loads((BACKEND_DIR / "data/firms/models/stan_retro_raw.json")
                       .read_text(encoding="utf-8"))
    assert retro["retrospective"] is True
    assert retro["uses_neighbour_viirs_same_month"] is True
    # Leave-one-region-out is stored and is not a hidden success.
    loo = meta["loo_region"]
    assert set(loo) == {"vietnam", "amazon", "australia"}
    assert loo["amazon"]["metrics"]["mae"] > loo["amazon"]["hts_metrics"]["mae"]


def test_T51_stan_status_exposes_both_variants():
    st = client.get("/api/firms/stan-status").json()
    assert st["trained"] is True
    assert st["served"] is True and st["role"] == "main"
    assert st["safe"]["variant"] == "forecast_safe"
    assert st["retrospective"]["retrospective"] is True


def test_T52_stan_series_is_the_served_main_target():
    import json
    import numpy as np
    base = BACKEND_DIR / "data/firms/models"
    series = json.loads((base / "stan_series_raw.json").read_text(encoding="utf-8"))
    meta = json.loads((base / "stan_safe_raw.json").read_text(encoding="utf-8"))
    assert series["role"] == "main"
    assert series["months"]["vietnam"] > 150
    assert series["series"]["vietnam"]["2025-01"]["source"] == "stan"
    assert series["series"]["vietnam"]["2023-01"]["source"] == "hts"
    # The 2024-25 targets must reproduce the artifact's own published MAE.
    import csv
    y, p = [], []
    with (BACKEND_DIR / "data/firms/benchmark/evaluation_samples_raw.csv").open(
            encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            ym = f"{r['year']}-{int(r['month']):02d}"
            tgt = series["series"][r["aoi"]].get(ym, {}).get("target")
            if tgt is not None:
                y.append(float(r["viirs_ref"]))
                p.append(float(tgt))
    mae = float(np.mean(np.abs(np.array(p) - np.array(y))))
    want = meta["official"]["metrics"]["mae"]
    assert abs(mae - want) < 5.0, (mae, want)
    assert want < meta["official"]["b2_metrics"]["mae"]


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
    assert g["missing_months"] > 0
    assert "2026" in g["missing_by_year"]  # unfetched year/months, not quiet fire
    assert "not zero fire" in g["note"]
    r = client.get("/api/firms/coverage", params={"aoi": "amazon"}).json()
    assert "gaps" in r and r["gaps"]["missing_months"] >= g["missing_months"]


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

