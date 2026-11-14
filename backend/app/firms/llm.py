"""LLM explainer via local Ollama (no API key), grounded on verified facts.

Default model: gemma4:cloud (Ollama cloud pointer, served on this machine's
Ollama at 127.0.0.1:11434). Override with OLLAMA_MODEL / OLLAMA_HOST.
The model only receives pre-computed facts and must quote them verbatim —
it can explain and compare, never invent numbers. Ollama down => honest
fallback to the rule-based answer with llm_used=False.
"""
from __future__ import annotations

import json
import os
import urllib.request

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma4:cloud")

SYSTEM = (
    "You explain a NASA FIRMS fire-activity dashboard. You receive VERIFIED FACTS "
    "(JSON) computed live from the dataset. Rules: (1) every number you state MUST "
    "come from VERIFIED FACTS — copy values exactly, never invent; "
    "(2) the sample data is SYNTHETIC unless data_source says NASA observed — never claim "
    "real fire events from synthetic data; (3) units are hotspot detections / sensor-adjusted "
    "activity index, NEVER confirmed fire counts; (4) the outlook is climatology, not a "
    "prediction; (5) if the answer is not in the facts, say what is missing. "
    "Reply in the same language as the user question (Vietnamese or English). "
    "Keep answers under 200 words."
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


def ask_llm(question: str, facts: dict, fallback_answer: str) -> dict:
    """Ask Ollama; on any failure return the rule-based answer honestly."""
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"QUESTION: {question}\nVERIFIED FACTS:\n{json.dumps(facts)[:6000]}"},
        ],
        "stream": False,
        "options": {"temperature": 0.1},
    }).encode()
    req = urllib.request.Request(
        OLLAMA_HOST.rstrip("/") + "/api/chat", data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.loads(r.read().decode())
        text = (out.get("message") or {}).get("content", "").strip()
        if not text:
            raise ValueError("empty LLM response")
        return {"answer": text, "llm_used": True, "model": OLLAMA_MODEL,
                "provider": "ollama"}
    except Exception as e:  # noqa: BLE001 - Ollama down => honest fallback
        return {"answer": fallback_answer, "llm_used": False,
                "model": OLLAMA_MODEL, "provider": "ollama",
                "reason": f"Ollama call failed ({e}); offline rule-based answer"}
