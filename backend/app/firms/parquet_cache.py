"""Parquet partition cache for FIRMS raw CSVs (CLAIM-024, audit P1-A).

Cold raw `/calendar` costs 153-215 s of CSV scanning (cached: ~91 ms), so
this module builds one Parquet partition per (aoi, year-month) from the raw
CSVs with pandas/pyarrow and serves month-filtered reads from it.

Contract:
- Only active when env ``FIRMS_PARQUET=1`` (default ``0`` = legacy CSV path,
  byte-for-byte unchanged). ``store.iter_raw_rows`` checks the flag.
- Only intercepts the default raw dir (``raw_dir is None``); test-injected
  ``tmp_path`` dirs always use the CSV path, so existing tests are unaffected
  by the flag.
- Only intercepts month/year-filtered reads (``ym`` / ``year``); unfiltered
  full-pool scans keep the CSV path.
- ``iter_parquet_rows`` yields the same shape as ``store.iter_raw_rows``:
  one ``dict`` per detection, lowercased header keys, all values ``str``
  (CSV semantics), SP-files-first order, same dedup signature.
- Never changes the ``beh-...`` harmonize cache key (that lives in
  ``harmonize.cache_behavior`` and is untouched).
- Any build/read failure raises; callers must fall back to the CSV path.

DuckDB: opt-in second rung (CLAIM-028). ``FIRMS_DUCKDB=1`` reads the same
(year, month) partitions directly with DuckDB SQL (partition pruning = the
ym/year predicate selects only the relevant ``*_YYYY-MM.parquet`` files;
no row-level WHERE is added because window-named partitions intentionally
mirror the CSV path's trust-by-name semantics, spillover rows included).
``duckdb`` is pinned loosely (``duckdb>=1.0`` in ``requirements-dev.txt``,
the agent/dev dataframe stack) and every DuckDB failure raises so callers
fall back to the older path.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "firms"
RAW_DIR = DATA_DIR / "raw"
PARQUET_DIR = DATA_DIR / "parquet"


def enabled() -> bool:
    """True only when the operator opts in via ``FIRMS_PARQUET=1``."""
    return os.getenv("FIRMS_PARQUET") == "1"


def duckdb_enabled() -> bool:
    """True only when the operator opts in via ``FIRMS_DUCKDB=1``.

    Independent of ``FIRMS_PARQUET`` so each rung benchmarks separately.
    Default ``0`` (off): legacy CSV behavior unchanged.
    """
    return os.getenv("FIRMS_DUCKDB") == "1"


def _is_default_raw(rd: Path) -> bool:
    """True when `rd` is the production raw dir (not a test override)."""
    try:
        return Path(rd).resolve() == RAW_DIR.resolve()
    except OSError:
        return Path(rd) == RAW_DIR


def partition_path(aoi: str, ym: str,
                   raw_dir: Path | None = None) -> Path:
    """Parquet file for one (aoi, year-month) partition.

    Production raw dir -> ``data/firms/parquet/``; any other source dir
    (e.g. test ``tmp_path``) -> an isolated ``_parquet/`` subdir beside it.
    """
    rd = Path(raw_dir) if raw_dir is not None else RAW_DIR
    base = PARQUET_DIR if _is_default_raw(rd) else rd / "_parquet"
    return base / f"{aoi}_{ym}.parquet"


def _meta_path(aoi: str, ym: str, raw_dir: Path | None = None) -> Path:
    p = partition_path(aoi, ym, raw_dir)
    return p.with_suffix(".meta.json")


def _manifest_files_for(aoi: str, rd: Path) -> set[str]:
    """Manifest-listed files for an aoi, patch-aware (tests swap MANIFEST)."""
    from app.firms import store as _store

    if Path(rd) == Path(_store.RAW_DIR):
        return _store._manifest_files_for_aoi(aoi)
    mf = Path(rd) / "ingest_manifest.json"
    if not mf.exists():
        return set()
    try:
        entries = json.loads(mf.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    return {str(e.get("file")) for e in entries
            if isinstance(e, dict) and e.get("aoi") == aoi and e.get("file")}


def _markers(files: list[Path]) -> dict[str, list]:
    """Name -> [size, mtime_ns] markers for freshness comparison."""
    out: dict[str, list] = {}
    for f in files:
        try:
            st = f.stat()
        except OSError:
            continue
        out[f.name] = [st.st_size, st.st_mtime_ns]
    return out


_WINDOW_TAG = re.compile(r"_\d{4}-\d{2}[-_]")


def _wanted_files(aoi: str, ym: str, raw_dir: Path,
                  manifest_files: set[str]) -> list[tuple[Path, bool]]:
    """Same rows as ``store.iter_raw_rows(ym=...)``, without its full scan.

    The CSV path scans every manifest-listed file (fetch pulls log every
    window there, so a month query re-parses the whole AOI). Window-named
    fetch pulls only ever carry rows of their own window, so this builder
    trusts them by name and re-scans -- with row-level date filtering --
    only manifest files WITHOUT a window tag (true ingested uploads,
    ``{aoi}_{src}_{stamp}_{digest}.csv``). Equivalence is verified
    empirically (row-for-row against the CSV path) rather than claimed.
    Returns [(path, filter_rows_by_date)] in SP-first order.
    """
    files = sorted(raw_dir.glob(f"{aoi}_*.csv"),
                   key=lambda p: (0 if "_SP_" in p.name else 1, p.name))
    wanted: list[tuple[Path, bool]] = []
    for f in files:
        if f"_{ym}-" in f.name or f"_{ym}_" in f.name:
            wanted.append((f, False))
        elif f.name in manifest_files and not _WINDOW_TAG.search(f.name):
            wanted.append((f, True))
    return wanted


def _sig(row: dict) -> tuple | None:
    """Same dedup signature as ``store.iter_raw_rows``."""
    try:
        return (
            str(row.get("instrument", "")).upper(),
            str(row.get("satellite", "")).strip(),
            str(row.get("acq_date", ""))[:10],
            str(row.get("acq_time", "")).strip(),
            round(float(row.get("latitude") or 0), 4),
            round(float(row.get("longitude") or 0), 4),
            str(row.get("version", "")).strip(),
        )
    except (TypeError, ValueError):
        return None


def build_aoi_month(aoi: str, ym: str,
                    raw_dir: Path | None = None) -> Path:
    """(Re)build one (aoi, ym) partition from raw CSVs. Returns its path."""
    import pandas as pd

    rd = Path(raw_dir) if raw_dir is not None else RAW_DIR
    manifest_files = _manifest_files_for(aoi, rd)
    wanted = _wanted_files(aoi, ym, rd, manifest_files)
    frames = []
    seen: set[tuple] = set()
    for f, by_date in wanted:
        try:
            df = pd.read_csv(f, dtype=str, keep_default_na=False)
        except (OSError, ValueError):
            continue
        df.columns = [str(c).strip().lower() for c in df.columns]
        if "acq_date" not in df.columns:
            continue
        recs = df.to_dict("records")
        keep = []
        for r in recs:
            sig = _sig(r)
            if sig is None or sig in seen:
                continue
            seen.add(sig)
            if by_date and str(sig[2])[:7] != ym:
                continue
            keep.append(r)
        if keep:
            frames.append(pd.DataFrame(keep))
    dest = partition_path(aoi, ym, raw_dir)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if frames:
        full = pd.concat(frames, ignore_index=True).fillna("")
        # CSV semantics: every value a str (round-trip stable, no NaN).
        for c in full.columns:
            full[c] = full[c].astype(str)
        full.to_parquet(dest, engine="pyarrow", index=False)
    else:
        # No rows for this month: write an empty frame with the canonical
        # FIRMS columns so readers still see a valid (empty) partition.
        pd.DataFrame(
            columns=["latitude", "longitude", "acq_date", "acq_time",
                     "satellite", "instrument", "confidence", "version"]
        ).to_parquet(dest, engine="pyarrow", index=False)
    try:
        _meta_path(aoi, ym, raw_dir).write_text(
            json.dumps({"aoi": aoi, "ym": ym,
                        "files": _markers([f for f, _ in wanted]),
                        "aoi_file_count": len(list(rd.glob(f"{aoi}_*.csv"))),
                        "rows": sum(len(f) for f in frames)},
                       ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    return dest


def is_fresh(aoi: str, ym: str, raw_dir: Path | None = None) -> bool:
    """True when the partition exists and no source CSV marker changed."""
    dest = partition_path(aoi, ym, raw_dir)
    meta = _meta_path(aoi, ym, raw_dir)
    if not dest.exists() or not meta.exists():
        return False
    try:
        saved = json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if not isinstance(saved, dict) or saved.get("aoi") != aoi \
            or saved.get("ym") != ym:
        return False
    rd = Path(raw_dir) if raw_dir is not None else RAW_DIR
    manifest_files = _manifest_files_for(aoi, rd)
    wanted = _wanted_files(aoi, ym, rd, manifest_files)
    # Any new/deleted AOI file invalidates the partition (a fresh pull could
    # in theory carry rows for this month); marker comparison covers edits.
    try:
        aoi_file_count = len(list(rd.glob(f"{aoi}_*.csv")))
    except OSError:
        return False
    return (isinstance(saved.get("files"), dict)
            and saved["files"] == _markers([f for f, _ in wanted])
            and saved.get("aoi_file_count") == aoi_file_count)


def iter_parquet_rows(aoi: str, raw_dir: Path | None = None,
                      limit: int | None = None,
                      year: int | None = None, ym: str | None = None):
    """Yield stored rows with the same shape as ``store.iter_raw_rows``.

    Stale/missing partitions are rebuilt from CSV on the fly (same cost as
    one CSV month scan, once). All values are ``str``; absent columns read
    as ``""``. Multi-month (``year=``) reads dedup globally like the CSV
    path; note row *order* with ``limit`` may differ from the CSV path
    (month-sequential vs SP-first), so truncated pulls can differ -- the
    calendar path uses ``limit=None`` and is unaffected.
    """
    import pandas as pd

    yms: list[str]
    extra: list[Path] = []
    if ym is not None:
        yms = [str(ym)]
    else:
        rd = Path(raw_dir) if raw_dir is not None else RAW_DIR
        yr_str = str(year) if year is not None else None
        # Candidate months from window-named files (exact, no guessing).
        yms = sorted({part for f in rd.glob(f"{aoi}_*.csv")
                      for part in [_month_of(f.name, yr_str)]
                      if part})
        # Uploads carry no window tag, so no month partition claims them;
        # scan them once here with a year filter (mirrors the CSV path,
        # which date-filters manifest files for year queries).
        manifest_files = _manifest_files_for(aoi, rd)
        extra = sorted(
            f for f in rd.glob(f"{aoi}_*.csv")
            if f.name in manifest_files and not _WINDOW_TAG.search(f.name))
    n = 0
    # Multi-source reads (year=, or year= with uploads): overlapping fetch
    # windows can store one detection in two adjacent partitions (e.g. a
    # 2019-03-01 row inside a late-Feb window file trusted by the Feb build
    # AND inside the March window). The CSV path dedups globally, so mirror
    # that with one shared `seen` set. Single-month reads need no dedup: the
    # build already dedups, and skipping the per-row sig keeps them fast.
    seen: set[tuple] | None = set() if (len(yms) > 1 or extra) else None
    for m in yms:
        if not is_fresh(aoi, m, raw_dir):
            try:
                build_aoi_month(aoi, m, raw_dir)
            except Exception:
                continue
        try:
            df = pd.read_parquet(partition_path(aoi, m, raw_dir),
                                 engine="pyarrow")
        except (OSError, ValueError):
            continue
        cols = [str(c) for c in df.columns]
        for rec in df.itertuples(index=False):
            row = {c: ("" if v is None else str(v))
                   for c, v in zip(cols, rec)}
            if seen is not None:
                sig = _sig(row)
                if sig is None or sig in seen:
                    continue
                seen.add(sig)
            yield row
            n += 1
            if limit is not None and n >= limit:
                return
    if extra:
        # Year reads must also cover tag-less uploads (no partition owns
        # them). Small files; parse with pandas, filter by year, dedup
        # globally against what the partitions already yielded.
        assert seen is not None
        for f in extra:
            try:
                df = pd.read_csv(f, dtype=str, keep_default_na=False)
            except (OSError, ValueError):
                continue
            df.columns = [str(c).strip().lower() for c in df.columns]
            if "acq_date" not in df.columns:
                continue
            for r in df.to_dict("records"):
                sig = _sig(r)
                if sig is None or sig in seen:
                    continue
                seen.add(sig)
                if year is not None and str(sig[2])[:4] != str(year):
                    continue
                yield {k: ("" if v is None else str(v))
                       for k, v in r.items()}
                n += 1
                if limit is not None and n >= limit:
                    return


def iter_duckdb_rows(aoi: str, raw_dir: Path | None = None,
                      limit: int | None = None,
                      year: int | None = None, ym: str | None = None,
                      dedup: bool = True):
    """Yield stored rows via DuckDB over the same partitions.

    Same contract as :func:`iter_parquet_rows` (same shape, same dedup, no
    cache-key change): one ``dict`` per detection, lowercased keys, all
    values ``str``. The ym/year predicate prunes at the file level -- only
    the relevant ``*_YYYY-MM.parquet`` partitions are opened, so DuckDB
    pushes the filter into the Parquet scan instead of parsing years of
    CSV. Stale/missing partitions are rebuilt from CSV on the fly (same as
    the pyarrow path). Any failure raises; callers must fall back.
    """
    import duckdb

    yms: list[str]
    extra: list[Path] = []
    if ym is not None:
        yms = [str(ym)]
    else:
        rd = Path(raw_dir) if raw_dir is not None else RAW_DIR
        yr_str = str(year) if year is not None else None
        yms = sorted({part for f in rd.glob(f"{aoi}_*.csv")
                      for part in [_month_of(f.name, yr_str)]
                      if part})
        manifest_files = _manifest_files_for(aoi, rd)
        extra = sorted(
            f for f in rd.glob(f"{aoi}_*.csv")
            if f.name in manifest_files and not _WINDOW_TAG.search(f.name))
    con = duckdb.connect(config={"threads": 4, "memory_limit": "1GB"})
    try:
        n = 0
        seen: set[tuple] | None = set() if (dedup and (len(yms) > 1 or extra)) else None
        for m in yms:
            if not is_fresh(aoi, m, raw_dir):
                build_aoi_month(aoi, m, raw_dir)
            # Partition pruning: exactly one file per requested month.
            rel = con.execute(
                "SELECT * FROM read_parquet(?)",
                [str(partition_path(aoi, m, raw_dir))],
            )
            cols = [str(d[0]).strip().lower() for d in rel.description]
            while True:
                batch = rel.fetchmany(50000)
                if not batch:
                    break
                for rec in batch:
                    row = {c: ("" if v is None else str(v))
                           for c, v in zip(cols, rec)}
                    if seen is not None:
                        sig = _sig(row)
                        if sig is None or sig in seen:
                            continue
                        seen.add(sig)
                    yield row
                    n += 1
                    if limit is not None and n >= limit:
                        return
    finally:
        try:
            con.close()
        except Exception:
            pass
    if extra:
        # Tag-less uploads: same small-file pandas scan as the pyarrow path.
        import pandas as pd

        assert seen is not None
        for f in extra:
            try:
                df = pd.read_csv(f, dtype=str, keep_default_na=False)
            except (OSError, ValueError):
                continue
            df.columns = [str(c).strip().lower() for c in df.columns]
            if "acq_date" not in df.columns:
                continue
            for r in df.to_dict("records"):
                sig = _sig(r)
                if sig is None or sig in seen:
                    continue
                seen.add(sig)
                if year is not None and str(sig[2])[:4] != str(year):
                    continue
                yield {k: ("" if v is None else str(v))
                       for k, v in r.items()}
                n += 1
                if limit is not None and n >= limit:
                    return


def _month_of(fname: str, year: str | None = None) -> str | None:
    """Extract ``YYYY-MM`` from a window-named raw file, else None."""
    m = re.search(r"_(\d{4})-(\d{2})[-_]", fname)
    if m and (year is None or m.group(1) == year):
        return f"{m.group(1)}-{m.group(2)}"
    return None


def aggregate_duckdb(
    aoi: str,
    raw_dir: Path | None = None,
    bbox: tuple[float, float, float, float] | None = None,
    qa_min: str = "all",
    platform_set: str = "all",
    source_type: str = "all",
    year: int | None = None,
    ym: str | None = None,
    res_deg: float = 0.05,
):
    """Aggregate Parquet partitions directly inside DuckDB SQL.

    Equivalent to ``harmonize.aggregate_iter(store.iter_raw_rows(...),
    keep_clean=None, qa_min=..., platform_set=..., source_type=...)`` after
    bbox filtering, without materialising millions of Python row dicts.
    Raises if tagless manifest CSVs exist or DuckDB fails, so callers can
    fall back to ``iter_raw_rows`` + ``aggregate_iter``.
    """
    from collections import defaultdict
    import duckdb
    from app.firms.harmonize import DailyAgg

    rd = Path(raw_dir) if raw_dir is not None else RAW_DIR
    if ym is not None:
        yms = [str(ym)]
        extra: list[Path] = []
    else:
        yr_str = str(year) if year is not None else None
        yms = sorted({part for f in rd.glob(f"{aoi}_*.csv")
                      for part in [_month_of(f.name, yr_str)]
                      if part})
        manifest_files = _manifest_files_for(aoi, rd)
        extra = sorted(
            f for f in rd.glob(f"{aoi}_*.csv")
            if f.name in manifest_files and not _WINDOW_TAG.search(f.name))
    if extra:
        raise RuntimeError("tagless manifest files present; use iter_raw_rows")

    stats = {
        "clean": 0,
        "rejected": 0,
        "qa_counts": {},
        "filtered_low_confidence": 0,
        "filtered_confidence": 0,
        "filtered_platform": 0,
        "filtered_source_type": 0,
        "filters": {
            "qa_min": qa_min,
            "platform_set": platform_set,
            **({"source_type": source_type} if source_type != "all" else {}),
        },
    }
    out: dict[tuple[str, str, str], DailyAgg] = defaultdict(DailyAgg)
    if not yms:
        return out, stats

    paths: list[str] = []
    for m in yms:
        if not is_fresh(aoi, m, raw_dir):
            build_aoi_month(aoi, m, raw_dir)
        p = partition_path(aoi, m, raw_dir)
        if p.exists():
            paths.append(str(p))
    if not paths:
        return out, stats

    con = duckdb.connect(config={"threads": 4, "memory_limit": "1GB"})
    try:
        schema_rel = con.execute(
            "SELECT * FROM read_parquet(?, union_by_name=True) LIMIT 0",
            [paths],
        )
        cols = {str(d[0]).strip().lower() for d in schema_rel.description}

        def col_expr(name: str) -> str:
            return f'"{name}"' if name in cols else "NULL::VARCHAR"

        bbox_sql = ""
        bbox_params: list = []
        if bbox is not None:
            bbox_sql = (
                f" WHERE TRY_CAST({col_expr('longitude')} AS DOUBLE) BETWEEN ? AND ?"
                f" AND TRY_CAST({col_expr('latitude')} AS DOUBLE) BETWEEN ? AND ?"
            )
            bbox_params = [float(bbox[0]), float(bbox[2]),
                           float(bbox[1]), float(bbox[3])]

        sat_expr = (
            f"CASE WHEN trim(coalesce({col_expr('satellite')}, '')) = '' THEN 'UNKNOWN' "
            f"ELSE replace(replace(replace(replace(replace(replace("
            f"trim({col_expr('satellite')}), 'NOAA20', 'NOAA-20'), 'NOAA21', 'NOAA-21'), "
            f"'NOAA_20', 'NOAA-20'), 'NOAA_21', 'NOAA-21'), 'NOAA 20', 'NOAA-20'), 'NOAA 21', 'NOAA-21') END"
        )

        create_sql = f"""
        CREATE TEMP TABLE _parsed AS
        WITH base AS (
            SELECT
                {col_expr('latitude')} AS _lat_s,
                {col_expr('longitude')} AS _lon_s,
                {col_expr('brightness')} AS _b_s,
                {col_expr('bright_ti4')} AS _b4_s,
                {col_expr('scan')} AS _sc_s,
                {col_expr('track')} AS _tr_s,
                {col_expr('bright_t31')} AS _t31_s,
                {col_expr('bright_ti5')} AS _t5_s,
                {col_expr('instrument')} AS _inst_s,
                {col_expr('acq_date')} AS _date_s,
                {col_expr('acq_time')} AS _time_s,
                {col_expr('frp')} AS _frp_s,
                {col_expr('daynight')} AS _dn_s,
                {col_expr('type')} AS _tp_s,
                {col_expr('confidence')} AS _conf_s,
                {sat_expr} AS _sat_norm,
                {col_expr('version')} AS _ver_s
            FROM read_parquet(?, union_by_name=True)
            {bbox_sql}
        ),
        norm AS (
            SELECT
                TRY_CAST(_lat_s AS DOUBLE) AS lat,
                TRY_CAST(_lon_s AS DOUBLE) AS lon,
                TRY_CAST(coalesce(nullif(_b_s, ''), nullif(_b4_s, '')) AS DOUBLE) AS bright,
                TRY_CAST(_sc_s AS DOUBLE) AS sc,
                TRY_CAST(_tr_s AS DOUBLE) AS tr,
                nullif(_t31_s, '') AS _t31_nz,
                nullif(_t5_s, '') AS _t5_nz,
                TRY_CAST(coalesce(nullif(_t31_s, ''), nullif(_t5_s, '')) AS DOUBLE) AS bt31,
                CASE
                    WHEN upper(trim(coalesce(_inst_s, ''))) LIKE 'VIIRS%' THEN 'VIIRS'
                    WHEN upper(trim(coalesce(_inst_s, ''))) = 'MODIS' THEN 'MODIS'
                    ELSE NULL
                END AS inst,
                substr(coalesce(_date_s, ''), 1, 10) AS day_str,
                TRY_STRPTIME(substr(coalesce(_date_s, ''), 1, 10), '%Y-%m-%d') AS day_dt,
                trim(coalesce(_time_s, '')) AS t_raw,
                lpad(trim(coalesce(_time_s, '')), 4, '0') AS t_pad,
                nullif(_frp_s, '') AS _frp_nz,
                TRY_CAST(nullif(_frp_s, '') AS DOUBLE) AS frp_val,
                nullif(_dn_s, '') AS dn_raw,
                nullif(_tp_s, '') AS _tp_nz,
                TRY_CAST(nullif(_tp_s, '') AS INTEGER) AS tp_val,
                lower(trim(coalesce(nullif(_conf_s, ''), 'n'))) AS conf_raw,
                CASE upper(_sat_norm)
                    WHEN 'N' THEN 'NPP'
                    WHEN 'NPP' THEN 'NPP'
                    WHEN 'SNPP' THEN 'NPP'
                    WHEN 'SUOMI NPP' THEN 'NPP'
                    WHEN 'SUOMI-NPP' THEN 'NPP'
                    WHEN 'S-NPP' THEN 'NPP'
                    WHEN 'S NPP' THEN 'NPP'
                    WHEN 'N20' THEN 'NOAA-20'
                    WHEN 'N-20' THEN 'NOAA-20'
                    WHEN 'N21' THEN 'NOAA-21'
                    WHEN 'N-21' THEN 'NOAA-21'
                    ELSE _sat_norm
                END AS sat,
                coalesce(nullif(_ver_s, ''), 'unknown') AS ver
            FROM base
        ),
        checked AS (
            SELECT
                lat, lon, inst, sat, day_str, t_pad, frp_val, tp_val, ver,
                CASE
                    WHEN regexp_matches(conf_raw, '^[0-9]{{1,3}}$') AND TRY_CAST(conf_raw AS INTEGER) <= 100 THEN
                        CASE WHEN TRY_CAST(conf_raw AS INTEGER) >= 80 THEN 'h'
                             WHEN TRY_CAST(conf_raw AS INTEGER) >= 40 THEN 'n'
                             ELSE 'l' END
                    WHEN conf_raw IN ('l', 'n', 'h') THEN conf_raw
                    ELSE NULL
                END AS conf,
                (
                    lat IS NOT NULL AND lat BETWEEN -90.0 AND 90.0
                    AND lon IS NOT NULL AND lon BETWEEN -180.0 AND 180.0
                    AND bright IS NOT NULL AND bright > 0.0 AND bright < 2000.0
                    AND sc IS NOT NULL AND sc > 0.0 AND sc < 50.0
                    AND tr IS NOT NULL AND tr > 0.0 AND tr < 50.0
                    AND (coalesce(_t31_nz, _t5_nz) IS NULL OR (bt31 IS NOT NULL AND bt31 >= 0.0 AND bt31 < 2000.0))
                    AND inst IS NOT NULL
                    AND length(day_str) = 10 AND day_dt IS NOT NULL
                    AND regexp_matches(t_raw, '^[0-9]{{1,4}}$')
                    AND TRY_CAST(substr(t_pad, 1, 2) AS INTEGER) BETWEEN 0 AND 23
                    AND TRY_CAST(substr(t_pad, 3, 2) AS INTEGER) BETWEEN 0 AND 59
                    AND (_frp_nz IS NULL OR (frp_val IS NOT NULL AND frp_val >= 0.0))
                    AND (dn_raw IS NULL OR dn_raw IN ('D', 'N'))
                    AND (_tp_nz IS NULL OR (tp_val IS NOT NULL AND tp_val BETWEEN 0 AND 3))
                    AND (
                        (regexp_matches(conf_raw, '^[0-9]{{1,3}}$') AND TRY_CAST(conf_raw AS INTEGER) <= 100)
                        OR conf_raw IN ('l', 'n', 'h')
                    )
                ) AS is_valid
            FROM norm
        )
        SELECT
            lat, lon, inst, sat, day_str, t_pad, conf, frp_val, tp_val, ver, is_valid,
            CASE
                WHEN NOT is_valid THEN NULL
                WHEN (sat != 'UNKNOWN' AND (
                    (inst = 'MODIS' AND sat NOT IN ('Terra', 'Aqua'))
                    OR (inst = 'VIIRS' AND sat NOT IN ('NPP', 'NOAA-20', 'NOAA-21'))
                )) THEN 'anachronistic_platform'
                WHEN (sat = 'Terra' AND day_str < '2000-02-24')
                  OR (sat = 'Aqua' AND day_str < '2002-07-04')
                  OR (sat = 'NPP' AND day_str < '2012-01-01')
                  OR (sat = 'NOAA-20' AND day_str < '2018-04-01')
                  OR (sat = 'NOAA-21' AND day_str < '2024-01-17') THEN 'anachronistic_platform'
                WHEN conf = 'l' AND coalesce(frp_val, 0.0) < 1.0 THEN 'low_confidence'
                ELSE 'keep'
            END AS qa_flag
        FROM checked
        """
        con.execute(create_sql, [paths] + bbox_params)

        drop_low_conf = qa_min in ("nominal", "high")
        drop_non_high = qa_min == "high"
        drop_non_snpp = platform_set == "snpp"
        drop_offshore = source_type == "land"
        drop_non_veg = source_type == "vegetation"

        stats_row = con.execute(f"""
        WITH f AS (
            SELECT
                is_valid,
                qa_flag,
                conf,
                inst,
                sat,
                tp_val,
                (is_valid AND qa_flag != 'anachronistic_platform') AS pass_qa,
                (? AND qa_flag = 'low_confidence') AS f_low,
                (? AND conf != 'h') AS f_conf,
                (? AND inst = 'VIIRS' AND sat != 'NPP') AS f_plat,
                ((? AND tp_val = 3) OR (? AND tp_val IN (1, 2, 3))) AS f_src
            FROM _parsed
        )
        SELECT
            COUNT(*) FILTER (WHERE NOT is_valid OR qa_flag = 'anachronistic_platform') AS rejected,
            COUNT(*) FILTER (WHERE is_valid AND qa_flag = 'keep') AS qa_keep,
            COUNT(*) FILTER (WHERE is_valid AND qa_flag = 'low_confidence') AS qa_low,
            COUNT(*) FILTER (WHERE is_valid AND qa_flag = 'anachronistic_platform') AS qa_anach,
            COUNT(*) FILTER (WHERE pass_qa AND f_low) AS filt_low,
            COUNT(*) FILTER (WHERE pass_qa AND NOT f_low AND f_conf) AS filt_conf,
            COUNT(*) FILTER (WHERE pass_qa AND NOT f_low AND NOT f_conf AND f_plat) AS filt_plat,
            COUNT(*) FILTER (WHERE pass_qa AND NOT f_low AND NOT f_conf AND NOT f_plat AND f_src) AS filt_src,
            COUNT(*) FILTER (WHERE pass_qa AND NOT f_low AND NOT f_conf AND NOT f_plat AND NOT f_src) AS clean_cnt
        FROM f
        """, [drop_low_conf, drop_non_high, drop_non_snpp, drop_offshore, drop_non_veg]).fetchone()

        (rejected, qa_keep, qa_low, qa_anach,
         filt_low, filt_conf, filt_plat, filt_src, clean_cnt) = stats_row

        stats["rejected"] = int(rejected or 0)
        stats["clean"] = int(clean_cnt or 0)
        stats["filtered_low_confidence"] = int(filt_low or 0)
        stats["filtered_confidence"] = int(filt_conf or 0)
        stats["filtered_platform"] = int(filt_plat or 0)
        stats["filtered_source_type"] = int(filt_src or 0)
        qa_counts: dict[str, int] = {}
        if qa_keep:
            qa_counts["keep"] = int(qa_keep)
        if qa_low:
            qa_counts["low_confidence"] = int(qa_low)
        if qa_anach:
            qa_counts["anachronistic_platform"] = int(qa_anach)
        stats["qa_counts"] = qa_counts

        agg_rows = con.execute(f"""
        WITH clean AS (
            SELECT
                lat, lon, day_str, t_pad, inst, sat, ver,
                coalesce(frp_val, 0.0) AS fval
            FROM _parsed
            WHERE is_valid
              AND qa_flag != 'anachronistic_platform'
              AND NOT (? AND qa_flag = 'low_confidence')
              AND NOT (? AND conf != 'h')
              AND NOT (? AND inst = 'VIIRS' AND sat != 'NPP')
              AND NOT ((? AND tp_val = 3) OR (? AND tp_val IN (1, 2, 3)))
            QUALIFY row_number() OVER (
                PARTITION BY inst, sat, day_str, t_pad, round_even(lat, 4), round_even(lon, 4), ver
            ) = 1
        )
        SELECT
            CAST(floor(lat / ?) AS BIGINT) AS la_idx,
            CAST(floor(lon / ?) AS BIGINT) AS lo_idx,
            day_str,
            inst,
            sat,
            COUNT(*) AS cnt,
            SUM(fval) AS frp_sum
        FROM clean
        GROUP BY 1, 2, 3, 4, 5
        """, [drop_low_conf, drop_non_high, drop_non_snpp, drop_offshore, drop_non_veg,
              res_deg, res_deg]).fetchall()

        for la_idx, lo_idx, day_str, inst, sat, cnt, frp_sum in agg_rows:
            cell_id = f"{la_idx * res_deg:.2f}_{lo_idx * res_deg:.2f}"
            agg = out[(cell_id, day_str, inst)]
            c = int(cnt)
            fv = float(frp_sum or 0.0)
            agg.count += c
            agg.platforms.add(sat)
            agg.platform_counts[sat] = agg.platform_counts.get(sat, 0) + c
            agg.frp += fv
            agg.platform_frp[sat] = agg.platform_frp.get(sat, 0.0) + fv

        return out, stats
    finally:
        try:
            con.close()
        except Exception:
            pass

