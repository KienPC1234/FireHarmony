# Audited NASA FIRMS raw subset — vietnam, 2025-01

16 unmodified FIRMS Area API CSVs (MODIS C6.1 SP + VIIRS SNPP 375 m SP),
pulled 2025 with `scripts/firms/fetch_full_month.py` for bbox `104,10,109,16`.
This is the only raw data in the source ZIP: the full 3.4M-row pull is not
distributable, but this month proves the pixel-to-calendar path end to end.

- `CHECKSUMS.sha256` pins every file; `rebuild_subset.py` verifies them first.
- `expected.json` records the deterministic output (clean/rejected rows,
  cell-days, month total, observed/estimated split, calibrated k).
- Reproduce: `python -m scripts.firms.rebuild_subset`

Coverage: 2025-01 was requested for all 31 days by both sensors (see the
manifest ledger in the full repo); this subset is a demonstration slice, not a
replacement for the complete history.
