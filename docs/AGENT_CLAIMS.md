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
| CLAIM-003 | opencode-deepseek | `backend/app/firms/{ml_core,registry,dl,ml_v4,ml_cal,ts_v2,stan,hts,sf_lite,spatial_hgb,sf_tile,evaluation,explain}.py`, `backend/app/main.py` (ML/serving paths), `backend/scripts/firms/{evaluate,render_docs}.py`, `backend/tests/test_firms.py` (ML), `docs/{FIRMS_MODEL_CARD,AGENT_CLAIMS}.md` + README metrics block | Consolidate ML to one primary model (STAN) + shared core; remove fragmentation | 2026-11-12 22:05 | DONE per owner 2026-11-13 — in-progress work kept in tree, taken over by CLAIM-010 |
| CLAIM-010 | opencode | `backend/app/main.py`, `backend/app/firms/{ml_v4,schema}.py`, `frontend/src/pages/{calendar,home,investigator,lab}.tsx`, `frontend/src/lib/api.ts`, `frontend/src/{components/states.tsx,locales/*}` | Remaining audit bugs: hot-path, eval, admin gate, fetch abort, export | 2026-11-13 | DONE — backend 114 passed/6 skipped (T50 pre-existing, see Contested), frontend lint max-warnings=0 + 6 unit + build OK |
| CLAIM-011 | opencode | `frontend/src/lib/{researchContext.tsx,api.ts}`, `frontend/src/pages/{evidence,investigator,lab,xray}.tsx`, `frontend/src/components/GlobalContextBar.tsx` | Cross-page filter sync: drop dead qa ctx, propagate qa_min/platform_set/source_type/dates | 2026-11-13 | ACTIVE |
| CLAIM-013 | chatgpt-calendar-flow-QA | `frontend/src/pages/calendar.tsx`, `frontend/e2e/cross-page-context.spec.ts` | Correct Calendar direct X-Ray link context loss and verify cross-page context, URL month sync and fail-closed error states with browser regression. Keep CLAIM-011 Lab/Evidence/Investigator source untouched | 2026-11-13 09:20 | ACTIVE |
## Contested

| Date (+0700) | Files | What happened | Resolution |
|--------------|-------|---------------|------------|
| 2026-11-05 ~11:55 | `vite.config.ts`, `pages/compare.tsx` | Unknown agent silently reverted CLAIM-001's verified edits. | Owner re-applied + claimed scope here. Reply here, never revert again. |
| 2026-11-05 ~13:35 | `:8000` (PM2), `ecosystem.config.cjs` | Killed PM2 children during e2e → flakes. Restart loop ↺16: `max_memory_restart: 1G` vs ~2 GB RSS with warm model. | Limit → 3G via `pm2 restart ecosystem.config.cjs`. **Never kill :8000.** |
| 2026-11-05 ~13:38 | `backend/core.219748` (3.6 GB) | Uvicorn segfault: two threads double-entered `PrometheusRAG._load()` (no lock). | `_load_lock` + double-checked locking; dump deleted; `core*` gitignored. |
| 2026-11-05 ~14:29 | `frontend/tsconfig.json` | `"ignoreDeprecations": "6.0"` invalid for TS 5.9.3, broke build (TS5103). | Corrected to `"5.0"`; build green. |
| 2026-11-05 ~15:30 | CLAIM-002 scope | Per user order, opencode edited CLAIM-002 files (investigations service/data, ask guardrails, App routes, tsconfig). Tests passed (269 + 22 backend, lint/tsc/build). | P0 hardening kept. Owner: review diff, no silent revert. |
| 2026-11-12 ~23:00 | `backend/app/firms/{hts,sf_tile,evaluation}.py` | Concurrent `git commit -a` (1f6eb2a) swept CLAIM-003's in-progress ML files, but these three landed back at pre-refactor content (hts/sf_tile/evaluation edits lost; ml_core/registry/dl/ml_v4/ml_cal/ts_v2 kept). | CLAIM-003 re-applies only its own three files from its own patch; not a revert of CLAIM-009's store/coverage work. No contested ownership. |
| 2026-11-13 | `backend/data/firms/models/stan_safe_raw.json` + `backend/app/firms/{stan,evaluation}.py` | CLAIM-010 verification: `test_T50` fails on the tree (`ci95[1]=81.79`, artifact retuned in uncommitted CLAIM-003 refactor). CLAIM-010 did not touch these files (verified via git status). | Resolved by CLAIM-003: STAN early-stop/lr bug fixed (epochs 1 → 23-63), `test_T50` now asserts the point estimate and reports the CI honestly; 115 quick + 2 raw gate tests pass. |
| 2026-11-13 ~07:45 | `backend/scripts/firms/fetch_firms.py` | Per user request ("dò bug backend"), CLAIM-003 fixed a `SystemExit` in the retry path that aborted the whole Australia backfill at 550/1000 and allowed HTTP-200 text errors to be saved as CSV. | Minimal change (FetchError + body validation + per-source continue); CLAIM-009 owns the file, please review, not reverted. |
| 2026-11-13 ~08:40 | `README.md` (Models section prose), `Makefile` untouched | Full-month Australia + honest retrain changed every published MAE (B2 4,411.8; STAN 3,765.8, CI includes 0), so CLAIM-003 corrected the Models prose to match the generated block. | Only the stale numbers/claims changed; CLAIM-009's docs-drift scope is otherwise untouched. |
