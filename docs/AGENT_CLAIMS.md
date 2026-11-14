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

## Contested

| Date (+0700) | Files | What happened | Resolution |
|--------------|-------|---------------|------------|
