"""Contract-schema lock (CLAIM-020): loose Pydantic validation of payloads.

Sample data only. Validates that real payloads parse under the loose
schemas in app.firms.schemas; a fail means the schema is too strict
(fix the schema), never the endpoint.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.firms import schemas as S
from app.main import app

client = TestClient(app)


def test_contract_schema_calendar():
    r = client.get("/api/firms/calendar", params={
        "aoi": "vietnam", "data": "sample", "limit": 100})
    assert r.status_code == 200, f"sample calendar must stay 200, got {r.status_code}"
    m = S.CalendarResponse.model_validate(r.json())
    assert m.daily_cells is not None and m.daily_cells >= 0
    assert m.calendar is not None and m.calendar.years, "calendar.years must be present"
    assert isinstance(m.calendar.matrix, list)


def test_contract_schema_map_cells():
    r = client.get("/api/firms/map-cells", params={
        "ym": "2019-03", "aoi": "vietnam", "data": "sample"})
    assert r.status_code == 200, f"map-cells must stay 200, got {r.status_code}"
    m = S.MapCellsResponse.model_validate(r.json())
    assert m.cells is not None, "map-cells must carry cells"
    assert m.ym == "2019-03"


def test_contract_schema_evidence():
    r = client.get("/api/firms/evidence", params={
        "aoi": "vietnam", "data": "sample", "method": "stat",
        "year": 2019, "month": 3})
    assert r.status_code == 200, f"evidence must stay 200, got {r.status_code}"
    m = S.EvidenceResponse.model_validate(r.json())
    assert m.ym == "2019-03", f"evidence must echo ym=2019-03, got {m.ym}"
    assert m.total_activity_index is not None


def test_contract_schema_backtest():
    r = client.get("/api/firms/backtest", params={
        "aoi": "vietnam", "data": "sample"})
    assert r.status_code == 200, f"backtest must stay 200, got {r.status_code}"
    m = S.BacktestResponse.model_validate(r.json())
    assert m.metrics is not None, "backtest must carry metrics"
    assert m.months, "backtest must carry months"


def test_contract_schema_xray():
    r = client.get("/api/firms/xray", params={
        "aoi": "vietnam", "data": "sample"})
    assert r.status_code == 200, f"xray must stay 200, got {r.status_code}"
    m = S.XrayResponse.model_validate(r.json())
    assert m.months, "xray must carry months"
    assert m.aoi == "vietnam"


def test_contract_schema_health():
    r = client.get("/api/health")
    assert r.status_code == 200, f"health must stay 200, got {r.status_code}"
    m = S.HealthResponse.model_validate(r.json())
    assert m.status == "ok"
    assert m.service is not None or r.json().get("service") is not None
