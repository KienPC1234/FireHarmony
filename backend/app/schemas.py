"""Request schemas for the FIRMS calendar API."""
from __future__ import annotations

from pydantic import BaseModel, Field


class RecordsPayload(BaseModel):
    records: list[dict] = Field(default_factory=list)


class PairsPayload(BaseModel):
    pairs: list[dict] = Field(default_factory=list)
