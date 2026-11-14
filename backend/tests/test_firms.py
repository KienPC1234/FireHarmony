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


def test_api_health_and_schema():
    assert client.get("/api/health").json()["status"] == "ok"
    assert "latitude" in client.get("/api/firms/schema").json()["fields"]


def test_api_validate_and_harmonize():
    v = client.post("/api/firms/validate", json={"records": _recs()}).json()
    assert v["clean"] == 40 and v["rejected"] == 0
    h = client.post("/api/firms/harmonize", json={"records": _recs()}).json()
    assert h["daily_cells"] >= 1
    assert h["calendar"]["years"] == [2019]


def test_dl_describe_and_train_refuses_thin():
    assert "CrossSensorCalibrator" in str(dl.describe()["models"])
    r = dl.train_calibrator([], epochs=2)
    assert r["trained"] is False


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
    assert cal["filters"] == {"qa_min": "high", "platform_set": "snpp"}
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


def test_T33_sensorformer_lite_is_an_honest_comparator():
    """Audit V6 follow-up: SF Lite is scored on the same holdout, gated, not served."""
    st = client.get("/api/firms/sf-status", params={"data": "raw"}).json()
    assert st["trained"] is True
    assert st["n_test"] == 72 and st["n_train"] > 100
    assert st["metrics"]["n"] == 72
    assert 0.0 <= st["coverage80"] <= 1.0
    assert {"no_gate", "no_attn"} <= set(st["ablation"])
    bt = client.get("/api/firms/backtest",
                    params={"aoi": "vietnam", "data": "sample"}).json()
    assert "sf_lite_v1" in bt["metrics"]
    assert bt["sf_lite_deployed"] is False
    assert bt["months"] and bt["months"][0].get("sf_pred") is not None
    # The gate must be explicit: losing to B2 means not deployed.
    assert st["mean_gain_vs_b2"] < 0.02


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
