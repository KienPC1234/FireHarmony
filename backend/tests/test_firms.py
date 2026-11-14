"""FIRMS harmonization tests — schema, harmonization, calendar, DL describe."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.firms import calendar as cal
from app.firms import dl, harmonize
from app.firms.schema import FirmsRecord
from app.main import app

client = TestClient(app)

_DIST_INDEX = Path(__file__).resolve().parents[2] / "frontend" / "dist" / "index.html"


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
             for y in (2018, 2019, 2020) for m in range(1, 13) for d in range(1, 21)]
    calen = cal.build_calendar(daily)
    assert calen["years"] == [2018, 2019, 2020]
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
    for f in _P("data/firms/raw").glob("amazon_test_*.csv"):
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
    for f in Path("data/firms/samples").glob("*.csv"):
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
    assert s["trained"] is True and s["method_id"] == "ts_win12_v1"
    assert s["params"] > 1000
    r = client.get("/api/firms/calendar", params={"aoi": "vietnam", "method": "ts"}).json()
    assert r["method_id"] == "ts_win12_v1"
    assert any(d.get("estimate_type") == "ts_predicted" for d in r["daily"])
    bad = client.get("/api/firms/calendar", params={"aoi": "vietnam", "method": "nope"})
    assert bad.status_code == 422


@pytest.mark.skipif(not _DIST_INDEX.exists(), reason="no SPA build")
def test_backtest_has_transformer_and_spa_fallback():
    b = client.get("/api/firms/backtest", params={"aoi": "vietnam"}).json()
    assert "transformer" in b["metrics"]
    assert b["months"] and "ts_pred" in b["months"][0]
    assert client.get("/calendar").status_code == 200
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
    model, _meta = _mlc.load_artifact("vietnam", _P("data/firms/models"))
    assert model is not None, "ML artifact missing; train first"
    rows = _modis_rows([f"2019-03-{d:02d}" for d in range(1, 21)])
    h = client.post("/api/firms/harmonize",
                    json={"records": rows, "method": "ml", "aoi": "vietnam"}).json()
    assert h["method_id"] == "ml_hgb_v1"
    assert any(d.get("estimate_type") == "ml_predicted" for d in h["daily"])
    yi = h["calendar"]["years"].index(2019)
    month_total = h["calendar"]["matrix"][yi][2]
    cell_sum = round(sum(d["harmonized_count"] for d in h["daily"]
                         if str(d["date"])[:7] == "2019-03"), 2)
    assert abs(month_total - cell_sum) < 0.05
    pred = round(float(_mlc.predict_viirs(model, float(len(rows)), 3)), 2)
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


def test_raw_ml_blocked():
    """P0-03: synthetic-trained ML/TS artifacts are never served for raw observed data."""
    r = client.get("/api/firms/calendar",
                   params={"aoi": "vietnam", "data": "raw", "method": "ml"})
    assert r.status_code == 422
    r2 = client.get("/api/firms/calendar",
                    params={"aoi": "vietnam", "data": "raw", "method": "ts"})
    assert r2.status_code == 422


def test_completeness_partial():
    """P0-10: a 5-day month is partial -> no criticals, latest None."""
    rows = _modis_rows([f"2021-06-{d:02d}" for d in range(1, 6)])
    h = client.post("/api/firms/harmonize", json={"records": rows}).json()
    comp = h["calendar"]["completeness"]["2021-06"]
    assert comp["partial"] is True
    assert comp["days"] == 5
    assert comp["span"] == ["2021-06-01", "2021-06-05"]
    assert h["critical_periods"] == []
    assert h["latest"] is None


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
    bad = client.get("/api/firms/export",
                     params={"aoi": "vietnam", "data": "raw", "method": "ml"})
    assert bad.status_code == 422
