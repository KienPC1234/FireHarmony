# AGENTS.md — FIRMS Fire Calendar

## What this project is

NASA Space Apps 2026 — **Harmonization of MODIS and VIIRS Hot Spots**:
a web app that calibrates VIIRS to MODIS-equivalent counts and renders a
burning-activity calendar (month × year + anomalies + CSV export).

Roots: `backend/app/firms/` (schema/harmonize/calendar/dl),
`backend/scripts/firms/`, `frontend/src/pages/{home,calendar,method,about}.tsx`.

## Agent loop — use the fast gate, not the release gate

```bash
make install-dev   # once: serving + tests + dataframes, no torch (fast)
make agent-check   # ~90 s: backend clean tests + frontend lint + unit + build
make check-fast    # ~70 s: backend clean profile only
make dev           # API :8000 + Vite :5173
```

Slow commands are release-only. **Do not run them as a dev loop:**

```bash
make test-full     # full suite, real raw data + SPA (can take ~40 min)
make check-release # release gate: clean tests + raw subset + eval + docs
```

If a raw-only bug is suspected, reproduce with the committed 4.3 MB fixture
(`make rebuild-subset`) or the 24-month demo pack (`make demo-verify`), not the
820 MB pull.

**Interpreter:** the system `python3` is 3.14 and has none of the project deps.
Always use `make` or `.venv/bin/python`; a bare `python -m ...` will fail with
confusing import errors. `.python-version` pins 3.11.

## Rules (✅ = machine-enforced)

1. **Coordinate via `docs/AGENT_CLAIMS.md`.** Claim scope before a multi-file
   edit: re-read the file, append one row, touch only your rows. Never revert
   another agent's work; disputes go in `Contested`. A claim is one line, not a
   ceremony. (Not machine-enforced.)
2. 🔴 **Never invent fire numbers.** Counts come from FIRMS CSV or the
   deterministic sample generator; anomalies are median/MAD deviations, not
   predictions. (Enforced by the test suite.)
3. **Keep the statistical path working without torch.** DL is an optional
   residual/scorer; `GET /api/firms/dl-info` must report `has_torch` honestly.
4. **No secrets.** `backend/.env` / `FIRMS_MAP_KEY` stay out of git.
5. **No Docker.** PM2 + Makefile as before.
6. ✅ **i18n dictionary standard.** No *new* inline `vi ? "..." : "..."` or
   `lang === "vi" ? ... : ...` in user-facing strings. Add keys to
   `frontend/src/locales/vi.ts` and `frontend/src/locales/en.ts` and render via
   `t("namespace.key")`. ESLint rule `i18n/no-inline-vi-ternary` enforces this.
   The legacy files listed in `frontend/eslint.config.js` are frozen debt, not
   a precedent; do not add new ternaries anywhere.
7. ✅ **Project license is MIT**, enforced across root `LICENSE`, `package.json`,
   UI footer, metadata and docs.
8. **Before removing a feature or adding a caveat, read
   `docs/TRUTH_CONTRACT.md`.** Truth labels are allowed; deleting capability to
   avoid a caveat needs owner sign-off.
