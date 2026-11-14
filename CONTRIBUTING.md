# Contributing

Thanks for looking at AlphaCentauriAB. This is a small, safety-oriented project,
so the rules are short but firm.

## Run it

```bash
make install
make data-check
source backend/activate.sh
make index                 # only if the FAISS index is missing
make dev                   # API :8000 + Vite :5173
```

Production, without Docker:

```bash
make pm2-start             # builds frontend/dist, starts uvicorn under PM2
pm2 status
pm2 logs alphacentauriab
```

The backend runs from `backend/`; the frontend from `frontend/`. `backend/.env`
holds local settings and is gitignored.

## Test before you push

```bash
make test                  # 129 backend tests + frontend typecheck/build
make test-e2e              # 18 Playwright browser tests
```

The E2E suite starts the API and the built dashboard on `:8000` itself. Install the
browser once with `cd frontend && npx playwright install chromium`.

`backend/tests/test_honesty.py` is the one that matters most — see below.

## Commit policy

**Do not commit every small edit.** The history should read as a sequence of
substantial, coherent changes, not a diary of typos.

- Commit only when the batch reaches **500+ changed lines** (insertions +
  deletions vs `HEAD`):
  `git diff HEAD --numstat | awk '{a+=$1; d+=$2} END {print a+d+0}'`.
- A reasonable floor is **500 changed lines** — no commit below it, even a
  complete behaviour change with its tests and docs.
- Typo fixes, one-line tweaks, doc-only edits and renames must be **accumulated and
  folded into the next 500+ commit**. Do not create a commit for them.
- Keep the working tree in progress if the batch is not ready; use `git diff` and
  tests to decide when it is.
- One commit should have one narrative. Past ~1500 lines or mixed narratives,
  split into 500+ line commits.
- Include the test that proves the change, or explain why it cannot be tested.

Emergency hotfixes are the only exception. Say so in the message.

## The one rule that is not negotiable

**Never introduce a number that is not quoted from a named NASA document.**

This project's entire argument is that its figures are real and traceable. That
argument collapses the moment one synthetic value, one interpolation, or one
averaged measurement ships to a user. Concretely:

- Every value served by HESTIA must carry the `doc_id` it was read from. This is
  enforced by `test_provenance_travels_with_each_individual_value`.
- Do not lower `hestia.MIN_ROWS`, and do not save a model with cross-validated
  `R² ≤ 0`. Both guards are load-bearing and covered by tests.
- Do not add `burn_duration` / `length` / `burn_length` back as features —
  `spread_rate ≈ length / burn_duration` is leakage, and a fake R² of 0.86 came
  from exactly that.
- If a result is negative or the data is insufficient, report it. Deleting an
  inconvenient result is not an option; the two we deleted are documented in
  [`docs/SAFETY.md`](docs/SAFETY.md) precisely so they cannot come back unnoticed.

If you believe a guard is wrong, open an issue and argue it with numbers. Do not
delete the test.

## Style

- Python: 3.11, type hints on public functions, `from __future__ import annotations`.
- Backend: FastAPI + Pydantic; services under `backend/app/services/`.
- AI stack: under `backend/prometheus/`; data and models under `backend/`.
- Frontend: TypeScript, functional React components, Tailwind + shadcn/ui.
- Keep documentation honest: if something is not built, say so. `docs/PLAN.md`
  marks unfinished phases explicitly — keep it that way.
- Agent-specific working instructions live in [`AGENTS.md`](AGENTS.md).

## Pull requests

1. One substantial batch per PR, following the commit policy above.
2. State what you measured, not what you hope for.
3. Include the test that proves it, or explain why it cannot be tested.
