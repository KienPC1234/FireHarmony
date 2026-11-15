"""Tool-calling AI Agent for Ask AI (/api/firms/investigate-stream).

Instead of stuffing all dataset facts into the prompt upfront, the LLM
(`gemma4:cloud` via local Ollama) dynamically invokes focused tools:
- `get_help_guide`: dedicated UI operation & user guide (`help_data.py`)
- `get_region_summary`: current AOI / dataset / filter / latest-month stats
- `get_month_evidence`: cell coverage, missing days & z-anomaly for a month
- `get_critical_periods`: top anomalous months
- `get_evaluation_metrics`: MAE / WAPE / bias parity & coverage summary
- `get_sensor_comparison`: MODIS (1 km) vs VIIRS (375 m) & era transition

Every tool call is streamed to the frontend as an `event: tool` SSE event so
the user sees exactly which tools the AI invoked.
"""
from __future__ import annotations

import json
import re
import urllib.request
from typing import Any, Callable

from . import dl
from . import evidence as evd
from . import explain as ex
from . import help_data as hd
from . import llm

SATELLITE_SPECS = {
    "MODIS_resolution_km": 1,
    "MODIS_launch_year": 2000,
    "VIIRS_resolution_m": 375,
    "VIIRS_launch_year": 2012,
}

DEFAULT_LIMITATIONS = [
    "AOI-month MAE against a VIIRS reference, not fire ground truth.",
    "A missing detection is not proof of no fire (cloud/smoke/sub-pixel).",
    "Australia remains a sparse 5-day-window series.",
    "Cell-day estimates are not spatially validated.",
]

AGENT_SYSTEM = (
    "You are the Ask AI Tool Agent for the NASA FIRMS Fire Activity Calendar dashboard. "
    "You have tools to load UI operation help guides and live dataset facts on demand. "
    "Rules: "
    "(1) ALWAYS call the relevant tool(s) before answering rather than guessing; "
    "for UI operation / how-to questions (fetching NASA FIRMS data, drawing regions, timeline, filters, map reading, exporting CSV), call `get_help_guide`; "
    "for region stats or numbers, call `get_region_summary`, `get_month_evidence`, `get_critical_periods`, `get_evaluation_metrics`, or `get_sensor_comparison` as needed; "
    "(2) every number you state MUST come verbatim from tool outputs: never invent numbers; "
    "(3) format all numbers with '.' as the decimal separator and NO thousands separators (e.g. 5819.12, NOT 5.819,12); "
    "(4) sample data is SYNTHETIC unless data_source says NASA observed; "
    "(5) units are hotspot detections / sensor-adjusted activity index, NEVER confirmed fire counts; "
    "(6) adapt tone to `audience_mode`: `explore` = clear, step-by-step plain language; `research` = concise technical precision; "
    "(7) format answers in clean Markdown: put each numbered step or bullet item on its own line (with a newline before `1.`, `2.`, `- `) so text is scannable; "
    "(8) reply in `ui_language` (or match the user question language if explicitly different) and keep answers concise (under 240 words)."
)

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_help_guide",
            "description": "Load dedicated step-by-step user operation help & UI guide for using the app.",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "enum": ["overview", "fetch_live", "timeline", "filters", "map", "models", "export", "all"],
                        "description": "The UI feature or operation topic to load help instructions for.",
                    }
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_region_summary",
            "description": "Get compact summary statistics for the currently selected AOI, dataset, bbox, filters, k-factor, and latest month.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_month_evidence",
            "description": "Get detailed evidence card for a specific year and month: observed vs estimated cells, paired coverage ratio, missing days, and anomaly z.",
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {"type": "integer", "description": "Calendar year, e.g. 2025"},
                    "month": {"type": "integer", "description": "Calendar month 1..12, e.g. 3"},
                },
                "required": ["year", "month"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_critical_periods",
            "description": "Get top anomalous hotspot months (highest positive z-scores) in the current AOI/dataset.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Number of top months to return (default 5, max 10)."}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_evaluation_metrics",
            "description": "Get model evaluation metrics (MAE, WAPE, bias for raw MODIS, global ratio, seasonal ratio, STAN/HTS) and paired coverage summary.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_sensor_comparison",
            "description": "Get MODIS (1 km) vs VIIRS (375 m) satellite specs, 2012 transition era ratio, and sensor context for the current AOI.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_seasonal_climatology",
            "description": "Get 12 monthly historical medians (Jan-Dec) and peak/quiet seasonal months for the current AOI.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_yearly_comparison",
            "description": "Get annual hotspot activity index totals and peak/recent year comparisons.",
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {"type": "integer", "description": "Optional specific year to compare against the previous year and peak year."}
                },
            },
        },
    },
]


