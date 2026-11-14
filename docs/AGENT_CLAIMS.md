# Agent Claims — who owns what right now

Read this + `AGENTS.md` before a multi-file edit. Keep it short.

## Protocol

1. **Claim before a multi-file edit:** re-read this file, append one row to
   `Active claims`. Touch only your rows; never reformat the file.
2. **One scope, one owner.** Don't touch another agent's active scope. Disputes
   go in `Contested`, never in reverts.
3. **Stale after 24 h** without update — take over only with a note in the row.
4. **Done = delete the row.** Put test proof in the commit message; history
   lives in the commit log. This file is small on purpose, so commit it with the
   work that changed it (or not at all) — there is no minimum line count.

## Active claims

| ID | Owner | Scope (files/dirs) | Task | Since (+0700) | Status |
|----|-------|--------------------|------|---------------|--------|
| CLAIM-003 | opencode-deepseek | `backend/app/firms/{ml_core,registry,dl,ml_v4,ml_cal,ts_v2,stan,hts,sf_lite,spatial_hgb,sf_tile,evaluation,explain}.py`, `backend/app/main.py` (ML/serving paths), `backend/scripts/firms/{evaluate,render_docs}.py`, `backend/tests/test_firms.py` (ML), `docs/{FIRMS_MODEL_CARD,AGENT_CLAIMS}.md` + README metrics block | Consolidate ML to one primary model (STAN) + shared core; remove fragmentation | 2026-11-12 22:05 | ACTIVE — refactor + unified eval |

## Contested

| Date (+0700) | Files | What happened | Resolution |
|--------------|-------|---------------|------------|
| 2026-11-05 ~11:55 | `vite.config.ts`, `pages/compare.tsx` | Unknown agent silently reverted CLAIM-001's verified edits. | Owner re-applied + claimed scope here. Reply here, never revert again. |
| 2026-11-05 ~13:35 | `:8000` (PM2), `ecosystem.config.cjs` | Killed PM2 children during e2e → flakes. Restart loop ↺16: `max_memory_restart: 1G` vs ~2 GB RSS with warm model. | Limit → 3G via `pm2 restart ecosystem.config.cjs`. **Never kill :8000.** |
| 2026-11-05 ~13:38 | `backend/core.219748` (3.6 GB) | Uvicorn segfault: two threads double-entered `PrometheusRAG._load()` (no lock). | `_load_lock` + double-checked locking; dump deleted; `core*` gitignored. |
| 2026-11-05 ~14:29 | `frontend/tsconfig.json` | `"ignoreDeprecations": "6.0"` invalid for TS 5.9.3, broke build (TS5103). | Corrected to `"5.0"`; build green. |
| 2026-11-05 ~15:30 | CLAIM-002 scope | Per user order, opencode edited CLAIM-002 files (investigations service/data, ask guardrails, App routes, tsconfig). Tests passed (269 + 22 backend, lint/tsc/build). | P0 hardening kept. Owner: review diff, no silent revert. |
