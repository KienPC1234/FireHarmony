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
    """Validate an uploaded FIRMS CSV in chunks, store under raw/, log manifest."""
    if aoi not in AOIS:
        raise ValueError(f"Unknown aoi {aoi!r}")
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(content).hexdigest()[:16]
    stamp = time.strftime("%Y%m%dT%H%M%S")
    dest = RAW_DIR / f"{aoi}_{source}_{stamp}_{digest}.csv"
    dest.write_bytes(content)
    text = content.decode("utf-8", errors="replace").splitlines()
    reader = csv.DictReader(text)
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


def load_raw_merged(aoi: str, limit: int = 100000,
                    raw_dir: Path | None = None) -> list[dict]:
    """Merge all downloaded raw CSVs for an aoi (real FIRMS pulls + ingests).

    Different sources/dates simply concatenate — harmonize() aggregates by
    (cell, day, instrument), so overlapping pulls of the same fire would
    double count; the manifest (file/date/source) is how you avoid that.
    """
    if aoi not in AOIS and aoi != "custom":
        raise ValueError(f"Unknown aoi {aoi!r}")
    raw_dir = raw_dir or RAW_DIR
    rows: list[dict] = []
    if not raw_dir.exists():
        return rows
    for f in sorted(raw_dir.glob(f"{aoi}_*.csv")):
        try:
            with f.open(encoding="utf-8") as fh:
                for r in csv.DictReader(fh):
                    rows.append({k.lower(): v for k, v in r.items()})
                    if len(rows) >= limit:
                        return rows
        except OSError:
            continue
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
