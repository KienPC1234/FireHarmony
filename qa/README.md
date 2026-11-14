# NASA2026 FireHarmony submission preflight

This is a **read-only** Python standard-library gate. It checks whether
submission claims have verifiable artifacts, without fetching FIRMS data,
rewriting model artifacts, mutating PM2, or modifying the official Project Tab.

From the project root:

```bash
.venv/bin/python -m unittest discover -s qa -p 'test_*.py' -v
.venv/bin/python qa/submission_preflight.py \
  --public-url https://kien-x99.tail6306c6.ts.net/ \
  --output /tmp/nasa2026-submission-preflight.json --soft-fail
```

When known, also pass `--repository-url`, `--project-url`, and `--video-url`
as clean HTTPS URLs (no userinfo, query parameters, or credentials). This only
confirms that those URLs were supplied. **Human review remains mandatory**
for the NASA portal, public access and the actual presentation.

Without `--soft-fail` the CLI exits 2 if any required evidence is blocked.
A PASS on a checksum proves integrity of a *packaged artifact*, not its
completeness or validity as Earth-observation ground truth. The evaluation
check recomputes pooled MAE/WAPE on the saved holdout rows, compares STAN
\`official\` metrics with eval-v4, and detects changes to evaluation files during
verification. Internal training metrics use a different protocol and cannot
replace official holdout results. This gate does **not** establish transfer
performance, calibration, or superiority
at the 95% confidence level. `0` detected hotspots and `null` missing
coverage must remain distinguishable in the submitted UI.

Outputs are JSON evidence receipts. Treat references to unknown NASA Project
Tab/video/repo URLs as **missing evidence**, not as proof they don't exist.
Run with `--soft-fail` during active collaborator writes and freeze a final
Git checkout for the definitive candidate.
