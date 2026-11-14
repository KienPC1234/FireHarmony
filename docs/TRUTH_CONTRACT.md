# Truth contract — what may be shown, and how

This file exists to stop two failure modes that cost this project days:

1. An audit finds a misleading claim → the feature is deleted or nulled → the
   product shrinks and the next audit finds less to test.
2. An agent adds a "just in case" guard (409, null, skip) that no test or run
   needs, and every later change has to work around it.

The contract is deliberately small. If something is not covered here, use the
existing label in `docs/FIRMS_MODEL_CARD.md` and add one line here.

## A number may be shown when it has four things

| Field | Required |
|---|---|
| **Source** | `nasa-firms-raw`, `sample`, `artifact`, or `user-upload` |
| **Unit / definition** | hotspot detections, activity index, MAE, ratio — never "fires" |
| **Valid range** | the months/AOIs where it is computed; missing coverage is `null`, not 0 |
| **Label** | `observed`, `estimated`, `not calibrated`, or `candidate` |

Missing one of these is a truth bug. Missing coverage is not.

## Null vs. label

- Use `null` only when the statistic is mathematically undefined, and return a
  `reason` (`ineligible_coverage`, `insufficient_comparable_history`,
  `not_calibrated`, `no_artifact`).
- Use a **label** when the number exists but is uncertain, fallback, or
  experimental: `estimated`, `candidate`, `gate_off`, `retrospective`.
- Do **not** delete a capability to avoid a label. Deleting a model, a tab, or a
  preset needs owner sign-off and a note in `docs/SUBMISSION.md`.

## Claims

- "Served" and "candidate" are different words. A candidate has a point estimate
  and a CI; it is not the default.
- A win is claimed only when the 95% CI excludes 0. Otherwise say "not
  established".
- Never rename a hotspot cluster into a fire perimeter, burned area, or severity
  grade. The same applies to the word "fire" in user-facing copy.

## Change policy (the anti-ratchet rule)

- **One audit per milestone.** Fix P0 items that affect truth; put P1 items in
  `docs/AUDIT_BACKLOG.md` and do not touch code for them in the same pass.
- **A caveat is not a feature.** Adding a label is cheap; removing a tab is
  expensive. Default to the label.
- **A new guard needs a test that fails without it** and a named failure mode.
  "Defensive" is not a failure mode.
- **Done = `make agent-check` green.** Release gates are for releases, not for
  every edit.
