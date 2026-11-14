"""Tests for Ask AI Tool Agent (`agent_tools.py`), help guide (`help_data.py`), and SSE streaming."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.firms import agent_tools, help_data  # noqa: E402
from app.main import _SENSOR_KW, _analysis_for_evidence, _sensor_context_facts, app  # noqa: E402
from app.routers.system import _data_source_label, _evaluation_facts  # noqa: E402


def _make_ctx(aoi: str = "vietnam", data: str = "sample", method: str = "stat") -> agent_tools.AgentContext:
    return agent_tools.AgentContext(
        aoi=aoi,
        data=data,
        analysis_method=method,
        requested_method=method,
        bbox=None,
        qa_min="all",
        platform_set="all",
        focus_ym="2025-03",
        year=2025,
        month=3,
        dataset_str=None,
        audience_mode="research",
        analysis_fn=_analysis_for_evidence,
        eval_fn=_evaluation_facts,
        source_label_fn=_data_source_label,
        sensor_ctx_fn=_sensor_context_facts,
    )


def test_help_topics_and_matching():
    for topic in ("overview", "fetch_live", "timeline", "filters", "map", "models", "export", "all"):
        res = help_data.get_help_topic(topic)
        assert res["topic"] == topic
    assert help_data.match_help_topic("Làm sao fetch dữ liệu NASA FIRMS?") == "fetch_live"
    assert help_data.match_help_topic("Cách mở rộng timeline?") == "timeline"
    assert help_data.match_help_topic("Bộ lọc QA và SNPP hoạt động sao?") == "filters"


def test_all_eight_agent_tools_execute():
    ctx = _make_ctx()
    res_help, _ = ctx.execute_tool("get_help_guide", {"topic": "fetch_live"})
    assert res_help["topic"] == "fetch_live" and len(res_help["steps"]) >= 3

    res_region, _ = ctx.execute_tool("get_region_summary", {})
    assert res_region["aoi"] == "vietnam" and res_region["n_records"] > 0

    res_ev, _ = ctx.execute_tool("get_month_evidence", {"year": 2025, "month": 3})
    assert res_ev.get("aoi") == "vietnam" and res_ev.get("ym") == "2025-03"

    res_crit, _ = ctx.execute_tool("get_critical_periods", {"limit": 3})
    assert len(res_crit["top_months"]) == 3

    res_eval, _ = ctx.execute_tool("get_evaluation_metrics", {})
    assert res_eval["evaluation"] is not None

    res_sensor, _ = ctx.execute_tool("get_sensor_comparison", {})
    assert res_sensor["satellite_specs"]["VIIRS_resolution_m"] == 375

    res_season, _ = ctx.execute_tool("get_seasonal_climatology", {})
    assert len(res_season["monthly_medians"]) == 12 and len(res_season["peak_months"]) == 3

    res_yearly, _ = ctx.execute_tool("get_yearly_comparison", {"year": 2024})
    assert res_yearly["requested_year"]["year"] == 2024
    assert res_yearly["previous_year"]["year"] == 2023


def test_run_tool_agent_mocked_multi_turn(monkeypatch):
    calls = {"n": 0}

    def fake_ollama(messages, use_tools=True):
        calls["n"] += 1
        if calls["n"] == 1:
            return {
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {"function": {"name": "get_help_guide", "arguments": {"topic": "fetch_live"}}}
                    ],
                }
            }
        return {
            "message": {
                "role": "assistant",
                "content": "Chọn vùng tối đa 35° × 35° và tối đa 14 ngày rồi bấm Fetch NASA FIRMS data.",
            }
        }

    monkeypatch.setattr(agent_tools, "_ollama_chat", fake_ollama)
    ctx = _make_ctx()
    events = list(agent_tools.run_tool_agent("Cách tải dữ liệu NASA FIRMS?", ctx, use_llm=True))
    tool_events = [e for e in events if e["type"] == "tool"]
    meta_events = [e for e in events if e["type"] == "meta"]
    delta_events = [e for e in events if e["type"] == "delta"]
    assert len(tool_events) == 1 and tool_events[0]["name"] == "get_help_guide"
    assert meta_events[0]["meta"]["tools_used"] == ["get_help_guide"]
    assert all(d["llm_used"] is True for d in delta_events)


def test_investigate_stream_raw_stan_no_409():
    client = TestClient(app)
    resp = client.post(
        "/api/firms/investigate-stream",
        json={
            "question": "Tóm tắt số liệu vùng đang xem?",
            "aoi": "vietnam",
            "data": "raw",
            "method": "stan",
            "mode": "explore",
            "use_llm": False,
        },
    )
    assert resp.status_code == 200
    assert "event: error" not in resp.text
    assert "event: tool" in resp.text
    assert "event: done" in resp.text
