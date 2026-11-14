# AGENTS.md — FIRMS Fire Calendar (fresh repo, 2026-11-09)

Old project sources (microgravity PROMETHEUS/HESTIA), if kept on disk, live
outside this repo and must not be resurrected here (`prometheus/`, NTRS corpus,
old guards).

## What this project is

NASA Space Apps 2026 — **Harmonization of MODIS and VIIRS Hot Spots**:
a web app that calibrates VIIRS to MODIS-equivalent counts and renders a
burning-activity calendar (month × year + anomalies + CSV export).

Roots: `backend/app/firms/` (schema/harmonize/calendar/dl),
`backend/scripts/firms/`, `frontend/src/pages/{home,calendar,method,about}.tsx`.

## Rules

1. 🔴 **Coordinate via `docs/AGENT_CLAIMS.md`.** Claim scope before editing; never
   touch another agent's active scope; disputes go in `Contested`, never reverts.
2. **Never invent fire numbers.** Counts come from FIRMS CSV or the deterministic
   sample generator; anomalies are median/MAD deviations, not predictions.
3. **Keep the statistical path working without torch.** DL is an optional residual/
   scorer; `GET /api/firms/dl-info` must report `has_torch` honestly.
4. **No secrets.** `backend/.env` / `FIRMS_MAP_KEY` stay out of git.
5. **No Docker.** PM2 + Makefile as before.
6. **Strict i18n Dictionary standard.** Absolutely zero inline ternary localization (`vi ? ... : ...` or `lang === 'vi' ? ... : ...`). All user-facing strings must be defined as structured dictionary keys in `frontend/src/locales/vi.ts` and `frontend/src/locales/en.ts` and rendered exclusively via `t("namespace.key")`.
6. **Strict i18n Dictionary standard.** Absolutely zero inline ternary localization (`vi ? ... : ...` or `lang === 'vi' ? ... : ...`). All user-facing strings must be defined as structured dictionary keys in `frontend/src/locales/vi.ts` and `frontend/src/locales/en.ts` and rendered exclusively via `t("namespace.key")`.
7. **Project License is strictly MIT.** MIT License is enforced across root `LICENSE`, `package.json`, UI Footer, metadata, and documentation.

## Commands

```bash
make install      # python + frontend deps
make sample       # generate deterministic FIRMS sample CSV
make test-backend # full firms suite (raw tests can take ~40 min)
make check-fast   # dev loop: clean profile, ~1 min, no raw/SPA tests
make check-release# before shipping: full suite + release gate
make dev          # API :8000 + Vite :5173
make demo         # build SPA, serve API + SPA on :8000
```
