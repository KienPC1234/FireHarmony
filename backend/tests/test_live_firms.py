"""Unit tests for CLAIM-W1: live FIRMS fetcher, custom AOI ingest/delete, export & filter guards."""
from __future__ import annotations

import csv
import io
import json
import sys
import urllib.error
from datetime import date as RealDate
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.firms import firms_live, store  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


class _MockResp:
    def __init__(self, body: str, status: int = 200):
        self._body = body.encode("utf-8")
        self.status = status

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


MODIS_CSV = (
    "latitude,longitude,brightness,scan,track,acq_date,acq_time,"
    "satellite,instrument,confidence,version,bright_t31,frp,daynight\n"
    "12.345,105.678,325.4,1.1,1.0,2026-11-10,630,Terra,MODIS,85,6.1NRT,295.2,18.4,D\n"
)

VIIRS_CSV = (
    "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,"
    "satellite,instrument,confidence,version,bright_ti5,frp,daynight\n"
    "12.355,105.688,332.1,0.4,0.4,2026-11-11,1345,N,VIIRS,n,2.0NRT,290.1,9.7,D\n"
)


def _isolate_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    raw = tmp_path / "raw"
    uploads = tmp_path / "uploads"
    raw.mkdir()
    uploads.mkdir()
    aois_json = tmp_path / "aois.json"
    aois_json.write_text("{}", encoding="utf-8")
    manifest = tmp_path / "ingest_manifest.json"
    store._registry_cached.cache_clear()
    store._manifest_aois_cached.cache_clear()
    monkeypatch.setattr(store, "RAW_DIR", raw)
    monkeypatch.setattr(store, "UPLOAD_DIR", uploads)
    monkeypatch.setattr(store, "AOIS_JSON", aois_json)
    monkeypatch.setattr(store, "MANIFEST", manifest)
    return raw, uploads, aois_json, manifest


def test_fetch_live_firms_area_merges_and_serves_calendar(tmp_path, monkeypatch):
    _isolate_store(tmp_path, monkeypatch)
    # Fixture rows are dated 2026-11-10/11. Freeze the request clock so the
    # sliding NRT window cannot drop them as CI time moves past those dates.
    class FixtureDate(RealDate):
        @classmethod
        def today(cls):
            return cls(2026, 11, 14)

    monkeypatch.setattr(firms_live, "date", FixtureDate)
    monkeypatch.setenv("FIRMS_MAP_KEY", "secret_test_key_123")
    seen_urls: list[str] = []

    def fake_urlopen(url: str, timeout: int = 20):
        seen_urls.append(url)
        if "/MODIS_NRT/" in url:
            return _MockResp(MODIS_CSV)
        return _MockResp(VIIRS_CSV)

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        res = firms_live.fetch_live_firms_area([104.0, 10.0, 109.0, 16.0], days=5)

    assert res["ok"] is True
    assert res["dataset"].startswith("live:")
    assert res["rows"] == 4  # 1 MODIS + 3 VIIRS sources
    assert res["date_range"] == ["2026-11-10", "2026-11-11"]
    assert res["bbox"] == [104.0, 10.0, 109.0, 16.0]
    assert len(seen_urls) == 4

    loaded = store.load_upload_dataset(res["dataset"])
    assert len(loaded) == 4
    assert loaded[0]["instrument"] == "MODIS"
    assert loaded[1]["instrument"] == "VIIRS"
    assert loaded[1]["brightness"] == "332.1"

    cal = client.get("/api/firms/calendar", params={
        "aoi": "vietnam", "data": "sample", "method": "stat",
        "dataset": res["dataset"],
    })
    assert cal.status_code == 200, cal.text[:300]
    assert cal.json()["daily_cells"] >= 1


