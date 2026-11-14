# Audit backlog (P1 only)

Per `docs/TRUTH_CONTRACT.md`: one audit per milestone. P0 truth fixes go in the
release; P1 items land here and are picked up only when they block a feature or
an agent. Do not re-open closed P0s without a failing test.

## Open P1

| ID | Item | Why it is parked | Unblock condition |
|----|------|------------------|-------------------|
| P1-A | Parquet/DuckDB ETL instead of CSV scans | Cold raw `/calendar` is 153–215 s; cached is 91–118 ms | A user-facing path needs sub-second cold start |
| P1-B | Per-cell cloud/overpass footprint | Not present in the FIRMS CSV feed | A footprint product is bundled |
| P1-C | Full-platform (NOAA-20/21) event study | The current raw pull contains no NOAA rows | A pull with NOAA rows exists |
| P1-D | Inline-ternary debt in 15 legacy frontend files | Frozen by ESLint allowlist; new code is enforced | A file is touched for another reason |

## Closed (do not re-litigate)

- 14 P0 truth items in `docs/AUDIT_UIUX_RESPONSE.md` and the model card.
- Leakage, artifact hashing, and gate-off serving in `docs/SENSORFORMER.md`.
