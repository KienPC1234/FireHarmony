import { api } from "@/lib/api";

export function AboutPage() {
  return (
    <div className="prose max-w-3xl">
      <h1>About &amp; data</h1>
      <p>
        Challenge: <i>Harmonization of MODIS and VIIRS Hot Spots</i> (NASA Space Apps 2026).
        Target users: early-warning and emergency responders, scientists, land managers.
      </p>
      <ul>
        <li>Sources: NASA FIRMS active-fire CSV (MODIS C6.1 NRT, VIIRS 375 m V2 NRT) via the FIRMS Area API. Get a free MAP_KEY, then <code>python -m scripts.firms.fetch_firms --help</code>.</li>
        <li>Sample: <code>backend/data/firms/samples/firms_sample.csv</code> — deterministic synthetic Vietnam dry-season data for offline demo; real FIRMS CSV drops in without code changes.</li>
        <li>Outputs: harmonized calendar matrix, per-month anomalies, critical-period ranking, downloadable <a href={api.exportUrl()}>harmonized_hotspots.csv</a>.</li>
        <li>Limits: 0.05° grid hides sub-village detail; ratio fallback 0.35 when a month has &lt;5 overlap days; overpass-time and cloud-cover biases are reduced, not removed. Check the Method page before citing a number.</li>
      </ul>
      <p>Backup of the previous project: <code>/data/backup_AlphaCentauriAB_20261109/</code> (history.bundle + worktree-gon.tar.gz + SHA256SUMS).</p>
    </div>
  );
}
