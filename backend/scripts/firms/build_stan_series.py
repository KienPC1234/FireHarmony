"""Build monthly STAN serving targets (2024+) with HTS fallback before 2024.

    python -m scripts.firms.build_stan_series
"""
from __future__ import annotations

import json

from app.firms import stan


if __name__ == "__main__":
    print(json.dumps(stan.build_series(), indent=1))
