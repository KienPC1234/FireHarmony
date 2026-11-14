import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Aoi, type CalendarResponse } from "@/lib/api";
import { EmptyState, ErrorState, Loading } from "@/components/states";

function colorFor(z: number): string {
  if (z >= 3) return "bg-red-700 text-white";
  if (z >= 2) return "bg-red-500 text-white";
  if (z >= 1) return "bg-orange-300";
  if (z <= -1.5) return "bg-blue-300";
  if (z <= -0.75) return "bg-blue-100";
  return "bg-amber-100";
}

const LEGEND: Array<[string, string]> = [
  ["bg-red-700 text-white", "z ≥ 3 cực đoan"],
  ["bg-red-500 text-white", "z ≥ 2 bất thường"],
  ["bg-orange-300", "z ≥ 1 trên TB"],
  ["bg-amber-100", "quanh median"],
  ["bg-blue-100", "z ≤ −0.75 dưới TB"],
  ["bg-blue-300", "z ≤ −1.5 thấp hẳn"],
];

const AOI_BBOX: Record<string, string> = {
  vietnam: "104,10,109,16",
  amazon: "-70,-12,-50,3",
  australia: "113,-39,153,-12",
};

export function CalendarPage() {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [aois, setAois] = useState<Aoi[]>([]);
  const [aoi, setAoi] = useState("vietnam");
  const [bbox, setBbox] = useState(AOI_BBOX.vietnam);
  const [applied, setApplied] = useState<{ bbox: string; aoi: string }>({ bbox: AOI_BBOX.vietnam, aoi: "vietnam" });

  useEffect(() => {
    api.aois().then((r) => setAois(r.aois)).catch(() => undefined);
  }, []);
  useEffect(() => {
    setData(null);
    setError(null);
    api.calendar(25000, applied.bbox || undefined, applied.aoi).then(setData).catch(setError);
  }, [applied]);

  const yearly = useMemo(
    () => (data ? data.calendar.years.map((y, i) => ({ year: y, fires: data.calendar.row_totals[i] })) : []),
    [data],
  );
  const csvHref = useMemo(() => api.exportUrl(25000, applied.bbox || undefined, applied.aoi), [applied]);
  if (error) return <ErrorState error={error} onRetry={() => setApplied({ ...applied })} />;
  if (!data) return <Loading label="Đang harmonize…" />;
  const L = data.latest;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold">Burning-activity calendar</h1>
        <a className="ml-auto rounded border px-3 py-2 text-sm" href={csvHref} download>
          Download harmonized CSV
        </a>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Preset regions">
        {(aois.length ? aois : [{ id: "vietnam", label: "Vietnam" }]).map((a) => (
          <button
            key={a.id}
            title={a.label}
            onClick={() => { setAoi(a.id); const b = AOI_BBOX[a.id] ?? ""; setBbox(b); setApplied({ bbox: b, aoi: a.id }); }}
            className={`rounded-full border px-3 py-1 text-sm ${aoi === a.id ? "bg-orange-600 text-white" : "hover:bg-accent"}`}
          >
            {a.id}
          </button>
        ))}
      </div>
      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border p-3"
        onSubmit={(e) => { e.preventDefault(); setApplied({ bbox, aoi }); }}
      >
        <label className="text-sm">Vùng quan tâm (minLon,minLat,maxLon,maxLat)
          <input value={bbox} onChange={(e) => setBbox(e.target.value)}
            className="ml-2 rounded border px-2 py-1 font-mono text-sm" size={24} aria-label="Bounding box" />
        </label>
        <button className="rounded bg-orange-600 px-3 py-1 text-white" type="submit">Apply</button>
        <span className="text-sm text-muted-foreground">{data.daily_cells} daily cells</span>
      </form>
      {L && (
        <div className="rounded-lg border-l-4 border-orange-600 bg-accent/50 p-3" role="status">
          <b>Tháng mới nhất {L.date}:</b> {L.month_total} vụ (quy đổi VIIRS) vs median lịch sử cùng tháng {L.hist_median}
          {L.ratio !== null && <> (×{L.ratio})</>} — <b>{L.verdict.replace("_", " ")}</b>.
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-xs" aria-label="Chú thích màu">
        {LEGEND.map(([cls, label]) => (
          <span key={label} className={`rounded px-2 py-1 ${cls}`}>{label}</span>
        ))}
      </div>
      {data.calendar.years.length === 0 ? <EmptyState message="Không có hotspot nào trong vùng này." /> : (
      <div className="overflow-x-auto rounded-lg border">
        <table className="border-collapse text-center text-sm">
          <thead className="sticky top-0">
            <tr><th className="p-1" />{data.calendar.months.map((m) => <th key={m} className="bg-background p-1">{m}</th>)}
              <th className="bg-background p-1">Total</th></tr>
          </thead>
          <tbody>
            {data.calendar.years.map((y, yi) => (
              <tr key={y}>
                <th className="p-1 text-left">{y}</th>
                {data.calendar.months.map((m, mi) => (
                  <td key={m} title={`${y}-${m}: ${data.calendar.matrix[yi][mi]} (z=${data.calendar.anomalies[yi][mi]})`}
                    className={`border p-2 ${colorFor(data.calendar.anomalies[yi][mi])}`}>
                    {data.calendar.matrix[yi][mi]}
                  </td>
                ))}
                <td className="p-1 font-semibold">{data.calendar.row_totals[yi]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <div>
        <h2 className="font-semibold">Yearly totals (VIIRS-equivalent)</h2>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={yearly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="fires" fill="#ea580c" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <h2 className="font-semibold">Critical periods (|z| ≥ 2)</h2>
        <ul className="list-disc pl-6 text-sm">
          {data.critical_periods.map((p) => (
            <li key={`${p.year}-${p.month}`}>{p.year}-{String(p.month).padStart(2, "0")}: {p.count} fires, z={p.z} ({p.label})</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
