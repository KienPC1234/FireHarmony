"""Shared configuration for the NASA data-collection pipeline.

All endpoints are public APIs and require NO API key:
- NTRS : https://ntrs.nasa.gov/api/...        (NASA Technical Reports Server)
- PSI  : https://psi.nasa.gov/geode-py/ws/...  (Physical Sciences Informatics)

Optional API key (not required): set the environment variable
    NASA_API_KEY=...   -> used for api.nasa.gov (images, APOD, ...)
"""
from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"

NTRS_DIR = RAW_DIR / "ntrs"
PSI_DIR = RAW_DIR / "psi"

# --- Endpoints ---
NTRS_SEARCH = "https://ntrs.nasa.gov/api/citations/search"
NTRS_CITATION = "https://ntrs.nasa.gov/api/citations/{id}"
PSI_SEARCH = "https://psi.nasa.gov/geode-py/ws/repo/search"
PSI_INVESTIGATION = "https://psi.nasa.gov/geode-py/ws/repo/investigations/{accession}"

# --- Search queries for the Fire Safety challenge ---
# Grouped to guarantee coverage. NTRS matches with OR, so many narrow queries
# are needed.
NTRS_QUERIES = [
    # --- Core: spacecraft fire safety ---
    "spacecraft fire safety",
    "fire safety microgravity",
    "fire detection spacecraft",
    "fire suppression spacecraft",
    "fire extinguisher crewed spacecraft",
    "spacecraft fire safety experiment",
    "Saffire fire experiment",
    "Saffire IV Saffire V",
    "spacecraft fire safety needs exploration",
    "fire safety extraterrestrial environments",
    "fire safety moon mars habitat",
    "material flammability microgravity",
    "flammability limits microgravity",
    "oxygen concentration flammability spacecraft",
    "smoke detection microgravity",
    "smoke aerosol spacecraft",
    "fire safety spacecraft materials",
    # --- Microgravity combustion science ---
    "microgravity combustion",
    "flame spread microgravity",
    "opposed flow flame spread microgravity",
    "concurrent flame spread microgravity",
    "cool flames microgravity",
    "flame extinguishment experiment",
    "droplet combustion microgravity",
    "soot formation microgravity flame",
    "burning suppression solids microgravity",
    "laminar diffusion flame microgravity",
    "reduced gravity fire",
    "partial gravity combustion",
    "fire whirl microgravity",
    "ignition microgravity solid fuel",
    # --- Extra: exploration, habitat, sensors ---
    "fire safety lunar exploration",
    "fire safety future human exploration",
    "fire safety challenges exploration",
    "aerospace fire detection sensor",
    "fire safety cryogenic life support",
]

# Maximum number of pages per query (100 results per page)
NTRS_MAX_PAGES = 2

# Core PSI investigations on fire (Combustion Science)
PSI_FIRE_ACCESSIONS = [
    "PSI-10", "PSI-20", "PSI-21", "PSI-22", "PSI-23", "PSI-25", "PSI-26",
    "PSI-39", "PSI-47", "PSI-60", "PSI-62", "PSI-68", "PSI-69", "PSI-98",
    "PSI-99", "PSI-100", "PSI-101", "PSI-102", "PSI-106", "PSI-107",
    "PSI-115", "PSI-117", "PSI-142", "PSI-159",
]

# --- HTTP ---
USER_AGENT = "AlphaCentauriAB-SpaceApps/0.1 (NASA Space Apps Challenge; research)"
REQUEST_TIMEOUT = 90
REQUEST_DELAY = 0.5  # seconds, respect rate limits

NASA_API_KEY = os.environ.get("NASA_API_KEY", "")  # optional
