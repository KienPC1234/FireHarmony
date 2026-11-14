"""Generate deterministic FIRMS-like sample CSV (Vietnam dry-season regime).

No network needed. Produces backend/data/firms/samples/firms_sample.csv
with event-clustered MODIS (2001+) + VIIRS (2012+) rows, VIIRS ~3x MODIS,
dry-season peak Dec-Apr, plus a 2019 anomaly spike for the calendar demo.
"""
from __future__ import annotations

import csv
import random
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "data" / "firms" / "samples" / "firms_sample.csv"

# Central Highlands / Mekong bounding box (demo AOI)
LAT0, LAT1 = 10.0, 16.0
LON0, LON1 = 104.0, 109.0


def seasonal_intensity(month: int) -> float:
    # dry season Dec-Apr high
    peaks = {12: 1.0, 1: 0.95, 2: 0.9, 3: 0.85, 4: 0.6, 5: 0.25,
             6: 0.12, 7: 0.10, 8: 0.10, 9: 0.15, 10: 0.3, 11: 0.7}
    return peaks[month]


MODIS_START, VIIRS_START, END_YEAR = 2001, 2012, 2025


def main(seed: int = 7) -> Path:
    """Event-based fire generation (physically realistic clustering).

    Each fire *event* produces one MODIS pixel (p=0.95, coarser sensor misses
    some) plus ~Poisson(3.2) VIIRS pixels jittered within ~1 km, all on the
    same date — so both sensors usually share the 0.05° cell-day, exactly
    the collocation real harmonization relies on. Extra VIIRS-only small
    fires (no MODIS pixel) model sub-MODIS-pixel burns.
    """
    rng = random.Random(seed)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for year in range(MODIS_START, END_YEAR + 1):
        for month in range(1, 13):
            base = seasonal_intensity(month)
            if year == 2019 and month in (2, 3):  # planted anomaly
                base *= 2.2
            n_events = int(base * 40 + rng.randint(0, 6))
            n_small = int(base * 20 + rng.randint(0, 4))  # VIIRS-only small burns
            for _ in range(n_events):
                rows.extend(_event(rng, year, month, year >= VIIRS_START))
            if year >= VIIRS_START:  # VIIRS flies only since 2012
                for _ in range(n_small):
                    rows.append(_row(rng, year, month, "VIIRS", rng.choice(["NPP", "NOAA-20"]),
                                     None, None))
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["latitude", "longitude", "brightness",
                                          "scan", "track", "acq_date", "acq_time",
                                          "satellite", "instrument", "confidence",
                                          "version", "bright_t31", "frp",
                                          "daynight", "type"])
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} rows -> {OUT}")
    return OUT


def _event(rng: random.Random, year: int, month: int, has_viirs: bool) -> list[dict]:
    """One fire event: shared center+date, MODIS pixel + VIIRS pixel cluster."""
    clat = rng.uniform(LAT0, LAT1)
    clon = rng.uniform(LON0, LON1)
    day = rng.randint(1, 28)
    rows = []
    if rng.random() < 0.95:
        rows.append(_row(rng, year, month, "MODIS", rng.choice(["Terra", "Aqua"]),
                         clat, clon, day))
    if not has_viirs:
        return rows
    n_v = max(1, int(rng.expovariate(1 / 3.2)))
    for _ in range(n_v):
        rows.append(_row(rng, year, month, "VIIRS", rng.choice(["NPP", "NOAA-20"]),
                         clat, clon, day))
    return rows


def _row(rng: random.Random, year: int, month: int, inst: str, sat: str,
         clat: float | None = None, clon: float | None = None,
         day: int | None = None) -> dict:
    if clat is None:
        clat = rng.uniform(LAT0, LAT1)
    if clon is None:
        clon = rng.uniform(LON0, LON1)
    if day is None:
        day = rng.randint(1, 28)
    spread = 0.004 if inst == "MODIS" else 0.008  # VIIRS pixels scatter wider
    lat = round(min(max(clat + rng.uniform(-spread, spread), LAT0), LAT1), 4)
    lon = round(min(max(clon + rng.uniform(-spread, spread), LON0), LON1), 4)
    frp = round(rng.uniform(2, 60) if inst == "MODIS" else rng.uniform(0.5, 40), 2)
    return {
        "latitude": lat, "longitude": lon,
        "brightness": round(300 + frp * 1.5 + rng.uniform(0, 15), 2),
        "scan": round(rng.uniform(0.5, 1.5), 2),
        "track": round(rng.uniform(0.5, 1.5), 2),
        "acq_date": f"{year}-{month:02d}-{day:02d}",
        "acq_time": f"{rng.randint(0, 23):02d}{rng.choice(['00', '15', '30', '45'])}",
        "satellite": sat, "instrument": inst,
        "confidence": rng.choice(["l", "n", "n", "h"]),
        "version": "C6.1" if inst == "MODIS" else "V2",
        "bright_t31": round(280 + rng.uniform(0, 20), 2),
        "frp": frp,
        "daynight": rng.choice(["D", "D", "D", "N"]),
        "type": 0,
    }


if __name__ == "__main__":
    main()
