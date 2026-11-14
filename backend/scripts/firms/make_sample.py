"""Generate deterministic FIRMS-like sample CSVs (offline demo data).

No network needed. One file per fire regime in backend/data/firms/samples/:
  vietnam   — Central Highlands/Mekong, dry season Dec-Apr, anomaly 2019-02/03
  amazon    — southern Amazon basin, dry season Jul-Oct, anomaly 2019-08
              (the real 2019 Amazon fire season)
  australia — southeast Australia, dry season Dec-Feb, anomaly 2019-12 + 2020-01
              (the real Black Summer)

Usage: python make_sample.py [vietnam|amazon|australia|all]
"""
from __future__ import annotations

import csv
import random
import sys
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[2] / "data" / "firms" / "samples"

REGIONS = {
    "vietnam": {
        "bbox": (104.0, 10.0, 109.0, 16.0),
        "peaks": {12: 1.0, 1: 0.95, 2: 0.9, 3: 0.85, 4: 0.6, 5: 0.25,
                  6: 0.12, 7: 0.10, 8: 0.10, 9: 0.15, 10: 0.3, 11: 0.7},
        "anomaly": {(2019, 2): 2.2, (2019, 3): 2.2},
        "label": "Vietnam — Central Highlands / Mekong, dry Dec–Apr",
    },
    "amazon": {
        "bbox": (-70.0, -12.0, -50.0, 3.0),
        "peaks": {7: 0.6, 8: 1.0, 9: 0.95, 10: 0.7, 11: 0.3, 12: 0.15,
                  1: 0.10, 2: 0.10, 3: 0.15, 4: 0.25, 5: 0.30, 6: 0.40},
        "anomaly": {(2019, 8): 2.0, (2019, 9): 1.6},
        "label": "Amazon — southern basin, dry Jul–Oct",
    },
    "australia": {
        "bbox": (113.0, -39.0, 153.0, -12.0),
        "peaks": {12: 1.0, 1: 0.95, 2: 0.80, 3: 0.40, 4: 0.15, 5: 0.10,
                  6: 0.08, 7: 0.08, 8: 0.10, 9: 0.20, 10: 0.35, 11: 0.60},
        "anomaly": {(2019, 12): 2.4, (2020, 1): 2.4},
        "label": "Australia — southeast, dry Dec–Feb (Black Summer)",
    },
}

MODIS_START, VIIRS_START, END_YEAR = 2001, 2012, 2025


def seasonal_intensity(peaks: dict[int, float], month: int) -> float:
    return peaks[month]


def main(region: str = "all", seed: int = 7) -> list[Path]:
    names = list(REGIONS) if region == "all" else [region]
    outs = []
    for name in names:
        if name not in REGIONS:
            raise SystemExit(f"unknown region {name!r}; choose from {list(REGIONS)}")
        outs.append(_generate(name, seed))
    return outs


def _generate(name: str, seed: int) -> Path:
    cfg = REGIONS[name]
    lon0, lat0, lon1, lat1 = cfg["bbox"]
    rng = random.Random(seed + hash(name) % 1000)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for year in range(MODIS_START, END_YEAR + 1):
        for month in range(1, 13):
            base = seasonal_intensity(cfg["peaks"], month)
            base *= cfg["anomaly"].get((year, month), 1.0)
            n_events = int(base * 40 + rng.randint(0, 6))
            n_small = int(base * 20 + rng.randint(0, 4))
            for _ in range(n_events):
                rows.extend(_event(rng, year, month, lon0, lat0, lon1, lat1,
                                   year >= VIIRS_START))
            if year >= VIIRS_START:
                for _ in range(n_small):
                    rows.append(_row(rng, year, month, "VIIRS",
                                     rng.choice(["NPP", "NOAA-20"]),
                                     None, None, None, lon0, lat0, lon1, lat1))
    out = OUT_DIR / f"firms_sample_{name}.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["latitude", "longitude", "brightness",
                                          "scan", "track", "acq_date", "acq_time",
                                          "satellite", "instrument", "confidence",
                                          "version", "bright_t31", "frp",
                                          "daynight", "type"])
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} rows -> {out}")
    return out


def _event(rng: random.Random, year: int, month: int,
           lon0: float, lat0: float, lon1: float, lat1: float,
           has_viirs: bool) -> list[dict]:
    """One fire event: shared center+date, MODIS pixel + VIIRS pixel cluster."""
    clat = rng.uniform(lat0, lat1)
    clon = rng.uniform(lon0, lon1)
    day = rng.randint(1, 28)
    rows = []
    if rng.random() < 0.95:
        rows.append(_row(rng, year, month, "MODIS", rng.choice(["Terra", "Aqua"]),
                         clat, clon, day, lon0, lat0, lon1, lat1))
    if not has_viirs:
        return rows
    n_v = max(1, int(rng.expovariate(1 / 3.2)))
    for _ in range(n_v):
        rows.append(_row(rng, year, month, "VIIRS", rng.choice(["NPP", "NOAA-20"]),
                         clat, clon, day, lon0, lat0, lon1, lat1))
    return rows


def _row(rng: random.Random, year: int, month: int, inst: str, sat: str,
         clat: float | None, clon: float | None, day: int | None,
         lon0: float, lat0: float, lon1: float, lat1: float) -> dict:
    if clat is None:
        clat = rng.uniform(lat0, lat1)
    if clon is None:
        clon = rng.uniform(lon0, lon1)
    if day is None:
        day = rng.randint(1, 28)
    spread = 0.004 if inst == "MODIS" else 0.008
    lat = round(min(max(clat + rng.uniform(-spread, spread), lat0), lat1), 4)
    lon = round(min(max(clon + rng.uniform(-spread, spread), lon0), lon1), 4)
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
    main(sys.argv[1] if len(sys.argv) > 1 else "all")
