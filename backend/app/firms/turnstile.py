"""Cloudflare Turnstile verification for the expensive public endpoints.

Why this exists: the site is exposed through Tailscale Funnel to the open
internet. AI chat calls a paid LLM and CSV ingest writes to disk, so both need
a cheap human check. Turnstile replaces the Anubis proof-of-work proxy, which
broke streaming and lazy-loaded chunks (cookie loss).

Design constraints:

* **Stdlib only** — ``urllib`` posts to ``siteverify``; no new dependency.
* **Fail open when unconfigured** — without ``TURNSTILE_SECRET_KEY`` every
  check returns immediately, so a fresh clone, unit tests and CI still work.
* **Public requests only** — Tailscale Funnel always adds ``X-Forwarded-For``
  / ``Tailscale-User-Login``. Direct hits on ``127.0.0.1:8000`` (local dev,
  ``make e2e``, prewarm scripts) carry neither, so they are exempt unless
  ``TURNSTILE_ALLOW_DIRECT=0``. Bots on the public host cannot remove those
  headers, because tailscaled generates them after the TLS termination.

The token travels in ``X-Turnstile-Token`` (required for multipart uploads) or
in the JSON body as ``turnstile_token``.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

from fastapi import HTTPException

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
VERIFY_TIMEOUT_S = 8.0

# Requests that arrive through a reverse proxy / tunnel always carry at least
# one of these. tailscaled injects X-Forwarded-For even when the client sends
# its own copy, so the check cannot be spoofed away from the public host.
_PROXY_HEADERS = ("x-forwarded-for", "x-forwarded-host", "tailscale-user-login")


class TurnstileUnavailable(RuntimeError):
    """siteverify could not be reached; callers decide fail-open vs closed."""


def secret_key() -> str:
    return os.environ.get("TURNSTILE_SECRET_KEY", "").strip()


def site_key() -> str:
    return os.environ.get("TURNSTILE_SITE_KEY", "").strip()


def is_public_request(request) -> bool:
    headers = getattr(request, "headers", {}) or {}
    return any(headers.get(name) for name in _PROXY_HEADERS)


def _allow_direct() -> bool:
    return os.environ.get("TURNSTILE_ALLOW_DIRECT", "1").strip() not in ("0", "false", "False")


def required(request) -> bool:
    """True when this request must present a valid Turnstile token."""
    if not secret_key():
        return False
    if not site_key():
        # A secret without a site key can never be satisfied by the UI. Treat
        # it as a misconfiguration and keep the app usable instead of locking
        # every AI request out.
        return False
    if not is_public_request(request) and _allow_direct():
        return False
    return True


def client_ip(request) -> str | None:
    headers = getattr(request, "headers", {}) or {}
    forwarded = (headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    client = getattr(request, "client", None)
    return getattr(client, "host", None)


def request_token(request, payload=None) -> str:
    headers = getattr(request, "headers", {}) or {}
    token = (headers.get("x-turnstile-token") or "").strip()
    if not token and isinstance(payload, dict):
        token = str(payload.get("turnstile_token") or "").strip()
    return token


def verify_token(token: str, *, remote_ip: str | None = None,
                 timeout: float = VERIFY_TIMEOUT_S) -> tuple[bool, list[str]]:
    """Ask Cloudflare whether ``token`` is valid. Never raises for a bad token."""
    body = urllib.parse.urlencode({
        "secret": secret_key(),
        "response": token,
        **({"remoteip": remote_ip} if remote_ip else {}),
    }).encode()
    req = urllib.request.Request(
        VERIFY_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            out = json.loads(resp.read().decode("utf-8", "replace") or "{}")
    except Exception as exc:  # network/DNS/TLS/JSON — surfaced as unavailable
        raise TurnstileUnavailable(str(exc)) from exc
    return bool(out.get("success")), [str(c) for c in (out.get("error-codes") or [])]


def _already_verified(request) -> bool:
    state = getattr(request, "state", None)
    return bool(state is not None and getattr(state, "turnstile_ok", False))


def _mark_verified(request) -> None:
    state = getattr(request, "state", None)
    if state is not None:
        state.turnstile_ok = True


def enforce(request, payload=None) -> None:
    """Raise HTTP 403 when the request needs a captcha but lacks a valid one.

    Idempotent per request: the upload middleware verifies before the multipart
    body is spooled to disk, then the route handler calls `enforce` again. The
    second call must not re-run siteverify, because a Turnstile token is
    single-use and would fail as a duplicate.

    Network failures against siteverify fail closed for public traffic: the
    alternative lets an attacker take Cloudflare down to strip the check.
    """
    if _already_verified(request):
        return
    if not required(request):
        _mark_verified(request)
        return
    token = request_token(request, payload)
    if not token:
        raise HTTPException(
            403,
            detail={
                "error_code": "turnstile_required",
                "message": "Captcha is required for this endpoint. Complete the "
                           "Cloudflare Turnstile check and retry.",
            },
        )
    try:
        ok, codes = verify_token(token, remote_ip=client_ip(request))
    except TurnstileUnavailable as exc:
        raise HTTPException(
            503,
            detail={
                "error_code": "turnstile_unavailable",
                "message": "Could not reach the captcha verifier. Retry in a moment.",
                "reason": str(exc),
            },
        )
    if not ok:
        raise HTTPException(
            403,
            detail={
                "error_code": "turnstile_failed",
                "message": "Captcha verification failed or expired. Retry the check.",
                "codes": codes,
            },
        )
    _mark_verified(request)
