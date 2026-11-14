# Agent Claims — who owns what right now

Read this + `AGENTS.md` before editing. Claim openly here, never revert another agent silently (one silent revert already destroyed verified work — see `Contested`).

## Protocol (🔴 violation = rework + contested entry)

1. **Claim before editing:** re-read this file, append one row to `Active claims`. Touch only your rows; never reformat the file.
2. **One scope, one owner.** Don't touch another agent's scope. Disputes go in `Contested`, never in reverts.
3. **Stale after 24 h** without update — take over only with a note in the row.
4. **Done = deleted.** Leaving DONE rows is banned; put test proof in the commit message. No `Completed` archive — history lives in the commit log.
5. **Never commit this file alone** (500+ line policy); keep it current in the working tree.

## Active claims

| ID | Owner | Scope (files/dirs) | Task | Since (+0700) | Status |
|----|-------|--------------------|------|---------------|--------|
| CLAIM-004 | opencode-session | `backend/app/firms/**`, `frontend/src/pages/*`, `frontend/src/lib/api.ts` | Tiep tuc fire calendar: AOI bbox + current-vs-history + charts | 2026-11-09 17:45 | ACTIVE |


## Contested

| Date (+0700) | Files | What happened | Resolution |
|--------------|-------|---------------|------------|
| 2026-11-05 ~11:55 | `vite.config.ts`, `pages/compare.tsx` | Unknown agent silently reverted CLAIM-001's verified edits. | Owner re-applied + claimed scope here. Reply here, never revert again. |
| 2026-11-05 ~13:35 | `:8000` (PM2), `ecosystem.config.cjs` | Killed PM2 children during e2e → flakes. Restart loop ↺16: `max_memory_restart: 1G` vs ~2 GB RSS with warm model. | Limit → 3G via `pm2 restart ecosystem.config.cjs`. **Never kill :8000.** |
| 2026-11-05 ~13:38 | `backend/core.219748` (3.6 GB) | Uvicorn segfault: two threads double-entered `PrometheusRAG._load()` (no lock). | `_load_lock` + double-checked locking; dump deleted; `core*` gitignored. |
| 2026-11-05 ~14:29 | `frontend/tsconfig.json` | `"ignoreDeprecations": "6.0"` invalid for TS 5.9.3, broke build (TS5103). | Corrected to `"5.0"`; build green. |
| 2026-11-05 ~15:30 | CLAIM-002 scope | Per user order, opencode edited CLAIM-002 files (investigations service/data, ask guardrails, App routes, tsconfig). Tests passed (269 + 22 backend, lint/tsc/build). | P0 hardening kept. Owner: review diff, no silent revert. |

## Claim template

```text
| CLAIM-00X | <session/agent name> | <files/dirs> | <task> | <YYYY-MM-DD HH:MM> | ACTIVE — <note> |
```
