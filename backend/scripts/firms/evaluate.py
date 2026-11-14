"""CLI: build (or verify) the frozen evaluation manifest.

    python -m scripts.firms.evaluate --data raw --test-years 2 --epochs 140
    python -m scripts.firms.evaluate --data sample --test-years 2
    python -m scripts.firms.evaluate --verify --data raw

The manifest is the single source of truth for /backtest and /xray. It fixes
audit P0-07 (same samples for every method) and P0-08 (cache identity).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import evaluation  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="raw", choices=("sample", "raw"))
    ap.add_argument("--test-years", type=int, default=2)
    ap.add_argument("--epochs", type=int, default=140)
    ap.add_argument("--verify", action="store_true")
    a = ap.parse_args()
    if a.verify:
        m = evaluation.load_manifest(a.data)
        if not m:
            print(f"no evaluation_{a.data}.json; build it first")
            return 2
        recomputed = evaluation.verify_manifest(m)
        mismatches = 0
        for group, methods in recomputed.items():
            if group == "all":
                expected = (m.get("pooled") or {}).get("metrics", {})
            else:
                expected = ((m.get("per_aoi") or {}).get(group) or {}).get("metrics", {})
            for method, got in methods.items():
                want = expected.get(method) or {}
                for key in ("mae", "wape", "bias"):
                    if key in want and abs(got[key] - want[key]) > 1e-4:
                        print(f"MISMATCH {group}/{method}/{key}: "
                              f"{got[key]} != {want[key]}")
                        mismatches += 1
        print(f"evaluation {a.data}: {m.get('n_eval')} samples, "
              f"{len(m.get('per_aoi', {}))} AOIs, mismatches={mismatches}")
        print("EVALUATION VERIFY " + ("OK" if mismatches == 0 else "FAILED"))
        return 0 if mismatches == 0 else 1
    res = evaluation.evaluate(data=a.data, test_years=a.test_years, epochs=a.epochs)
    if not res.get("trained"):
        print(json.dumps(res, indent=1))
        return 2
    m = res["manifest"]
    print(json.dumps({"path": res["path"], "n_eval": m["n_eval"],
                      "test_years": m["test_years"],
                      "pooled": {k: v["mae"] for k, v in m["pooled"]["metrics"].items()},
                      "per_aoi": {a: {k: v["mae"] for k, v in info["metrics"].items()}
                                  for a, info in m["per_aoi"].items()}},
                     indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
