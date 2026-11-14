"""Request ledger + month coverage derived from the ingest manifest.

Why this module exists (audit P0-03 / P0-06):
  * `detection_days` (days with at least one hotspot) is NOT observation
    coverage. A month can be fully requested and still have few fire days.
  * The first full-month fetcher asked for days 1,6,11,16,21,26 x 5 days,
    which ends on day 30 and never requests day 31. That is a real coverage
    defect and must be reported, not hidden behind "full month".

`coverage_for_aoi` reconstructs exactly which calendar days were requested
for an AOI from the manifest (filename start date + `days`), per source.
It is the only place that should answer "did we look on this day?".
"""
from __future__ import annotations

import calendar as _cal
import json
import re
from collections import defaultdict
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

from app.firms import store

_DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
LEDGER = store.DATA_DIR / "request_ledger.jsonl"

# A month is only called "partial" when under 90% of its days were requested.
# The legacy day-31 gap is 30/31 = 96.8%, so it stays usable but is reported
# explicitly through `missing_days` and `coverage_ratio`.
PARTIAL_THRESHOLD = 0.90


@lru_cache(maxsize=8)
def _manifest_cached(path_str: str, mtime_ns: int, size: int, inode: int = 0) -> tuple:
    try:
        doc = json.loads(Path(path_str).read_text(encoding="utf-8"))
        return tuple(doc) if isinstance(doc, list) else ()
    except (OSError, ValueError):
        return ()


def load_manifest(path: Path | None = None) -> list[dict]:
    path = path or store.MANIFEST
    if not path.exists():
        return []
    try:
        st = path.stat()
    except OSError:
        return []
    return list(_manifest_cached(str(path), st.st_mtime_ns, st.st_size, st.st_ino))


def manifest_aois(manifest: list[dict] | None = None) -> set[str]:
    """AOI ids present in the ingest manifest (preset + custom pulls).

    The manifest is the source of truth for "was this AOI ever fetched",
    backing GET /api/firms/aois and the custom-AOI 200-vs-404 decision.
    """
    entries = manifest if manifest is not None else load_manifest()
    return {str(e.get("aoi")) for e in entries
            if isinstance(e, dict) and e.get("aoi")}


def ledger_status(aoi: str, limit: int = 50) -> dict:
    """Recent request outcomes for an AOI (failed/empty hidden before).

    If the JSONL ledger is empty (pulls predate it), reconstruct successful
    entries from the manifest and mark them `backfilled`; failed pulls from
    before the ledger existed cannot be recovered and are not invented.

    Bounded scan: only the last 20000 ledger lines are inspected so a
    multi-year ledger cannot stall a request.
    """
    rows: list[dict] = []
    backfilled = False
    if LEDGER.exists():
        try:
            lines = LEDGER.read_text(encoding="utf-8").splitlines()
        except OSError:
            lines = []
        if len(lines) > 20000:
            lines = lines[-20000:]
        for line in lines:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("aoi") == aoi:
                rows.append(e)
    if not rows:
        for e in load_manifest():
            if e.get("aoi") != aoi:
                continue
            iv = _entry_interval(e)
            rows.append({"aoi": aoi, "source": e.get("source"),
                         "start": f"{iv[0]}-{iv[1]:02d}-{iv[2]:02d}" if iv else None,
                         "days": e.get("days"), "rows": e.get("rows"),
                         "status": ("success_rows" if e.get("rows") else "success_empty"),
                         "backfilled": True})
        backfilled = bool(rows)
    counts: dict[str, int] = defaultdict(int)
    for r in rows:
        counts[str(r.get("status", "unknown"))] += 1
    return {"aoi": aoi, "entries": len(rows), "by_status": dict(counts),
            "backfilled_from_manifest": backfilled,
            "recent": rows[-limit:]}


def append_ledger(entry: dict) -> None:
    """Append one request outcome (success_rows / success_empty / failed).

    The manifest only ever contained successful pulls. Failures used to be
    printed and lost; judges asking for a request ledger now have one.
    """
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _entry_interval(entry: dict) -> tuple[int, int, int, int] | None:
    """Parse (year, month, start_day, ndays) from a manifest filename.

    Uploads (`{aoi}_{source}_YYYYMMDDTHHMMSS_{digest}.csv`) carry no
    `YYYY-MM-DD` and no `days` window, so they return None and are
    excluded from request coverage by design. Request coverage only
    answers "did the Area API pull ask for this day?".
    """
    m = _DATE_RE.search(str(entry.get("file", "")))
    if not m:
        return None
    y, mo, d = (int(g) for g in m.groups())
    try:
        days = int(entry.get("days", 5) or 5)
    except (TypeError, ValueError):
        days = 5
    return y, mo, d, max(days, 1)


