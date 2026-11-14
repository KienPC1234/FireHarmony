"""Build monthly STAN serving targets (2024+) with HTS fallback before 2024.

    python -m scripts.firms.build_stan_series

Writes backend/data/firms/models/stan_series_raw.json, including the calibrated
log-scale 80% band and its measured validation/holdout coverage.
"""
from __future__ import annotations

import json

from app.firms import stan


def main() -> dict:
    return stan.build_series()


if __name__ == "__main__":
    print(json.dumps(main(), indent=1))
