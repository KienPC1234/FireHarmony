"""Contract-frag lock (CLAIM-015): de-frag params/guards/labels.

Sample data only (no raw pulls). Each test name starts with
``contract_frag_`` and each assert names the exact contract it locks,
so a failure says which guard/label was removed — never an invented number.
Respects docs/TRUTH_CONTRACT.md: a new guard needs a test that fails
without it (the 409 / split-mismatch / label asserts below do exactly that).
"""
from __future__ import annotations

import pytest
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.firms import evaluation
from app.main import MODEL_DIR, app

client = TestClient(app)


def test_contract_frag_cors_expose_headers():
    """CORS must expose X-Elapsed-Ms/X-Filter-Hash/X-Row-Count; exports must send them."""
    cors = [m for m in app.user_middleware if m.cls is CORSMiddleware]
    assert cors, "CORSMiddleware must stay registered on the app"
    exposed = list(cors[0].kwargs.get("expose_headers", []))
    for header in ("X-Elapsed-Ms", "X-Filter-Hash", "X-Row-Count"):
        assert header in exposed, (
            f"CORS expose_headers must include {header} or browsers cannot "
            f"read it; got {exposed}"
        )
    r = client.get("/api/health")
    assert r.status_code == 200, f"health must stay 200, got {r.status_code}"
    assert r.headers.get("X-Elapsed-Ms") is not None, (
        "elapsed middleware must set X-Elapsed-Ms on every response"
    )
    e = client.get("/api/firms/export", params={
        "aoi": "vietnam", "data": "sample", "method": "stat", "limit": 100})
    assert e.status_code == 200, f"sample export must stay 200, got {e.status_code}"
    assert e.headers.get("X-Row-Count") is not None, (
        "export must send X-Row-Count so the UI never implies a complete CSV")
    assert e.headers.get("X-Filter-Hash"), (
        "export must send X-Filter-Hash so a filtered slice is identifiable")


def test_contract_frag_map_cells_max_cells():
    """map-cells must accept max_cells and cut exactly at it."""
    full = client.get("/api/firms/map-cells", params={
        "ym": "2019-03", "aoi": "vietnam", "data": "sample"})
    assert full.status_code == 200, f"map-cells must stay 200, got {full.status_code}"
    assert full.json()["capped_at"] == 20000, (
        "map-cells default cap must stay 20000 when max_cells is omitted")
    tiny = client.get("/api/firms/map-cells", params={
        "ym": "2019-03", "aoi": "vietnam", "data": "sample", "max_cells": 5})
    assert tiny.status_code == 200, f"map-cells max_cells must stay 200, got {tiny.status_code}"
    body = tiny.json()
    assert body["capped_at"] == 5, "map-cells must echo the requested max_cells as capped_at"
    assert body["returned"] <= 5, (
        f"map-cells must cut cells at max_cells=5, returned {body['returned']}")
    assert body["total"] >= body["returned"], (
        "map-cells total must cover every cell of the month, not just the preview")
    assert body["preview"] == (body["returned"] < body["total"]), (
        "map-cells preview flag must be true exactly when the cap hides cells")


def test_contract_frag_backtest_test_years():
    """backtest must accept test_years; a wrong split must 409, not silently rescore."""
    manifest = evaluation.load_manifest("sample", MODEL_DIR)
    if manifest is None:
        pytest.skip("no sample evaluation manifest; build it before locking the split")
    built = int(manifest.get("test_year_count", 2))
    ok = client.get("/api/firms/backtest", params={
        "aoi": "vietnam", "data": "sample", "test_years": built})
    assert ok.status_code == 200, f"backtest with the built split must stay 200, got {ok.status_code}"
    assert ok.json().get("test_years") == manifest.get("test_years"), (
        "backtest test_years must come from the frozen manifest, never invented")
    wrong = 1 if built != 1 else 6
    bad = client.get("/api/firms/backtest", params={
        "aoi": "vietnam", "data": "sample", "test_years": wrong})
    assert bad.status_code == 409, (
        f"backtest with test_years={wrong} (manifest built with {built}) "
        f"must 409, got {bad.status_code}")
    detail = bad.json().get("detail") or {}
    assert detail.get("error_code") == "evaluation_split_mismatch", (
        f"wrong-split backtest must report evaluation_split_mismatch, got {detail}")


def test_contract_frag_spatial_check_res_deg():
    """spatial-check must accept res_deg, echo it, and keep the NOT-a-holdout label."""
    r = client.get("/api/firms/spatial-check", params={
        "aoi": "vietnam", "data": "sample", "year": 2019, "month": 3, "res_deg": 0.5})
    assert r.status_code == 200, f"spatial-check must stay 200, got {r.status_code}"
    body = r.json()
    assert body.get("res_deg") == 0.5, (
        f"spatial-check must echo the requested res_deg=0.5, got {body.get('res_deg')}")
    assert body.get("aoi_month") == "2019-03", (
        f"spatial-check must scope to the requested AOI-month, got {body.get('aoi_month')}")
    assert "NOT a spatial holdout" in (body.get("claim") or ""), (
        "spatial-check claim must keep the NOT-a-holdout label or it overclaims")
    bad = client.get("/api/firms/spatial-check", params={
        "aoi": "vietnam", "data": "sample", "year": 2019, "month": 3, "res_deg": 5})
    assert bad.status_code == 422, (
        f"spatial-check res_deg=5 (max 1.0) must 422, got {bad.status_code}")


def test_contract_frag_calendar_monthly_filters_platform_mix():
    """calendar JSON must carry monthly/filters + calendar.platform_mix (top-level alias if present)."""
    r = client.get("/api/firms/calendar", params={
        "aoi": "vietnam", "data": "sample", "limit": 100})
    assert r.status_code == 200, f"sample calendar must stay 200, got {r.status_code}"
    body = r.json()
    assert isinstance(body.get("monthly"), dict) and body["monthly"], (
        "calendar must include the monthly slot totals the summary is computed from")
    filters = body.get("filters")
    assert isinstance(filters, dict) and filters.get("qa_min") == "all", (
        f"calendar must echo the active filters, got {filters}")
    nested = (body.get("calendar") or {}).get("platform_mix")
    assert isinstance(nested, dict) and nested, (
        "calendar.calendar.platform_mix must stay the canonical platform-mix location")
    if "platform_mix" in body:
        assert body["platform_mix"] == nested, (
            "top-level platform_mix alias must equal calendar.platform_mix when present")
    assert "synthetic" in (body.get("data_source") or "").lower(), (
        "sample calendar must keep the synthetic label or it overclaims observed fires")


def test_contract_frag_hts_bbox_409():
    """hts/stan + bbox must 409 model_requires_full_aoi (model totals are not reallocatable)."""
    for endpoint in ("/api/firms/calendar", "/api/firms/map-cells"):
        params = {"aoi": "vietnam", "data": "sample", "method": "hts",
                  "bbox": "104,13,109,16"}
        if endpoint == "/api/firms/map-cells":
            params["ym"] = "2019-03"
        r = client.get(endpoint, params=params)
        assert r.status_code == 409, (
            f"{endpoint} hts+bbox must 409, got {r.status_code}: {r.text[:200]}")
        detail = r.json().get("detail") or {}
        assert detail.get("error_code") == "model_requires_full_aoi", (
            f"{endpoint} hts+bbox must report model_requires_full_aoi, got {detail}")
