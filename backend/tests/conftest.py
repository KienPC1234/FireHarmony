"""Pytest configuration for fast dev runs by default.

Raw 1.7 GB CSV integration tests are skipped unless `--run-raw` or
`FIRMS_RUN_RAW=1` is explicitly passed (e.g., `make test-full`).
"""
from __future__ import annotations

import os


def pytest_addoption(parser) -> None:
    parser.addoption(
        "--run-raw",
        action="store_true",
        default=False,
        help="Run slow raw-data tests (~12-40 min over 1.7 GB FIRMS CSVs).",
    )


def pytest_configure(config) -> None:
    run_raw = config.getoption("--run-raw", default=False) or os.getenv("FIRMS_RUN_RAW") == "1"
    if not run_raw:
        os.environ.setdefault("FIRMS_SKIP_RAW", "1")
    else:
        os.environ["FIRMS_SKIP_RAW"] = "0"
