"""Generate the model-card metrics block from evaluation_raw.json.

Audit V5 P0-03: documentation numbers drifted from the artifact. This script
is the only writer of the block between the markers; `--check` fails CI when
the docs no longer match the manifest.

    python -m scripts.firms.render_docs            # update model card
    python -m scripts.firms.render_docs --check    # verify (CI)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.firms import evaluation  # noqa: E402

DOC = BACKEND.parent / "docs" / "FIRMS_MODEL_CARD.md"
README = BACKEND.parent / "README.md"
BEGIN = "<!-- BEGIN GENERATED METRICS -->"
END = "<!-- END GENERATED METRICS -->"
README_BEGIN = "<!-- BEGIN GENERATED README METRICS -->"
README_END = "<!-- END GENERATED README METRICS -->"


def _table(metrics: dict, title: str) -> list[str]:
    rows = [f"**{title}**", "",
            "| Method | MAE | WAPE | Bias | n |",
            "|---|---:|---:|---:|---:|"]
    for method, m in metrics.items():
        rows.append(f"| `{method}` | {m['mae']:.1f} | {m['wape']:.3f} | "
                    f"{m['bias']:+.1f} | {m['n']} |")
    return rows


def build(manifest: dict) -> str:
    per = manifest.get("per_aoi") or {}
    pooled = (manifest.get("pooled") or {}).get("metrics") or {}
    # Only methods that actually have a pooled metric enter the per-AOI table;
    # artifact-backed methods (STAN/HTS/spatial) are raw-only.
    methods = [m for m in manifest.get("methods", []) if m in pooled]
    coverage = {a: (i.get("coverage") or {}) for a, i in per.items()}
    lines = [
        BEGIN,
        f"_Generated from `evaluation_{manifest.get('data', 'raw')}.json` · "
        f"`{manifest.get('evaluation_version')}` · "
        f"pair_table_hash `{manifest.get('pair_table_hash') or manifest.get('dataset_sha256')}`._",
        "",
        f"Candidate holdout years: `{manifest.get('candidate_holdout_years')}` · "
        f"scored years: `{manifest.get('scored_years')}` · "
        f"excluded months (no 12-month context): `{manifest.get('excluded_months')}`.",
        "",
    ]
    headline = manifest.get("headline") or {}
    lines += _table(headline.get("metrics") or {},
                    f"Headline — full-month AOIs only {headline.get('aois')} "
                    f"(n={headline.get('n_eval')})")
    lines += ["", f"_{headline.get('why', '')}_", ""]
    lines += _table((manifest.get("pooled") or {}).get("metrics") or {},
                    f"All-AOI pooled (n={(manifest.get('pooled') or {}).get('n_eval')})")
    lines += ["", "| AOI | coverage class | months ≥90% paired days | months |",
              "|---|---|---:|---:|"]
    for a, c in coverage.items():
        lines.append(f"| {a} | {per[a].get('coverage_class')} | "
                     f"{c.get('full_months')} | {c.get('months')} |")
    comp = manifest.get("comparisons") or {}
    if comp:
        lines += ["", "| comparison | ΔMAE (A−B) | 95% bootstrap CI | P(A better) | n |",
                  "|---|---:|---|---:|---:|"]
        for name, c in comp.items():
            lines.append(f"| {name} | {c['delta_mae']:+.1f} | "
                         f"[{c['ci95'][0]:+.1f}, {c['ci95'][1]:+.1f}] | "
                         f"{c['prob_a_better']:.2f} | {c['n']} |")
        lines += ["", "_Bootstrap unit: AOI-month block; it is not a claim of "
                  "independent hotspot observations._"]
    wf = [(a, (i.get("hgb_gate") or {}).get("folds") or [])
          for a, i in per.items()]
    wf = [(a, f) for a, f in wf if f]
    if wf:
        lines += ["", "**Walk-forward HGB gate folds (expanding window, count MAE)**", "",
                  "| AOI | test year | B1 | B2 | residual |", "|---|---:|---:|---:|---:|"]
        for a, folds in wf:
            for f in folds:
                lines.append(f"| {a} | {f.get('test_year')} | {f.get('b1_mae')} | "
                             f"{f.get('b2_mae')} | {f.get('residual_mae')} |")
    lines += ["", "**Per-AOI metrics**", "",
              "| AOI | " + " | ".join(methods) + " |",
              "|---|" + "---:|" * len(methods)]
    for a, info in per.items():
        m = info.get("metrics") or {}
        cells = [str(round(m.get(k, {}).get("mae", float("nan")), 1)) for k in methods]
        lines.append(f"| {a} | " + " | ".join(cells) + " |")
    lines.append(END)
    return "\n".join(lines)


def build_readme(manifest: dict) -> str:
    head = manifest.get("headline") or {}
    metrics = head.get("metrics") or {}
    primary = manifest.get("primary_method_id") or "stan_safe_v1"
    lines = [README_BEGIN,
             f"_Generated from `evaluation_{manifest.get('data', 'raw')}.json` "
             f"({manifest.get('evaluation_version')}); headline = full-month AOIs "
             f"{head.get('aois')}, n={head.get('n_eval')}. "
             f"Primary: `{primary}`._", "",
             "| Method | MAE (headline) |", "|---|---:|"]
    for k, v in metrics.items():
        lines.append(f"| `{k}` | {v['mae']:.1f} |")
    comp = (manifest.get("comparisons") or {}).get("stan_vs_b2") or \
        (manifest.get("comparisons") or {}).get("hgb_vs_b2")
    if comp:
        lines.append("")
        lines.append(f"`{comp['method_a']}` − `{comp['method_b']}` ΔMAE "
                     f"{comp['delta_mae']:+.1f}, 95% CI "
                     f"[{comp['ci95'][0]:+.1f}, {comp['ci95'][1]:+.1f}] — "
                     + ("CI excludes 0." if comp['ci95'][1] < 0
                        else "CI includes 0, so the gain is not established."))
    lines.append(README_END)
    return "\n".join(lines)


def _replace(text: str, begin: str, end: str, block: str) -> str:
    head, rest = text.split(begin, 1)
    _, tail = rest.split(end, 1)
    return head + block + tail


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    return run(a.check)


def run(check: bool = False) -> int:
    manifest = evaluation.load_manifest("raw")
    if not manifest:
        print("no evaluation_raw.json")
        return 2
    generated = build(manifest)
    readme_block = build_readme(manifest)
    files = [(DOC, BEGIN, END, generated),
             (README, README_BEGIN, README_END, readme_block)]
    bad = 0
    for path, begin, end, block in files:
        text = path.read_text(encoding="utf-8")
        if begin not in text or end not in text:
            print(f"markers missing in {path}")
            bad += 1
            continue
        current = _replace(text, begin, end, text.split(begin, 1)[1].split(end, 1)[0].join([begin, end]))
        expected = _replace(text, begin, end, block)
        if check:
            if current != expected:
                print(f"DOCS METRICS MISMATCH {path}")
                bad += 1
        else:
            path.write_text(expected, encoding="utf-8")
            print("updated", path)
    if check:
        print("DOCS METRICS " + ("OK" if bad == 0 else "MISMATCH"))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
