# NASA Space Apps 2026 — FireHarmony challenge alignment

**Status (2026-11-14): Project Tab challenge not yet verified; public source behind audited RC.**
This is a verification record, not proof of NASA submission or acceptance.

## Correct challenge for the implemented application

Harmonization of MODIS and VIIRS Hot Spots:
https://www.spaceappschallenge.org/2026/challenges/harmonization-of-modis-and-viirs-hot-spots/

The official problem asks for a web app combining active-fire hotspots from
MODIS and VIIRS into a burning activity calendar, with user-selected areas,
historical patterns, unusual conditions and critical periods.

FireHarmony implements NASA FIRMS ingestion, harmonization and scientific
provenance, AOI selection, monthly calendar, GIS map, evidence, and export.
Hotspot detections and estimates do not equal unique physical fires.

## Distinct challenge: Flame in Freefall

https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/

This other NASA challenge calls for an AI dashboard interpreting microgravity
combustion experiments to inform spacecraft and exploration fire safety.
FireHarmony's satellite-hotspot workflow does not analyze those experiments.
Submitting this code under Flame in Freefall would mismatch its objective.
The actual challenge selected in the team's NASA Project Tab is not verified.

## Independently verified RC2

- Frozen RC2 source: 3e7563a47652d9de63c64f9a0c9f4c5ea5dc30a0
- Isolated Chromium Playwright: 70 passed
- Re-extracted backend: 115 passed, 5 skipped
- Isolated HTTP E2E smoke: 17 passed
- Frontend unit tests: 18 passed; lint and production build: PASS
- Demo pack: 24 months, 362 files, 459832 rows, SHA-256 checked
- The STAN/HTS model-specific and served-series holdouts are distinct
  protocols when their sample counts differ. Do not substitute one MAE for
  the other, nor claim statistical superiority from a CI including zero.

## Public GitHub source parity, checked 2026-11-14

Public GitHub repository: https://github.com/KienPC1234/FireHarmony
Public master SHA: 89a5654df87a19398e361d44fa402e451e0ffd40
Audited RC2 SHA: 3e7563a47652d9de63c64f9a0c9f4c5ea5dc30a0

At verification, the public branch was nine commits behind the audited RC2.
Providing the URL alone does not prove the tested source has been published.
Do not publish unrelated or unreviewed working-tree changes.

## Submission readiness actions

1. Verify the actual NASA Project Tab challenge and correct portal selection
   through the owner if necessary. No portal change was made here.
2. Publish an approved release commit and independently confirm GitHub SHA
   parity with the source that passed tests.
3. Supply and validate public HTTPS demo, demo video and Project Tab URLs.
4. Preserve receipts, dataset provenance, model caveats and test evidence.
5. Do not treat preflight or an archive checksum as proof of NASA submission.

A release candidate is not a production deployment.
