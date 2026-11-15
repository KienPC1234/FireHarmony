"""Turnstile gate: fail-open when unconfigured, enforce on public requests."""
from __future__ import annotations

import json
import sys
import urllib.error
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.firms import turnstile  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


class _Headers(dict):
    """Case-insensitive headers like Starlette's."""

    def get(self, key, default=None):
        for k, v in self.items():
            if k.lower() == str(key).lower():
                return v
        return default


class _Client:
    def __init__(self, host: str = "127.0.0.1"):
        self.host = host


class _State:
    pass


class _Request:
    def __init__(self, headers: dict | None = None, host: str = "127.0.0.1"):
        self.headers = _Headers(headers or {})
        self.client = _Client(host)
        self.state = _State()


PUBLIC = {"X-Forwarded-For": "203.0.113.9", "Host": "kien-x99.tail6306c6.ts.net"}
LOCAL = {}


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setenv("TURNSTILE_SITE_KEY", "site-public")
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret-private")
    monkeypatch.delenv("TURNSTILE_ALLOW_DIRECT", raising=False)
    return "secret-private"


def test_fail_open_without_secret(monkeypatch):
    monkeypatch.delenv("TURNSTILE_SECRET_KEY", raising=False)
    monkeypatch.setenv("TURNSTILE_SITE_KEY", "site-public")
    assert turnstile.required(_Request(PUBLIC)) is False
    # No secret -> enforce is a no-op even with no token.
    turnstile.enforce(_Request(PUBLIC), {"question": "hi"})


def test_public_request_requires_check(keys):
    assert turnstile.required(_Request(PUBLIC)) is True


def test_direct_request_skipped_by_default(keys):
    assert turnstile.required(_Request(LOCAL)) is False
    turnstile.enforce(_Request(LOCAL))


def test_direct_request_enforced_when_opted_out(keys, monkeypatch):
    monkeypatch.setenv("TURNSTILE_ALLOW_DIRECT", "0")
    assert turnstile.required(_Request(LOCAL)) is True


def test_missing_token_rejected(keys):
    with pytest.raises(HTTPException) as exc:
        turnstile.enforce(_Request(PUBLIC), {"question": "hi"})
    assert exc.value.status_code == 403
    assert exc.value.detail["error_code"] == "turnstile_required"


def test_header_token_accepted(keys):
    req = _Request({**PUBLIC, "X-Turnstile-Token": "tok-1"})
    with patch.object(turnstile, "verify_token", return_value=(True, [])) as verify:
        turnstile.enforce(req, {"question": "hi"})
    verify.assert_called_once()
    assert verify.call_args.args[0] == "tok-1"
    assert verify.call_args.kwargs["remote_ip"] == "203.0.113.9"


def test_body_token_used_for_json_endpoints(keys):
    req = _Request(PUBLIC)
    with patch.object(turnstile, "verify_token", return_value=(True, [])):
        turnstile.enforce(req, {"question": "hi", "turnstile_token": "tok-2"})


def test_failed_verification_rejected(keys):
    req = _Request(PUBLIC, host="203.0.113.9")
    with patch.object(turnstile, "verify_token", return_value=(False, ["invalid-input-response"])):
        with pytest.raises(HTTPException) as exc:
            turnstile.enforce(req, {"turnstile_token": "expired"})
    assert exc.value.status_code == 403
    assert exc.value.detail["error_code"] == "turnstile_failed"
    assert exc.value.detail["codes"] == ["invalid-input-response"]


def test_verifier_unreachable_is_503(keys):
    req = _Request(PUBLIC)
    with patch.object(turnstile, "verify_token",
                      side_effect=turnstile.TurnstileUnavailable("dns")):
        with pytest.raises(HTTPException) as exc:
            turnstile.enforce(req, {"turnstile_token": "tok"})
    assert exc.value.status_code == 503
    assert exc.value.detail["error_code"] == "turnstile_unavailable"


class _Resp:
    def __init__(self, payload: dict):
        self._body = json.dumps(payload).encode()

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_verify_token_posts_secret_and_remote_ip(keys):
    captured = {}

    def fake_urlopen(req, timeout=0):
        captured["url"] = req.full_url
        captured["body"] = req.data.decode()
        return _Resp({"success": True, "error-codes": []})

    with patch("urllib.request.urlopen", fake_urlopen):
        ok, codes = turnstile.verify_token("tok-3", remote_ip="203.0.113.9")
    assert ok is True and codes == []
    assert captured["url"] == turnstile.VERIFY_URL
    assert "secret=secret-private" in captured["body"]
    assert "response=tok-3" in captured["body"]
    assert "remoteip=203.0.113.9" in captured["body"]


def test_verify_token_network_error_raises_unavailable(keys):
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("boom")):
        with pytest.raises(turnstile.TurnstileUnavailable):
            turnstile.verify_token("tok")


def test_captcha_config_local_is_disabled(keys):
    r = client.get("/api/firms/captcha-config")
    assert r.status_code == 200
    assert r.json() == {"enabled": False, "site_key": ""}


def test_captcha_config_public_reports_site_key(keys):
    r = client.get("/api/firms/captcha-config", headers={"X-Forwarded-For": "203.0.113.9"})
    assert r.status_code == 200
    assert r.json() == {"enabled": True, "site_key": "site-public"}


def test_public_ai_call_without_token_is_403(keys):
    r = client.post(
        "/api/firms/ask",
        json={"question": "why march?", "aoi": "vietnam", "data": "sample"},
        headers={"X-Forwarded-For": "203.0.113.9"},
    )
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "turnstile_required"


def test_enforce_is_memoized_per_request(keys):
    """Middleware + handler both call enforce; siteverify must run once."""
    req = _Request({**PUBLIC, "X-Turnstile-Token": "tok-once"})
    with patch.object(turnstile, "verify_token", return_value=(True, [])) as verify:
        turnstile.enforce(req)
        turnstile.enforce(req)
    verify.assert_called_once()


def test_upload_rejected_before_reading_file(keys):
    """The upload middleware must 403 without touching the multipart body."""
    r = client.post(
        "/api/firms/upload-dataset",
        files={"file": ("tiny.csv", b"latitude,longitude\n1,2\n")},
        headers={"X-Forwarded-For": "203.0.113.9"},
    )
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "turnstile_required"