def test_fetch_live_old_end_date_uses_sp_sources_and_env_fallback(tmp_path, monkeypatch):
    _isolate_store(tmp_path, monkeypatch)
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text('FIRMS_MAP_KEY="fallback_key_abc"\n', encoding="utf-8")
    monkeypatch.setattr(firms_live, "_ENV_PATH", env_file)

    seen_urls: list[str] = []

    def fake_urlopen(url: str, timeout: int = 20):
        seen_urls.append(url)
        assert "fallback_key_abc" in url
        return _MockResp(MODIS_CSV)

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        res = firms_live.fetch_live_firms_area(
            [104.0, 10.0, 109.0, 16.0], days=3, end_date="2020-01-15"
        )

    assert res["sources_fetched"] == ["MODIS_SP", "VIIRS_SNPP_SP"]
    assert all(u.endswith("/2020-01-15") for u in seen_urls)


def test_fetch_live_validation_and_upstream_errors(tmp_path, monkeypatch):
    _isolate_store(tmp_path, monkeypatch)
    monkeypatch.setenv("FIRMS_MAP_KEY", "secret_key_xyz")

    with pytest.raises(ValueError):
        firms_live.fetch_live_firms_area([110.0, 10.0, 105.0, 16.0], days=5)
    with pytest.raises(ValueError):
        firms_live.fetch_live_firms_area([104.0, 10.0, 109.0, 16.0], days=11)
    with pytest.raises(ValueError):
        firms_live.fetch_live_firms_area([104.0, 10.0, 109.0, 16.0], days=5, end_date="bad-date")

    with patch("urllib.request.urlopen", return_value=_MockResp("Invalid MAP_KEY")):
        with pytest.raises(firms_live.FirmsLiveError) as exc_info:
            firms_live.fetch_live_firms_area([104.0, 10.0, 109.0, 16.0], days=5)
        assert "secret_key_xyz" not in str(exc_info.value)


def test_post_fetch_live_endpoint_503_and_200(tmp_path, monkeypatch):
    _isolate_store(tmp_path, monkeypatch)
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    monkeypatch.setattr(firms_live, "_ENV_PATH", tmp_path / "missing.env")

    r_missing = client.post("/api/firms/fetch-live", json={"bbox": [104, 10, 109, 16], "days": 5})
    assert r_missing.status_code == 503

    monkeypatch.setenv("FIRMS_MAP_KEY", "secret_key_endpoint")
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("network down secret_key_endpoint")):
        r_err = client.post("/api/firms/fetch-live", json={"bbox": [104, 10, 109, 16], "days": 5})
        assert r_err.status_code == 503
        assert "secret_key_endpoint" not in r_err.text

    with patch("urllib.request.urlopen", return_value=_MockResp(MODIS_CSV)):
        r_ok = client.post("/api/firms/fetch-live", json={"bbox": [104, 10, 109, 16], "days": 5})
        assert r_ok.status_code == 200
        body = r_ok.json()
        assert body["ok"] is True
        assert body["dataset"].startswith("live:")


def test_custom_aoi_ingest_and_delete(tmp_path, monkeypatch):
    _isolate_store(tmp_path, monkeypatch)

    # Preset cannot be deleted
    r_preset = client.delete("/api/firms/aois/vietnam")
    assert r_preset.status_code == 400

    # Missing custom AOI -> 404
    r_missing = client.delete("/api/firms/aois/nonexistent_custom")
    assert r_missing.status_code == 404

    # Create custom AOI
    r_create = client.post("/api/firms/aois", json={
        "id": "borneo_test", "label": "Borneo Test", "bbox": [110.0, -2.0, 117.0, 5.0],
    })
    assert r_create.status_code == 200, r_create.text

    # Ingest into custom AOI succeeds
    report = store.ingest_upload("borneo.csv", MODIS_CSV.encode("utf-8"), "borneo_test", "upload")
    assert report["aoi"] == "borneo_test"
    assert report["clean"] == 1
    assert store.raw_ready("borneo_test") is True

    # Unknown AOI still rejected
    with pytest.raises(ValueError):
        store.ingest_upload("bad.csv", MODIS_CSV.encode("utf-8"), "unknown_aoi_xyz", "upload")

    # Delete custom AOI succeeds and removes from /api/firms/aois (when no manifest? manifest keeps it in list,
    # so test deletion on a fresh custom AOI without manifest)
    r_create2 = client.post("/api/firms/aois", json={
        "id": "temp_custom_del", "label": "Temp Delete", "bbox": [10.0, 10.0, 12.0, 12.0],
    })
    assert r_create2.status_code == 200
    r_del = client.delete("/api/firms/aois/temp_custom_del")
    assert r_del.status_code == 200
    assert r_del.json() == {"ok": True, "deleted": "temp_custom_del"}
    aoi_ids = {a["id"] for a in client.get("/api/firms/aois").json()["aois"]}
    assert "temp_custom_del" not in aoi_ids


