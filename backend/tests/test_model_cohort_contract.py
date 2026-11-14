from pathlib import Path
import sys
import json
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "qa"))
from submission_preflight import Check, audit, verify_protocol_cohorts
from app.routers.models import _hts_candidate_status


def _fixture(tmp_path: Path, served_n: int = 72, model_n: int = 60) -> Path:
    base = tmp_path / "backend" / "data" / "firms" / "models"
    base.mkdir(parents=True)
    payloads = {
        "evaluation_raw.json": {
            "n_eval": served_n, "samples": [{} for _ in range(served_n)]},
        "stan_safe_raw.json": {"official": {
            "n": model_n, "metrics": {"n": model_n},
            "per_aoi": {a: {"stan": {"n": model_n // 3}}
                        for a in ("vietnam", "amazon", "australia")}}},
        "hts_anchor_raw.json": {
            "n_test": model_n, "metrics": {"n": model_n},
            "per_aoi": {a: {"n": model_n // 3}
                        for a in ("vietnam", "amazon", "australia")}},
    }
    for name, content in payloads.items():
        (base / name).write_text(json.dumps(content), encoding="utf-8")
    return tmp_path


def test_model_specific_60_and_served_72_are_not_falsely_equated(tmp_path):
    root = _fixture(tmp_path)
    result = verify_protocol_cohorts(root)
    assert result.status == "WARN"
    assert result.evidence["sample_counts"] == {
        "served_series": 72, "stan_model_specific": 60, "hts_model_specific": 60}
    assert "do not compare" in result.detail


def test_matching_cohorts_pass(tmp_path):
    result = verify_protocol_cohorts(_fixture(tmp_path, 60, 60))
    assert result.status == "PASS"


def test_internal_protocol_count_disagreement_blocks(tmp_path):
    root = _fixture(tmp_path)
    p = root / "backend/data/firms/models/hts_anchor_raw.json"
    d = json.loads(p.read_text())
    d["metrics"]["n"] = 61
    p.write_text(json.dumps(d))
    result = verify_protocol_cohorts(root)
    assert result.status == "BLOCKED"
    assert result.evidence["problems"]


def test_candidate_status_uses_metrics_not_stale_text():
    meta = {"hts_mae": 3731.957, "b2_mae": 3503.6494,
            "gate": {"passed": False},
            "status": "candidate: consistent point gain, CI includes 0"}
    assert "underperforms" in _hts_candidate_status(meta)
    assert "improves" in _hts_candidate_status(
        {"hts_mae": 3400, "b2_mae": 3500, "gate": {"passed": False}})
    assert "validation gate passed" in _hts_candidate_status(
        {"hts_mae": 3400, "b2_mae": 3500, "gate": {"passed": True}})


def test_preflight_detects_artifact_replaced_between_checks(tmp_path, monkeypatch):
    import submission_preflight as mod
    monkeypatch.setattr(mod, "basic_files", lambda root: [])
    monkeypatch.setattr(mod, "verify_demo_pack", lambda root: Check("DEMO_PACK", "PASS", "", {}))
    monkeypatch.setattr(mod, "verify_benchmark", lambda root: Check(
        "MODEL_EVAL", "PASS", "", {"artifact_sha256": "earlier"}))
    monkeypatch.setattr(mod, "verify_model_alignment", lambda root: Check(
        "MODEL_ARTIFACT_ALIGNMENT", "PASS", "",
        {"artifact_sha256": {"evaluation": "later"}}))
    monkeypatch.setattr(mod, "verify_protocol_cohorts", lambda root: Check(
        "MODEL_PROTOCOL_COHORTS", "PASS", "", {}))
    monkeypatch.setattr(mod, "verify_release", lambda root: Check(
        "FRONTEND_DIST", "PASS", "", {}))
    monkeypatch.setattr(mod, "verify_public", lambda root, url: Check(
        "PUBLIC_DEMO", "PASS", "", {}))
    monkeypatch.setattr(mod, "submission_evidence", lambda *args: [])
    monkeypatch.setattr(mod, "run_git", lambda *args: "frozen")
    result = audit(tmp_path)
    assert result["ready_for_submission"] is False
    assert any(c["id"] == "MODEL_EVAL_SNAPSHOT_STABILITY"
               and c["status"] == "BLOCKED" for c in result["checks"])
