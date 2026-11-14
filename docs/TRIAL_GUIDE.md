# Trial guide — reproduce without a NASA key, then go full-AOI with one

Audience: a researcher with no `FIRMS_MAP_KEY` who wants to try the product
today, and later re-run it on real pulls. Units everywhere are **hotspot
detections / sensor-adjusted activity index**, never confirmed fires; VIIRS is
a sensor reference, not ground truth (`docs/TRUTH_CONTRACT.md`).

Base URL below is `http://127.0.0.1:8000` (from `make demo` or `make dev`).
`ADMIN_TOKEN` note: upload/register/ingest endpoints are open in local dev and
gated (`401`/`403`/`503`) only when the server sets `ADMIN_TOKEN` (always in
production). If a write call is gated on a public host, stay on path B.

## Path B — no key (public demo)

### B1. Sample calendar (works with zero data on disk)

```bash
curl -s 'http://127.0.0.1:8000/api/firms/sample?aoi=vietnam&limit=5' | head -c 600
curl -s 'http://127.0.0.1:8000/api/firms/calendar?aoi=vietnam&data=sample&method=stat' | head -c 600
```

`data=sample` is synthetic and labelled as such (`synthetic demo, NOT
observed`). It exists only for the preset AOIs (`vietnam`, `amazon`,
`australia`); any other `aoi=` on sample is `400 Unknown aoi`.

### B2. Spatial / temporal subset — always `method=stat`

```bash
# bbox subset (any dataset, stat path)
curl -s 'http://127.0.0.1:8000/api/firms/calendar?aoi=vietnam&data=sample&method=stat&bbox=104,10,109,16' | head -c 600

# custom polygon (URL-encoded GeoJSON Polygon/MultiPolygon), stat-only
curl -s --get 'http://127.0.0.1:8000/api/firms/calendar' \
  --data-urlencode 'aoi=vietnam' \
  --data-urlencode 'data=sample' \
  --data-urlencode 'method=stat' \
  --data-urlencode 'geometry={"type":"Polygon","coordinates":[[[104,10],[109,10],[109,16],[104,16],[104,10]]]}' | head -c 600

# date window, stat-only
curl -s 'http://127.0.0.1:8000/api/firms/calendar?aoi=vietnam&data=sample&method=stat&from_date=2024-01-01&to_date=2024-06-30' | head -c 600
```

Polygon rule: a drawn polygon is `method=stat`-only. STAN/HTS are AOI-level
monthly totals for the full AOI and full month — they cannot be reallocated
to a polygon without inventing numbers, so any `bbox`/`geometry`/`from_date`/
`to_date` subset with `method=hts|stan` returns `409
model_requires_full_aoi` / `geometry_requires_stat_method`. The exit is
explicit: retry the same subset with `method=stat`.

### B3. Your own CSV — session upload (no key, no persistence)

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/firms/upload-dataset' \
  -F 'file=@my_firms_export.csv' | head -c 600
# → {"dataset_id":"upload:<hex>", "calendar_url":"/calendar?dataset=upload:<hex>", ...}

ID=upload:PASTE_HEX_HERE
curl -s "http://127.0.0.1:8000/api/firms/calendar?dataset=${ID}&method=stat" | head -c 600
curl -s "http://127.0.0.1:8000/api/firms/brief?dataset=${ID}&method=stat" | head -c 1200
```

Limits: 50 MB cap (`400`/`413` above it), empty file → `400`, unknown
`dataset=` → `404`. The session dataset is labelled `user-uploaded session
dataset (unverified source)` and is **not** a manifest-backed pull, so
coverage/uncertainty report unknown rather than a ledger. Uploads are
method=stat territory; `hts`/`stan` on an upload is `409` (no tiles for it).

### B4. Take something home — export / brief

```bash
curl -s 'http://127.0.0.1:8000/api/firms/export?aoi=vietnam&data=sample&method=stat' -o harmonized.csv
curl -s 'http://127.0.0.1:8000/api/firms/export-detections?aoi=vietnam&data=sample' -o detections.csv
curl -s 'http://127.0.0.1:8000/api/firms/brief?aoi=vietnam&data=sample&method=stat' -o brief.md
```

`export` streams the same harmonized path as `/calendar` (check
`X-Filter-Hash`, `X-Row-Count` headers); `brief` is the one-page Markdown
with the identical method/dataset. `brief` takes `bbox` but not `geometry`.

## Path A — self-host with a key (full AOI, STAN/HTS)

```bash
export FIRMS_MAP_KEY=<key>   # https://firms.modaps.eosdis.nasa.gov/api/area/
cd backend
../.venv/bin/python -m scripts.firms.fetch_full_month \
  --aoi vietnam --bbox 104,10,109,16 --start-year 2012 --end-year 2025 --workers 4
