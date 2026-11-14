"""Release gate: run the checks a clean-source judge can reproduce.

    python -m scripts.firms.check_release

Levels:
  verify-artifacts : pytest clean profile + benchmark/eval/docs checks
  rebuild-fixture  : add `--rebuild` (retrains from committed monthly pairs)
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
PY = sys.executable


def run(name: str, cmd: list[str], env: dict | None = None) -> bool:
    print(f"\n== {name} ==")
    print("$", " ".join(cmd))
    r = subprocess.run(cmd, cwd=BACKEND, env=env)
    ok = r.returncode == 0
    print(("PASS " if ok else "FAIL ") + name)
    return ok


def artifacts_ok() -> bool:
    """Release ZIP must actually ship servable ML/TS artifacts (audit V6 P0-03)."""
    from app.main import _artifact_availability
    a = _artifact_availability()
    print("\n== artifact health ==")
    print(a)
    ok = bool(a["ml"] and a["ts"] and a["ts_artifact_present"])
    print(("PASS " if ok else "FAIL ") + "artifact health")
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true")
    a = ap.parse_args()
    if not artifacts_ok():
        print("\nRELEASE GATE FAILED (artifact health)")
        return 1
    import os
    clean_env = {**os.environ, "FIRMS_SKIP_RAW": "1", "FIRMS_SKIP_DIST": "1"}
    checks = [
        ("pytest clean-source", [PY, "-m", "pytest", "tests/test_firms.py", "-q"], clean_env),
        ("raw subset rebuild", [PY, "-m", "scripts.firms.rebuild_subset"], None),
        ("benchmark consistency", [PY, "-m", "scripts.firms.make_benchmark", "--check"], None),
        ("evaluation verify (raw)", [PY, "-m", "scripts.firms.evaluate", "--data", "raw", "--verify"], None),
        ("evaluation verify (sample)", [PY, "-m", "scripts.firms.evaluate", "--data", "sample", "--verify"], None),
        ("docs metrics snapshot", [PY, "-m", "scripts.firms.render_docs", "--check"], None),
        ("environment check", [PY, "-m", "scripts.check_env"], None),
    ]
    if a.rebuild:
        checks.append(("rebuild fixture (raw)",
                       [PY, "-m", "scripts.firms.rebuild_benchmark", "--data", "raw"], None))
    ok = all(run(*c) for c in checks)
    print("\nRELEASE GATE " + ("OK" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
