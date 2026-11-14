import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, describeError, type Aoi } from "@/lib/api";
import { ErrorState, Loading } from "@/components/states";

export function HomePage() {
  const [health, setHealth] = useState<string>("…");
  const [aois, setAois] = useState<Aoi[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.health().then((h) => setHealth(`${h.status} · torch=${h.torch}`)).catch((e) => setHealth(describeError(e)));
    api.aois().then((r) => {
      setAois(r.aois);
      r.aois.forEach((a) =>
        api.sample(5, a.id).then((s) => setCounts((c) => ({ ...c, [a.id]: s.count }))).catch(() => undefined),
      );
    }).catch(setError);
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

  if (error) return <ErrorState error={error} />;
  return (
    <div className="space-y-8">
      <section className="rounded-xl bg-gradient-to-br from-orange-600 to-red-800 p-8 text-white">
        <h1 className="text-3xl font-bold">Harmonized burning-activity calendar</h1>
        <p className="mt-2 max-w-3xl text-orange-100">
          MODIS (2000–, 1 km) và VIIRS (2012–, 375 m) không so sánh trực tiếp được —
          VIIRS thấy gấp ~3 lần. App chuẩn hóa cả hai về <b>độ nhạy VIIRS</b> trên lưới ngày 0.05°,
          vẽ một calendar duy nhất: tháng × năm + anomaly + CSV.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link className="rounded bg-white px-4 py-2 font-semibold text-orange-700" to="/calendar">Mở calendar →</Link>
          <Link className="rounded border border-white/60 px-4 py-2" to="/ask">Hỏi đáp AI</Link>
          <span className="ml-auto self-center text-sm text-orange-100">API: {health}</span>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">3 vùng cháy demo (số liệu tổng hợp, theo mùa cháy thật)</h2>
        {aois.length === 0 ? <Loading label="Đang tải vùng…" /> : (
        <div className="grid gap-3 md:grid-cols-3">
          {aois.map((a) => (
            <Link key={a.id} to="/calendar"
              className="rounded-lg border p-4 transition-shadow hover:shadow-md">
              <p className="font-mono text-xs uppercase text-orange-600">{a.id}</p>
              <p className="mt-1 text-sm">{a.label}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {counts[a.id] !== undefined ? `~${counts[a.id]}+ hotspots trong sample` : "…"}
              </p>
            </Link>
          ))}
        </div>
        )}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="font-semibold">Dùng CSV FIRMS của bạn</h2>
        <p className="text-sm text-muted-foreground">Tải từ FIRMS Area API rồi upload (tối đa 5000 dòng, xử lý tại chỗ).</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input type="file" accept=".csv" aria-label="FIRMS CSV"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="rounded bg-orange-600 px-4 py-2 text-white" onClick={onUpload}>Harmonize</button>
        </div>
        {result && <p className="mt-3 text-sm" role="status">{result}</p>}
      </section>
    </div>
  );
}