../.venv/bin/python -m scripts.firms.fetch_missing --aoi vietnam --start-year 2012 --end-year 2025
```

Custom region: register first, then fetch/ingest into it.

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/firms/aois' \
  -H 'Content-Type: application/json' \
  -d '{"label":"My reserve","bbox":[104,10,109,16]}'
# → {"id":"my-reserve", ...} ; bad bbox → 400, duplicate id → 409

curl -s -X POST 'http://127.0.0.1:8000/api/firms/ingest?aoi=my-reserve&source=upload' \
  -F 'file=@my_firms_export.csv' | head -c 600
```

Then the served-model path (full AOI, full month — no filters):

```bash
curl -s 'http://127.0.0.1:8000/api/firms/calendar?aoi=vietnam&data=raw&method=stan' | head -c 600
curl -s 'http://127.0.0.1:8000/api/firms/models' | head -c 900   # recommended_primary vs statistically_established
curl -s 'http://127.0.0.1:8000/api/firms/backtest?aoi=vietnam&data=raw&test_years=2' | head -c 600
```

`/backtest` is frozen: it reads the committed evaluation manifest and never
trains. `refresh=1` is `409 refresh_requires_offline_pipeline` (rebuild via
`python -m scripts.firms.retrain_all`, then restart); a `test_years` that
disagrees with the manifest is `409 evaluation_split_mismatch`.

## Error matrix — what to expect, and the exit

| Endpoint | dataset × method | Expected failure | Exit |
|---|---|---|---|
| `calendar`, `export`, `brief` | `sample` + `hts`/`stan` | `409` — model needs raw tiles; sample has none | use `method=stat` on sample |
| `calendar`, `export` | `raw` + `hts`/`stan` + `bbox`/`geometry`/`from_date`/`to_date` | `409 model_requires_full_aoi` / `geometry_requires_stat_method` | same subset with `method=stat`, or full AOI for the model |
| `calendar`, `export`, `brief` | `raw`, AOI with nothing fetched | `404 no_raw_data` | `data=sample`, or fetch first (path A) |
| any | `sample`, unknown `aoi` | `400 Unknown aoi` | pick a preset, or register + use `raw` |
| `calendar` (+`export`) | `dataset=upload:<bad>` | `404` | re-upload, copy the full `dataset_id` |
| `upload-dataset`, `ingest` | file > 50 MB / empty | `400`/`413` | split the CSV, or fetch server-side instead |
| `aois` POST | bad bbox / duplicate id | `400` / `409` | fix order/range (`minLon,minLat,maxLon,maxLat`), pick a new id |
| `backtest` | `refresh=1` / wrong `test_years` | `409` | read the frozen table; retrain offline only |

General rule: `400` = bad input (fix the request), `404` = no such
data/dataset on this server (switch feed or fetch), `409` = truth guard
(don't force it — take the labelled path the message names).

## State, links, and what does not travel

- The dashboard's AOI/feed/method/filters live in the URL
  (`/calendar?aoi=vietnam&data=raw…`). Copy that URL as the share link —
  that is the experiment record.
- An unsaved bbox/polygon typed or drawn in the browser is client-side
  state: it is lost when you switch machines. Either copy the share link
  (`?aoi=…` plus the filter query) or register the region server-side
  (`POST /api/firms/aois`) so it becomes a first-class `aoi=` anyone can
  query.
- Session uploads (`upload:<hex>`) live on the server that received them
  and expire with it; they are not portable. For a durable custom region,
  use path A (register + fetch/ingest) instead.