def test_export_empty_filter_returns_header_csv_and_hts_filter_guards(tmp_path, monkeypatch):
    # Empty filter on sample returns 200 with exact CSV header and X-Row-Count: 0
    r_empty = client.get("/api/firms/export", params={
        "aoi": "vietnam", "data": "sample", "method": "stat",
        "bbox": "0.0,0.0,1.0,1.0",
    })
    assert r_empty.status_code == 200, r_empty.text
    assert r_empty.headers.get("x-row-count") == "0"
    rows = list(csv.reader(io.StringIO(r_empty.text)))
    assert len(rows) == 1
    assert "cell_id" in rows[0] and "harmonized_count" in rows[0]

    # Empty filter on raw with no matching rows in bbox also returns 200 header-only CSV
    _isolate_store(tmp_path, monkeypatch)
    r_create = client.post("/api/firms/aois", json={
        "id": "raw_empty_test", "label": "Raw Empty Test", "bbox": [104.0, 10.0, 109.0, 16.0],
    })
    assert r_create.status_code == 200
    store.ingest_upload("m.csv", MODIS_CSV.encode("utf-8"), "raw_empty_test", "upload")
    r_raw_empty = client.get("/api/firms/export", params={
        "aoi": "raw_empty_test", "data": "raw", "method": "stat",
        "bbox": "0.0,0.0,1.0,1.0",
    })
    assert r_raw_empty.status_code == 200, r_raw_empty.text
    assert r_raw_empty.headers.get("x-row-count") == "0"
    assert len(list(csv.reader(io.StringIO(r_raw_empty.text)))) == 1

    # Unfiltered raw AOI with no raw data still returns 404
    r_404 = client.get("/api/firms/export", params={
        "aoi": "nowhere_missing_aoi", "data": "raw", "method": "stat",
    })
    assert r_404.status_code == 404

    # hts/stan guards for qa_min, platform_set, source_type across calendar/map-cells/export
    for method in ("hts", "stan"):
        for extra in (
            {"qa_min": "high"},
            {"platform_set": "snpp"},
            {"source_type": "land"},
        ):
            r_cal = client.get("/api/firms/calendar", params={"aoi": "vietnam", "data": "sample", "method": method, **extra})
            assert r_cal.status_code == 409
            assert r_cal.json()["detail"]["error_code"] == "model_requires_full_aoi"

            r_map = client.get("/api/firms/map-cells", params={"aoi": "vietnam", "data": "sample", "method": method, "ym": "2019-03", **extra})
            assert r_map.status_code == 409
            assert r_map.json()["detail"]["error_code"] == "model_requires_full_aoi"

            r_exp = client.get("/api/firms/export", params={"aoi": "vietnam", "data": "sample", "method": method, **extra})
            assert r_exp.status_code == 409
            assert r_exp.json()["detail"]["error_code"] == "model_requires_full_aoi"


