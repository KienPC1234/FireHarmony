# Data gaps and resume plan

A missing year is **not** a quiet fire year. `GET /api/firms/coverage?aoi=…`
returns a `gaps` ledger (`missing_months`, `missing_by_year`,
`missing_examples`) derived from the request manifest. The calendar UI shows
the same warning.

## Current gaps (2026-11-10)

| AOI | Expected range | Fetched months | Missing | Where |
|---|---|---:|---:|---|
| vietnam | 2012-01 … 2026-12 | 169 | 11 | 2026-01…10 + future 2026-12 (NRT partial) |
| amazon | 2012-01 … 2026-12 | 85 | 95 | 2012-01…2018-12 (84), 2026-01…10 (11) |
| australia | 2012-01 … 2026-12 | 85 | 95 | 2012-01…2018-12 (84), 2026-01…10 (11) |

Australia also has **0/85 months with ≥90% paired MODIS/VIIRS days**; its rows
are 5-day windows, so it is a sparse stress test, not a monthly series.

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
