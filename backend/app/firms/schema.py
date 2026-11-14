"""FIRMS harmonized hotspot record — single clean schema for MODIS + VIIRS.

Source format: NASA FIRMS active-fire CSV (MODIS C6.1 NRT + VIIRS 375m V2 NRT).
Docs: https://www.earthdata.nasa.gov/faq/firms-faq (column names below).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Instrument = Literal["MODIS", "VIIRS"]
Satellite = Literal["Terra", "Aqua", "NPP", "NOAA-20", "NOAA-21", "UNKNOWN"]
DayNight = Literal["D", "N"]
QAFlag = Literal["keep", "low_confidence", "suspect_geometry", "duplicate"]

MODIS_SATS = {"Terra", "Aqua"}
VIIRS_SATS = {"NPP", "NOAA-20", "NOAA-21", "N", "NPP", "NOAA20", "NOAA21"}


class FirmsRecord(BaseModel):
    """One validated hotspot. Field names match FIRMS CSV headers (lowercased)."""

    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    brightness: float = Field(gt=0, lt=2000)
    scan: float = Field(gt=0, lt=50)
    track: float = Field(gt=0, lt=50)
    acq_date: date
    acq_time: str = Field(pattern=r"^\d{4}$")  # HHMM UTC, e.g. "1330"
    satellite: str = "UNKNOWN"
    instrument: Instrument = "MODIS"
    confidence: str = "n"  # MODIS: l/n/h ; VIIRS: l/n/h (v2) or d/n/u legacy
    version: str = "unknown"
    bright_t31: float = Field(default=0.0, ge=0.0, lt=2000.0)
    frp: float = Field(default=0.0, ge=0.0)  # MW
    daynight: DayNight = "D"
    type: int = Field(default=0, ge=0, le=3)  # 0 presumed veg, 1 volcano, 2 static, 3 offshore
    qa_flag: QAFlag = "keep"

    @field_validator("satellite", mode="before")
    @classmethod
    def _norm_sat(cls, v: object) -> str:
        s = str(v or "UNKNOWN").strip()
        s = s.replace("NOAA20", "NOAA-20").replace("NOAA21", "NOAA-21")
        if s in {"N", "NPP", "Suomi NPP", "S-NPP"}:
            return "NPP"
        return s or "UNKNOWN"

    @field_validator("instrument", mode="before")
    @classmethod
    def _norm_inst(cls, v: object) -> str:
        s = str(v or "").strip().upper()
        if s.startswith("VIIRS"):
            return "VIIRS"
        return "MODIS"

    @field_validator("confidence", mode="before")
    @classmethod
    def _norm_conf(cls, v: object) -> str:
        return str(v or "n").strip().lower()

    def qa(self) -> QAFlag:
        """Deterministic QA: geometry + confidence + FRP sanity. No ML here."""
        if not (-90 <= self.latitude <= 90 and -180 <= self.longitude <= 180):
            return "suspect_geometry"
        if self.frp < 0 or self.brightness <= 0:
            return "suspect_geometry"
        if self.confidence == "l" and self.frp < 1.0:
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
    harmonized_count: float = 0.0  # VIIRS-equivalent (MODIS-era upscaled, labeled estimated)
    harmonized_frp: float = 0.0
    method: str = "viirs_equiv"
