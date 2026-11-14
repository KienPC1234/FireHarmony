"""Check the runtime against the versions embedded in artifacts.

    python -m scripts.check_env

Joblib models carry `sklearn_version`; PyTorch models carry `torch_version`.
A mismatch is a warning (models often load) but must be visible before a
demo, as audit V5 P1-08 requested.
"""
from __future__ import annotations

import json
import platform
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def main() -> int:
    import numpy
    import sklearn
    try:
        import torch
        tv = torch.__version__
    except Exception:
        tv = None
    print("python", platform.python_version())
    print("numpy", numpy.__version__)
    print("scikit-learn", sklearn.__version__)
    print("torch", tv or "missing")
    warnings = 0
    mdir = BACKEND / "data" / "firms" / "models"
    for jp in sorted(mdir.glob("cal_*.json")):
        try:
            doc = json.loads(jp.read_text())
        except Exception:
            continue
        want = str(doc.get("sklearn_version", ""))
        if want and ".".join(want.split(".")[:2]) != ".".join(sklearn.__version__.split(".")[:2]):
            print(f"WARN {jp.name}: artifact sklearn {want} vs runtime {sklearn.__version__}")
            warnings += 1
    for jp in sorted(mdir.glob("ts_*.json")) + sorted(mdir.glob("stan_*.json")):
        try:
            doc = json.loads(jp.read_text())
        except Exception:
            continue
        want = str(doc.get("torch_version", ""))
        if want and tv and want.split("+")[0] != tv.split("+")[0]:
            print(f"WARN {jp.name}: artifact torch {want} vs runtime {tv}")
            warnings += 1
    print(f"ENV CHECK {'OK' if warnings == 0 else 'OK WITH WARNINGS'} ({warnings} warnings)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