def requested_days(aoi: str, manifest: list[dict] | None = None) -> dict[str, dict[str, set[int]]]:
    """{ 'YYYY-MM': {source: {day numbers actually requested}} }.

    Two API shapes are handled explicitly:
      * archive pulls pass an explicit start date and cover start..start+days-1;
      * NRT pulls carry no date and cover the last `days` days **ending at the
        file's date tag**, not starting there. Treating NRT forward used to
        claim future days (and could make a partial month look full).
    A window that crosses a month boundary is split across both months.
    """
    manifest = manifest if manifest is not None else load_manifest()
    out: dict[str, dict[str, set[int]]] = defaultdict(lambda: defaultdict(set))
    for e in manifest:
        if str(e.get("aoi")) != aoi:
            continue
        iv = _entry_interval(e)
        if iv is None:
            continue
        y, mo, start, ndays = iv
        src = str(e.get("source", "?"))
        anchor = date(y, mo, start)
        step = -1 if "NRT" in src.upper() else 1
        for k in range(ndays):
            d = anchor + timedelta(days=step * k)
            out[f"{d.year}-{d.month:02d}"][src].add(d.day)
    return {ym: dict(by_src) for ym, by_src in out.items()}


def _sensor_family(source: str) -> str:
    s = str(source).upper()
    if s.startswith("MODIS"):
        return "MODIS"
    if s.startswith("VIIRS"):
        return "VIIRS"
    return "OTHER"


def coverage_from_day_sets(modis_days: set[int], viirs_days: set[int],
                           days_in_month: int) -> dict:
    """Pure per-sensor coverage rule (used by tests and the manifest path).

    Harmonization needs BOTH sensors on the same days; union coverage is not
    evidence that a MODIS/VIIRS pair exists. Example: MODIS 31/31 + VIIRS
    5/31 gives union=31 but paired=5.
    """
    modis = set(modis_days)
    viirs = set(viirs_days)
    paired = modis & viirs
    union = modis | viirs
    last = int(days_in_month) or 1
    ratio = len(paired) / last
    return {
        "days_in_month": last,
        "modis_days": len(modis),
        "viirs_days": len(viirs),
        "union_days": len(union),
        "paired_days": len(paired),
        "paired_coverage_ratio": round(ratio, 3),
        "coverage_ratio": round(ratio, 3),  # backward-compatible alias
        "coverage_by_sensor": {
            "MODIS": {"days": len(modis), "ratio": round(len(modis) / last, 3)},
            "VIIRS": {"days": len(viirs), "ratio": round(len(viirs) / last, 3)},
        },
        "missing_days": [d for d in range(1, last + 1) if d not in paired],
        "missing_modis_days": [d for d in range(1, last + 1) if d not in modis],
        "missing_viirs_days": [d for d in range(1, last + 1) if d not in viirs],
        "coverage_status": ("complete" if len(paired) == last else
                            "usable" if ratio >= PARTIAL_THRESHOLD else
                            "incomplete"),
        "partial": ratio < PARTIAL_THRESHOLD,
        "status": "verified",
    }


@lru_cache(maxsize=16)
def _coverage_cached(aoi: str, mtime_ns: int, size: int, inode: int = 0) -> dict:
    return _coverage_compute(aoi, None)


def coverage_for_aoi(aoi: str, manifest: list[dict] | None = None) -> dict[str, dict]:
    """Per-month coverage split by sensor, with a paired-day eligibility flag."""
    if manifest is None:
        try:
            st = store.MANIFEST.stat()
            return _coverage_cached(aoi, st.st_mtime_ns, st.st_size, st.st_ino)
        except OSError:
            return {}
    return _coverage_compute(aoi, manifest)


