"""Dataset store: cached loading, QA reports, CSV ingest, data status.

Samples live in data/firms/samples/firms_sample_{aoi}.csv (committed).
Real FIRMS downloads land in data/firms/raw/ (gitignored) via
scripts/firms/fetch_firms.py or POST /api/firms/ingest.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import time
from functools import lru_cache
from pathlib import Path

from app.firms.schema import FirmsRecord

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "firms"
SAMPLE_DIR = DATA_DIR / "samples"
RAW_DIR = DATA_DIR / "raw"
UPLOAD_DIR = DATA_DIR / "uploads"
MANIFEST = DATA_DIR / "ingest_manifest.json"

AOIS = ("vietnam", "amazon", "australia")


def sample_path(aoi: str) -> Path:
    return SAMPLE_DIR / f"firms_sample_{aoi}.csv"


def _read_all_rows(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return [{k.lower(): v for k, v in r.items()} for r in csv.DictReader(f)]


@lru_cache(maxsize=8)
def _load_cached(key: tuple[str, float, int]) -> list[dict]:
    """Cache key = (path, mtime, size): file edits invalidate automatically."""
    path = Path(key[0])
    return _read_all_rows(path)


def load_records(aoi: str, limit: int = 25000) -> list[dict]:
    """Validated-AOI sample loader with mtime-keyed cache (no re-parse/hit)."""
    if aoi not in AOIS:
        raise ValueError(f"Unknown aoi {aoi!r}; choose from {list(AOIS)}")
    p = sample_path(aoi)
    if not p.exists():
        return []
    st = p.stat()
    return _load_cached((str(p), st.st_mtime, st.st_size))[:limit]


def cache_info() -> dict:
    i = _load_cached.cache_info()
    return {"hits": i.hits, "misses": i.misses, "size": i.currsize}


def qa_report(records: list[dict]) -> dict:
    """Deterministic QA over raw dict rows: schema pass rate, dupes, coverage."""
    clean, rejected, seen = 0, 0, set()
    dupes = 0
    by_inst: dict[str, int] = {}
    by_conf: dict[str, int] = {}
    dates: list[str] = []
    for r in records:
        try:
            rec = FirmsRecord(**{k.lower(): v for k, v in dict(r).items()})
        except Exception:  # noqa: BLE001 - counted, reported in bulk
            rejected += 1
            continue
        clean += 1
        sig = (round(rec.latitude, 4), round(rec.longitude, 4),
               str(rec.acq_date), rec.acq_time, rec.instrument)
        if sig in seen:
            dupes += 1
        seen.add(sig)
        by_inst[rec.instrument] = by_inst.get(rec.instrument, 0) + 1
        by_conf[rec.confidence] = by_conf.get(rec.confidence, 0) + 1
        dates.append(str(rec.acq_date))
    dates.sort()
    return {"rows": len(records), "clean": clean, "rejected": rejected,
            "duplicates": dupes, "by_instrument": by_inst,
            "by_confidence": by_conf,
            "date_range": [dates[0], dates[-1]] if dates else [None, None]}


def ingest_upload(filename: str, content: bytes, aoi: str,
                  source: str = "upload") -> dict:
    """Validate an uploaded FIRMS CSV in chunks, store under raw/, log manifest.

    P1-15: validate BEFORE committing to disk; enforce 50 MB upstream too.
    """
    if aoi not in AOIS:
        raise ValueError(f"Unknown aoi {aoi!r}")
    if len(content) > 50 * 1024 * 1024:
        raise ValueError("File too large (max 50 MB)")
    text = content.decode("utf-8", errors="replace").splitlines()
    reader = csv.DictReader(text)
    if not reader.fieldnames or "latitude" not in {c.lower() for c in reader.fieldnames}:
        raise ValueError("Not a FIRMS CSV: missing latitude/longitude columns")
    clean, rejected, total = 0, 0, 0
    errors: list[dict] = []
    for i, row in enumerate(reader):
        total += 1
        try:
            FirmsRecord(**{k.lower(): v for k, v in dict(row).items()})
            clean += 1
        except Exception as e:  # noqa: BLE001 - per-row report
            rejected += 1
            if len(errors) < 20:
                errors.append({"row": i + 2, "error": str(e)[:160]})
    if total == 0:
        raise ValueError("Empty CSV (no data rows)")
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    full_digest = hashlib.sha256(content).hexdigest()
    digest = full_digest[:16]
    stamp = time.strftime("%Y%m%dT%H%M%S")
    dest = RAW_DIR / f"{aoi}_{source}_{stamp}_{digest}.csv"
    dest.write_bytes(content)
    report = {"file": dest.name, "bytes": len(content), "sha16": digest,
              "sha256": full_digest,
              "aoi": aoi, "source": source, "rows": total,
              "clean": clean, "rejected": rejected, "errors": errors}
    manifest = []
    if MANIFEST.exists():
        try:
            manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            manifest = []
    manifest.append({**report, "errors": [], "at": stamp})
    _atomic_write_json(MANIFEST, manifest)
    return report


def _atomic_write_json(path: Path, doc) -> None:
    """Write JSON atomically (tmp + replace) to survive crashes/races."""
    import uuid as _uuid
    import os as _os
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.{_os.getpid()}.{_uuid.uuid4().hex[:8]}.tmp"
    tmp.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    tmp.replace(path)


def save_upload_dataset(filename: str, chunks, max_bytes: int = 10 * 1024 * 1024) -> dict:
    """Stream an uploaded CSV to uploads/ with an early size cap (P0-11/P1-18).

    `chunks` is a SYNC iterable of bytes (endpoint bridges async reads).
    Validates header + schema AFTER a complete, within-quota write.
    Prunes oldest uploads beyond 20 files.
    Returns {dataset_id, file, rows, clean, rejected, errors}.
    """
    import re as _re
    import uuid as _uuid
    import os as _os
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe = _re.sub(r"[^A-Za-z0-9_.-]", "_", filename or "upload.csv")[:60]
    digest = hashlib.sha256()
    size = 0
    tmp = UPLOAD_DIR / f"tmp_{_os.getpid()}_{_uuid.uuid4().hex[:12]}.part"
    with tmp.open("wb") as fh:
        for ch in chunks:
            if not ch:
                continue
            size += len(ch)
            if size > max_bytes:
                fh.close()
                tmp.unlink(missing_ok=True)
                raise ValueError(f"File too large (>{max_bytes // 1024 // 1024} MB session cap)")
            digest.update(ch)
            fh.write(ch)
    return register_upload_file(tmp, safe, size, digest.hexdigest())


def register_upload_file(tmp: Path, safe_filename: str, size: int, digest_hex: str) -> dict:
    """Validate + promote a fully-written tmp upload; prune; never keep invalid."""
    import re as _re
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe = _re.sub(r"[^A-Za-z0-9_.-]", "_", safe_filename or "upload.csv")[:60]
    did = digest_hex[:16]
    dest = UPLOAD_DIR / f"upload_{did}_{safe}"
    if dest.exists():
        tmp.unlink(missing_ok=True)
    else:
        tmp.replace(dest)
    ups = sorted(UPLOAD_DIR.glob("upload_*.csv"), key=lambda p: p.stat().st_mtime)
    for old in ups[:-20]:
        old.unlink(missing_ok=True)
    # validate
    text = dest.read_text(encoding="utf-8", errors="replace").splitlines()
    reader = csv.DictReader(text)
    if not reader.fieldnames or "latitude" not in {c.lower() for c in reader.fieldnames}:
        dest.unlink(missing_ok=True)
        raise ValueError("Not a FIRMS CSV: missing latitude/longitude columns")
    clean, rejected, total = 0, 0, 0
    errors: list[dict] = []
    for i, row in enumerate(reader):
        total += 1
        try:
            FirmsRecord(**{k.lower(): v for k, v in dict(row).items()})
            clean += 1
        except Exception as e:  # noqa: BLE001 - per-row report
            rejected += 1
            if len(errors) < 10:
                errors.append({"row": i + 2, "error": str(e)[:160]})
    if total == 0:
        dest.unlink(missing_ok=True)
        raise ValueError("Empty CSV (no data rows)")
    return {"dataset_id": f"upload:{did}", "file": dest.name, "bytes": size,
            "rows": total, "clean": clean, "rejected": rejected, "errors": errors}


def load_upload_dataset(dataset_id: str, limit: int = 100000) -> list[dict]:
    """Load a session upload by id (validated hex, no path traversal)."""
    import re as _re
    m = _re.fullmatch(r"upload:([0-9a-f]{16})", dataset_id or "")
    if not m:
        raise ValueError(f"Bad dataset_id {dataset_id!r}")
    hits = sorted(UPLOAD_DIR.glob(f"upload_{m.group(1)}_*.csv"))
    if not hits:
        raise ValueError(f"Unknown or expired dataset {dataset_id!r}")
    rows: list[dict] = []
    with hits[0].open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows.append({k.lower(): v for k, v in r.items()})
            if len(rows) >= limit:
                break
    return rows


CACHE_DIR = DATA_DIR / "cache"
_FP_CACHE: dict[str, tuple[int, int, int, str]] = {}
_FP_CACHE_CAP = 2000


def _fp_cache_set(key: str, marker: tuple[int, int, int], digest: str) -> None:
    if len(_FP_CACHE) >= _FP_CACHE_CAP:
        # Bounded: evict oldest inserted (dict preserves insertion order).
        _FP_CACHE.pop(next(iter(_FP_CACHE)), None)
    _FP_CACHE[key] = (*marker, digest)


def file_sha256(path: Path) -> str:
    """Full-content SHA-256 (audit P0-05)."""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def raw_fingerprint(aoi: str, raw_dir: Path | None = None) -> str:
    """Content fingerprint of an AOI's raw pulls.

    Audit P0-05: name+size+mtime can miss an in-place edit. We hash file
    contents, memoized by (size, mtime_ns, ctime_ns). Rewriting a byte changes
    ctime even if mtime is restored; copying identical content changes ctime
    but the content hash (and therefore the fingerprint) stays the same.

    A disk sidecar (`cache/fp_{aoi}.json`) keeps the fingerprint cheap across
    restarts: when no file marker changed, no byte is hashed and a cache
    lookup stays a cache lookup instead of a full re-hash.
    """
    raw_dir = raw_dir or RAW_DIR
    files = sorted(raw_dir.glob(f"{aoi}_*.csv"))
    if not files:
        return "empty"
    markers: dict[str, list] = {}
    for f in files:
        try:
            st = f.stat()
        except OSError:
            continue
        markers[f.name] = [st.st_size, st.st_mtime_ns, st.st_ctime_ns]
    if not markers:
        return "empty"
    sidecar = DATA_DIR / "cache" / f"fp_{aoi}.json"
    if raw_dir == RAW_DIR:
        try:
            saved = json.loads(sidecar.read_text(encoding="utf-8"))
            sfiles = saved.get("files")
            if (isinstance(saved, dict) and isinstance(saved.get("fp"), str)
                    and isinstance(sfiles, dict)
                    and {n: list(e)[:3] for n, e in sfiles.items()} == markers):
                for n, m in markers.items():
                    _fp_cache_set(str(raw_dir / n), (m[0], m[1], m[2]),
                                  str(sfiles[n][3]))
                return saved["fp"]
        except (OSError, ValueError, KeyError, TypeError, IndexError):
            pass
    parts: list[str] = []
    digests: dict[str, str] = {}
    for f in files:
        if f.name not in markers:
            continue
        m = markers[f.name]
        key = str(f)
        cached = _FP_CACHE.get(key)
        if cached is None or list(cached[:3]) != m:
            try:
                digest = file_sha256(f)
            except OSError:
                digest = "unreadable"
            _fp_cache_set(key, (m[0], m[1], m[2]), digest)
            dval = digest
        else:
            dval = cached[3]
        digests[f.name] = dval
        parts.append(f"{f.name}:{dval}")
    fp = hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]
    if raw_dir == RAW_DIR:
        try:
            sidecar.parent.mkdir(parents=True, exist_ok=True)
            sidecar.write_text(json.dumps(
                {"fp": fp,
                 "files": {n: [*m, digests[n]]
                           for n, m in markers.items() if n in digests}},
                ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
    return fp


def sample_fingerprint(aoi: str) -> str:
    p = sample_path(aoi)
    if not p.exists():
        return "empty"
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def pooled_fingerprint(aois, raw: bool = True) -> str:
    """Fingerprint of the multi-AOI pool a pooled model was trained on."""
    parts = [f"{a}:{raw_fingerprint(a) if raw else sample_fingerprint(a)}"
             for a in aois]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


_SAFE_CACHE_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_,.-]*$")


def _safe_cache_key(key: str) -> str:
    """Contain a cache key inside CACHE_DIR.

    Keys embed request values (e.g. the user-supplied `bbox`). A value with `/`
    or `..` would escape the cache directory, create subdirectories, or raise
    OSError. Plain tokens are kept verbatim; anything else is hashed.
    """
    if _SAFE_CACHE_KEY.match(key) and ".." not in key:
        return key
    return "h_" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]


def cache_get(key: str):
    """Read a cached analysis result. JSON, not pickle (audit P1-20)."""
    f = CACHE_DIR / f"{_safe_cache_key(key)}.json"
    if not f.exists():
        return None
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def cache_put(key: str, value) -> None:
    import uuid as _uuid
    import os as _os
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    safe = _safe_cache_key(key)
    tmp = CACHE_DIR / f".{safe}.{_os.getpid()}.{_uuid.uuid4().hex[:8]}.tmp"
    tmp.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    tmp.replace(CACHE_DIR / f"{safe}.json")
    # keep the newest 40 entries
    entries = sorted(CACHE_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime)
    for old in entries[:-40]:
        old.unlink(missing_ok=True)


def iter_raw_rows(aoi: str, raw_dir: Path | None = None, limit: int | None = None,
                  year: int | None = None, ym: str | None = None):
    """Stream deduped raw rows for an aoi without materialising them.

    Same dedup signature and SP-first ordering as load_raw_merged, but yields
    dicts so a 1.4M-row AOI never becomes a 1.4M-element Python list in RAM.
    Supports year/ym fast-path filtering to avoid parsing years of unneeded CSVs.
    """
    if aoi not in AOIS and aoi != "custom":
        raise ValueError(f"Unknown aoi {aoi!r}")
    raw_dir = raw_dir or RAW_DIR
    if not raw_dir.exists():
        return
    files = sorted(raw_dir.glob(f"{aoi}_*.csv"),
                   key=lambda p: (0 if "_SP_" in p.name else 1, p.name))
    if ym is not None:
        files = [f for f in files if f"_{ym}-" in f.name or f"_{ym}_" in f.name]
    elif year is not None:
        files = [f for f in files if f"_{year}-" in f.name]
    seen: set[tuple] = set()
    n = 0
    for f in files:
        try:
            with f.open(encoding="utf-8", newline="") as fh:
                reader = csv.reader(fh)
                try:
                    header = [h.strip().lower() for h in next(reader)]
                except StopIteration:
                    continue
                idx = {k: i for i, k in enumerate(header)}
                i_inst = idx.get("instrument")
                i_sat = idx.get("satellite")
                i_date = idx.get("acq_date")
                i_time = idx.get("acq_time")
                i_lat = idx.get("latitude")
                i_lon = idx.get("longitude")
                i_ver = idx.get("version")
                for row in reader:
                    try:
                        sig = (
                            row[i_inst].upper() if i_inst is not None else "",
                            row[i_sat].strip() if i_sat is not None else "",
                            row[i_date][:10] if i_date is not None else "",
                            row[i_time].strip() if i_time is not None else "",
                            round(float(row[i_lat]), 4) if i_lat is not None else 0.0,
                            round(float(row[i_lon]), 4) if i_lon is not None else 0.0,
                            row[i_ver].strip() if i_ver is not None else "",
                        )
                    except (IndexError, TypeError, ValueError):
                        continue
                    # Deterministic tuple dedup: stable across processes,
                    # no hash() randomization/collision risk.
                    if sig in seen:
                        continue
                    seen.add(sig)
                    yield dict(zip(header, row))
                    n += 1
                    if limit is not None and n >= limit:
                        return
        except OSError:
            continue


def load_raw_merged(aoi: str, limit: int = 2000000,
                    raw_dir: Path | None = None) -> list[dict]:
    """Bounded, deduped, round-robin prefix of an AOI's raw pulls.

    Reading every row of a 4.4M-row AOI into `per_file` lists is how the old
    version could OOM. We only need `limit` rows, so each file contributes at
    most ceil(limit / n_files) + slack; if dedup eats into the budget the cap
    is raised and the pass repeated. Full-data consumers (training, evaluation,
    calendar) use `iter_raw_rows`/`PairBuilder` instead.
    """
    if aoi not in AOIS and aoi != "custom":
        raise ValueError(f"Unknown aoi {aoi!r}")
    raw_dir = raw_dir or RAW_DIR
    if not raw_dir.exists():
        return []
    files = sorted(raw_dir.glob(f"{aoi}_*.csv"),
                   key=lambda p: (0 if "_SP_" in p.name else 1, p.name))
    if not files:
        return []
    cap = max(8, (limit + len(files) - 1) // len(files) + 8)
    for _ in range(4):
        seen: set[tuple] = set()
        per_file: list[list[dict]] = []
        for f in files:
            buf: list[dict] = []
            try:
                with f.open(encoding="utf-8") as fh:
                    for i, r in enumerate(csv.DictReader(fh)):
                        if i >= cap:
                            break
                        d = {k.lower(): v for k, v in r.items()}
                        try:
                            sig = (str(d.get("instrument", "")).upper(),
                                   str(d.get("satellite", "")).strip(),
                                   str(d.get("acq_date", ""))[:10],
                                   str(d.get("acq_time", "")).strip(),
                                   round(float(d.get("latitude") or 0), 4),
                                   round(float(d.get("longitude") or 0), 4),
                                   str(d.get("version", "")).strip())
                        except (TypeError, ValueError):
                            continue
                        if sig in seen:
                            continue
                        seen.add(sig)
                        buf.append(d)
            except OSError:
                continue
            if buf:
                per_file.append(buf)
        rows: list[dict] = []
        i = 0
        while len(rows) < limit:
            progressed = False
            for buf in per_file:
                if i < len(buf):
                    rows.append(buf[i])
                    progressed = True
                    if len(rows) >= limit:
                        break
            if not progressed:
                break
            i += 1
        if len(rows) >= limit or all(len(b) < cap for b in per_file):
            return rows
        cap *= 2
    return rows


def raw_stats(aoi: str, raw_dir: Path | None = None) -> dict:
    """Existence + month coverage for an AOI's raw pulls (audit P0-14)."""
    from app.firms import coverage as _cov
    raw_dir = raw_dir or RAW_DIR
    files = sorted(raw_dir.glob(f"{aoi}_*.csv")) if raw_dir.exists() else []
    cover = _cov.coverage_for_aoi(aoi) if files else {}
    months = sorted(cover)
    full = [m for m in months if not cover[m].get("partial")]
    manifest_files = set()
    if MANIFEST.exists():
        try:
            manifest_files = {e.get("file") for e in json.loads(MANIFEST.read_text())}
        except (OSError, ValueError):
            manifest_files = set()
    checksums = sum(1 for f in files if f.name in manifest_files)
    full_months = len(full)
    return {
        "aoi": aoi,
        "raw_ready": bool(files),
        "dashboard_ready": bool(files),
        "benchmark_ready": bool(cover) and full_months >= 12,
        "raw_files": len(files),
        "months_available": len(months),
        "date_range": [months[0], months[-1]] if months else None,
        "full_months": full_months,
        "full_month_ready": bool(full_months >= 1),
        "partial_months": len(months) - full_months,
        "coverage_verified": bool(cover),
        "checksum_entries": checksums,
        "checksums_present": checksums == len(files) if files else False,
        "fingerprint": raw_fingerprint(aoi, raw_dir) if files else "empty",
    }


