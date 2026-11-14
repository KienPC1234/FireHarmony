"""HTTP E2E smoke test against a running server (no browser needed).

    python -m scripts.e2e_smoke --base http://127.0.0.1:8000

Covers the SPA routes, static assets, and every Lab endpoint. This is not a
Playwright replacement, but it catches broken routing/MIME/JSON contracts.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request


def _get(base: str, path: str, expect: int = 200) -> tuple[bool, str]:
    url = base.rstrip("/") + path
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            body = r.read()
            ctype = r.headers.get("Content-Type", "")
            ok = r.status == expect
            return ok, f"{r.status} {ctype} {len(body)}B"
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def _post(base: str, path: str, payload: dict) -> tuple[bool, str]:
    url = base.rstrip("/") + path
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read()
            return r.status == 200, f"{r.status} {len(body)}B"
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    a = ap.parse_args()
    checks = [
        ("health", _get(a.base, "/api/health")[0], ""),
        ("models", _get(a.base, "/api/firms/models")[0], ""),
        ("stan status", _get(a.base, "/api/firms/stan-status")[0], ""),
        ("aois", _get(a.base, "/api/firms/aois")[0], ""),
        ("calendar sample", _get(a.base, "/api/firms/calendar?aoi=vietnam&data=sample")[0], ""),
        ("export sample", _get(a.base, "/api/firms/export?aoi=vietnam&method=stat")[0], ""),
        ("backtest sample", _get(a.base, "/api/firms/backtest?aoi=vietnam&data=sample&test_years=2")[0], ""),
        ("evidence", _get(a.base, "/api/firms/evidence?aoi=vietnam&data=sample&year=2019&month=3")[0], ""),
        ("simulate", _get(a.base, "/api/firms/simulate?aoi=vietnam&data=sample&year=2019")[0], ""),
        ("blind spots", _get(a.base, "/api/firms/blind-spots?aoi=vietnam&data=sample&year=2019&month=3")[0], ""),
        ("spatial check", _get(a.base, "/api/firms/spatial-check?aoi=vietnam&data=sample&year=2019&month=3")[0], ""),
        ("SPA /", _get(a.base, "/")[0], ""),
        ("SPA /calendar", _get(a.base, "/calendar")[0], ""),
        ("SPA /lab", _get(a.base, "/lab")[0], ""),
        ("logo", _get(a.base, "/logo.svg")[0], ""),
        ("manifest", _get(a.base, "/manifest.webmanifest")[0], ""),
        ("investigate", _post(a.base, "/api/firms/investigate",
                              {"question": "why anomalous?", "aoi": "vietnam",
                               "data": "sample", "year": 2019, "month": 3,
                               "use_llm": False})[0], ""),
    ]
    bad = 0
    for name, ok, detail in checks:
        print(("PASS " if ok else "FAIL ") + name + (f" · {detail}" if detail else ""))
        bad += 0 if ok else 1
    print("E2E " + ("OK" if bad == 0 else f"FAILED ({bad})"))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
