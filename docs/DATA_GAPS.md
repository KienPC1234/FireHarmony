# Data gaps and resume plan

A missing year is **not** a quiet fire year. `GET /api/firms/coverage?aoi=…`
returns a `gaps` ledger (`missing_months`, `missing_by_year`,
`missing_examples`) derived from the request manifest. The calendar UI shows
the same warning.

## Current gaps (2026-11-13, post-Australia backfill)

| AOI | Expected range | Fetched months | Full months (>=90% paired) | Missing |
|---|---|---:|---:|---|
| vietnam | 2012-01 … 2026-12 | 169 | 168 | 2026-11..12 (NRT partial / future) |
| amazon | 2012-01 … 2026-12 | 85 | 84 | 2012-01…2018-12 (84), 2026-11..12 |
| australia | 2012-01 … 2026-12 | 85 | 84 | 2012-01…2018-12 (84), 2026-11..12 |

All three AOIs now meet the `full_month` coverage rule; earlier pre-backfill snapshots had Australia at 0/85 full months (5-day windows).

Fallback `k=0.35` (`insufficient_overlap`, <3 co-observed months) keeps its number
but always ships with `uncertainty_status=not_calibrated` + `calibration_note`
(no interval emitted); per `docs/TRUTH_CONTRACT.md` the bare number is never shown alone.

## Custom / new regions (stat-only, transfer not established)

A custom bbox/geometry (or any region outside vietnam/amazon/australia) is
served only with `method=stat` + `uncertainty_status=not_calibrated`.
`hts`/`stan` return 409 (`model_requires_full_aoi` /
`geometry_requires_stat_method`) because AOI-level monthly targets cannot be
reallocated to an arbitrary polygon. Transfer to new regions is
**not established**: evaluation covers only the 3 preset AOIs.

## Ops caps and cold start

Request caps (enforced in `backend/app/main.py`): daily slice 5000,
map-cells `max_cells` ≤ 200k, `/validate` ≤ 50k rows, ingest ≤ 50MB,
session dataset ≤ 10MB, geometry ≤ 200kB / 5k vertices.
Every response carries `X-Elapsed-Ms`; cold `/calendar` on the full Vietnam
pull is ~153.7s (stat) / ~215.3s (STAN), warm 91–118ms. Raw (~1.4 GB) stays
gitignored; the submission ships only the 24-month demo pack (459,832 rows,
SHA-256 pinned).

## Resume

```bash
cd backend
# finish amazon 2012-2018 (large; run in chunks if rate-limited)
../.venv/bin/python -m scripts.firms.fetch_missing --aoi amazon \
  --start-year 2012 --end-year 2018 --workers 2 --delay 0.2

# australia is slow because VIIRS responses are large; resume in chunks
../.venv/bin/python -m scripts.firms.fetch_missing --aoi australia \
  --start-year 2019 --end-year 2025 --workers 2 --delay 0.2
```

After fetching, run the full chain so artifacts, docs and benchmark stay in
sync:

```bash
../.venv/bin/python -m scripts.firms.train_ml --aoi vietnam --data raw --test-years 2
../.venv/bin/python -m scripts.firms.train_ts --aoi vietnam --data raw --test-years 2
../.venv/bin/python -m scripts.firms.evaluate --data raw --test-years 2
../.venv/bin/python -m scripts.firms.make_benchmark
../.venv/bin/python -m scripts.firms.render_docs
../.venv/bin/python -m scripts.firms.rebuild_benchmark --data raw
../.venv/bin/python -m pytest tests/test_firms.py -q
```

The coverage-aware filter (`coverage.eligible_pair_months`) excludes months
with <90% paired MODIS/VIIRS days from training/evaluation, so a partially
fetched year cannot silently enter a monthly ratio.