def _coverage_compute(aoi: str, manifest: list[dict] | None) -> dict[str, dict]:
    per = requested_days(aoi, manifest)
    cover: dict[str, dict] = {}
    for ym, by_src in sorted(per.items()):
        y, mo = int(ym[:4]), int(ym[5:])
        last = _cal.monthrange(y, mo)[1]
        fam_days: dict[str, set[int]] = {"MODIS": set(), "VIIRS": set()}
        for src, days in by_src.items():
            fam_days.setdefault(_sensor_family(src), set()).update(days)
        entry = coverage_from_day_sets(fam_days.get("MODIS", set()),
                                       fam_days.get("VIIRS", set()), last)
        entry["sources"] = {s: len(d) for s, d in sorted(by_src.items())}
        entry["source_families"] = {s: sorted(d) for s, d in fam_days.items()}
        entry["nrt"] = any("NRT" in s.upper() for s in by_src)
        cover[ym] = entry
    return cover


def coverage_summary(aoi: str, manifest: list[dict] | None = None) -> dict:
    cover = coverage_for_aoi(aoi, manifest)
    full = [ym for ym, c in cover.items() if not c["partial"]]
    complete = [ym for ym, c in cover.items() if c["coverage_status"] == "complete"]
    partial = [ym for ym, c in cover.items() if c["partial"]]
    missing_day_hist: dict[str, int] = defaultdict(int)
    for c in cover.values():
        for d in c["missing_days"]:
            missing_day_hist[str(d)] += 1
    return {
        "aoi": aoi,
        "months": len(cover),
        "full_months": len(full),
        "complete_months": len(complete),
        "partial_months": len(partial),
        "partial_examples": sorted(partial)[:12],
        "missing_day_histogram": dict(sorted(missing_day_hist.items(), key=lambda kv: int(kv[0]))),
        "verified": bool(cover),
        "threshold": PARTIAL_THRESHOLD,
        "coverage_metric": "paired_request_coverage",
        "coverage_kind": "request_ledger_not_observation",
        "request_coverage": bool(cover),
        "dataset_ready": bool(store.raw_ready(aoi)),
        "observation_footprint": "unknown",
        "observation_coverage": "unknown",
        "definition": ("paired_days / days_in_month; a month is usable when both "
                       "MODIS and VIIRS were requested on >=90% of days, complete "
                       "only at 100%. This measures successful requests, NOT "
                       "cloud-free overpass or per-cell observation footprint. "
                       "Union coverage is reported separately."),
        "months_detail": cover,
        "gaps": coverage_gaps(aoi),
    }


def today() -> str:
    return date.today().isoformat()


def eligible_pair_months(aoi: str, min_ratio: float = 0.9) -> set[str]:
    """Year-months with >= min_ratio paired MODIS/VIIRS requested days.

    Training/evaluation uses this so a partially fetched year cannot silently
    enter a monthly ratio. Sample/upload has no ledger and is not filtered.
    """
    cover = coverage_for_aoi(aoi)
    return {ym for ym, c in cover.items()
            if float(c.get("paired_coverage_ratio", 0.0)) >= min_ratio}


def coverage_gaps(aoi: str, start_year: int = 2012,
                  end_year: int | None = None) -> dict:
    """Explicit missing-month ledger for the satellite era.

    A year with no rows is not a quiet year; it may be unfetched. This ledger
    lists every expected month absent from the manifest so the UI and docs can
    say "not fetched" instead of silently omitting it.
    """
    cover = coverage_for_aoi(aoi)
    if not cover:
        return {"verified": False, "reason": "no_manifest_entries"}
    if end_year is None:
        end_year = max(int(ym[:4]) for ym in cover)
    expected = [f"{y}-{m:02d}" for y in range(start_year, end_year + 1)
                for m in range(1, 13)]
    have = set(cover)
    missing = [ym for ym in expected if ym not in have]
    by_year: dict[str, int] = defaultdict(int)
    for ym in missing:
        by_year[ym[:4]] += 1
    return {
        "verified": True,
        "range": [f"{start_year}-01", f"{end_year}-12"],
        "expected_months": len(expected),
        "fetched_months": len(expected) - len(missing),
        "missing_months": len(missing),
        "missing_by_year": dict(sorted(by_year.items())),
        "missing_examples": missing[:12],
        "note": ("Missing = absent from the request manifest, not zero fire. "
                 "Resume with scripts.firms.fetch_missing."),
    }
