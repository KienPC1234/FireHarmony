"""HTTP E2E smoke test against a running server (no browser needed).

    python -m scripts.e2e_smoke --base http://127.0.0.1:8000

Covers the SPA routes, static assets, and every Lab endpoint. This is not a
Playwright replacement, but it catches broken routing/MIME/JSON contracts.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
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




def _investigate_probe(base: str, payload: dict) -> tuple[bool, str]:
    """Test public CAPTCHA enforcement or exercise the unguarded local route.

    Public protection is checked by requiring the exact missing-token
    Turnstile response, not by treating every 403 as success. The protected
    path's answer is intentionally *not* tested without a human token.
    """
    url = base.rstrip("/") + "/api/firms/captcha-config"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            if r.status != 200:
                return False, f"captcha-config HTTP {r.status}"
            config = json.loads(r.read(16_384))
        if not isinstance(config, dict) or not isinstance(config.get("enabled"), bool):
            return False, "captcha-config contract invalid"
    except urllib.error.HTTPError as exc:
        # Older frozen releases do not provide a CAPTCHA config endpoint.
        if exc.code == 404:
            return _post(base, "/api/firms/investigate", payload)
        return False, f"captcha-config HTTP {exc.code}"
    except (OSError, ValueError, TypeError) as exc:
        return False, f"captcha-config unavailable ({type(exc).__name__})"

    if not config["enabled"]:
        return _post(base, "/api/firms/investigate", payload)
    if not str(config.get("site_key") or "").strip():
        return False, "captcha enabled but public site key missing"

    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        base.rstrip("/") + "/api/firms/investigate", data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return False, f"captcha enabled but unauthenticated POST returned HTTP {r.status}"
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read(8192))
            code = detail.get("detail", {}).get("error_code")
        except (ValueError, TypeError, AttributeError):
            code = None
        matched = exc.code == 403 and code == "turnstile_required"
        status = "guard verified; response not tested" if matched else "unexpected error"
        return matched, f"HTTP {exc.code} {code!r}; {status}"
    except OSError as exc:
        return False, f"investigate unavailable ({type(exc).__name__})"


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
    ]
    investigator_ok, investigator_detail = _investigate_probe(
        a.base,
        {"question": "why anomalous?", "aoi": "vietnam",
         "data": "sample", "year": 2019, "month": 3, "use_llm": False},
    )
    checks.append(("investigate", investigator_ok, investigator_detail))
    bad = 0
    for name, ok, detail in checks:
        print(("PASS " if ok else "FAIL ") + name + (f" · {detail}" if detail else ""))
        bad += 0 if ok else 1
    print("E2E " + ("OK" if bad == 0 else f"FAILED ({bad})"))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
