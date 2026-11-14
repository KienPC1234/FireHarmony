"""FIRMS harmonization tests — schema, harmonization, calendar, DL describe."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.firms import calendar as cal
from app.firms import dl, harmonize
from app.firms.schema import FirmsRecord
from app.main import app

client = TestClient(app)


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
    daily = [{"date": f"{y}-{m:02d}-10", "harmonized_count": 10.0 + (50.0 if (y, m) == (2019, 3) else 0.0)}
             for y in (2018, 2019, 2020) for m in range(1, 13)]
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
    rows += [{**base, "satellite": "NPP", "instrument": "VIIRS", "frp": 5.0}
             for _ in range(3)]
    return rows


def test_forward_rule_uses_viirs_where_it_flew():
    """VIIRS authoritative on shared cells; MODIS-era upscaled by 1/k."""
    daily = harmonize.harmonize_daily(
        harmonize.aggregate(_same_cell_recs()), {"_fallback": 0.5})
    assert len(daily) == 1
    c = daily[0]
    assert c["harmonized_count"] == 3  # VIIRS kept, MODIS not added on top
    assert c["harmonized_frp"] == 15.0
    only_modis = harmonize.harmonize_daily(
        harmonize.aggregate([_same_cell_recs()[0]]), {"_fallback": 0.5})
    assert only_modis[0]["harmonized_count"] == 2.0  # 1 / 0.5, labeled estimated


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
