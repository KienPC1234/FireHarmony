"""On-demand NASA FIRMS Area API fetcher for live hotspot queries.

Fetches active-fire CSVs from NASA FIRMS Area API, merges/normalizes MODIS +
VIIRS rows into ``data/firms/uploads/live_<hex>.csv`` so ``dataset=live:<hex>``
can be served immediately via ``store.load_upload_dataset`` and ``method=stat``.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import os
import re
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

from app.firms import store
from app.firms.schema import FirmsRecord

FIRMS_API_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
NRT_SOURCES = ("MODIS_NRT", "VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT")
SP_SOURCES = ("MODIS_SP", "VIIRS_SNPP_SP")
SP_AGE_DAYS = 60
MAX_LIVE_DAYS = 31
MAX_HYBRID_DAYS = 62
MAX_BBOX_SPAN_DEG = 20.0
MAX_BBOX_AREA_DEG2 = 150.0
MAX_BBOX_SPAN_DEG = 45.0
REQUEST_TIMEOUT_S = 20
MAX_LIVE_FILES = 100
MAX_CACHE_FILES = 500
CACHE_TTL_TODAY_S = 900
CACHE_TTL_HIST_S = 7 * 86400

NORMALIZED_FIELDS = (
    "latitude", "longitude", "brightness", "scan", "track",
    "acq_date", "acq_time", "satellite", "instrument", "confidence",
    "version", "bright_t31", "frp", "daynight", "type",
)

_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
_SOURCE_RE = re.compile(r"^[A-Za-z0-9_]{2,40}$")


class FirmsLiveError(RuntimeError):
    """Upstream NASA FIRMS request or response error."""


class FirmsLiveConfigError(FirmsLiveError):
    """Missing or invalid FIRMS_MAP_KEY configuration."""


def _get_firms_map_key() -> str:
    """Read FIRMS_MAP_KEY from os.environ or fallback to backend/.env."""
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if key:
        return key
    try:
        for raw in _ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == "FIRMS_MAP_KEY":
                val = v.strip().strip("'\"")
                if val:
                    return val
    except OSError:
        pass
    raise FirmsLiveConfigError("FIRMS_MAP_KEY is not configured")


def _validate_bbox_coords(bbox: list[float] | tuple[float, ...]) -> tuple[float, float, float, float]:
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
        raise ValueError("bbox must be [min_lon, min_lat, max_lon, max_lat]")
    vals: list[float] = []
    for item in bbox:
        if isinstance(item, bool):
            raise ValueError("bbox coordinates must be numeric")
        try:
            fval = float(item)
        except (TypeError, ValueError) as exc:
            raise ValueError("bbox coordinates must be numeric") from exc
        if not math.isfinite(fval):
            raise ValueError("bbox coordinates must be finite")
        vals.append(fval)
    w, s, e, n = vals
    if not (-180.0 <= w < e <= 180.0 and -90.0 <= s < n <= 90.0):
        raise ValueError(
            "bbox out of range or inverted: expected -180<=w<e<=180 and -90<=s<n<=90"
        )
    return w, s, e, n


def _check_live_bbox_limits(w: float, s: float, e: float, n: float) -> None:
    dlon = e - w
    dlat = n - s
    if dlon > MAX_BBOX_SPAN_DEG or dlat > MAX_BBOX_SPAN_DEG or (dlon * dlat) > MAX_BBOX_AREA_DEG2:
        raise ValueError(
            f"bbox too large ({dlon:.1f}x{dlat:.1f} deg, {dlon * dlat:.1f} deg²; max {MAX_BBOX_SPAN_DEG:.0f} deg per axis and {MAX_BBOX_AREA_DEG2:.0f} deg²); draw a smaller region"
        )
    if (e - w) > MAX_BBOX_SPAN_DEG or (n - s) > MAX_BBOX_SPAN_DEG:
        raise ValueError(
            f"bbox span too large (max {MAX_BBOX_SPAN_DEG:.0f} deg per axis); draw a smaller region"
        )


def _validate_bbox(bbox: list[float] | tuple[float, ...]) -> tuple[float, float, float, float]:
    w, s, e, n = _validate_bbox_coords(bbox)
    _check_live_bbox_limits(w, s, e, n)
    return w, s, e, n


def _validate_days(days: int) -> int:
    if isinstance(days, bool) or not isinstance(days, int) or not (1 <= days <= 10):
        raise ValueError("days must be an integer between 1 and 10")
    return days


def _validate_date_str(val: str | None, field: str = "end_date") -> str | None:
    if val is None or (isinstance(val, str) and not val.strip()):
        return None
    if not isinstance(val, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", val.strip()):
        raise ValueError(f"{field} must be YYYY-MM-DD")
    cleaned = val.strip()
    try:
        date.fromisoformat(cleaned)
    except ValueError as exc:
        raise ValueError(f"{field} is not a valid calendar date") from exc
    return cleaned


def _validate_end_date(end_date: str | None) -> str | None:
    return _validate_date_str(end_date, "end_date")


def _resolve_date_window(
    days: int,
    end_date: str | None,
    from_date: str | None,
    to_date: str | None,
    max_days: int = MAX_LIVE_DAYS,
) -> tuple[date, date, list[str]]:
    """Resolve [from_d, to_d] inclusive window and validate span <= max_days."""
    warnings: list[str] = []
    today = date.today()
    clean_end = _validate_date_str(end_date, "end_date")
    clean_from = _validate_date_str(from_date, "from_date")
    clean_to = _validate_date_str(to_date, "to_date")

    if clean_from or clean_to:
        if clean_from and clean_to:
            from_d = date.fromisoformat(clean_from)
            to_d = date.fromisoformat(clean_to)
            if from_d > to_d:
                raise ValueError("from_date must be on or before to_date")
        elif clean_from:
            from_d = date.fromisoformat(clean_from)
            to_d = date.fromisoformat(clean_end) if clean_end else min(today, from_d + timedelta(days=days - 1))
            if from_d > to_d:
                to_d = from_d
        else:
            to_d = date.fromisoformat(clean_to)  # type: ignore[arg-type]
            from_d = to_d - timedelta(days=days - 1)
    else:
        to_d = date.fromisoformat(clean_end) if clean_end else today
        from_d = to_d - timedelta(days=days - 1)

    if from_d > today:
        raise ValueError("from_date cannot be in the future")
    if to_d > today:
        to_d = today
        warnings.append(f"Clamped to_date to today ({today.isoformat()})")

    span_days = (to_d - from_d).days + 1
    if span_days > max_days:
        raise ValueError(f"Date range cannot exceed {max_days} days (requested {span_days})")
    return from_d, to_d, warnings


def _resolve_sources(sources: list[str] | None, end_date: str | None) -> list[str]:
    if sources is None:
        if end_date is not None and (date.today() - date.fromisoformat(end_date)).days > SP_AGE_DAYS:
            return list(SP_SOURCES)
        return list(NRT_SOURCES)
    if not isinstance(sources, (list, tuple)) or not sources:
        raise ValueError("sources must be a non-empty list of FIRMS source names")
    out: list[str] = []
    for s in sources:
        name = str(s or "").strip()
        if not _SOURCE_RE.fullmatch(name):
            raise ValueError(f"invalid FIRMS source name: {s!r}")
        out.append(name)
    return out


def _sanitize_error(text: str, map_key: str) -> str:
    return text.replace(map_key, "***") if map_key else text


def _fetch_source_csv(map_key: str, source: str, bbox_str: str,
                      days: int, end_date: str | None) -> str:
    url = f"{FIRMS_API_BASE}/{map_key}/{source}/{bbox_str}/{days}"
    if end_date:
        url += f"/{end_date}"
    try:
        with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT_S) as resp:  # noqa: S310
            status = getattr(resp, "status", 200)
            if status != 200:
                raise FirmsLiveError(f"FIRMS upstream returned HTTP {status} for {source}")
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        raise FirmsLiveError(
            f"FIRMS upstream HTTP {exc.code} for {source}"
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise FirmsLiveError(
            f"FIRMS upstream request failed for {source}: {_sanitize_error(str(exc), map_key)}"
        ) from exc

    stripped = body.strip()
    if not stripped:
        raise FirmsLiveError(f"FIRMS upstream returned empty body for {source}")
    first_line = stripped.splitlines()[0].lower()
    body_lower = stripped[:400].lower()
    if "invalid map_key" in body_lower or "exceeding" in body_lower:
        raise FirmsLiveError(f"FIRMS API rejected request: {stripped.splitlines()[0][:120]}")
    if "latitude" not in first_line or "longitude" not in first_line:
        raise FirmsLiveError(
            f"FIRMS upstream returned non-CSV response for {source}: {stripped.splitlines()[0][:120]}"
        )
    return body


def _normalize_row(raw_row: dict, source: str) -> dict[str, str]:
    d = {str(k).lower().strip(): ("" if v is None else str(v).strip())
         for k, v in raw_row.items() if k is not None}
    if not d.get("brightness") and d.get("bright_ti4"):
        d["brightness"] = d["bright_ti4"]
    if not d.get("bright_t31") and d.get("bright_ti5"):
        d["bright_t31"] = d["bright_ti5"]
    if not d.get("instrument"):
        if source.upper().startswith("MODIS"):
            d["instrument"] = "MODIS"
        elif source.upper().startswith("VIIRS"):
            d["instrument"] = "VIIRS"
    for optional_key in ("frp", "type", "daynight"):
        if d.get(optional_key) == "":
            d.pop(optional_key, None)
    rec = FirmsRecord(**d)
    dumped = rec.model_dump(mode="json")
    return {
        k: ("" if dumped.get(k) is None else str(dumped.get(k)))
        for k in NORMALIZED_FIELDS
    }


def _write_live_csv(rows: list[dict[str, str]]) -> str:
    store.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(NORMALIZED_FIELDS), lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    payload = buf.getvalue().encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()[:16]
    dest = store.UPLOAD_DIR / f"live_{digest}.csv"
    tmp = store.UPLOAD_DIR / f".tmp_live_{digest}_{os.getpid()}.part"
    tmp.write_bytes(payload)
    tmp.replace(dest)

    existing = sorted(store.UPLOAD_DIR.glob("live_*.csv"), key=lambda p: p.stat().st_mtime)
    for old in existing[:-MAX_LIVE_FILES]:
        old.unlink(missing_ok=True)
    return digest


def _live_cache_dir() -> Path:
    return store.UPLOAD_DIR.parent / "live_cache"


def _chunk_cache_path(bbox_key: str, source: str, chunk_days: int, chunk_end: str) -> Path:
    raw_key = f"{bbox_key}|{source}|{chunk_days}|{chunk_end}".encode("utf-8")
    digest = hashlib.sha256(raw_key).hexdigest()[:24]
    return _live_cache_dir() / f"{digest}.csv"


def _read_chunk_cache(cache_path: Path, chunk_end: str) -> str | None:
    if not cache_path.is_file():
        return None
    try:
        age_s = time.time() - cache_path.stat().st_mtime
        ttl_s = CACHE_TTL_TODAY_S if chunk_end >= date.today().isoformat() else CACHE_TTL_HIST_S
        if age_s > ttl_s:
            return None
        return cache_path.read_text(encoding="utf-8")
    except OSError:
        return None


def _write_chunk_cache(cache_path: Path, csv_text: str) -> None:
    try:
        cache_dir = cache_path.parent
        cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = cache_dir / f".tmp_{cache_path.stem}_{os.getpid()}.part"
        tmp.write_text(csv_text, encoding="utf-8")
        tmp.replace(cache_path)
        existing = sorted(cache_dir.glob("*.csv"), key=lambda p: p.stat().st_mtime)
        for old in existing[:-MAX_CACHE_FILES]:
            old.unlink(missing_ok=True)
    except OSError:
        pass


def _regions_index_path() -> Path:
    return _live_cache_dir() / "live_regions.json"


def _find_covering_region(
    w: float, s: float, e: float, n: float, from_iso: str, to_iso: str,
) -> dict | None:
    """Reuse an already-cached live CSV if it spatially & temporally covers [w,s,e,n] x [from,to]."""
    idx_path = _regions_index_path()
    if not idx_path.is_file():
        return None
    try:
        entries = json.loads(idx_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(entries, list):
        return None
    now = time.time()
    today_iso = date.today().isoformat()
    ttl_s = CACHE_TTL_TODAY_S if to_iso >= today_iso else CACHE_TTL_HIST_S
    for entry in reversed(entries):
        if not isinstance(entry, dict):
            continue
        ts = float(entry.get("ts") or 0)
        if now - ts > ttl_s:
            continue
        eb = entry.get("bbox")
        if not (isinstance(eb, list) and len(eb) == 4):
            continue
        ew, es, ee, en = float(eb[0]), float(eb[1]), float(eb[2]), float(eb[3])
        ef = str(entry.get("from_date") or "")
        et = str(entry.get("to_date") or "")
        if not (ew <= w and es <= s and ee >= e and en >= n and ef <= from_iso and et >= to_iso):
            continue
        hex_id = str(entry.get("hex_id") or "")
        src_file = store.UPLOAD_DIR / f"live_{hex_id}.csv"
        if not src_file.is_file():
            continue
        rows: list[dict[str, str]] = []
        dates: list[str] = []
        try:
            with src_file.open("r", encoding="utf-8", newline="") as fh:
                for row in csv.DictReader(fh):
                    lat = float(row["latitude"])
                    lon = float(row["longitude"])
                    acq = str(row.get("acq_date") or "")[:10]
                    if not (w <= lon <= e and s <= lat <= n):
                        continue
                    if acq and (acq < from_iso or acq > to_iso):
                        continue
                    rows.append({k: str(row.get(k, "")) for k in NORMALIZED_FIELDS})
                    if acq:
                        dates.append(acq)
        except (OSError, ValueError, KeyError):
            continue
        sub_hex = _write_live_csv(rows)
        dates.sort()
        return {
            "ok": True,
            "dataset": f"live:{sub_hex}",
            "rows": len(rows),
            "sources_fetched": list(entry.get("sources_fetched") or []),
            "bbox": [w, s, e, n],
            "requested_range": [from_iso, to_iso],
            "date_range": [dates[0], dates[-1]] if dates else [None, None],
            "cached": True,
            "cache_hits": 1,
            "network_fetches": 0,
            "warnings": [],
        }
    return None


def _record_region(
    w: float, s: float, e: float, n: float,
    from_iso: str, to_iso: str, hex_id: str, sources_fetched: list[str],
) -> None:
    try:
        idx_path = _regions_index_path()
        idx_path.parent.mkdir(parents=True, exist_ok=True)
        entries: list[dict] = []
        if idx_path.is_file():
            try:
                raw = json.loads(idx_path.read_text(encoding="utf-8"))
                if isinstance(raw, list):
                    entries = raw
            except (OSError, ValueError):
                entries = []
        entries = [
            x for x in entries
            if not (
                isinstance(x, dict)
                and x.get("hex_id") == hex_id
                and x.get("from_date") == from_iso
                and x.get("to_date") == to_iso
            )
        ]
        entries.append({
            "bbox": [w, s, e, n],
            "from_date": from_iso,
            "to_date": to_iso,
            "hex_id": hex_id,
            "sources_fetched": sources_fetched,
            "ts": time.time(),
        })
        entries = entries[-MAX_LIVE_FILES:]
        tmp = idx_path.with_name(f".tmp_{idx_path.name}_{os.getpid()}")
        tmp.write_text(json.dumps(entries), encoding="utf-8")
        tmp.replace(idx_path)
    except OSError:
        pass


def _sample_rows_and_bounds(
    w: float, s: float, e: float, n: float, aoi: str | None = None
) -> tuple[list[dict[str, str]], date | None, date | None]:
    """Collect sample rows inside [w,s,e,n] and overall sample [min_date, max_date]."""
    presets: list[str] = []
    if aoi and aoi in store.PRESET_AOIS:
        presets = [aoi]
    else:
        for preset, meta in store.PRESET_AOIS.items():
            parts = [float(x) for x in str(meta.get("bbox", "")).split(",")]
            if len(parts) == 4:
                pw, ps, pe, pn = parts
                if not (e < pw or w > pe or n < ps or s > pn):
                    presets.append(preset)
    if not presets:
        return [], None, None

    rows_in_bbox: list[dict[str, str]] = []
    min_d: date | None = None
    max_d: date | None = None
    for preset in presets:
        recs = store.load_records(preset, limit=100_000)
        for rec in recs:
            acq = str(rec.get("acq_date") or "").strip()
            if acq:
                try:
                    d_val = date.fromisoformat(acq)
                    if min_d is None or d_val < min_d:
                        min_d = d_val
                    if max_d is None or d_val > max_d:
                        max_d = d_val
                except ValueError:
                    pass
            try:
                lon = float(rec.get("longitude", ""))
                lat = float(rec.get("latitude", ""))
            except (TypeError, ValueError):
                continue
            if w <= lon <= e and s <= lat <= n:
                rows_in_bbox.append({f: str(rec.get(f, "") or "") for f in NORMALIZED_FIELDS})
    return rows_in_bbox, min_d, max_d


def fetch_live_firms_area(
    bbox: list[float],
    days: int = 5,
    end_date: str | None = None,
    sources: list[str] | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    aoi: str | None = None,
    use_sample: bool = False,
) -> dict:
    """Fetch, normalize, and cache live NASA FIRMS Area CSV rows.

    When ``use_sample=True``, dates within preset sample coverage are served
    locally (allowing up to ``MAX_HYBRID_DAYS`` = 62 days), and any portion
    outside sample coverage is automatically supplemented from NASA FIRMS
    (up to ``MAX_LIVE_DAYS`` = 31 live days, respecting live bbox limits).
    """
    if use_sample:
        w, s, e, n = _validate_bbox_coords(bbox)
    else:
        w, s, e, n = _validate_bbox(bbox)
    days = _validate_days(days)
    from_d, to_d, window_warnings = _resolve_date_window(
        days, end_date, from_date, to_date,
        max_days=MAX_HYBRID_DAYS if use_sample else MAX_LIVE_DAYS,
    )
    from_iso = from_d.isoformat()
    to_iso = to_d.isoformat()

    sample_slice: list[dict[str, str]] = []
    live_ranges: list[tuple[date, date]] = [(from_d, to_d)]
    if use_sample:
        sample_rows_all, sample_min_d, sample_max_d = _sample_rows_and_bounds(w, s, e, n, aoi=aoi)
        if sample_min_d is not None and sample_max_d is not None:
            live_ranges = []
            if from_d < sample_min_d:
                live_ranges.append((from_d, min(to_d, sample_min_d - timedelta(days=1))))
            if to_d > sample_max_d:
                live_ranges.append((max(from_d, sample_max_d + timedelta(days=1)), to_d))
            for row in sample_rows_all:
                acq = row.get("acq_date", "")
                if from_iso <= acq <= to_iso:
                    sample_slice.append(row)
        live_days_needed = sum((r_to - r_from).days + 1 for r_from, r_to in live_ranges)
        if live_days_needed > MAX_LIVE_DAYS:
            raise ValueError(
                f"Out-of-sample live fetch cannot exceed {MAX_LIVE_DAYS} days (needs {live_days_needed} live days)"
            )
        if live_days_needed > 0:
            _check_live_bbox_limits(w, s, e, n)
    else:
        live_days_needed = (to_d - from_d).days + 1

    if not use_sample and sources is None:
        covered = _find_covering_region(w, s, e, n, from_iso, to_iso)
        if covered is not None:
            if window_warnings:
                covered["warnings"] = list(window_warnings) + list(covered.get("warnings") or [])
            return covered

    merged_rows: list[dict[str, str]] = []
    seen_rows: set[tuple[str, str, str, str, str, str, str]] = set()
    sources_fetched: list[str] = []
    warnings: list[str] = list(window_warnings)
    dates: list[str] = []

    if sample_slice:
        sources_fetched.append("SAMPLE")
        for row in sample_slice:
            acq = row.get("acq_date", "")
            dedup_key = (
                "SAMPLE",
                row.get("latitude", ""),
                row.get("longitude", ""),
                acq,
                row.get("acq_time", ""),
                row.get("satellite", ""),
                row.get("instrument", ""),
            )
            if dedup_key in seen_rows:
                continue
            seen_rows.add(dedup_key)
            merged_rows.append(row)
            if acq:
                dates.append(acq)

    cache_hits = 0
    network_fetches = 0

    if live_days_needed > 0:
        explicit_sources = _resolve_sources(sources, to_d.isoformat()) if sources is not None else None
        map_key = _get_firms_map_key()

        bbox_str = f"{w},{s},{e},{n}"
        bbox_key = f"{w:.4f},{s:.4f},{e:.4f},{n:.4f}"

        chunks: list[tuple[int, str]] = []
        for r_from, r_to in live_ranges:
            cur_end = r_to
            while cur_end >= r_from:
                remaining = (cur_end - r_from).days + 1
                chunk_days = min(5, remaining)
                chunks.append((chunk_days, cur_end.isoformat()))
                cur_end = cur_end - timedelta(days=chunk_days)

        tasks: list[tuple[int, str, int, str]] = []
        ordered_sources: list[str] = []
        seen_ordered: set[str] = set()
        for chunk_days, chunk_end in chunks:
            chunk_sources = explicit_sources if explicit_sources is not None else _resolve_sources(None, chunk_end)
            for src in chunk_sources:
                if src not in seen_ordered:
                    seen_ordered.add(src)
                    ordered_sources.append(src)
                tasks.append((len(tasks), src, chunk_days, chunk_end))

        from concurrent.futures import ThreadPoolExecutor

        def _run_fetch(task: tuple[int, str, int, str]):
            idx, src, chunk_days, chunk_end = task
            cache_path = _chunk_cache_path(bbox_key, src, chunk_days, chunk_end)
            cached_csv = _read_chunk_cache(cache_path, chunk_end)
            if cached_csv is not None:
                return idx, src, cached_csv, None, True
            try:
                csv_text = _fetch_source_csv(map_key, src, bbox_str, chunk_days, chunk_end)
                _write_chunk_cache(cache_path, csv_text)
                return idx, src, csv_text, None, False
            except FirmsLiveError as exc:
                return idx, src, None, str(exc), False

        with ThreadPoolExecutor(max_workers=min(4, max(1, len(tasks)))) as pool:
            results = list(pool.map(_run_fetch, tasks))

        ok_sources: set[str] = set()
        for _idx, src, csv_text, err_msg, was_cached in results:
            if err_msg is not None:
                if "rejected request" in err_msg.lower():
                    raise FirmsLiveError(err_msg)
                warnings.append(err_msg)
                continue
            if was_cached:
                cache_hits += 1
            else:
                network_fetches += 1
            ok_sources.add(src)
            reader = csv.DictReader((csv_text or "").splitlines())
            skipped = 0
            for raw_row in reader:
                try:
                    norm = _normalize_row(raw_row, src)
                except Exception:  # noqa: BLE001 - skip malformed upstream rows
                    skipped += 1
                    continue
                acq = norm["acq_date"]
                if acq and (acq < from_iso or acq > to_iso):
                    continue
                dedup_key = (
                    src,
                    norm["latitude"],
                    norm["longitude"],
                    acq,
                    norm["acq_time"],
                    norm["satellite"],
                    norm["instrument"],
                )
                if dedup_key in seen_rows:
                    continue
                seen_rows.add(dedup_key)
                merged_rows.append(norm)
                if acq:
                    dates.append(acq)
            if skipped:
                warnings.append(f"{src}: skipped {skipped} malformed rows")

        for src in ordered_sources:
            if src in ok_sources:
                sources_fetched.append(src)

        if not ok_sources and not sample_slice:
            detail = "; ".join(warnings) if warnings else "all FIRMS source requests failed"
            raise FirmsLiveError(detail)

    hex_id = _write_live_csv(merged_rows)
    if live_days_needed > 0 and not sample_slice:
        _record_region(w, s, e, n, from_iso, to_iso, hex_id, sources_fetched)
    dates.sort()
    date_range = [dates[0], dates[-1]] if dates else [None, None]
    live_rows_count = len(merged_rows) - len(sample_slice)
    return {
        "ok": True,
        "dataset": f"live:{hex_id}",
        "rows": len(merged_rows),
        "sample_rows": len(sample_slice),
        "live_rows": max(0, live_rows_count),
        "sources_fetched": sources_fetched,
        "bbox": [w, s, e, n],
        "requested_range": [from_iso, to_iso],
        "date_range": date_range,
        "cached": (live_days_needed == 0) or (cache_hits > 0 and network_fetches == 0),
        "cache_hits": cache_hits,
        "network_fetches": network_fetches,
        "warnings": warnings,
    }
