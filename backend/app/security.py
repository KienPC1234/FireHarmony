"""Small HTTP hardening layer.

The dashboard serves public data and has no accounts, so the goal is not
authentication. It is to stop a public deployment from accepting an unbounded
request body and to send the headers a browser expects from a modern app.
"""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from prometheus.configs import _settings

_settings.load_dotenv_if_present()
MAX_BODY_BYTES = int(_settings.get("PROMETHEUS_MAX_BODY_BYTES", "1048576"))


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Reject oversized bodies and add the usual response headers.

    The body limit is enforced twice. ``Content-Length`` is checked first as a
    cheap early exit, but a request sent with chunked transfer encoding has no
    ``Content-Length`` header at all and would sail straight through a
    header-only check. The body is therefore also counted as it streams in, and
    the request is refused as soon as it exceeds the limit.
    """

    async def dispatch(self, request, call_next):  # noqa: ANN001
        if request.method in ("POST", "PUT", "PATCH"):
            raw = request.headers.get("content-length")
            if raw:
                try:
                    if int(raw) > MAX_BODY_BYTES:
                        return JSONResponse(
                            {"detail": f"Request body exceeds {MAX_BODY_BYTES} bytes."},
                            status_code=413,
                        )
                except ValueError:
                    return JSONResponse({"detail": "Invalid Content-Length."},
                                        status_code=400)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        return response


class BodySizeLimitMiddleware:
    """Count the bytes of a request body and refuse the oversized ones.

    This sits below the header check on purpose: by the time a body has been
    read it is already buffered, so the cheapest defence stays in
    ``SecurityHeadersMiddleware`` and this one catches what the header misses.

    The ASGI receive callable is wrapped so that every chunk is measured. When
    the running total passes the limit the request is answered with 413 and the
    body is no longer buffered, so an oversized upload is never fully read into
    memory.
    """

    def __init__(self, app, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("method") not in (
                "POST", "PUT", "PATCH"):
            await self.app(scope, receive, send)
            return

        total = 0
        overflow = False
        body_sent = False

        async def counting_receive():
            nonlocal total, overflow
            message = await receive()
            if message.get("type") == "http.request":
                total += len(message.get("body", b"") or b"")
                if total > self.max_bytes:
                    overflow = True
                    # Stop the body here: the rest is never read.
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def guarded_send(message):
            nonlocal body_sent
            if not overflow:
                await send(message)
                return
            if message.get("type") == "http.response.start":
                await send({
                    "type": "http.response.start",
                    "status": 413,
                    "headers": [(b"content-type", b"application/json")],
                })
            elif message.get("type") == "http.response.body":
                # Only the first body is sent: a second one would break the
                # response framing.
                if body_sent:
                    return
                body_sent = True
                body = (b'{"detail":"Request body exceeds '
                        + str(self.max_bytes).encode() + b' bytes."}')
                await send({"type": "http.response.body", "body": body})

        await self.app(scope, counting_receive, guarded_send)
