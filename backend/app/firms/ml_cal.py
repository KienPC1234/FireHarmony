"""Monthly pair builders (MODIS + VIIRS counts per year-month).

Only the data-reduction half of the old calibration module remains: the HGB
calibrator (`hgb_b2res_v4`) was archived and removed on 2026-11-14, but its pair
builder is still the shared way to turn millions of raw rows into AOI-month
pairs for evaluation and the benchmark.
"""

from __future__ import annotations

from __future__ import annotations

OVERLAP_START_YEAR = 2012


def _parse_year_month(rec: dict) -> tuple[int, int] | None:
    d = rec.get("acq_date", "")
    if hasattr(d, "year") and hasattr(d, "month"):
        try:
            return int(d.year), int(d.month)
        except (TypeError, ValueError):
            return None
    s = str(d or "").strip()[:10]
    try:
        year = int(s[0:4])
        month = int(s[5:7])
    except (ValueError, IndexError):
        return None
    if not (1 <= month <= 12):
        return None
    return year, month


def _norm_instrument(rec: dict) -> str | None:
    s = str(rec.get("instrument", "") or "").strip().upper()
    if s.startswith("VIIRS"):
        return "VIIRS"
    if s == "MODIS":
        return "MODIS"
    return None


def _accumulate_pair(counts: dict, rec: dict) -> None:
    ym = _parse_year_month(rec)
    if ym is None:
        return
    year, month = ym
    if year < OVERLAP_START_YEAR:
        return
    inst = _norm_instrument(rec)
    if inst is None:
        return
    key = (year, month)
    slot = counts.setdefault(key, {"modis": 0, "viirs": 0,
                                   "day": 0, "night": 0,
                                   "terra": 0, "aqua": 0})
    if inst == "MODIS":
        slot["modis"] += 1
        dn = str(rec.get("daynight", "") or "").upper()
        if dn == "D":
            slot["day"] += 1
        elif dn == "N":
            slot["night"] += 1
        sat = str(rec.get("satellite", "") or "")
        if sat == "Terra":
            slot["terra"] += 1
        elif sat == "Aqua":
            slot["aqua"] += 1
    else:
        slot["viirs"] += 1


def _finalize_pairs(counts: dict) -> list[dict]:
    pairs = []
    for (y, m), v in counts.items():
        if v["modis"] > 0 and v["viirs"] > 0:
            dd = v["day"] + v["night"]
            tt = v["terra"] + v["aqua"]
            pairs.append({"year": y, "month": m, "modis": v["modis"], "viirs": v["viirs"],
                          "day_frac": v["day"] / dd if dd else 0.5,
                          "terra_frac": v["terra"] / tt if tt else 0.5})
    pairs.sort(key=lambda p: (p["year"], p["month"]))
    return pairs


class PairBuilder:
    """Streaming monthly-pair accumulator (no per-row storage)."""

    def __init__(self) -> None:
        self.counts: dict[tuple[int, int], dict[str, int]] = {}

    def add(self, rec: dict) -> None:
        if isinstance(rec, dict):
            _accumulate_pair(self.counts, rec)

    def finalize(self) -> list[dict]:
        return _finalize_pairs(self.counts)


def build_monthly_pairs(records: list[dict]) -> list[dict]:
    """Aggregate raw records by year-month (sum counts per instrument).

    Keeps only overlap-era months (year >= 2012) with both MODIS > 0
    and VIIRS > 0. Returns sorted [{year, month, modis, viirs,
    day_frac, terra_frac}, ...] where day_frac/terra_frac describe the
    MODIS detections (observable pre-2012 too): fraction daytime and
    fraction Terra (vs Aqua). 0.5 fallback when the split is unknown.
    """
    counts: dict[tuple[int, int], dict[str, int]] = {}
    for rec in records or []:
        if isinstance(rec, dict):
            _accumulate_pair(counts, rec)
    return _finalize_pairs(counts)


def build_monthly_pairs_iter(records) -> list[dict]:
    """Streaming variant: accepts an iterable, never materialises rows.

    Used for the 4.4M-row amazon pull, where `load_raw_merged` would exceed
    RAM. Returns the same structure as `build_monthly_pairs`.
    """
    counts: dict[tuple[int, int], dict[str, int]] = {}
    for rec in records or ():
        if isinstance(rec, dict):
            _accumulate_pair(counts, rec)
    return _finalize_pairs(counts)


