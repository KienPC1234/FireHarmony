# Contributing

FIRMS Fire Calendar — NASA Space Apps 2026. Small repo, short rules.

## Run it

```bash
make install
make sample                # deterministic offline samples (3 AOIs)
make test-backend          # 13 backend tests, no network/GPU needed
make dev                   # API :8000 + Vite :5173
```

Real data (optional, free key):

```bash
cp backend/.env.example backend/.env   # then set FIRMS_MAP_KEY inside
make fetch AOI_BBOX=104,10,109,16 DAYS=5 SOURCES=VIIRS_SNPP_NRT,MODIS_NRT AOI=vietnam
```

`backend/.env` is gitignored — never commit keys.

## Test before you push

```bash
make test                  # backend + frontend lint/unit/typecheck/build
```

## Data & honesty rules

- Every number the API serves comes from a FIRMS CSV (sample or download) or is
  labeled `estimated` (pre-2012 1/k upscale). No invented fire counts.
- The statistical path must work without torch (`GET /api/firms/dl-info`
  reports `has_torch` honestly; tests cover the thin-data refusal).
- New harmonization logic needs a test with an era-consistency or
  anomaly-catch assertion — see `backend/tests/test_firms.py`.
