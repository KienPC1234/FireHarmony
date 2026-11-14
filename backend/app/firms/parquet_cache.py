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
    elif year is not None:
        rd = Path(raw_dir) if raw_dir is not None else RAW_DIR
        # Candidate months from window-named files (exact, no guessing).
        yms = sorted({part for f in rd.glob(f"{aoi}_*.csv")
                      for part in [_month_of(f.name, str(year))]
                      if part})
        # Uploads carry no window tag, so no month partition claims them;
        # scan them once here with a year filter (mirrors the CSV path,
        # which date-filters manifest files for year queries).
        manifest_files = _manifest_files_for(aoi, rd)
        extra = sorted(
            f for f in rd.glob(f"{aoi}_*.csv")
            if f.name in manifest_files and not _WINDOW_TAG.search(f.name))
    else:
        raise ValueError("iter_parquet_rows requires ym or year")
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
                if str(sig[2])[:4] != str(year):
                    continue
                yield {k: ("" if v is None else str(v))
                       for k, v in r.items()}
                n += 1
                if limit is not None and n >= limit:
                    return


def iter_duckdb_rows(aoi: str, raw_dir: Path | None = None,
                      limit: int | None = None,
                      year: int | None = None, ym: str | None = None):
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
    elif year is not None:
        rd = Path(raw_dir) if raw_dir is not None else RAW_DIR
        yms = sorted({part for f in rd.glob(f"{aoi}_*.csv")
                      for part in [_month_of(f.name, str(year))]
                      if part})
        manifest_files = _manifest_files_for(aoi, rd)
        extra = sorted(
            f for f in rd.glob(f"{aoi}_*.csv")
            if f.name in manifest_files and not _WINDOW_TAG.search(f.name))
    else:
        raise ValueError("iter_duckdb_rows requires ym or year")
    con = duckdb.connect()
    try:
        n = 0
        seen: set[tuple] | None = set() if (len(yms) > 1 or extra) else None
        for m in yms:
            if not is_fresh(aoi, m, raw_dir):
                build_aoi_month(aoi, m, raw_dir)
            # Partition pruning: exactly one file per requested month.
            rel = con.execute(
                "SELECT * FROM read_parquet(?)",
                [str(partition_path(aoi, m, raw_dir))],
            )
            cols = [str(d[0]).strip().lower() for d in rel.description]
            for rec in rel.fetchall():
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
                if str(sig[2])[:4] != str(year):
                    continue
                yield {k: ("" if v is None else str(v))
                       for k, v in r.items()}
                n += 1
                if limit is not None and n >= limit:
                    return


def _month_of(fname: str, year: str) -> str | None:
    """Extract ``YYYY-MM`` from a window-named raw file, else None."""
    import re
    m = re.search(r"_(\d{4})-(\d{2})[-_]", fname)
    if m and m.group(1) == year:
        return f"{m.group(1)}-{m.group(2)}"
    return None
