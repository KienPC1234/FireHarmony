"""LLM explainer via local Ollama (no API key), grounded on verified facts.

Default model: gemma4:cloud (Ollama cloud pointer, served on this machine's
Ollama at 127.0.0.1:11434). Override with OLLAMA_MODEL / OLLAMA_HOST.
The model only receives pre-computed facts and must quote them verbatim -
it can explain and compare, never invent numbers. Ollama down => honest
fallback to the rule-based answer with llm_used=False.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma4:cloud")

SYSTEM = (
    "You explain a NASA FIRMS fire-activity dashboard. You receive VERIFIED FACTS "
    "(JSON) computed live from the dataset. Rules: (1) every number you state MUST "
    "come from VERIFIED FACTS: copy values exactly, never invent; "
    "(2) the sample data is SYNTHETIC unless data_source says NASA observed: never claim "
    "real fire events from synthetic data; (3) units are hotspot detections / sensor-adjusted "
    "activity index, NEVER confirmed fire counts; (4) the outlook is climatology, not a "
    "prediction; (5) if an evidence card is present, explain total/observed/estimated cells, "
    "coverage ratio and missing days, anomaly z, k and the effective method; "
    "(6) if coverage is partial or unknown, say so before interpreting the month; "
    "(7) cite the endpoints in `citations` when relevant, without inventing URLs; "
    "(8) if the answer is not in the facts, say what is missing. "
    "Reply in the same language as the user question (Vietnamese or English). "
    "Keep answers under 220 words."
)


def _tags() -> list[str]:
    try:
        with urllib.request.urlopen(OLLAMA_HOST.rstrip("/") + "/api/tags", timeout=5) as r:
            out = json.loads(r.read().decode())
        return [m.get("name", "") for m in out.get("models", [])]
    except Exception:
        return []


def available() -> dict:
    models = _tags()
    return {"llm_available": len(models) > 0,
            "provider": "ollama",
            "host": OLLAMA_HOST,
            "model": OLLAMA_MODEL,
            "models": models[:20]}


def _number_tokens(text: str) -> list[tuple[str, float, bool]]:
    """(raw token, value, has_decimal) for every numeric token in `text`."""
    out: list[tuple[str, float, bool]] = []
    for tok in re.findall(r"\d[\d,.]*", text):
        raw = tok.rstrip(".")
        if not raw:
            continue
        try:
            val = float(raw.replace(",", ""))
        except ValueError:
            continue
        out.append((raw, val, ("." in raw or "," in raw)))
    return out


def _large_numbers_grounded(answer: str, facts: dict,
                            question: str = "") -> tuple[bool, list[str]]:
    """Audit V6 P0-07: every stated number must be grounded, not only >=1000.

    Allowed without a fact match: calendar years 1990-2100, day/month ordinals
    0-31, 0/100, and percent renderings of a fractional fact (0.9 -> 90).
    Decimals are compared at full precision, so 2386.4 cannot hide as 2386.9;
    integer claims must literally appear in the facts. Wrong small numbers
    (e.g. "75%" when no fact contains 75) now fail the guard.
    """
    fact_tokens = _number_tokens(json.dumps(facts, ensure_ascii=False))
    fact_ints = {int(v) for _r, v, dec in fact_tokens if not dec}
    fact_floats = {round(v, 4) for _r, v, _dec in fact_tokens}
    fact_floats |= {round(v * 100, 4) for _r, v, _dec in fact_tokens
                    if 0 < v <= 1}
    question_years = {int(v) for _r, v, _dec in _number_tokens(question)
                      if 1990 <= v <= 2100}
    bad: list[str] = []
    for raw, val, has_decimal in _number_tokens(answer):
        if 1990 <= val <= 2100:
            continue
        if not has_decimal and 0 <= val <= 31:
            continue
        if val in (0.0, 100.0):
            continue
        if has_decimal:
            if round(val, 4) in fact_floats:
                continue
        elif int(val) in fact_ints or float(val) in fact_floats:
            continue
        bad.append(raw)
    return (not bad), bad


def ask_llm(question: str, facts: dict, fallback_answer: str) -> dict:
    """Ask Ollama; on any failure return the rule-based answer honestly."""
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"QUESTION: {question}\nVERIFIED FACTS:\n{json.dumps(facts, ensure_ascii=False)[:12000]}"},
        ],
        "stream": False,
        "options": {"temperature": 0.1},
    }).encode()
    req = urllib.request.Request(
        OLLAMA_HOST.rstrip("/") + "/api/chat", data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.loads(r.read().decode())
        text = (out.get("message") or {}).get("content", "").strip()
        if not text:
            raise ValueError("empty LLM response")
        ok, bad = _large_numbers_grounded(text, facts, question)
        if not ok:
            return {"answer": fallback_answer, "llm_used": False,
                    "model": OLLAMA_MODEL, "provider": "ollama",
                    "reason": f"ungrounded numbers {bad}; returned rule-based answer"}
        return {"answer": text, "llm_used": True, "model": OLLAMA_MODEL,
                "provider": "ollama"}
    except Exception as e:  # noqa: BLE001 - Ollama down => honest fallback
        return {"answer": fallback_answer, "llm_used": False,
                "model": OLLAMA_MODEL, "provider": "ollama",
                "reason": f"Ollama call failed ({e}); offline rule-based answer"}
