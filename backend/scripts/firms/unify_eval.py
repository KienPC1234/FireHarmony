"""Stitch committed model artifacts into the frozen evaluation manifest.

The unified table used to stop at HGB/Transformer while the calendar served
STAN. This CLI joins STAN, HTS and the spatial HGB onto the exact same sample
IDs (no retraining, no model call) and rewrites the manifest + artifact
sidecars + docs.

    python -m scripts.firms.unify_eval            # raw + sample
    python -m scripts.firms.unify_eval --check    # exit 1 if already unified
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import evaluation  # noqa: E402


def run(data: str = "both", check: bool = False) -> int:
    targets = ("raw", "sample") if data == "both" else (data,)
    bad = 0
    for data in targets:
        manifest = evaluation.load_manifest(data)
        if not manifest:
            print(f"no evaluation_{data}.json")
            bad += 1
            continue
        before = list(manifest.get("methods") or [])
        merged = evaluation.merge_artifact_methods(manifest)
        added = [m for m in merged.get("methods", []) if m not in before]
        if check:
            missing = [m for m in evaluation.ARTIFACT_METHODS
                       if data == "raw" and m not in before]
            if missing:
                print(f"{data}: NOT unified, missing {missing}")
                bad += 1
            else:
                print(f"{data}: unified ({len(before)} methods)")
            continue
        path = evaluation.MODEL_DIR / f"evaluation_{data}.json"
        evaluation.MODEL_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(merged, indent=1, ensure_ascii=False),
                        encoding="utf-8")
        stamped = evaluation.stamp_artifacts(merged)
        pooled = (merged.get("pooled") or {}).get("metrics") or {}
        print(f"{data}: +{added or 'no new methods'}, stamped {stamped}; "
              f"pooled MAE " + ", ".join(f"{k}={v['mae']:.1f}"
                                         for k, v in pooled.items()))
    return 0 if bad == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="raw", choices=("sample", "raw", "both"))
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    return run(a.data, a.check)


if __name__ == "__main__":
    raise SystemExit(main())
