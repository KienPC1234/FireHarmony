# Anubis bot-guard (opt-in, PM2-managed, no Docker)

Anubis ([TecharoHQ/anubis](https://github.com/TecharoHQ/anubis)) is a
proof-of-work reverse proxy that challenges browser-like scrapers before
they can reach the expensive endpoints (`/calendar` cold ~150 s, `/export`,
`/backtest`).

Deployed chain on this host (Tailscale Funnel is the only public entry):

```
internet -> funnel https://kien-x99.tail6306c6.ts.net -> Anubis (127.0.0.1:8239) -> app (127.0.0.1:8000)
```

Local tooling (`make e2e`, `make prewarm`, dev curl) keeps hitting the app
directly at `127.0.0.1:8000` and is unaffected. It is **opt-in**: disabling
later is one command (see below).

## Install the binary (once, no Docker)

Anubis ships as a native package (`.deb` / `.rpm` / tarball). Example:

```bash
# Debian/Ubuntu, x86_64 — pick the version from the releases page
sudo apt install ./anubis_<version>_amd64.deb

# or tarball anywhere on PATH
sudo install -D ./bin/anubis /usr/local/bin
```

Then create the storage dir (the policy uses a persistent bbolt store):

```bash
sudo mkdir -p /var/lib/anubis && sudo chown $(whoami) /var/lib/anubis
```

## Enable

```bash
make pm2-anubis-start   # starts the `anubis` PM2 app (BIND 127.0.0.1:8239 -> TARGET 127.0.0.1:8000)
pm2 logs anubis
```

Signing key (do this once, otherwise every Anubis restart logs out ALL
users and forces everyone to re-solve): the PM2 config reads
`/var/lib/anubis/hs512.key` (mode `0600`).

```bash
python3 -c "import secrets; print(secrets.token_hex(32))" > /var/lib/anubis/hs512.key
chmod 600 /var/lib/anubis/hs512.key
```

Without the key file Anubis logs `[misconfiguration] ... no private key
is set` and generates a random key per boot — that was the "must solve on
every visit" symptom.

Cookie compatibility: Anubis defaults to `Partitioned` (CHIPS) cookies,
which older browsers silently drop — the challenge shows "accepted" in the
logs but the browser never stores the cookie, so every page, JS chunk and
API call gets challenged again. This deployment sets
`COOKIE_PARTITIONED=false` + `COOKIE_SAME_SITE=Lax` (same-site-only usage),
which works on all browsers. After changing any cookie setting, every user
re-solves once (the cookie-name suffix rotates).

The app itself listens on `127.0.0.1:8000` only
(`ecosystem.config.cjs` uses `--host 127.0.0.1`), so nothing reaches it
except localhost.

Point the public entry at Anubis. On this host that is the Tailscale Funnel
(not nginx):

```bash
tailscale funnel --bg 8239
tailscale serve status   # expect: / proxy http://127.0.0.1:8239 (Funnel on)
```

(If the host ever moves behind nginx instead: `proxy_pass
http://127.0.0.1:8239;`, reload nginx, and unset `USE_REMOTE_ADDRESS` in
`anubis.ecosystem.config.cjs` so Anubis trusts the `X-Real-IP` header
nginx sets.)

Verify:

```bash
curl -s http://127.0.0.1:8239/api/health            # -> {"status":"ok",...} (allowlisted, no challenge)
curl -s -A "Mozilla/5.0" http://127.0.0.1:8239/ | head -c 200   # -> Anubis challenge page, not the SPA
```

Then open the site in a real browser once (solves proof-of-work, sets a
cookie) — the SPA and all its `fetch()` calls work normally after that.

## Disable (one command)

```bash
make pm2-anubis-stop   # or: pm2 delete anubis
```

Then point the funnel back at the app and reload. No app change
needed — `ecosystem.config.cjs` keeps serving direct on `127.0.0.1:8000`.

```bash
tailscale funnel --bg 8000
```

## What is challenged, and what stays open

Policy: [`anubis.botPolicies.yaml`](../anubis.botPolicies.yaml).

| Rule | Action | Why |
|---|---|---|
| `^/api/(firms/)?health$`, `/robots.txt`, `/manifest.webmanifest`, `/favicon.ico`, `/.well-known/*` | ALLOW | LB/nginx health checks and browser boot plumbing must not be challenged |
| `^/api/firms/(calendar\|map-cells\|export.*\|brief\|backtest\|evaluation\|coverage-xray)` | CHALLENGE | Expensive endpoints: browsers pass after one PoW, bare curl/python scrapers get the challenge page instead of JSON |
| `Mozilla` UA | CHALLENGE | Browser-like scrapers (AI crawlers spoof browser UAs) |

Tuning knobs (env, see `anubis.ecosystem.config.cjs`): `ANUBIS_BIN`,
`ANUBIS_BIND`, `ANUBIS_TARGET`, `ANUBIS_DIFFICULTY` (default `"5"` — public
funnel; raise only if bots persist, higher values hurt real mobile users),
`ANUBIS_COOKIE_TTL` (default `"3h"` — passed challenges go stale the same
day), `ANUBIS_POLICY`, `ANUBIS_METRICS_BIND`.

## Ops notes (important)

- `make prewarm`, `make e2e`, and any terminal `curl` against the **public**
  URL will hit the challenge page. Point them at the backend directly:
  `BASE=http://127.0.0.1:8000` (or `make e2e BASE=...`).
- Playwright e2e uses real Chromium, so it passes the challenge like a user.
- Metrics: `curl http://127.0.0.1:8240/metrics` (binds localhost only).
- Firewall: when Anubis is on, block direct external access to `:8000`
  (security group / `ufw`) so bots cannot bypass the guard.
- The in-app user guide (`/guide`) is click-only and needs no change: first
  browser visit solves the challenge, everything after that is normal clicks.