def _compact_evaluation(ev: dict | None) -> dict | None:
    if not isinstance(ev, dict):
        return ev
    out = {k: v for k, v in ev.items() if k != "per_aoi"}
    per_aoi = ev.get("per_aoi")
    if isinstance(per_aoi, dict):
        compact_aois = {}
        for aoi_key, aoi_val in per_aoi.items():
            if not isinstance(aoi_val, dict):
                compact_aois[aoi_key] = aoi_val
                continue
            item = {k: v for k, v in aoi_val.items() if k not in ("coverage", "unified_eval")}
            cov = aoi_val.get("coverage")
            if isinstance(cov, dict):
                item["coverage"] = {k: v for k, v in cov.items() if k != "months_detail"}
            ue = aoi_val.get("unified_eval")
            if isinstance(ue, dict):
                item["unified_eval"] = {k: v for k, v in ue.items() if k != "coverage"}
            compact_aois[aoi_key] = item
        out["per_aoi"] = compact_aois
    return out


class AgentContext:
    """Lazy loader for FIRMS analysis so tools compute only what the LLM asks for."""

    def __init__(
        self,
        *,
        aoi: str,
        data: str,
        analysis_method: str,
        requested_method: str,
        bbox: str | None,
        qa_min: str,
        platform_set: str,
        focus_ym: str | None,
        year: int | None,
        month: int | None,
        dataset_str: str | None,
        audience_mode: str,
        lang: str = "vi",
        analysis_fn: Callable[..., dict],
        eval_fn: Callable[[str, str], dict | None],
        source_label_fn: Callable[[str, str | None], str],
        sensor_ctx_fn: Callable[[str, dict], dict | None],
    ) -> None:
        self.aoi = aoi
        self.data = data
        self.analysis_method = analysis_method
        self.requested_method = requested_method
        self.bbox = bbox
        self.qa_min = qa_min
        self.platform_set = platform_set
        self.focus_ym = focus_ym
        self.year = year
        self.month = month
        self.dataset_str = dataset_str
        self.audience_mode = audience_mode
        self.lang = "en" if str(lang).lower().startswith("en") else "vi"
        self._analysis_fn = analysis_fn
        self._eval_fn = eval_fn
        self._source_label_fn = source_label_fn
        self._sensor_ctx_fn = sensor_ctx_fn
        self._out: dict | None = None
        self._facts: dict | None = None
        self._evidence: dict | None = None

    def ensure_analysis(self, *, need_daily: bool = False) -> tuple[dict, dict]:
        if self._out is None:
            kwargs: dict[str, Any] = {
                "focus_ym": self.focus_ym,
                "dataset": self.dataset_str,
            }
            if not need_daily:
                kwargs["daily_cap"] = 5000
            try:
                self._out = self._analysis_fn(
                    self.aoi,
                    self.data,
                    self.analysis_method,
                    self.bbox,
                    self.qa_min,
                    self.platform_set,
                    **kwargs,
                )
            except TypeError:
                kwargs.pop("daily_cap", None)
                self._out = self._analysis_fn(
                    self.aoi,
                    self.data,
                    self.analysis_method,
                    self.bbox,
                    self.qa_min,
                    self.platform_set,
                    **kwargs,
                )
            self._facts = ex.gather_facts(
                self._out["calendar"],
                self._out["daily_cells"],
                self._out["ratios"],
                self._out.get("qa", {}).get("clean", 0),
                self.bbox,
                method=self._out.get("method_id"),
                evaluation=self._eval_fn(self.aoi, self.data),
                coverage=self._out.get("coverage"),
                filters=self._out.get("filters"),
            )
            self._facts["data_source"] = self._source_label_fn(self.data, self.dataset_str)
            self._facts["latest"] = self._out["latest"]
        assert self._out is not None and self._facts is not None
        return self._out, self._facts

    def execute_tool(self, name: str, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
        if name == "get_help_guide":
            topic = str(args.get("topic") or "all")
            res = hd.get_help_topic(topic, lang=self.lang)
            title = res.get("title") or f"Help ({topic})"
            return res, title

        out, facts = self.ensure_analysis(need_daily=(name == "get_month_evidence"))
        if name == "get_region_summary":
            res = {
                "aoi": self.aoi,
                "data": self.data,
                "dataset": self.dataset_str,
                "requested_method": self.requested_method,
                "effective_analysis_method": self.analysis_method,
                "n_records": facts.get("n_records"),
                "years": facts.get("years"),
                "n_years": facts.get("n_years"),
                "daily_cells": facts.get("daily_cells"),
                "bbox": facts.get("bbox"),
                "k_fallback": facts.get("k_fallback"),
                "k_months_measured": facts.get("k_months_measured"),
                "k_mode": facts.get("k_mode"),
                "data_source": facts.get("data_source"),
                "latest": facts.get("latest"),
                "filters": facts.get("filters"),
            }
            return res, f"{self.aoi} ({res['n_records']} records)"

        if name == "get_month_evidence":
            yr = int(args.get("year") or self.year or 2025)
            mo = int(args.get("month") or self.month or 1)
            mo = max(1, min(12, mo))
            ev = evd.build_evidence(out, out.get("daily") or [], self.aoi, self.data, self.analysis_method, yr, mo)
            self._evidence = ev
            return ev, f"Evidence {yr}-{mo:02d}"

        if name == "get_critical_periods":
            limit = max(1, min(10, int(args.get("limit") or 5)))
            top = (out.get("critical_periods") or [])[:limit]
            return {"top_months": top, "z_unit": facts.get("z_unit")}, f"Top {len(top)} anomalous months"

        if name == "get_evaluation_metrics":
            ev = _compact_evaluation(facts.get("evaluation"))
            return {"evaluation": ev, "coverage": facts.get("coverage")}, "Unified eval & coverage"

        if name == "get_sensor_comparison":
            sctx = self._sensor_ctx_fn(self.aoi, facts)
            res = {
                "satellite_specs": SATELLITE_SPECS,
                "era_ratio": facts.get("era_ratio"),
                "calibration_window": facts.get("calibration_window"),
                "sensor_context": sctx,
            }
            return res, f"MODIS 1km vs VIIRS 375m (era_ratio={facts.get('era_ratio')})"

        if name == "get_seasonal_climatology":
            meds = facts.get("col_medians") or []
            monthly = {str(i + 1): round(float(v), 2) for i, v in enumerate(meds) if v is not None}
            ranked = sorted(monthly.items(), key=lambda kv: kv[1], reverse=True)
            peak_months = [int(k) for k, _v in ranked[:3]]
            quiet_months = [int(k) for k, _v in ranked[-3:]]
            return {
                "monthly_medians": monthly,
                "peak_months": peak_months,
                "quiet_months": quiet_months,
                "unit": "sensor-adjusted hotspot detections (NOT confirmed fires)",
            }, f"Peak months {peak_months}"

        if name == "get_yearly_comparison":
            cal_data = out.get("calendar") or {}
            years_list = cal_data.get("years") or []
            matrix = cal_data.get("matrix") or []
            totals = [
                {"year": int(yr), "total_index": round(sum(float(x or 0.0) for x in row), 2)}
                for yr, row in zip(years_list, matrix)
            ]
            peak_year = max(totals, key=lambda item: item["total_index"]) if totals else None
            req_yr = args.get("year")
            focus_entry = None
            prev_entry = None
            if req_yr is not None:
                yr_int = int(req_yr)
                focus_entry = next((t for t in totals if t["year"] == yr_int), None)
                prev_entry = next((t for t in totals if t["year"] == yr_int - 1), None)
            return {
                "recent_years": totals[-5:],
                "peak_year": peak_year,
                "requested_year": focus_entry,
                "previous_year": prev_entry,
            }, f"{len(totals)} years (peak={peak_year['year'] if peak_year else 'N/A'})"

        return {"error": f"Unknown tool: {name}"}, f"Unknown tool {name}"


def _ollama_chat(messages: list[dict[str, Any]], use_tools: bool = True) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": llm.OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.1},
    }
    if use_tools:
        payload["tools"] = TOOL_SCHEMAS
    body = json.dumps(payload, ensure_ascii=False).encode()
    req = urllib.request.Request(
        llm.OLLAMA_HOST.rstrip("/") + "/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode())


def _fallback_answer(question: str, ctx: AgentContext) -> tuple[str, list[str], list[dict[str, Any]], dict]:
    """Deterministic fallback when Ollama is offline or fails grounding."""
    help_topic = hd.match_help_topic(question)
    if help_topic:
        h = hd.get_help_topic(help_topic, lang=ctx.lang)
        lines = [f"**{h['title']}**", "", *h["steps"]]
        tool_rec = {"name": "get_help_guide", "args": {"topic": help_topic}, "summary": h["title"]}
        return "\n".join(lines), ["get_help_guide"], [tool_rec], {"satellite_specs": SATELLITE_SPECS}

    out, facts = ctx.ensure_analysis()
    rule = ex.answer(question, facts, out["critical_periods"], out["latest"], dl.describe())
    tool_rec = {"name": "get_region_summary", "args": {}, "summary": f"{ctx.aoi} fallback"}
    return rule["answer"], ["get_region_summary"], [tool_rec], facts


def run_tool_agent(question: str, ctx: AgentContext, use_llm: bool = True):
    """Run the Ollama tool-calling loop and yield SSE-ready event dicts."""
    context_header = {
        "aoi": ctx.aoi,
        "data": ctx.data,
        "dataset": ctx.dataset_str,
        "bbox": ctx.bbox,
        "focus_ym": ctx.focus_ym,
        "requested_method": ctx.requested_method,
        "effective_analysis_method": ctx.analysis_method,
        "audience_mode": ctx.audience_mode,
        "ui_language": "English" if ctx.lang == "en" else "Vietnamese",
        "qa_min": ctx.qa_min,
        "platform_set": ctx.platform_set,
        "satellite_specs": SATELLITE_SPECS,
    }
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": AGENT_SYSTEM},
        {
            "role": "user",
            "content": (
                f"CONTEXT: {json.dumps(context_header, ensure_ascii=False)}\n"
                f"QUESTION: {question}"
            ),
        },
    ]

    tool_calls_log: list[dict[str, Any]] = []
    collected_facts: dict[str, Any] = {"context": context_header}
    final_text = ""
    llm_used = False

    if use_llm:
        try:
            for _step in range(4):
                resp = _ollama_chat(messages, use_tools=True)
                msg = resp.get("message") or {}
                calls = msg.get("tool_calls") or []
                if not calls:
                    final_text = str(msg.get("content") or "").strip()
                    break
                messages.append(msg)
                for call in calls:
                    fn = call.get("function") or {}
                    t_name = str(fn.get("name") or "")
                    t_args = fn.get("arguments") or {}
                    if isinstance(t_args, str):
                        try:
                            t_args = json.loads(t_args)
                        except Exception:
                            t_args = {}
                    yield {
                        "type": "status",
                        "stage": "tool_call",
                        "detail": f"Calling {t_name}...",
                    }
                    result, summary = ctx.execute_tool(t_name, t_args)
                    rec = {"name": t_name, "args": t_args, "summary": summary}
                    tool_calls_log.append(rec)
                    collected_facts[f"{t_name}_{len(tool_calls_log)}"] = result
                    yield {"type": "tool", **rec}
                    messages.append({
                        "role": "tool",
                        "tool_name": t_name,
                        "content": json.dumps(result, ensure_ascii=False)[:10000],
                    })
            if not final_text and tool_calls_log:
                resp = _ollama_chat(messages, use_tools=False)
                final_text = str((resp.get("message") or {}).get("content") or "").strip()
            if final_text:
                ok, bad = llm._large_numbers_grounded(final_text, collected_facts, question)
                if ok:
                    llm_used = True
                else:
                    final_text = ""
        except Exception:
            final_text = ""

    if not final_text:
        fb_text, fb_tools, fb_records, fb_facts = _fallback_answer(question, ctx)
        if not tool_calls_log:
            for rec in fb_records:
                tool_calls_log.append(rec)
                yield {"type": "tool", **rec}
        tools_used = list(dict.fromkeys([c["name"] for c in tool_calls_log] or fb_tools))
        facts_for_meta = ctx._facts or fb_facts
        final_text = fb_text
    else:
        tools_used = list(dict.fromkeys(c["name"] for c in tool_calls_log)) or ["direct_context"]
        facts_for_meta = ctx._facts or {"satellite_specs": SATELLITE_SPECS}

    yield {
        "type": "meta",
        "meta": {
            "tools_used": tools_used,
            "tool_calls": tool_calls_log,
            "evidence": ctx._evidence,
            "facts": facts_for_meta,
            "suggestions": [],
            "limitations": DEFAULT_LIMITATIONS,
            "citations": (ctx._evidence or {}).get("citations", []),
        },
    }
    yield {"type": "status", "stage": "synthesizing", "detail": "Synthesizing grounded answer..."}

    for piece in re.findall(r"\S+\s*", final_text):
        yield {"type": "delta", "delta": piece, "llm_used": llm_used}
    yield {"type": "done", "full_answer": final_text}
