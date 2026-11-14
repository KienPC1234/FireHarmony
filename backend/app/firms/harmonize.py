"""Grid aggregation + cross-sensor harmonization (no torch required).

Why VIIRS != MODIS (must explain on the poster):
- MODIS: 1 km nadir (Terra/Aqua, since 2000), coarser, misses small burns.
- VIIRS 375 m (Suomi-NPP/NOAA-20/21, since 2012): ~3-4x more detections,
  higher FRP sensitivity, different overpass times.
Direct count comparison is meaningless - harmonize forward to VIIRS-level.

Pipeline per (cell, day):
  1. aggregate raw detections per sensor (count, sum FRP)
  2. estimate k = MODIS/VIIRS from monthly AOI totals (no collocation needed)
  3. forward harmonization to VIIRS sensitivity (not a sum, not a max):
     harmonized = VIIRS where VIIRS observed the cell-day (authoritative,
     more sensitive), else MODIS / k (MODIS-era upscaled to VIIRS level).
     Rationale: k*VIIRS ~= MODIS on the same fire population, so a sum or a
     max over disjoint cells double-counts (~2x step in 2012, measured).
     Using VIIRS wherever it flew keeps every real detection; the 1/k
     upscale applies only where VIIRS never flew (pre-2012) and is labeled
     estimated. Era-consistent by construction.
  4. optional torch MLP residual corrector (dl.py) refines the MODIS->VIIRS
     upscale on overlap months.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
import math

import numpy as np

RES_DEG = 0.05  # ~5 km cells: fine enough for districts, coarse enough for MODIS


ALGORITHM_VERSION = "harmonize-v4"  # sensor-adjusted activity index, not fire counts
FEATURE_VERSION = "harmonize-features-v1"


@lru_cache(maxsize=1)
def cache_behavior() -> str:
    """Short hash of the harmonization behavior for disk-cache keys.

    A behavior change (new output fields, new fallback text, new fusion
    logic) must never serve a stale cached payload. The key rotates
    automatically with the function sources, so there is no manual version
    string to forget after a behavior edit.
    """
    try:
        import hashlib
        import inspect
        blob = "".join(inspect.getsource(f) for f in (
            estimate_efficiency_ratio, fuse_cell_day, daily_row,
            _provenance, aggregate_iter))
        return "beh-" + hashlib.sha256(blob.encode("utf-8")).hexdigest()[:10]
    except (OSError, TypeError):
        return "beh-" + ALGORITHM_VERSION


@dataclass
class DailyAgg:
    count: int = 0
    frp: float = 0.0
    platforms: set = None  # type: ignore
    platform_counts: dict = None  # type: ignore
    platform_frp: dict = None  # type: ignore

    def __post_init__(self):
        if self.platforms is None:
            self.platforms = set()
        if self.platform_counts is None:
            self.platform_counts = {}
        if self.platform_frp is None:
            self.platform_frp = {}


def _dedup_key(r: dict) -> tuple:
    """P0-08: (instrument, satellite, date, time, rounded lat/lon, version)."""
    try:
        la = round(float(r["latitude"]), 4)
        lo = round(float(r["longitude"]), 4)
    except (KeyError, TypeError, ValueError):
        la, lo = 0.0, 0.0
    inst = str(r.get("instrument", "")).upper()
    inst = "VIIRS" if inst.startswith("VIIRS") else ("MODIS" if inst == "MODIS" else inst)
    return (inst, str(r.get("satellite", "")).strip(), str(r.get("acq_date", ""))[:10],
            str(r.get("acq_time", "")).strip(), la, lo, str(r.get("version", "")))


def aggregate(records: list[dict], res_deg: float = RES_DEG) -> dict[tuple[str, str, str], DailyAgg]:
    """Group validated records by (cell_id, date, instrument). Dedups exact re-pulls."""
    out: dict[tuple[str, str, str], DailyAgg] = defaultdict(DailyAgg)
    seen: set[tuple] = set()
    for r in records:
        sig = _dedup_key(r)
        if sig in seen:
            continue  # same detection pulled twice (overlapping raw files)
        seen.add(sig)
        try:
            lat = float(r["latitude"])
            lon = float(r["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        inst = str(r.get("instrument", "")).strip().upper()
        # P0-12: unknown instruments are rejected, never counted as MODIS.
        # `aggregate_iter` validates through FirmsRecord, so both paths must
        # agree on the same input.
        if inst.startswith("VIIRS"):
            inst = "VIIRS"
        elif inst != "MODIS":
            continue
        d = str(r.get("acq_date", ""))[:10]
        la = math.floor(lat / res_deg) * res_deg
        lo = math.floor(lon / res_deg) * res_deg
        key = (f"{la:.2f}_{lo:.2f}", d, inst)
        agg = out[key]
        agg.count += 1
        sat = str(r.get("satellite", "UNKNOWN"))
        agg.platforms.add(sat)
        agg.platform_counts[sat] = agg.platform_counts.get(sat, 0) + 1
        try:
            frp = float(r.get("frp", 0.0) or 0.0)
        except (TypeError, ValueError):
            frp = 0.0
        agg.frp += frp
        agg.platform_frp[sat] = agg.platform_frp.get(sat, 0.0) + frp
    return out


def _dedup_key_rec(rec) -> tuple:
    inst = "VIIRS" if str(rec.instrument).upper().startswith("VIIRS") else "MODIS"
    return (inst, str(rec.satellite).strip(), str(rec.acq_date)[:10],
            str(rec.acq_time).strip(), round(float(rec.latitude), 4),
            round(float(rec.longitude), 4), str(rec.version))


from app.firms.schema import INSTRUMENT_PLATFORMS, PLATFORM_FROM

_SAT_ALIASES = {
    "N": "NPP", "NPP": "NPP", "SNPP": "NPP",
    "SUOMI NPP": "NPP", "SUOMI-NPP": "NPP", "S-NPP": "NPP", "S NPP": "NPP",
    "N20": "NOAA-20", "N-20": "NOAA-20",
    "N21": "NOAA-21", "N-21": "NOAA-21",
}
_VALID_CONF = {"l", "n", "h"}


def _fast_parse_and_qa(r: dict, keys_lower: bool = True):
    """Fast-path equivalent of FirmsRecord(**kw) + rec.qa() when keep_clean is None."""
    kw = r if keys_lower else {k.lower(): v for k, v in r.items()}
    try:
        lat = float(kw["latitude"])
        lon = float(kw["longitude"])
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
            return None
        b_raw = kw.get("brightness")
        if b_raw in (None, ""):
            b_raw = kw.get("bright_ti4")
        brightness = float(b_raw)
        if not (0.0 < brightness < 2000.0):
            return None
        scan = float(kw["scan"])
        track = float(kw["track"])
        if not (0.0 < scan < 50.0 and 0.0 < track < 50.0):
            return None
        bt31_raw = kw.get("bright_t31")
        if bt31_raw in (None, ""):
            bt31_raw = kw.get("bright_ti5")
        if bt31_raw not in (None, ""):
            bt31 = float(bt31_raw)
            if not (0.0 <= bt31 < 2000.0):
                return None
        inst_raw = str(kw.get("instrument") or "").strip().upper()
        if inst_raw.startswith("VIIRS"):
            inst = "VIIRS"
        elif inst_raw == "MODIS":
            inst = "MODIS"
        else:
            return None
        d_raw = kw.get("acq_date")
        if isinstance(d_raw, date):
            day = d_raw.isoformat()
        else:
            day = str(d_raw or "")[:10]
            if len(day) != 10 or day[4] != "-" or day[7] != "-":
                return None
            date.fromisoformat(day)
        t_raw = str(kw.get("acq_time") or "").strip()
        if not t_raw.isdigit() or not (1 <= len(t_raw) <= 4):
            return None
        t_pad = t_raw.zfill(4)
        hh = int(t_pad[:2])
        mm = int(t_pad[2:4])
        if not (0 <= hh <= 23 and 0 <= mm <= 59):
            return None
        frp_raw = kw.get("frp")
        if frp_raw in (None, ""):
            frp = None
        else:
            frp = float(frp_raw)
            if frp < 0.0:
                return None
        dn_raw = kw.get("daynight")
        if dn_raw not in (None, "", "D", "N"):
            return None
        tp_raw = kw.get("type")
        if tp_raw in (None, ""):
            tp = None
        else:
            tp = int(tp_raw)
            if not (0 <= tp <= 3):
                return None
        conf_raw = str(kw.get("confidence", "n") or "n").strip().lower()
        if conf_raw.isdigit() and 1 <= len(conf_raw) <= 3:
            pct = int(conf_raw)
            if pct > 100:
                return None
            conf = "h" if pct >= 80 else ("n" if pct >= 40 else "l")
        elif conf_raw in _VALID_CONF:
            conf = conf_raw
        else:
            return None
        sat_raw = str(kw.get("satellite") or "UNKNOWN").strip()
        if "NOAA" in sat_raw:
            sat_raw = (sat_raw.replace("NOAA20", "NOAA-20").replace("NOAA21", "NOAA-21")
                       .replace("NOAA_20", "NOAA-20").replace("NOAA_21", "NOAA-21")
                       .replace("NOAA 20", "NOAA-20").replace("NOAA 21", "NOAA-21"))
        sat = _SAT_ALIASES.get(sat_raw.upper(), sat_raw) or "UNKNOWN"
        ver = str(kw.get("version", "unknown") or "unknown")
    except (KeyError, TypeError, ValueError):
        return None

    # QA
    plats = INSTRUMENT_PLATFORMS.get(inst)
    if sat != "UNKNOWN" and plats is not None and sat not in plats:
        q = "anachronistic_platform"
    else:
        start = PLATFORM_FROM.get(sat)
        if start is not None and day < start:
            q = "anachronistic_platform"
        elif conf == "l" and (frp or 0.0) < 1.0:
            q = "low_confidence"
        else:
            q = "keep"
    return (lat, lon, day, t_pad, inst, sat, conf, frp, tp, ver, q)


def aggregate_iter(records, res_deg: float = RES_DEG, keep_clean=None,
                   qa_min: str = "all", platform_set: str = "all",
                   source_type: str = "all", keys_lower: bool = True,
                   daynight: str = "all", min_frp: float = 0.0):
    """Streaming aggregate used for large raw pulls (never builds a row list).

    `keep_clean` is an optional callable receiving each validated dict (used by
    the monthly ML context); pass None to skip retaining anything. Returns
    (agg, stats) where stats has clean/rejected/qa_counts and filter counts.

    `qa_min`: all | nominal | high. `platform_set`: all | snpp (keep MODIS +
    SNPP VIIRS, drop NOAA-20/21 so a platform change is not read as more fire).
    `source_type`: all | land (exclude type=3 offshore) | vegetation (type=0/None).
    """
    from app.firms.schema import FirmsRecord

    out: dict[tuple[str, str, str], DailyAgg] = defaultdict(DailyAgg)
    seen: set[tuple] = set()
    stats = {"clean": 0, "rejected": 0, "qa_counts": {},
             "filtered_low_confidence": 0, "filtered_confidence": 0,
             "filtered_platform": 0, "filtered_source_type": 0,
             "filters": {"qa_min": qa_min, "platform_set": platform_set,
                         **({"source_type": source_type} if source_type != "all" else {})}}
    if keep_clean is None:
        qa_counts = stats["qa_counts"]
        for r in records:
            parsed = _fast_parse_and_qa(r, keys_lower=keys_lower)
            if parsed is None:
                stats["rejected"] += 1
                continue
            lat, lon, day, t_pad, inst, sat, conf, frp, tp, ver, q = parsed
            qa_counts[q] = qa_counts.get(q, 0) + 1
            if q == "anachronistic_platform":
                stats["rejected"] += 1
                continue
            if qa_min in ("nominal", "high") and q == "low_confidence":
                stats["filtered_low_confidence"] += 1
                continue
            if qa_min == "high" and conf != "h":
                stats["filtered_confidence"] += 1
                continue
            if platform_set == "snpp" and inst == "VIIRS" and sat != "NPP":
                stats["filtered_platform"] += 1
                continue
            if source_type == "land" and tp == 3:
                stats["filtered_source_type"] += 1
                continue
            if source_type == "vegetation" and tp in (1, 2, 3):
                stats["filtered_source_type"] += 1
                continue
            if daynight != "all":
                dn = str(r.get("daynight") if keys_lower else (r.get("daynight") or r.get("DAYNIGHT") or "")).strip().upper()
                if dn != daynight:
                    continue
            if min_frp > 0.0 and (frp or 0.0) < min_frp:
                continue
            stats["clean"] += 1
            sig = (inst, sat, day, t_pad, round(lat, 4), round(lon, 4), ver)
            if sig in seen:
                continue
            seen.add(sig)
            la = math.floor(lat / res_deg) * res_deg
            lo = math.floor(lon / res_deg) * res_deg
            agg = out[(f"{la:.2f}_{lo:.2f}", day, inst)]
            agg.count += 1
            agg.platforms.add(sat)
            agg.platform_counts[sat] = agg.platform_counts.get(sat, 0) + 1
            fval = frp or 0.0
            agg.frp += fval
            agg.platform_frp[sat] = agg.platform_frp.get(sat, 0.0) + fval
        return out, stats
    for r in records:
        # `iter_raw_rows` and sample loaders already lowercase keys; avoid a
        # second dict+lower pass on the 2M-row hot path.
        kw = r if keys_lower else {k.lower(): v for k, v in r.items()}
        try:
            rec = FirmsRecord(**kw)
        except Exception:
            stats["rejected"] += 1
            continue
        q = rec.qa()
        stats["qa_counts"][q] = stats["qa_counts"].get(q, 0) + 1
        if q in ("suspect_geometry", "anachronistic_platform"):
            stats["rejected"] += 1
            continue
        if qa_min in ("nominal", "high") and q == "low_confidence":
            stats["filtered_low_confidence"] += 1
            continue
        if qa_min == "high" and rec.confidence != "h":
            stats["filtered_confidence"] += 1
            continue
        if (platform_set == "snpp" and rec.instrument == "VIIRS"
                and rec.satellite != "NPP"):
            stats["filtered_platform"] += 1
            continue
        if source_type == "land" and rec.type == 3:
            stats["filtered_source_type"] += 1
            continue
        if source_type == "vegetation" and rec.type in (1, 2, 3):
            stats["filtered_source_type"] += 1
            continue
        if daynight != "all" and (rec.daynight or "").upper() != daynight:
            continue
        if min_frp > 0.0 and (rec.frp or 0.0) < min_frp:
            continue
        stats["clean"] += 1
        sig = _dedup_key_rec(rec)
        if sig in seen:
            continue
        seen.add(sig)
        if keep_clean is not None:
            d = rec.model_dump(mode="json")
            d["qa_flag"] = q
            keep_clean(d)
        lat, lon = rec.latitude, rec.longitude
        inst = "VIIRS" if str(rec.instrument).upper().startswith("VIIRS") else "MODIS"
        day = str(rec.acq_date)[:10]
        la = math.floor(lat / res_deg) * res_deg
        lo = math.floor(lon / res_deg) * res_deg
        key = (f"{la:.2f}_{lo:.2f}", day, inst)
        agg = out[key]
        agg.count += 1
        sat = str(rec.satellite)
        agg.platforms.add(sat)
        agg.platform_counts[sat] = agg.platform_counts.get(sat, 0) + 1
        try:
            frp = float(rec.frp or 0.0)
        except (TypeError, ValueError):
            frp = 0.0
        agg.frp += frp
        agg.platform_frp[sat] = agg.platform_frp.get(sat, 0.0) + frp
    return out, stats


def estimate_efficiency_ratio(
    agg: dict[tuple[str, str, str], DailyAgg],
    min_months: int = 3,
    exclude_months: set[str] | frozenset[str] | None = None,
    mode: str = "fusion",
) -> dict[str, float]:
    """Per-month detection ratio k = MODIS / VIIRS from AOI-monthly totals.

    Deliberately NOT estimated on same-cell overlap days: at 0.05° the two
    sensors' pixels of the same fire usually land in different cells
    (375 m vs 1 km footprints, geolocation offsets, different overpass
    times), so cell-overlap is near-empty on real data too. Monthly AOI
    totals need no collocation: both sensors saw the same fire population.

    Audit P0-04/P0-05: this is a FUSION ratio when the same month's VIIRS is
    used to produce the same month's output. For a predictive backtest pass
    `exclude_months` (the evaluation months) and `mode="predictive"`; the
    ratio is then built only from information available before the test
    period. Provenance keys start with `_` and never collide with YYYY-MM.
    """
    exclude = set(exclude_months or ())
    monthly: dict[str, dict[str, float]] = defaultdict(lambda: {"MODIS": 0.0, "VIIRS": 0.0})
    monthly_viirs_sats: dict[str, set[str]] = defaultdict(set)
    for (cell, day, inst), a in agg.items():
        ym = day[:7]
        monthly[ym][inst] += a.count
        if inst == "VIIRS":
            for sat in (a.platforms or set()):
                if sat and sat != "UNKNOWN":
                    monthly_viirs_sats[ym].add(sat)
    ratios: dict[str, float] = {}
    all_r: list[float] = []
    used_months: list[str] = []
    for m in sorted(monthly):
        if m in exclude:
            continue
        per = monthly[m]
        if per["MODIS"] > 0 and per["VIIRS"] > 0:
            r = per["MODIS"] / per["VIIRS"]
            ratios[m] = r
            all_r.append(r)
            used_months.append(m)
    if len(all_r) < min_months:
        ratios = {}
        used_months = []
    fallback = float(np.median(all_r)) if all_r else 0.35
    fallback = round(float(np.clip(fallback, 0.05, 1.5)), 4)
    if all_r:
        q1, q3 = np.percentile(all_r, [25, 75])
        rel_iqr = float((q3 - q1) / fallback) if fallback > 0 else 0.0
    else:
        rel_iqr = 0.0
    clipped = [m for m in used_months if not (0.05 <= ratios[m] <= 1.5)]
    calibrated = len(all_r) >= min_months
    if calibrated:
        calibration_note = (
            f"calibrated on {len(all_r)} co-observed months "
            f"({used_months[0]}..{used_months[-1]}); "
            f"k is a measured MODIS/VIIRS ratio")
    else:
        # Truth label: the 0.35 number is kept for continuity but it is NOT
        # a measured ratio — fewer than min_months co-observed months exist.
        # Callers must read uncertainty_status=not_calibrated, never the
        # bare number.
        calibration_note = (
            f"insufficient_overlap (<{min_months} co-observed months, "
            f"n={len(all_r)}): k={fallback} "
            f"is a fallback, not a measured ratio; "
            f"uncertainty_status=not_calibrated, no interval emitted")
    out = {
        "_fallback": fallback,
        "_fallback_rel_iqr": round(float(np.clip(rel_iqr, 0.0, 1.0)), 4),
        "_n_months": len(all_r),
        "_calibration_status": "calibrated" if calibrated else "insufficient_overlap",
        "_calibration_note": calibration_note,
        "_calibration_min_months": min_months,
        "_clipped_months": clipped,
        "_clipped_fraction": round(len(clipped) / len(all_r), 4) if all_r else None,
        "_mode": mode,
        "_excluded_months": sorted(exclude),
        "_calibration_window": [used_months[0], used_months[-1]] if used_months else None,
        "_train_end": used_months[-1] if used_months else None,
        "_sensor_set": ["MODIS", "VIIRS"],
        "_active_viirs_platforms": {
            m: {
                "count": len(monthly_viirs_sats[m]),
                "platforms": sorted(monthly_viirs_sats[m]),
            }
            for m in sorted(monthly) if monthly_viirs_sats.get(m)
        },
        "_multi_satellite_pooling": any(
            len(sats) > 1 for sats in monthly_viirs_sats.values()
        ),
        "_data_version": ALGORITHM_VERSION,
        **{m: round(float(np.clip(v, 0.05, 1.5)), 4) for m, v in ratios.items()},
    }
    return out


def _provenance(ratios: dict) -> dict:
    return {
        "ratio_mode": str(ratios.get("_mode", "fusion")),
        "calibration_window": ratios.get("_calibration_window"),
        "calibration_train_end": ratios.get("_train_end"),
        "calibration_sensor_set": ratios.get("_sensor_set"),
        "calibration_version": ratios.get("_data_version", ALGORITHM_VERSION),
        "calibration_months": ratios.get("_n_months", 0),
        "calibration_status": ratios.get("_calibration_status", "calibrated"),
        "calibration_note": ratios.get("_calibration_note"),
        "calibration_min_months": ratios.get("_calibration_min_months", 3),
        "calibration_clipped_fraction": ratios.get("_clipped_fraction"),
        "multi_satellite_pooling": bool(ratios.get("_multi_satellite_pooling", False)),
    }


def iter_cell_days(agg: dict[tuple[str, str, str], DailyAgg]):
    """Yield (cell, day, {instrument: DailyAgg}) in sorted cell-day order.

    Sorted `agg` keys group MODIS and VIIRS for the same cell-day next to each
    other, so fusing needs no `cells_days` dict. That dict held one object per
    cell-day (1.4M+ for Vietnam) and was the main memory spike on raw data.
    """
    keys = sorted(agg)
    i, n = 0, len(keys)
    while i < n:
        cell, day, inst = keys[i]
        per = {inst: agg[keys[i]]}
        j = i + 1
        while j < n:
            c2, d2, i2 = keys[j]
            if c2 != cell or d2 != day:
                break
            per[i2] = agg[keys[j]]
            j += 1
        yield cell, day, per
        i = j


def fuse_cell_day(per: dict[str, DailyAgg], k: float, rel_iqr: float,
                  calibrated: bool = True):
    """Fuse one cell-day. Returns (mo, vi, h_count, h_frp, low, high, est, sensors).

    `calibrated` is False when fewer than `min_months` co-observed months exist.
    Then no interval is emitted at all: a one-point [x, x] band would pretend
    zero uncertainty from a fallback k that was never estimated (audit P0-02).
    """
    mo = per.get("MODIS", DailyAgg())
    vi = per.get("VIIRS", DailyAgg())
    if vi.count > 0:
        h_count = float(vi.count)
        h_frp = float(vi.frp)
        h_low = h_high = None
        est, sensors = "viirs_observed", "VIIRS" if mo.count == 0 else "VIIRS+MODIS"
    else:
        h_count = mo.count / k
        h_frp = None
        if calibrated and rel_iqr > 0:
            k_low = max(k * (1.0 - rel_iqr), 1e-6)
            k_high = k * (1.0 + rel_iqr)
            h_low = mo.count / k_high
            h_high = mo.count / k_low
        else:
            # No calibrated dispersion: emit no interval rather than a fake
            # zero-width [x, x] band (audit V6 P0-02).
            h_low = h_high = None
        est, sensors = "modis_upscaled_estimated", "MODIS"
    return mo, vi, h_count, h_frp, h_low, h_high, est, sensors


def daily_row(cell: str, day: str, mo: DailyAgg, vi: DailyAgg,
              h_count: float, h_frp: float | None, h_low: float | None,
              h_high: float | None, est: str, sensors: str,
              k: float, rel_iqr: float, provenance: dict) -> dict:
    """Materialise one harmonized cell-day dict (shared by list and stream paths)."""
    plats = sorted((mo.platforms or set()) | (vi.platforms or set()))
    platform_counts: dict[str, int] = {}
    for src in (mo.platform_counts or {}), (vi.platform_counts or {}):
        for sat, n in src.items():
            platform_counts[sat] = platform_counts.get(sat, 0) + int(n)
    lat_s, lon_s = cell.split("_")
    clat, clon = float(lat_s) + RES_DEG / 2, float(lon_s) + RES_DEG / 2
    # P1-16: physical cell area shrinks with latitude (0.05 deg is not equal-area).
    import math as _math
    cell_km2 = round((111.32 * RES_DEG) ** 2 * max(_math.cos(_math.radians(clat)), 0.2), 3)
    _ustatus = ("observed_no_estimate" if est == "viirs_observed"
                else ("ratio_iqr_band" if h_low is not None
                      else "not_calibrated"))
    # Truth label (TRUTH_CONTRACT.md): the number exists but its meaning
    # differs; never show the bare fallback k as if measured.
    if _ustatus == "observed_no_estimate":
        _ulabel = "observed — VIIRS recorded a detection here (no upscale)"
    elif _ustatus == "ratio_iqr_band":
        _ulabel = ("estimated — MODIS-only cell upscaled by 1/k with "
                   "month-to-month IQR band (same-month VIIRS absent)")
    else:
        _ulabel = (f"not calibrated — insufficient_overlap "
                   f"(<{provenance.get('calibration_min_months', 3)} co-observed months); "
                   f"k={round(float(k), 4)} is a fallback, not a measured ratio; "
                   f"no interval emitted")
    return {
        "cell_id": cell,
        "date": day,
        "lat": clat,
        "lon": clon,
        "cell_km2": cell_km2,
        "cell_area_method": "cos-lat approximation of a 0.05 deg box; not an equal-area grid",
        "modis_count": mo.count,
        "viirs_count": vi.count,
        "modis_frp": round(mo.frp, 3),
        "viirs_frp": round(vi.frp, 3),
        "harmonized_count": round(float(h_count), 3),
        "harmonized_count_low": None if h_low is None else round(float(h_low), 3),
        "harmonized_count_high": None if h_high is None else round(float(h_high), 3),
        "uncertainty_status": _ustatus,
        "uncertainty_label": _ulabel,
        "harmonized_per_km2": round(float(h_count) / cell_km2, 4),
        "harmonized_frp": None if h_frp is None else round(h_frp, 3),
        "method": "sensor_adjusted_index_v3",
        "estimate_type": est,
        "sensors": sensors,
        "platforms": "+".join(p for p in plats if p and p != "UNKNOWN") or "UNKNOWN",
        "platform_counts": platform_counts,
        "modis_platform_counts": dict(mo.platform_counts or {}),
        "viirs_platform_counts": dict(vi.platform_counts or {}),
        "modis_platform_frp": dict(mo.platform_frp or {}),
        "viirs_platform_frp": dict(vi.platform_frp or {}),
        "platform_single": plats[0] if len(plats) == 1 else ("mixed" if plats else "UNKNOWN"),
        "coverage_status": "observed" if vi.count > 0 else "unknown",
        "k_used": round(float(k), 4),
        "uncertainty_rel": round(rel_iqr, 4),
        "algorithm_version": ALGORITHM_VERSION,
        **provenance,
    }


def iter_daily(
    agg: dict[tuple[str, str, str], DailyAgg],
    ratios: dict[str, float] | None = None,
):
    """Yield fused cell-day dicts one at a time (CSV export / streaming callers)."""
    ratios = ratios or {"_fallback": 0.35}
    rel_iqr = float(ratios.get("_fallback_rel_iqr", 0.0) or 0.0)
    calibrated = ratios.get("_calibration_status", "calibrated") == "calibrated"
    fallback = ratios["_fallback"]
    provenance = _provenance(ratios)
    for cell, day, per in iter_cell_days(agg):
        k = ratios.get(day[:7], fallback)
        fused = fuse_cell_day(per, k, rel_iqr, calibrated)
        yield daily_row(cell, day, *fused, k, rel_iqr, provenance)


def harmonize_daily(
    agg: dict[tuple[str, str, str], DailyAgg],
    ratios: dict[str, float] | None = None,
) -> list[dict]:
    """Fuse per-sensor aggregates into a sensor-adjusted activity index.

    P0-04: a hotspot-only feed cannot prove 'VIIRS looked and saw nothing'.
    vi.count == 0 therefore means *no VIIRS detection recorded*, not *confirmed
    absence*. Cells where VIIRS recorded >=1 detection keep the VIIRS value
    (authoritative, more sensitive); MODIS-only cell-days are upscaled by 1/k
    and MUST be treated as estimates (estimate_type + coverage_status=unknown).
    P0-06: harmonized_frp is null for upscaled cells - count-ratio k must never
    rescale FRP (different retrieval physics).
    P0-05: upscaled cells carry an uncertainty interval from the month-to-month
    dispersion of k, so the output never presents one number as exact.
    """
    return list(iter_daily(agg, ratios))


def dedup_signature(d: dict, policy: str = "exact") -> tuple:
    """Dedup key for sensitivity analysis.

    exact    : instrument+satellite+date+time+rounded lat/lon+version
    pixel_day: instrument+satellite+date+rounded lat/lon (merges repeated
               detections in one pixel-day; more aggressive, reported only)
    """
    inst = str(d.get("instrument", "")).upper()
    inst = "VIIRS" if inst.startswith("VIIRS") else ("MODIS" if inst == "MODIS" else inst)
    try:
        la = round(float(d.get("latitude") or 0), 4)
        lo = round(float(d.get("longitude") or 0), 4)
    except (TypeError, ValueError):
        la = lo = 0.0
    base = (inst, str(d.get("satellite", "")).strip(),
            str(d.get("acq_date", ""))[:10], la, lo)
    if policy == "pixel_day":
        return base
    return base + (str(d.get("acq_time", "")).strip(), str(d.get("version", "")))


def dedup_sensitivity(records, limit: int = 200000) -> dict:
    """How many rows collapse under exact vs pixel-day dedup (audit P1-08)."""
    exact: set[tuple] = set()
    pixel: set[tuple] = set()
    n = 0
    for d in records:
        n += 1
        exact.add(dedup_signature(d, "exact"))
        pixel.add(dedup_signature(d, "pixel_day"))
        if n >= limit:
            break
    return {
        "rows_examined": n,
        "unique_exact": len(exact),
        "unique_pixel_day": len(pixel),
        "duplicates_exact": n - len(exact),
        "extra_merged_by_pixel_day": len(exact) - len(pixel),
        "exact_policy": "instrument+satellite+date+time+lat4+lon4+version",
        "pixel_day_policy": "instrument+satellite+date+lat4+lon4",
        "note": ("pixel_day is a sensitivity bound, not the served policy: it can "
                 "merge distinct fires in one ~5 km cell-day."),
    }


def _platform_sum(counts: dict, allowed: set[str]) -> float:
    total = 0.0
    for sat, n in (counts or {}).items():
        if sat in allowed or ("MODIS" in allowed and sat in {"Terra", "Aqua"}):
            total += float(n or 0.0)
    return total


def reconfigure_daily(daily: list[dict], allowed_platforms: list[str],
                      label: str = "custom",
                      baseline_k: dict[str, float] | None = None) -> tuple[list[dict], dict]:
    """Recompute the harmonized index for a sensor subset.

    The heavy streaming pass is done once for all sensors; this function only
    recombines per-platform counts already stored on each cell. It is what the
    Satellite Mission Simulator calls, so every scenario uses the same code
    path and the same denominators (audit V5 P0-06).
    """
    allowed = set(allowed_platforms)
    monthly: dict[str, list[float]] = {}
    for c in daily:
        ym = str(c["date"])[:7]
        slot = monthly.setdefault(ym, [0.0, 0.0])
        slot[0] += _platform_sum(c.get("modis_platform_counts") or {}, allowed)
        slot[1] += _platform_sum(c.get("viirs_platform_counts") or {}, allowed)
    measured = {m: v[0] / v[1] for m, v in monthly.items() if v[1] > 0}
    all_r = list(measured.values())
    if all_r:
        fallback = float(np.median(all_r))
    elif baseline_k:
        fallback = float(np.median(list(baseline_k.values())))
    else:
        fallback = 0.35
    fallback = float(np.clip(fallback, 0.05, 1.5))
    out: list[dict] = []
    dropped = 0
    monthly_viirs_sats: dict[str, set[str]] = defaultdict(set)
    for c in daily:
        ym = str(c["date"])[:7]
        mo_counts = c.get("modis_platform_counts") or {}
        vi_counts = c.get("viirs_platform_counts") or {}
        mo = _platform_sum(mo_counts, allowed)
        vi = _platform_sum(vi_counts, allowed)
        if mo <= 0 and vi <= 0:
            dropped += 1
            continue
        k = measured.get(ym) or (baseline_k or {}).get(ym) or fallback
        sel_counts = {p: int(n) for p, n in {**mo_counts, **{
            p: vi_counts.get(p, 0) + mo_counts.get(p, 0) for p in vi_counts
        }}.items() if p in allowed or ("MODIS" in allowed and p in {"Terra", "Aqua"})}
        for p, n in vi_counts.items():
            if p in allowed and float(n or 0) > 0 and p != "UNKNOWN":
                monthly_viirs_sats[ym].add(p)
        if vi > 0:
            h, est = vi, "viirs_observed"
            h_frp = _platform_sum(c.get("viirs_platform_frp") or {}, allowed)
            sensors = "VIIRS" if mo <= 0 else "VIIRS+MODIS"
        else:
            h, est = mo / k, "modis_upscaled_estimated"
            h_frp = None
            sensors = "MODIS"
        h_round = round(float(h), 3)
        cell_km2 = c.get("cell_km2")
        row_out = {**c,
                   "modis_count": int(mo), "viirs_count": int(vi),
                   "harmonized_count": h_round,
                   "harmonized_frp": None if h_frp is None else round(float(h_frp), 3),
                   "estimate_type": est, "sensors": sensors,
                   "platform_counts": sel_counts,
                   "platforms": "+".join(sorted(sel_counts)) or "UNKNOWN",
                   "platform_single": (next(iter(sel_counts)) if len(sel_counts) == 1
                                       else ("mixed" if sel_counts else "UNKNOWN")),
                   "coverage_status": "observed" if vi > 0 else "unknown",
                   "k_used": round(float(k), 4),
                   "sensor_config": label,
                   "viirs_available": vi > 0,
                   "algorithm_version": ALGORITHM_VERSION}
        if cell_km2 is not None and float(cell_km2) > 0:
            row_out["harmonized_per_km2"] = round(h_round / float(cell_km2), 4)
        out.append(row_out)
    meta = {
        "sensor_config": label,
        "allowed_platforms": sorted(allowed),
        "modis_available": any(v[0] > 0 for v in monthly.values()),
        "viirs_available": any(v[1] > 0 for v in monthly.values()),
        "months_with_both_sensors": len(measured),
        "months_total": len(monthly),
        "k_fallback": round(fallback, 4),
        "k_measured_months": len(measured),
        "k_by_month": {k: round(float(v), 4) for k, v in measured.items()},
        "active_viirs_platforms": {
            m: {"count": len(sats), "platforms": sorted(sats)}
            for m, sats in sorted(monthly_viirs_sats.items()) if sats
        },
        "dropped_cells": dropped,
        "ratio_mode": "simulated",
    }
    return out, meta
