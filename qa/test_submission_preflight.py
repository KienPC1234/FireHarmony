"""Offline unit tests for FireHarmony submission evidence gates (stdlib only)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from submission_preflight import (  # noqa: E402
    basic_files, safe_url, submission_evidence, verify_benchmark,
    verify_demo_pack, verify_model_alignment, verify_release,
)


def hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class SubmissionPreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def path(self, relative: str, data: str | bytes) -> Path:
        f = self.root / relative
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))
        return f

    def seed_demo(self) -> Path:
        data = b"latitude,longitude\n10.5,104.2\n"
        name = "vietnam_demo.csv"
        self.path("backend/data/firms/demo_pack/raw/" + name, data)
        sha = hash_bytes(data)
        combined = hash_bytes(sha.encode())
        manifest = {
            "aoi": "vietnam", "months": 1, "files": 1, "rows": 1,
            "bytes": len(data), "checksum_sha256": combined,
            "observation_coverage": "unknown",
            "entries": [{
                "name": name, "bytes": len(data), "rows": 1, "month": "2024-01",
                "sha256": sha,
            }],
        }
        return self.path("backend/data/firms/demo_pack/manifest.json", json.dumps(manifest))

    def seed_eval(self) -> Path:
        e = {
            "evaluation_version": "eval-v4", "n_eval": 2,
            "methods": ["b2_seasonal_ratio", "stan_safe_v1"],
            "samples": [
                {"viirs_ref": 10, "b2_seasonal_ratio": 8, "stan_safe_v1": 9},
                {"viirs_ref": 20, "b2_seasonal_ratio": 18, "stan_safe_v1": 21},
            ],
            "pooled": {"n_eval": 2, "metrics": {
                "b2_seasonal_ratio": {"mae": 2.0, "wape": 4 / 30, "bias": -2, "n": 2},
                "stan_safe_v1": {"mae": 1.0, "wape": 2 / 30, "bias": 0, "n": 2},
            }},
        }
        return self.path("backend/data/firms/models/evaluation_raw.json", json.dumps(e))

    def seed_alignment(self):
        samples = [
            {"id": "amazon:2024-01", "aoi": "amazon", "year": 2024, "month": 1,
             "viirs_ref": 10.0, "b2_seasonal_ratio": 8.0,
             "stan_safe_v1": 9.0, "hts_anchor_v1": 8.5},
            {"id": "amazon:2024-02", "aoi": "amazon", "year": 2024, "month": 2,
             "viirs_ref": 20.0, "b2_seasonal_ratio": 18.0,
             "stan_safe_v1": 19.0, "hts_anchor_v1": 18.5},
        ]
        self.path("backend/data/firms/models/evaluation_raw.json", json.dumps({
            "evaluation_version": "eval-v4", "n_eval": 2, "samples": samples,
        }))
        self.path("backend/data/firms/models/stan_series_raw.json", json.dumps({
            "dataset_sha256": "shared-tile-sha",
            "series": {"amazon": {
                "2024-01": {"target": 9.0},
                "2024-02": {"target": 19.0},
            }},
        }))
        self.path("backend/data/firms/models/hts_series_raw.json", json.dumps({
            "dataset_sha256": "shared-tile-sha",
            "series": {"amazon": {
                "2024-01": {"hts": 8.5, "b2": 8.0, "viirs": 10.0},
                "2024-02": {"hts": 18.5, "b2": 18.0, "viirs": 20.0},
            }},
        }))
        # Model-sidecar metrics use a distinct training protocol; deliberately
        # different values must not invalidate the served-series evaluation.
        self.path("backend/data/firms/models/stan_safe_raw.json", json.dumps({
            "dataset_sha256": "shared-tile-sha",
            "official": {"metrics": {"mae": 999.0}},
        }))
        self.path("backend/data/firms/models/hts_anchor_raw.json", json.dumps({
            "dataset_sha256": "shared-tile-sha",
            "metrics": {"mae": 888.0},
        }))

    def test_correct_demo_pack_passes(self):
        self.seed_demo()
        result = verify_demo_pack(self.root)
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.evidence["rows"], 1)

    def test_demo_pack_mutation_detected(self):
        self.seed_demo()
        self.path("backend/data/firms/demo_pack/raw/vietnam_demo.csv",
                  "latitude,longitude\n10.5,104.3\n")
        result = verify_demo_pack(self.root)
        self.assertEqual(result.status, "BLOCKED")
        self.assertTrue(result.evidence["errors"])

    def test_demo_pack_traversal_rejected(self):
        m = self.seed_demo()
        data = json.loads(m.read_text())
        data["entries"][0]["name"] = "../outside.csv"
        m.write_text(json.dumps(data))
        result = verify_demo_pack(self.root)
        self.assertEqual(result.status, "BLOCKED")

    def test_metrics_recomputed_and_checked(self):
        self.seed_eval()
        result = verify_benchmark(self.root)
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.evidence["eval_rows"], 2)

    def test_metrics_fabrication_detected(self):
        p = self.seed_eval()
        data = json.loads(p.read_text())
        data["pooled"]["metrics"]["stan_safe_v1"]["mae"] = 0
        p.write_text(json.dumps(data))
        result = verify_benchmark(self.root)
        self.assertEqual(result.status, "BLOCKED")
        self.assertIn("stan_safe_v1", result.evidence["mismatches"])

    def test_served_series_aligns_to_eval_manifest(self):
        self.seed_alignment()
        result = verify_model_alignment(self.root)
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.evidence["eval_rows"], 2)
        self.assertEqual(result.evidence["dataset_lineage"]["stan_model"], "shared-tile-sha")

    def test_served_series_prediction_mismatch_blocks_submission(self):
        self.seed_alignment()
        p = self.root / "backend/data/firms/models/stan_series_raw.json"
        obj = json.loads(p.read_text())
        obj["series"]["amazon"]["2024-01"]["target"] = 9.5
        p.write_text(json.dumps(obj))
        result = verify_model_alignment(self.root)
        self.assertEqual(result.status, "BLOCKED")
        self.assertIn("amazon:2024-01.stan_safe_v1", result.evidence["mismatches"])

    def test_model_lineage_mismatch_blocks_submission(self):
        self.seed_alignment()
        p = self.root / "backend/data/firms/models/hts_anchor_raw.json"
        obj = json.loads(p.read_text())
        obj["dataset_sha256"] = "different-tile-sha"
        p.write_text(json.dumps(obj))
        result = verify_model_alignment(self.root)
        self.assertEqual(result.status, "BLOCKED")
        self.assertIn("dataset_lineage", result.evidence["mismatches"])

    def test_missing_artifacts_are_blockers(self):
        self.assertEqual(verify_demo_pack(self.root).status, "BLOCKED")
        self.assertEqual(verify_benchmark(self.root).status, "BLOCKED")
        self.assertEqual(verify_release(self.root).status, "BLOCKED")

    def test_spa_asset_identity(self):
        p = self.path("frontend/dist/index.html", '<script src="/assets/app.js"></script>')
        self.assertEqual(verify_release(self.root).status, "BLOCKED")
        self.path("frontend/dist/assets/app.js", b"console.log('public');")
        result = verify_release(self.root)
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.evidence["sha256"], hash_bytes(p.read_bytes()))

    def test_clean_public_urls_without_secrets(self):
        self.assertTrue(safe_url("https://example.org/project"))
        self.assertFalse(safe_url("http://example.org"))
        self.assertFalse(safe_url("https://user:secret@example.org/"))
        self.assertFalse(safe_url("https://example.org/?api_key=secret"))
        self.assertFalse(safe_url("https://127.0.0.1/"))
        self.assertFalse(safe_url("https://192.168.1.12/"))
        self.assertFalse(safe_url("https://localhost/"))
        self.assertFalse(safe_url("https://example.org/#fragment"))
        self.assertTrue(safe_url("https://www.youtube.com/watch?v=example", allow_video_query=True))
        self.assertFalse(safe_url("https://www.youtube.com/watch?key=secret", allow_video_query=True))
        self.assertFalse(safe_url(None))

    def test_supplied_url_is_still_manual_verification(self):
        checks = submission_evidence(
            self.root,
            "https://www.spaceappschallenge.org/2026/find-a-team/",
            "https://example.org/video",
            "https://example.org/source",
        )
        self.assertEqual({x.id: x.status for x in checks}["SOURCE_REPOSITORY"], "WARN")
        self.assertEqual({x.id: x.status for x in checks}["NASA_PROJECT_TAB"], "WARN")
        self.assertEqual({x.id: x.status for x in checks}["DEMO_VIDEO"], "WARN")

    def test_missing_portal_video_and_repository_not_marked_ready(self):
        checks = submission_evidence(self.root, None, None, None)
        by_id = {x.id: x for x in checks}
        for name in ("SOURCE_REPOSITORY", "NASA_PROJECT_TAB", "DEMO_VIDEO"):
            self.assertEqual(by_id[name].status, "BLOCKED")
        self.assertNotIn("password", repr(checks))


if __name__ == "__main__":
    unittest.main()