def raw_ready(aoi: str) -> bool:
    return bool(list(RAW_DIR.glob(f"{aoi}_*.csv"))) if RAW_DIR.exists() else False


def model_artifacts_ready(aoi: str) -> bool:
    """True only when a servable artifact exists (never hardcoded).

    `data-status` used to report `model_artifact_ready: True` unconditionally,
    which is exactly the kind of claim the audit banned.
    """
    md = DATA_DIR / "models"
    return any(p.exists() for p in (
        md / f"cal_{aoi}_raw.json",
        md / f"ts_{aoi}_raw.json",
        md / "stan_series_raw.json",
        md / "hts_series_raw.json",
    ))


def data_status() -> dict:
    """What data is on disk: samples + ingested raw files + manifest."""
    datasets = []
    for aoi in AOIS:
        p = sample_path(aoi)
        n = sum(1 for _ in p.open(encoding="utf-8")) - 1 if p.exists() else 0
        rs = raw_stats(aoi)
        datasets.append({"aoi": aoi, "sample_file": p.name if p.exists() else None,
                         "sample_rows": max(n, 0),
                         "sample_bytes": p.stat().st_size if p.exists() else 0,
                         "dataset_ready": bool(rs.get("raw_ready")),
                         "model_artifact_ready": model_artifacts_ready(aoi),
                         **rs})
    raw_files = []
    if RAW_DIR.exists():
        for f in sorted(RAW_DIR.glob("*.csv")):
            raw_files.append({"file": f.name, "bytes": f.stat().st_size})
    return {"datasets": datasets, "raw_files": raw_files[:100],
            "raw_count": len(raw_files),
            "raw_aois_ready": [d["aoi"] for d in datasets if d["raw_ready"]],
            "cache": cache_info(),
            "manifest_entries": len(json.loads(MANIFEST.read_text(encoding="utf-8")))
            if MANIFEST.exists() else 0}
