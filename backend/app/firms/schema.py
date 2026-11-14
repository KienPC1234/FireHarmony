"""FIRMS harmonized hotspot record - single clean schema for MODIS + VIIRS.

Source format: NASA FIRMS active-fire CSV (MODIS C6.1 NRT + VIIRS 375m V2 NRT).
Docs: https://www.earthdata.nasa.gov/faq/firms-faq (column names below).
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Instrument = Literal["MODIS", "VIIRS"]
Satellite = Literal["Terra", "Aqua", "NPP", "NOAA-20", "NOAA-21", "UNKNOWN"]
DayNight = Literal["D", "N"]
QAFlag = Literal["keep", "low_confidence", "suspect_geometry", "duplicate",
                 "anachronistic_platform"]

MODIS_SATS = {"Terra", "Aqua"}
VIIRS_SATS = {"NPP", "NOAA-20", "NOAA-21", "N", "NPP", "NOAA20", "NOAA21"}

INSTRUMENT_PLATFORMS = {"MODIS": {"Terra", "Aqua"}, "VIIRS": {"NPP", "NOAA-20", "NOAA-21"}}

# Platform service windows (FIRMS availability): rows outside are anachronistic.
PLATFORM_FROM: dict[str, str] = {
    "Terra": "2000-02-24",
    "Aqua": "2002-07-04",
    "NPP": "2012-01-01",
    "NOAA-20": "2018-04-01",
    "NOAA-21": "2024-01-17",
}


class FirmsRecord(BaseModel):
    """One validated hotspot. Field names match FIRMS CSV headers (lowercased)."""

    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    brightness: float = Field(gt=0, lt=2000)
    scan: float = Field(gt=0, lt=50)
    track: float = Field(gt=0, lt=50)
    acq_date: date
    acq_time: str = Field(pattern=r"^\d{1,4}$")  # HHMM UTC, real FIRMS is not zero-padded ("830")
    satellite: str = "UNKNOWN"
    instrument: Instrument  # required: no silent MODIS default (P0-07)
    confidence: str = "n"  # normalized to l/n/h; see validators (MODIS C6 NRT ships 0-100 %)
    confidence_pct: float | None = None  # raw 0-100 value when the source ships percent scale
    version: str = "unknown"
    bright_t31: float = Field(default=0.0, ge=0.0, lt=2000.0)
    frp: float | None = Field(default=None, ge=0.0)  # MW; None = not reported (never 0-filled)
    daynight: DayNight | None = Field(default=None)  # None = not reported
    # P0-14: None = unknown type (was silently 0=vegetation fire). Only filter when verified.
    type: int | None = Field(default=None, ge=0, le=3)
    qa_flag: QAFlag = "keep"

    @model_validator(mode="before")
    @classmethod
    def _aliases(cls, data: Any) -> Any:
        """Accept real FIRMS column variants: VIIRS bright_ti4/ti5, any case."""
        if isinstance(data, dict):
            # `iter_raw_rows` already lowercases CSV headers; avoid rebuilding
            # a ~15-key dict for every one of millions of rows.
            d = data if all(isinstance(k, str) and k.islower() for k in data) else {
                str(k).lower(): v for k, v in data.items()}
            if d.get("brightness") in (None, "") and d.get("bright_ti4") not in (None, ""):
                d["brightness"] = d["bright_ti4"]
            if d.get("bright_t31") in (None, "") and d.get("bright_ti5") not in (None, ""):
                d["bright_t31"] = d["bright_ti5"]
            conf = str(d.get("confidence", "")).strip()
            if re.fullmatch(r"\d{1,3}", conf):
                d["confidence_pct"] = float(conf)
            return d
        return data

    @field_validator("satellite", mode="before")
    @classmethod
    def _norm_sat(cls, v: object) -> str:
        s = str(v or "UNKNOWN").strip()
        s = (s.replace("NOAA20", "NOAA-20").replace("NOAA21", "NOAA-21")
               .replace("NOAA_20", "NOAA-20").replace("NOAA_21", "NOAA-21")
               .replace("NOAA 20", "NOAA-20").replace("NOAA 21", "NOAA-21"))
        if s in {"N20", "N-20"}:
            return "NOAA-20"
        if s in {"N21", "N-21"}:
            return "NOAA-21"
        if s in {"N", "NPP", "Suomi NPP", "S-NPP"}:
            return "NPP"
        return s or "UNKNOWN"

    @field_validator("instrument", mode="before")
    @classmethod
    def _norm_inst(cls, v: object) -> str:
        s = str(v or "").strip().upper()
        # P0-12: reject unknown instruments instead of silently mapping to MODIS.
        if s.startswith("VIIRS"):
            return "VIIRS"
        if s == "MODIS":
            return "MODIS"
        raise ValueError(f"unknown instrument {v!r}; expected MODIS|VIIRS")

    @field_validator("acq_time", mode="before")
    @classmethod
    def _pad_time(cls, v: object) -> str:
        s = str(v or "").strip()
        if not s.isdigit() or not (1 <= len(s) <= 4):
            raise ValueError(f"bad acq_time {v!r}; expected HHMM")
        s = s.zfill(4)
        hh, mm = int(s[:2]), int(s[2:4])
        if not (0 <= hh <= 23 and 0 <= mm <= 59):
            raise ValueError(f"bad acq_time {v!r}; HH 00-23 MM 00-59")
        return s

    @field_validator("confidence", mode="before")
    @classmethod
    def _norm_conf(cls, v: object) -> str:
        s = str(v or "n").strip().lower()
        if re.fullmatch(r"\d{1,3}", s):
            pct = int(s)
            if not (0 <= pct <= 100):
                raise ValueError(f"confidence_pct out of range: {v!r}")
            if pct >= 80:
                return "h"
            if pct >= 40:
                return "n"
            return "l"
        if s not in {"l", "n", "h"}:
            raise ValueError(f"unknown confidence {v!r}; expected l|n|h or 0-100")
        return s

    def qa(self) -> QAFlag:
        """Deterministic QA: geometry + platform-date + confidence. No ML here."""
        if not (-90 <= self.latitude <= 90 and -180 <= self.longitude <= 180):
            return "suspect_geometry"
        if self.brightness <= 0:
            return "suspect_geometry"
        if self.frp is not None and self.frp < 0:
            return "suspect_geometry"
        plats = INSTRUMENT_PLATFORMS.get(self.instrument)
        if self.satellite != "UNKNOWN" and plats is not None and self.satellite not in plats:
            return "anachronistic_platform"
        start = PLATFORM_FROM.get(self.satellite)
        if start is not None and self.acq_date.isoformat() < start:
            return "anachronistic_platform"
        if self.confidence == "l" and (self.frp or 0.0) < 1.0:
            return "low_confidence"
        return "keep"

    @property
    def acq_datetime_utc(self) -> datetime:
        t = self.acq_time.zfill(4)
        return datetime(
            self.acq_date.year, self.acq_date.month, self.acq_date.day,
            int(t[:2]), int(t[2:4]),
        )

    def cell_id(self, res_deg: float = 0.05) -> str:
        """Coarse grid cell id for harmonization (default ~5km at equator)."""
        import math

        la = math.floor(self.latitude / res_deg) * res_deg
        lo = math.floor(self.longitude / res_deg) * res_deg
        return f"{la:.2f}_{lo:.2f}"


class HarmonizedCell(BaseModel):
    """Daily per-cell aggregate after cross-sensor calibration."""

    cell_id: str
    date: date
    lat: float
    lon: float
    modis_count: int = 0
    viirs_count: int = 0
    modis_frp: float = 0.0
    viirs_frp: float = 0.0
    harmonized_count: float = 0.0  # sensor-adjusted activity index (see estimate_type)
    harmonized_frp: float | None = None  # P0-06: null unless FRP calibrated separately
    method: str = "viirs_equiv"
    # P0-08 provenance per cell-day:
    estimate_type: str = "viirs_observed"  # viirs_observed | modis_upscaled_estimated
    sensors: str = "VIIRS"  # e.g. VIIRS / MODIS / VIIRS+MODIS
    platforms: str = ""  # e.g. NPP+Terra (when known)
    coverage_status: str = "observed"  # observed | unknown (no coverage info in FIRMS hotspots-only feed)
    k_used: float | None = None
    algorithm_version: str = "harmonize-v2"
