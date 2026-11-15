# Turnstile human check (AI chat + CSV upload)

Cloudflare Turnstile replaced the Anubis proof-of-work proxy. Anubis depended
on a cookie surviving the challenge; browsers that dropped it (CHIPS/Partitioned
cookies, privacy extensions) re-challenged every request — AI streaming ended
empty and lazy JS chunks failed with `Failed to fetch dynamically imported
module`. Turnstile needs no cookie and no proxy hop.

## What is protected

| Endpoint | Why |
|---|---|
| `POST /api/firms/investigate` | AI investigator (paid LLM) |
| `POST /api/firms/investigate-stream` | streaming AI chat (paid LLM) |
| `POST /api/firms/ask-llm` | LLM explainer |
| `POST /api/firms/ask` | offline assistant (CPU) |
| `POST /api/firms/upload-dataset` | session CSV upload (disk) |
| `POST /api/firms/ingest` | admin CSV ingest (disk) |

Calendar, map, evidence, exports and live fetch stay free — the check exists to
stop abuse of the expensive AI/ingest paths, not to gate reading.

## Architecture

```
browser ── GET /api/firms/captcha-config ──► {enabled, site_key}
        └─ Turnstile widget (invisible unless a human is needed)
           token ──► JSON body `turnstile_token`
                     or header `X-Turnstile-Token` (multipart uploads)
backend  ── POST https://challenges.cloudflare.com/turnstile/v0/siteverify
```

* Verification lives in `backend/app/firms/turnstile.py` and uses only the
  Python stdlib (`urllib`). No new dependency.
* Tokens are single-use. The widget resets and re-executes before every send.
* `execution: "execute"` + `appearance: "interaction-only"` keeps it invisible
  when Cloudflare can verify silently; it only shows a checkbox when needed.
* Uploads are checked by an HTTP middleware **before** Starlette parses the
  multipart body. Without it, an unverified caller could force the server to
  spool a 50 MB file to disk before the route handler rejected them.
  `enforce()` memoizes success on `request.state`, so the middleware and the
  handler do not spend the single-use token twice.
* `TurnstileGate.solve()` waits for `/api/firms/captcha-config` and the
  Cloudflare script, so a send on the first click still carries a token.

## Configuration

`backend/.env` (gitignored, loaded by `ecosystem.config.cjs`):

```
TURNSTILE_SITE_KEY=0x...   # public, shipped to the browser
TURNSTILE_SECRET_KEY=0x... # private, server-side only
```

Create the widget at <https://dash.cloudflare.com> → Turnstile → Add widget →
Managed, hostname = the funnel host (`kien-x99.tail6306c6.ts.net`).

Behaviour:

* **Both keys empty** → the check is disabled entirely (fresh clone, CI).
* **Direct `127.0.0.1:8000`** (local dev, `make e2e`, prewarm, curl) → exempt,
  because Tailscale Funnel is the only public entry and it always adds
  `X-Forwarded-For` / `Tailscale-User-Login`. Set `TURNSTILE_ALLOW_DIRECT=0`
  to enforce even locally.
* **Public funnel traffic** → a valid token is required. If `siteverify` is
  unreachable the request fails with `503 turnstile_unavailable` (fail closed,
  so an attacker cannot disable Cloudflare to strip the check).

## Error contract

`403` with a JSON `detail`:

```json
{"error_code": "turnstile_required", "message": "..."}
{"error_code": "turnstile_failed",   "codes": ["invalid-input-response"]}
{"error_code": "turnstile_unavailable", "reason": "..."}
```

The SPA maps any `turnstile_*` code to the localized
`turnstile.retry` string, so users see "complete the check and try again"
instead of a raw HTTP error. The gate renders nothing when
`/api/firms/captcha-config` reports `enabled: false`.

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_turnstile.py -q
```

Covers fail-open, public/local detection, missing/invalid token, siteverify
payload, `503` on network failure, and the `captcha-config` response.

## Expected console noise (not a failure)

This host is **not** behind a Cloudflare zone (Tailscale Funnel terminates TLS
and proxies straight to `:8000`). Cloudflare's own iframe therefore logs a few
messages that look alarming but do not affect tokens:

| Console message | Meaning |
|---|---|
| `Connecting to 'data:,' violates ... connect-src ...` | Cloudflare's challenge iframe probes a `data:` URL and its **own** CSP blocks it. Our app sets no CSP. |
| `Cannot determine Turnstile's embedded location, aborting clearance redemption, are you running Turnstile on a Cloudflare Zone?` | Only disables `cf_clearance` redemption — a Cloudflare-zone feature. Token issuance + Siteverify still work on any http(s) site. |
| `POST /cdn-cgi/challenge-platform/... 405` | The same clearance attempt reaches our origin; the SPA fallback is GET-only. Harmless. |
| `powerPreference ... ignored`, `No available adapters`, `OTS parsing error` | Browser/WebGPU/font noise from the widget. |

Judge success by the protected request returning HTTP 200 (and the token
reaching siteverify), not by the console being silent. Verified working on the
real production key: AI requests returned 200 while these messages were
present.

## Ops

After changing keys: `pm2 restart ecosystem.config.cjs --only alphacentauriab
--update-env` (env is injected by PM2, not read by uvicorn). Rotating the
site key only needs a frontend rebuild if you hardcode it — this deployment
reads it at runtime from `/api/firms/captcha-config`.