def test_fetch_live_date_range_chunking_and_disk_cache(tmp_path, monkeypatch):
    _isolate_store(tmp_path, monkeypatch)
    monkeypatch.setenv("FIRMS_MAP_KEY", "secret_cache_key")
    seen_urls: list[str] = []

    def fake_urlopen(url: str, timeout: int = 20):
        seen_urls.append(url)
        # Return a row matching the chunk end_date so each chunk contributes 1 distinct date
        end_part = url.rstrip("/").split("/")[-1]
        csv_body = (
            "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type\n"
            f"19.5,102.5,330.0,1.0,1.0,{end_part},0700,Terra,MODIS,80,6.1NRT,295.0,15.0,D,0\n"
        )
        return _MockResp(csv_body)

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        res1 = firms_live.fetch_live_firms_area(
            [100.0, 18.0, 104.0, 21.0],
            from_date="2026-10-01",
            to_date="2026-10-14",
            sources=["MODIS_NRT"],
        )

    assert res1["ok"] is True
    assert res1["rows"] == 3  # 14 days -> 3 chunks (5, 5, 4)
    assert res1["requested_range"] == ["2026-10-01", "2026-10-14"]
    assert res1["cached"] is False
    assert res1["network_fetches"] == 3
    assert res1["cache_hits"] == 0
    assert len(seen_urls) == 3

    # Second call for the same range must be served 100% from disk cache with 0 network calls
    seen_urls.clear()
    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        res2 = firms_live.fetch_live_firms_area(
            [100.0, 18.0, 104.0, 21.0],
            from_date="2026-10-01",
            to_date="2026-10-14",
            sources=["MODIS_NRT"],
        )

    assert res2["ok"] is True
    assert res2["rows"] == 3
    assert res2["cached"] is True
    assert res2["cache_hits"] == 3
    assert res2["network_fetches"] == 0
    assert len(seen_urls) == 0


def test_fetch_live_date_range_validation(tmp_path, monkeypatch):
    _isolate_store(tmp_path, monkeypatch)
    monkeypatch.setenv("FIRMS_MAP_KEY", "secret_val_key")

    r_bad_order = client.post("/api/firms/fetch-live", json={
        "bbox": [100.0, 18.0, 104.0, 21.0],
        "from_date": "2026-10-15",
        "to_date": "2026-10-01",
    })
    assert r_bad_order.status_code == 400

    r_too_long = client.post("/api/firms/fetch-live", json={
        "bbox": [100.0, 18.0, 104.0, 21.0],
        "from_date": "2026-01-01",
        "to_date": "2026-04-01",
    })
    assert r_too_long.status_code == 400

    r_too_big_bbox = client.post("/api/firms/fetch-live", json={
        "bbox": [-10.0, -10.0, 40.0, 40.0],
        "from_date": "2026-10-01",
        "to_date": "2026-10-05",
    })
    assert r_too_big_bbox.status_code == 400


def test_hybrid_sample_60_days_no_network(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "UPLOAD_DIR", tmp_path / "uploads")
    res = firms_live.fetch_live_firms_area(
        bbox=[104.0, 10.0, 109.0, 16.0],
        from_date="2025-10-01",
        to_date="2025-11-29",
        aoi="vietnam",
        use_sample=True,
    )
    assert res["ok"] is True
    assert res["network_fetches"] == 0
    assert res["sample_rows"] > 0
    assert res["live_rows"] == 0
    assert res["cached"] is True


def test_hybrid_sample_auto_supplements_outside_range(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setenv("FIRMS_MAP_KEY", "test-key")
    called = []

    def fake_fetch(map_key, src, bbox_str, chunk_days, chunk_end):
        called.append((src, chunk_days, chunk_end))
        return (
            "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight\n"
            f"12.5,106.5,320.0,0.4,0.4,{chunk_end},0600,N,VIIRS,n,2.0NRT,295.0,15.0,D\n"
        )

    monkeypatch.setattr(firms_live, "_fetch_source_csv", fake_fetch)
    res = firms_live.fetch_live_firms_area(
        bbox=[104.0, 10.0, 109.0, 16.0],
        from_date="2025-12-20",
        to_date="2026-01-05",
        aoi="vietnam",
        use_sample=True,
    )
    assert res["ok"] is True
    assert res["sample_rows"] > 0
    assert res["live_rows"] > 0
    assert len(called) > 0
    assert all(end >= "2025-12-29" for _src, _days, end in called)


def test_hybrid_rejects_excessive_out_of_sample_days(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "UPLOAD_DIR", tmp_path / "uploads")
    with pytest.raises(ValueError, match="Out-of-sample live fetch cannot exceed"):
        firms_live.fetch_live_firms_area(
            bbox=[104.0, 10.0, 109.0, 16.0],
            from_date="2026-01-01",
            to_date="2026-02-15",
            aoi="vietnam",
            use_sample=True,
        )
