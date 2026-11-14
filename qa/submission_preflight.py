#!/usr/bin/env python3
"""Read-only, dependency-free evidence gate for the FireHarmony NASA submission.

This is NOT a substitute for NASA's submission portal. It distinguishes
machine-verifiable evidence from items that require human proof.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any
from urllib.parse import parse_qsl, urlsplit
from urllib.request import Request, urlopen


@dataclass
class Check:
    id: str
    status: str  # PASS / WARN / BLOCKED
    detail: str
    evidence: dict[str, Any]


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_url(value: str | None, *, allow_video_query: bool = False) -> bool:
    if not value:
        return False
    try:
        u = urlsplit(value)
        hostname = u.hostname or ""
        if u.scheme != "https" or not hostname or u.username or u.password or u.fragment:
            return False
        if hostname == "localhost" or hostname.endswith((".local", ".internal")):
            return False
        try:
            if not ipaddress.ip_address(hostname).is_global:
                return False
        except ValueError:
            pass  # public DNS hostnames, not IP literals
        if u.query:
            if not (allow_video_query and hostname in (
                "youtube.com", "www.youtube.com", "m.youtube.com"
            )):
                return False
            allowed = {"v", "t", "start", "list"}
            if any(key not in allowed for key, _ in parse_qsl(u.query, keep_blank_values=True)):
                return False
        return True
    except ValueError:
        return False


def run_git(root: Path, *args: str) -> str | None:
    try:
        p = subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True, text=True, timeout=10, check=False,
        )
        return p.stdout.strip() if p.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def basic_files(root: Path) -> list[Check]:
    found = []
    for label, name in [
        ("MIT_LICENSE", "LICENSE"), ("PROJECT_README", "README.md"),
        ("SUBMISSION_CHECKLIST", "docs/SUBMISSION.md"),
        ("DEMO_RUNBOOK", "docs/DEMO.md"),
        ("TRUTH_CONTRACT", "docs/TRUTH_CONTRACT.md"),
        ("FRONTEND_PACKAGE", "frontend/package.json"),
    ]:
        p = root / name
        found.append(Check(label, "PASS" if p.is_file() else "BLOCKED",
                           name + (" exists" if p.is_file() else " missing"), {"path": name}))
    license_path = root / "LICENSE"
    if license_path.is_file():
        text = license_path.read_text(encoding="utf-8", errors="replace")
        found.append(Check("LICENSE_CONTENT", "PASS" if "MIT License" in text and "Permission is hereby granted" in text else "BLOCKED",
                           "MIT license text present" if "Permission is hereby granted" in text else "MIT terms cannot be verified", {}))
    pkg = root / "frontend/package.json"
    if pkg.is_file():
        try:
            v = json.loads(pkg.read_text(encoding="utf-8"))
            found.append(Check("FRONTEND_LICENSE", "PASS" if v.get("license") == "MIT" else "BLOCKED",
                               "frontend package declares " + str(v.get("license")), {}))
        except (ValueError, OSError) as e:
            found.append(Check("FRONTEND_LICENSE", "BLOCKED", "Package metadata invalid", {"exception": type(e).__name__}))
    return found


def verify_demo_pack(root: Path) -> Check:
    manifest = root / "backend/data/firms/demo_pack/manifest.json"
    if not manifest.is_file():
        return Check("DEMO_PACK", "BLOCKED", "Demo pack manifest missing", {})
    try:
        manifest_sha_before = digest(manifest)
        m = json.loads(manifest.read_text(encoding="utf-8"))
        entries = m["entries"]
        if not isinstance(entries, list) or not entries:
            raise ValueError("empty manifest")
        pack = manifest.parent / "raw"
        bad: list[str] = []
        seen: set[str] = set()
        sums = []
        total_bytes = 0
        total_rows = 0
        for e in entries:
            name = e["name"]
            if (not isinstance(name, str) or
                Path(name).name != name or name in seen or
                not name.lower().endswith(".csv")):
                bad.append("invalid or duplicated relative filename")
                continue
            seen.add(name)
            f = pack / name
            if not f.is_file() or f.is_symlink():
                bad.append("missing/unsafe file: " + name)
                continue
            if f.stat().st_size != e["bytes"] or digest(f) != e["sha256"]:
                bad.append("size/checksum mismatch: " + name)
            total_bytes += int(e["bytes"])
            total_rows += int(e["rows"])
            sums.append(e)
        combined = hashlib.sha256(
            "".join(x["sha256"] for x in sorted(entries, key=lambda v: v["name"])).encode()
        ).hexdigest()
        if combined != m.get("checksum_sha256"):
            bad.append("manifest combined SHA-256 mismatch")
        if len(entries) != m.get("files") or total_rows != m.get("rows") or total_bytes != m.get("bytes"):
            bad.append("manifest file/row/byte totals mismatch")
        if digest(manifest) != manifest_sha_before:
            bad.append("manifest changed during audit")
        ev = {
            "aoi": m.get("aoi"), "months": m.get("months"), "files": len(entries),
            "rows": total_rows, "combined_sha256": combined,
            "observation_coverage": m.get("observation_coverage"),
            "errors": bad[:5],
        }
        return Check("DEMO_PACK", "BLOCKED" if bad else "PASS",
                     ("Demo pack integrity failures: " + str(len(bad))) if bad
                     else "All packaged files, byte sizes, and SHA-256 values verified",
                     ev)
    except (ValueError, TypeError, KeyError, OSError) as e:
        return Check("DEMO_PACK", "BLOCKED", "Manifest could not be validated",
                     {"exception": type(e).__name__})


def verify_benchmark(root: Path) -> Check:
    p = root / "backend/data/firms/models/evaluation_raw.json"
    if not p.is_file():
        return Check("MODEL_EVAL", "BLOCKED", "Official evaluation artifact missing", {})
    try:
        before = digest(p)
        a = json.loads(p.read_text(encoding="utf-8"))
        rows = a["samples"]
        methods = a["methods"]
        official = a["pooled"]["metrics"]
        if not rows or not methods:
            raise ValueError("no scored evaluation rows")
        target = sum(float(x["viirs_ref"]) for x in rows)
        if target <= 0:
            raise ValueError("invalid reference denominator")
        observed = {}
        differences = {}
        for method in methods:
            errors = [abs(float(x[method]) - float(x["viirs_ref"])) for x in rows]
            metric = official[method]
            mae = sum(errors) / len(rows)
            wape = sum(errors) / target
            observed[method] = {"mae": round(mae, 4), "wape": round(wape, 6)}
            if abs(mae - float(metric["mae"])) > 0.02 or abs(wape - float(metric["wape"])) > 0.00001:
                differences[method] = "stored MAE/WAPE differs from sample rows"
        if int(a["n_eval"]) != len(rows) or int(a["pooled"]["n_eval"]) != len(rows):
            differences["n_eval"] = "sample count mismatch"
        if before != digest(p):
            differences["artifact"] = "artifact changed during the audit"
        ev = {"evaluation_version": a.get("evaluation_version"),
              "eval_rows": len(rows), "methods": observed, "mismatches": differences,
              "artifact_sha256": before}
        return Check("MODEL_EVAL", "BLOCKED" if differences else "PASS",
                     "Recomputed pooled MAE/WAPE from every scored sample"
                     if not differences else "Official evaluation figures do not reconcile",
                     ev)
    except (KeyError, ValueError, TypeError, OSError, ZeroDivisionError) as e:
        return Check("MODEL_EVAL", "BLOCKED", "Evaluation cannot be reconstructed",
                     {"exception": type(e).__name__})




def verify_model_alignment(root: Path) -> Check:
    """Prove eval-v4 rows match the actually served STAN/HTS series.

    stan_safe_raw.json#official and hts_anchor_raw.json metrics are produced
    by model-specific evaluation protocols. They are not the same artifact as
    the published served-series holdout, so comparing those summaries directly
    is invalid. The public table must instead reconcile to series_raw outputs.
    """
    paths = {
        "evaluation": root / "backend/data/firms/models/evaluation_raw.json",
        "stan_series": root / "backend/data/firms/models/stan_series_raw.json",
        "hts_series": root / "backend/data/firms/models/hts_series_raw.json",
        "stan_model": root / "backend/data/firms/models/stan_safe_raw.json",
        "hts_model": root / "backend/data/firms/models/hts_anchor_raw.json",
    }
    missing = [name for name, path in paths.items() if not path.is_file()]
    if missing:
        return Check("MODEL_ARTIFACT_ALIGNMENT", "BLOCKED",
                     "Missing evaluation/serving/model artifacts",
                     {"missing": missing})
    try:
        initial = {name: digest(path) for name, path in paths.items()}
        data = {
            name: json.loads(path.read_text(encoding="utf-8"))
            for name, path in paths.items()
        }
        evaluation = data["evaluation"]
        stan_series = data["stan_series"]
        hts_series = data["hts_series"]
        lineage = {
            name: data[name].get("dataset_sha256")
            for name in ("stan_series", "hts_series", "stan_model", "hts_model")
        }
        mismatches: dict[str, Any] = {}
        lineage_values = set(lineage.values())
        if None in lineage_values or len(lineage_values) != 1:
            mismatches["dataset_lineage"] = lineage
        samples = evaluation.get("samples") or []
        if not samples or len(samples) != int(evaluation.get("n_eval", -1)):
            mismatches["sample_count"] = {
                "manifest_n_eval": evaluation.get("n_eval"),
                "actual_samples": len(samples),
            }
        seen: set[str] = set()
        missing_series = 0
        for sample in samples:
            aoi = sample.get("aoi")
            ym = f"{int(sample['year']):04d}-{int(sample['month']):02d}"
            sample_id = sample.get("id") or f"{aoi}:{ym}"
            if sample_id in seen:
                mismatches["duplicate:" + str(sample_id)] = "duplicate evaluation sample ID"
                continue
            seen.add(sample_id)
            stan_row = ((stan_series.get("series") or {}).get(aoi) or {}).get(ym) or {}
            hts_row = ((hts_series.get("series") or {}).get(aoi) or {}).get(ym) or {}
            if not stan_row or not hts_row:
                missing_series += 1
                mismatches["missing:" + str(sample_id)] = "STAN/HTS serving series row missing"
                continue
            pairs = (
                ("stan_safe_v1", sample.get("stan_safe_v1"), stan_row.get("target")),
                ("hts_anchor_v1", sample.get("hts_anchor_v1"), hts_row.get("hts")),
                ("viirs_ref", sample.get("viirs_ref"), hts_row.get("viirs")),
                ("b2_seasonal_ratio", sample.get("b2_seasonal_ratio"), hts_row.get("b2")),
            )
            for field, expected, actual in pairs:
                if expected is None or actual is None:
                    mismatches[f"{sample_id}.{field}"] = {
                        "expected": expected, "served_series": actual,
                    }
                    continue
                gap = abs(float(expected) - float(actual))
                # Series values are stored to 3 decimals; eval rows to 4.
                if gap > 0.00051:
                    mismatches[f"{sample_id}.{field}"] = {
                        "expected": expected, "served_series": actual,
                        "absolute_gap": round(gap, 7),
                    }
        final = {name: digest(path) for name, path in paths.items()}
        if initial != final:
            mismatches["snapshot"] = {"reason": "an artifact changed during verification"}
        return Check(
            "MODEL_ARTIFACT_ALIGNMENT", "BLOCKED" if mismatches else "PASS",
            "All evaluation samples reconcile to the deployed STAN/HTS series and tile-data lineage"
            if not mismatches else "Published evaluation does not reconcile to served series or shared data lineage",
            {
                "evaluation_version": evaluation.get("evaluation_version"),
                "eval_rows": len(samples), "unique_ids": len(seen),
                "missing_series_rows": missing_series,
                "dataset_lineage": lineage,
                "sample_ids_sha256": hashlib.sha256(
                    "\n".join(sorted(seen)).encode()
                ).hexdigest(),
                "mismatches": dict(list(mismatches.items())[:12]),
                "artifact_sha256": initial,
            },
        )
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return Check("MODEL_ARTIFACT_ALIGNMENT", "BLOCKED",
                     "Cannot reconcile evaluation to served model series",
                     {"exception": type(exc).__name__})

def verify_release(root: Path) -> Check:
    p = root / "frontend/dist/index.html"
    if not p.is_file():
        return Check("FRONTEND_DIST", "BLOCKED", "Compiled SPA missing", {})
    html = p.read_text(encoding="utf-8", errors="replace")
    urls = re.findall(r'(?:src|href)="(/assets/[^"]+)"', html)
    missing = [x for x in urls if not (root / "frontend/dist" / x.lstrip("/")).is_file()]
    return Check("FRONTEND_DIST", "PASS" if urls and not missing else "BLOCKED",
                 "Static entry references are present" if urls and not missing else "Static assets missing or not linked",
                 {"sha256": digest(p), "checked_assets": len(urls), "missing_assets": missing[:6]})


def verify_public(root: Path, url: str | None) -> Check:
    if not url:
        return Check("PUBLIC_DEMO", "WARN", "Provide --public-url to verify live HTTPS deployment", {})
    if not safe_url(url):
        return Check("PUBLIC_DEMO", "BLOCKED", "Public URL must be clean HTTPS with no query or credentials", {})
    try:
        with urlopen(Request(url, method="GET", headers={"User-Agent": "FireHarmony-Preflight/1.0"}), timeout=16) as r:
            payload = r.read(2 * 1024 * 1024)
            code = r.status
        sha = hashlib.sha256(payload).hexdigest()
        live_file = root / "frontend/dist/index.html"
        expected = digest(live_file) if live_file.is_file() else None
        matching = code == 200 and sha == expected
        return Check("PUBLIC_DEMO", "PASS" if matching else "BLOCKED",
                     "Live HTTPS matches deployed SPA entry" if matching else "Live HTTPS entry differs from local release",
                     {"http_status": code, "public_index_sha256": sha,
                      "local_index_sha256": expected})
    except Exception as e:
        return Check("PUBLIC_DEMO", "BLOCKED", "Live HTTPS unavailable",
                     {"exception": type(e).__name__})


def submission_evidence(root: Path, project_url: str | None,
                        video_url: str | None, repository_url: str | None) -> list[Check]:
    found = run_git(root, "remote", "-v") or ""
    remote_configured = bool(found.strip())
    checks = [Check(
        "SOURCE_REPOSITORY", "WARN" if safe_url(repository_url) else "BLOCKED",
        "Source repository URL provided; public access unverified"
        if safe_url(repository_url) else "No verifiable public source repository URL supplied",
        {"git_remote_configured": remote_configured, "requires_manual_access_check": True})]
    for name, value, label in [
        ("NASA_PROJECT_TAB", project_url, "NASA Project Tab"),
        ("DEMO_VIDEO", video_url, "submission video"),
    ]:
        acceptable = safe_url(value, allow_video_query=(name == "DEMO_VIDEO"))
        checks.append(Check(
            name, "WARN" if acceptable else "BLOCKED",
            label + " URL provided; manual portal confirmation still required"
            if acceptable else label + " link not provided or invalid",
            {"manual_confirmation_required": True}))
    dirty = run_git(root, "status", "--porcelain")
    checks.append(Check("SOURCE_WORKTREE", "PASS" if dirty == "" else "WARN",
                        "Git tree is clean" if dirty == "" else "Working tree includes ongoing development; freeze a release checkout",
                        {"git_available": dirty is not None, "dirty_paths_count": len(dirty.splitlines()) if dirty else 0}))
    submission_file = root / "docs/SUBMISSION.md"
    if submission_file.is_file():
        open_items = len(re.findall(r"(?m)^\s*- \[ \]", submission_file.read_text(encoding="utf-8")))
        checks.append(Check("SUBMISSION_CHECKLIST_PROGRESS", "WARN" if open_items else "PASS",
                            str(open_items) + " unconfirmed checklist items (not proof each task is incomplete)",
                            {"unchecked_items": open_items}))
    return checks


def audit(root: Path, *, public_url: str | None = None,
          project_url: str | None = None, video_url: str | None = None,
          repository_url: str | None = None) -> dict[str, Any]:
    checks = [
        *basic_files(root), verify_demo_pack(root),
        verify_benchmark(root), verify_model_alignment(root), verify_release(root),
        verify_public(root, public_url),
        *submission_evidence(root, project_url, video_url, repository_url),
    ]
    evaluations = {check.id: check for check in checks}
    saved_eval = evaluations["MODEL_EVAL"].evidence.get("artifact_sha256")
    aligned_eval = evaluations["MODEL_ARTIFACT_ALIGNMENT"].evidence.get("eval_sha256")
    if saved_eval and aligned_eval and saved_eval != aligned_eval:
        checks.append(Check(
            "MODEL_EVAL_SNAPSHOT_STABILITY", "BLOCKED",
            "Evaluation artifact changed between checks: retry on a frozen release snapshot",
            {"first_sha256": saved_eval, "later_sha256": aligned_eval}))
    counts = {x: sum(check.status == x for check in checks) for x in ("PASS", "WARN", "BLOCKED")}
    return {
        "audit": "FireHarmony 2026 NASA submission preflight",
        "checked_at_utc": datetime.now(timezone.utc).isoformat(),
        "root": str(root),
        "git_head": run_git(root, "rev-parse", "--short", "HEAD"),
        "counts": counts,
        "ready_for_submission": counts["BLOCKED"] == 0 and counts["WARN"] == 0,
        "disclaimer": "Machine checks are not NASA judging or proof of NASA Project Tab completion.",
        "checks": [asdict(x) for x in checks],
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    p.add_argument("--public-url", help="HTTPS website root; verification is GET-only")
    p.add_argument("--project-url", help="Official NASA project submission page")
    p.add_argument("--video-url", help="Accessible demonstration video")
    p.add_argument("--repository-url", help="Public source URL")
    p.add_argument("--output", type=Path, help="Optional JSON output (outside repository recommended)")
    p.add_argument("--soft-fail", action="store_true", help="Exit 0 for review even with blockers")
    args = p.parse_args(argv)
    result = audit(
        args.root.resolve(), public_url=args.public_url,
        project_url=args.project_url, video_url=args.video_url,
        repository_url=args.repository_url,
    )
    serialized = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized + "\n", encoding="utf-8")
    print(serialized)
    return 0 if args.soft_fail or result["counts"]["BLOCKED"] == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
