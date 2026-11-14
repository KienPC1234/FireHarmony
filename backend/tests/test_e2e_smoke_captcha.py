"""Public vs local HTTP smoke semantics for the human-check boundary."""
from __future__ import annotations

import io
import json
from urllib.error import HTTPError
from unittest.mock import patch

from scripts import e2e_smoke


class _Response:
    status = 200

    def __init__(self, data):
        self.data = data

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, *_args):
        return self.data


PAYLOAD = {"question": "why anomalous?", "aoi": "vietnam", "data": "sample",
           "year": 2019, "month": 3, "use_llm": False}


def _error(url: str, code: int, detail: dict):
    return HTTPError(url, code, "test", {}, io.BytesIO(json.dumps(detail).encode()))


def test_public_valid_captcha_denial_counts_as_guard_only():
    def open_fake(request, **_kwargs):
        url = request if isinstance(request, str) else request.full_url
        if url.endswith("/captcha-config"):
            return _Response(b'{"enabled":true,"site_key":"sitekey-public"}')
        raise _error(url, 403, {"detail": {"error_code": "turnstile_required"}})

    with patch.object(e2e_smoke.urllib.request, "urlopen", side_effect=open_fake):
        ok, detail = e2e_smoke._investigate_probe("https://example.test", PAYLOAD)
    assert ok is True
    assert "guard verified; response not tested" in detail


def test_public_wrong_403_must_not_be_reported_as_success():
    def open_fake(request, **_kwargs):
        url = request if isinstance(request, str) else request.full_url
        if url.endswith("/captcha-config"):
            return _Response(b'{"enabled":true,"site_key":"sitekey-public"}')
        raise _error(url, 403, {"detail": {"error_code": "service_broken"}})

    with patch.object(e2e_smoke.urllib.request, "urlopen", side_effect=open_fake):
        ok, detail = e2e_smoke._investigate_probe("https://example.test", PAYLOAD)
    assert ok is False
    assert "unexpected error" in detail


def test_public_enabled_but_post_succeeds_is_security_failure():
    with patch.object(e2e_smoke.urllib.request, "urlopen",
                      side_effect=[_Response(b'{"enabled":true,"site_key":"x"}'),
                                   _Response(b'{"answer":"unexpected"}')]):
        ok, detail = e2e_smoke._investigate_probe("https://example.test", PAYLOAD)
    assert ok is False
    assert "unauthenticated" in detail


def test_local_captcha_disabled_still_requires_true_answer():
    with patch.object(e2e_smoke.urllib.request, "urlopen",
                      side_effect=[_Response(b'{"enabled":false,"site_key":""}'),
                                   _Response(b'{"answer":"local"}')]):
        ok, detail = e2e_smoke._investigate_probe("http://127.0.0.1:8000", PAYLOAD)
    assert ok is True
    assert detail.startswith("200")


def test_missing_captcha_endpoint_preserves_legacy_post_behavior():
    with patch.object(e2e_smoke.urllib.request, "urlopen",
                      side_effect=[_error("https://example.test/api/firms/captcha-config", 404, {}),
                                   _Response(b'{"answer":"legacy"}')]):
        ok, detail = e2e_smoke._investigate_probe("https://example.test", PAYLOAD)
    assert ok is True
    assert detail.startswith("200")


def test_invalid_captcha_config_fails_closed():
    with patch.object(e2e_smoke.urllib.request, "urlopen",
                      return_value=_Response(b'{"enabled":"yes","site_key":"x"}')):
        ok, detail = e2e_smoke._investigate_probe("https://example.test", PAYLOAD)
    assert ok is False
    assert "contract invalid" in detail
