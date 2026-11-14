"""Dataset store: cached loading, QA reports, CSV ingest, data status.

Samples live in data/firms/samples/firms_sample_{aoi}.csv (committed).
Real FIRMS downloads land in data/firms/raw/ (gitignored) via
scripts/firms/fetch_firms.py or POST /api/firms/ingest.
"""
from __future__ import annotations

import csv
import hashlib
import json
import time
from functools import lru_cache
from pathlib import Path

from app.firms.schema import FirmsRecord

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "firms"
SAMPLE_DIR = DATA_DIR / "samples"
RAW_DIR = DATA_DIR / "raw"
MANIFEST = DATA_DIR / "ingest_manifest.json"

AOIS = ("vietnam", "amazon", "australia")


def sample_path(aoi: str) -> Path:
    return SAMPLE_DIR / f"firms_sample_{aoi}.csv"


def _read_all_rows(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return [{k.lower(): v for k, v in r.items()} for r in csv.DictReader(f)]


@lru_cache(maxsize=8)
def _load_cached(key: tuple[str, float, int], limit: int) -> list[dict]:
    """Cache key = (path, mtime, size): file edits invalidate automatically."""
    path = Path(key[0])
    return _read_all_rows(path)[:limit]


def load_records(aoi: str, limit: int = 25000) -> list[dict]:
    """Validated-AOI sample loader with mtime-keyed cache (no re-parse/hit)."""
    if aoi not in AOIS:
        raise ValueError(f"Unknown aoi {aoi!r}; choose from {list(AOIS)}")
    p = sample_path(aoi)
    if not p.exists():
        return []
    st = p.stat()
    return _load_cached((str(p), st.st_mtime, st.st_size), limit)


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
    digest = hashlib.sha256(content).hexdigest()[:16]
    stamp = time.strftime("%Y%m%dT%H%M%S")
    dest = RAW_DIR / f"{aoi}_{source}_{stamp}_{digest}.csv"
    dest.write_bytes(content)
    report = {"file": dest.name, "bytes": len(content), "sha16": digest,
              "aoi": aoi, "source": source, "rows": total,
              "clean": clean, "rejected": rejected, "errors": errors}
    manifest = []
    if MANIFEST.exists():
        try:
            manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            manifest = []
    manifest.append({**report, "errors": [], "at": stamp})
    MANIFEST.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return report


def load_raw_merged(aoi: str, limit: int = 1000000,
                    raw_dir: Path | None = None) -> list[dict]:
    """Merge all downloaded raw CSVs for an aoi, deduped (P0-08).

    Overlapping NRT/science-quality pulls of the same detection collapse onto
    one key: (instrument, satellite, date, time, lat4, lon4, version). Science
    rows win over NRT duplicates only in that the first occurrence is kept and
    file order is sorted — provenance lives in the manifest.
    """
    if aoi not in AOIS and aoi != "custom":
        raise ValueError(f"Unknown aoi {aoi!r}")
    raw_dir = raw_dir or RAW_DIR
    rows: list[dict] = []
    seen: set[tuple] = set()
    if not raw_dir.exists():
        return rows
    per_file: list[list[dict]] = []
    for f in sorted(raw_dir.glob(f"{aoi}_*.csv"),
                    key=lambda p: (0 if "_SP_" in p.name else 1, p.name)):
        buf: list[dict] = []
        try:
            with f.open(encoding="utf-8") as fh:
                for r in csv.DictReader(fh):
                    d = {k.lower(): v for k, v in r.items()}
                    try:
                        # NRT and science-quality (SP) pulls of the same
                        # detection collapse to one: version is NOT part of
                        # the signature, SP files sort first so SP wins.
                        sig = (str(d.get("instrument", "")).upper(),
                               str(d.get("satellite", "")).strip(),
                               str(d.get("acq_date", ""))[:10],
                               str(d.get("acq_time", "")).strip(),
                               round(float(d.get("latitude") or 0), 4),
                               round(float(d.get("longitude") or 0), 4))
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
    # Round-robin interleave so any limit-prefix stays representative
    # across sources/dates (P1-12: no single-file prefix bias).
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
    return rows


def data_status() -> dict:
    """What data is on disk: samples + ingested raw files + manifest."""
    datasets = []
    for aoi in AOIS:
        p = sample_path(aoi)
        n = sum(1 for _ in p.open(encoding="utf-8")) - 1 if p.exists() else 0
        datasets.append({"aoi": aoi, "sample_file": p.name if p.exists() else None,
                         "sample_rows": max(n, 0),
                         "sample_bytes": p.stat().st_size if p.exists() else 0})
    raw_files = []
    if RAW_DIR.exists():
        for f in sorted(RAW_DIR.glob("*.csv")):
            raw_files.append({"file": f.name, "bytes": f.stat().st_size})
    return {"datasets": datasets, "raw_files": raw_files[:100],
            "raw_count": len(raw_files),
            "cache": cache_info(),
            "manifest_entries": len(json.loads(MANIFEST.read_text(encoding="utf-8")))
            if MANIFEST.exists() else 0}
