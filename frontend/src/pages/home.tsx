import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, describeError } from "@/lib/api";

export function HomePage() {
  const [health, setHealth] = useState<string>("…");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string>("");

  useEffect(() => {
    api.health().then((h) => setHealth(`${h.status} · torch=${h.torch}`)).catch((e) => setHealth(describeError(e)));
  }, []);

  async function onUpload() {
    if (!file) return;
    const text = await file.text();
    const [header, ...lines] = text.trim().split("\n");
    const cols = header.split(",").map((c) => c.trim().toLowerCase());
    const records = lines.slice(0, 5000).map((ln) => {
      const cells = ln.split(",");
      return Object.fromEntries(cols.map((c, i) => [c, cells[i]?.trim()]));
    });
    try {
      const v = await api.validate(records);
      const h = await api.harmonize(records);
      setResult(`Clean ${v.clean}, rejected ${v.rejected}. Cells ${h.daily_cells}. ` +
        `Critical: ${h.critical_periods.slice(0, 3).map((p) => `${p.year}-${p.month}(z=${p.z})`).join(", ") || "none"}`);
    } catch (e) {
      setResult(describeError(e));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Harmonized burning-activity calendar</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          MODIS (2000–, 1 km) and VIIRS (2012–, 375 m) hot spots cannot be compared directly —
          VIIRS sees ~3× more fires. Upload a NASA FIRMS CSV and this app calibrates VIIRS
          to MODIS-equivalent counts on a 0.05° daily grid, then renders one calendar:
          month × year with anomalies against history. API: <code>{health}</code>
        </p>
      </div>
      <div className="rounded-lg border p-4">
        <h2 className="font-semibold">1. Try your own FIRMS CSV</h2>
        <p className="text-sm text-muted-foreground">Download from FIRMS Area API, then upload here (max 5000 rows, all local).</p>
        <div className="mt-3 flex gap-2">
          <input type="file" accept=".csv" aria-label="FIRMS CSV"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="rounded bg-orange-600 px-4 py-2 text-white" onClick={onUpload}>Harmonize</button>
        </div>
        {result && <p className="mt-3 text-sm" role="status">{result}</p>}
      </div>
      <div className="rounded-lg border p-4">
        <h2 className="font-semibold">2. Or explore the sample calendar</h2>
        <p className="text-sm text-muted-foreground">Deterministic Vietnam dry-season sample, MODIS 2001–2025 + VIIRS 2012–2025, with a planted 2019 anomaly.</p>
        <Link className="mt-2 inline-block rounded bg-zinc-900 px-4 py-2 text-white" to="/calendar">Open calendar →</Link>
      </div>
    </div>
  );
}
