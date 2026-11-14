"""Build tile-month pairs from the committed FIRMS raw pull.

The served benchmark collapses each AOI into one monthly pair (231 train
windows). That is the binding constraint on model capacity, not GPU FLOPs.
This script keeps the same sensors but aggregates at 1-degree tiles, producing
~29k tile-months (10k with >=20 MODIS and >=20 VIIRS detections) and ~960
tiles. It writes a small CSV so the experiment is reproducible from the ZIP
without the 823 MB raw pull.

    python -m scripts.firms.build_tiles

Output: backend/data/firms/benchmark/tile_pairs_raw.csv
Columns: aoi, tile_id, lat, lon, year, month, modis, viirs, day_frac, terra_frac
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import store  # noqa: E402

AOIS = ("vietnam", "amazon", "australia")
BOUNDS = {
    "vietnam": (10.0, 16.0, 104.0, 109.0),
    "amazon": (-12.0, 3.0, -70.0, -50.0),
    "australia": (-39.0, -12.0, 113.0, 153.0),
}
TILE_DEG = 1.0
OUT = BACKEND / "data" / "firms" / "benchmark" / "tile_pairs_raw.csv"


def _inst(rec: dict) -> str | None:
    s = str(rec.get("instrument", "") or "").strip().upper()
    if s.startswith("VIIRS"):
        return "V"
    if s == "MODIS":
        return "M"
    return None


def build() -> dict:
    acc: dict[tuple, list[int]] = {}
    dates_m: dict[tuple, set[str]] = {}
    dates_v: dict[tuple, set[str]] = {}
    for aoi in AOIS:
        lat0, lat1, lon0, lon1 = BOUNDS[aoi]
        for rec in store.iter_raw_rows(aoi, limit=None):
            inst = _inst(rec)
            if inst is None:
                continue
            d = str(rec.get("acq_date", ""))[:10]
            if len(d) < 10:
                continue
            try:
                y, m = int(d[:4]), int(d[5:7])
                lat, lon = float(rec["latitude"]), float(rec["longitude"])
            except (KeyError, TypeError, ValueError):
                continue
            if y < 2012:
                continue
            if not (lat0 <= lat <= lat1 and lon0 <= lon <= lon1):
                continue
            ilat = int(math.floor(lat / TILE_DEG) * TILE_DEG)
            ilon = int(math.floor(lon / TILE_DEG) * TILE_DEG)
            key = (aoi, ilat, ilon, y, m)
            slot = acc.get(key)
            if slot is None:
                slot = [0, 0, 0, 0, 0, 0]
                acc[key] = slot
            if inst == "M":
                slot[0] += 1
                dates_m.setdefault(key, set()).add(d)
                dn = str(rec.get("daynight", "") or "").upper()
                if dn == "D":
                    slot[2] += 1
                elif dn == "N":
                    slot[3] += 1
                sat = str(rec.get("satellite", "") or "")
                if sat == "Terra":
                    slot[4] += 1
                elif sat == "Aqua":
                    slot[5] += 1
            else:
                slot[1] += 1
                dates_v.setdefault(key, set()).add(d)

    rows = []
    for (aoi, ilat, ilon, y, m), s in sorted(acc.items()):
        modis, viirs = s[0], s[1]
        # Keep a month if either sensor saw something. VIIRS=0 with MODIS>0 is
        # a real "no VIIRS detection", not a fabricated observation mask.
        if modis <= 0 and viirs <= 0:
            continue
        dd = s[2] + s[3]
        tt = s[4] + s[5]
        rows.append({
            "aoi": aoi,
            "tile_id": f"{aoi}:{int(ilat)}:{int(ilon)}",
            "lat": round(ilat + TILE_DEG / 2, 3),
            "lon": round(ilon + TILE_DEG / 2, 3),
            "year": y, "month": m,
            "modis": modis, "viirs": viirs,
            "day_frac": round(s[2] / dd, 4) if dd else 0.5,
            "terra_frac": round(s[4] / tt, 4) if tt else 0.5,
            # Observation opportunity: distinct acquisition dates per sensor.
            # This is the mask the old `observed=1.0` feature pretended to have.
            "days_modis": len(dates_m.get(key, ())),
            "days_viirs": len(dates_v.get(key, ())),
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    strong = [r for r in rows if r["modis"] >= 20 and r["viirs"] >= 20]
    tiles = {r["tile_id"] for r in rows}
    meta = {
        "rows": len(rows), "strong_rows": len(strong), "tiles": len(tiles),
        "aois": list(AOIS), "tile_deg": TILE_DEG,
        "sha256": hashlib.sha256(OUT.read_bytes()).hexdigest(),
    }
    (OUT.parent / "tile_pairs_raw.json").write_text(
        json.dumps(meta, indent=1) + "\n", encoding="utf-8")
    return meta


if __name__ == "__main__":
    print(json.dumps(build(), indent=1))
