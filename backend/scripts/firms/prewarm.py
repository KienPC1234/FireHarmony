"""Warm the heavy raw calendar caches and print measured request costs (P1-08).

The dashboard caches a full raw aggregation on disk. A judge who opens the
calendar first pays that cost once; this script pays it deliberately and
reports the numbers so the demo and the README can quote real timings.

    python -m scripts.firms.prewarm --aoi vietnam --methods stan,stat

It talks to a running API (default http://127.0.0.1:8000) and never writes
model or data artifacts.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request

DEFAULT_BASE = "http://127.0.0.1:8000"


def _get(base: str, path: str, timeout: float) -> tuple[dict, int, int]:
    t0 = time.perf_counter()
    req = urllib.request.Request(base + path)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        elapsed_header = int(r.headers.get("X-Elapsed-Ms") or 0)
        elapsed = int((time.perf_counter() - t0) * 1000)
        return json.loads(body), elapsed, elapsed_header


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--aoi", action="append", default=None,
                    help="repeatable; defaults to every AOI with dataset_ready")
    ap.add_argument("--data", default="raw", choices=["raw", "sample"])
    ap.add_argument("--methods", default="stan,hts,stat")
    ap.add_argument("--timeout", type=float, default=900)
    ap.add_argument("--report", default="")
    args = ap.parse_args()

    _status, _, _ = _get(args.base, "/api/firms/data-status", 60)
    if args.aoi:
        aois = args.aoi
    else:
        aois = [d["aoi"] for d in _status.get("datasets", [])
                if d.get("dataset_ready")]
    if not aois:
        print("No dataset_ready AOI: run `make demo-install` or fetch raw data first.")
        return 2

    rows: list[dict] = []
    failures = 0
    for aoi in aois:
        for method in [m.strip() for m in args.methods.split(",") if m.strip()]:
            path = (f"/api/firms/calendar?data={args.data}&aoi={aoi}"
                    f"&method={method}&limit=10")
            try:
                body, ms, hdr = _get(args.base, path, args.timeout)
            except urllib.error.HTTPError as e:
                failures += 1
                print(f"{aoi:10s} {method:5s} HTTP {e.code}")
                continue
            s = body.get("summary") or {}
            period = s.get("period") or {}
            row = {"aoi": aoi, "method": method, "calendar_ms": hdr or ms,
                   "from": period.get("from"), "to": period.get("to"),
                   "cells": s.get("n_daily_cells_total")}
            rows.append(row)
            print(f"{aoi:10s} {method:5s} {row['calendar_ms']:>7d} ms  "
                  f"{period.get('from')}..{period.get('to')}  "
                  f"{s.get('n_daily_cells_total')} cells")
            if period.get("to"):
                try:
                    m, ms2, hdr2 = _get(
                        args.base,
                        f"/api/firms/map-cells?data={args.data}&aoi={aoi}"
                        f"&method={method}&ym={period['to']}&max_cells=500",
                        args.timeout)
                    row["last_month_ms"] = hdr2 or ms2
                    row["map_cells"] = f"{m.get('returned')}/{m.get('total')}"
                    print(f"{'':10s} {'':5s} {row['last_month_ms']:>7d} ms  "
                          f"map-cells {row['map_cells']}")
                except urllib.error.HTTPError as e:
                    row["last_month_ms"] = None
                    print(f"{'':10s} {'':5s} map-cells HTTP {e.code}")

    if args.report:
        with open(args.report, "w", encoding="utf-8") as fh:
            json.dump({"base": args.base, "data": args.data, "rows": rows}, fh, indent=2)
        print(f"wrote {args.report}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
