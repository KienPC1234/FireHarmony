import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, describeError, type CalendarResponse } from "@/lib/api";

function colorFor(z: number): string {
  if (z >= 3) return "bg-red-700 text-white";
  if (z >= 2) return "bg-red-500 text-white";
  if (z >= 1) return "bg-orange-300";
  if (z <= -1.5) return "bg-blue-300";
  if (z <= -0.75) return "bg-blue-100";
  return "bg-amber-100";
}

const DEFAULT_BBOX = "104,10,109,16";

export function CalendarPage() {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState("");
  const [bbox, setBbox] = useState(DEFAULT_BBOX);
  const [applied, setApplied] = useState(DEFAULT_BBOX);

  useEffect(() => {
    setData(null);
    setError("");
    api.calendar(25000, applied).then(setData).catch((e) => setError(describeError(e)));
  }, [applied]);

  const yearly = useMemo(
    () => (data ? data.calendar.years.map((y, i) => ({ year: y, fires: data.calendar.row_totals[i] })) : []),
    [data],
  );
  const csvHref = useMemo(() => api.exportUrl(25000, applied), [applied]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p>Loading calendar…</p>;
  const L = data.latest;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">Burning-activity calendar</h1>
        <a className="ml-auto rounded border px-3 py-2 text-sm" href={csvHref} download>
          Download harmonized CSV
        </a>
      </div>
      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border p-3"
        onSubmit={(e) => { e.preventDefault(); setApplied(bbox); }}
      >
        <label className="text-sm">Area of interest (minLon,minLat,maxLon,maxLat)
          <input value={bbox} onChange={(e) => setBbox(e.target.value)}
            className="ml-2 rounded border px-2 py-1 font-mono text-sm" size={24} aria-label="Bounding box" />
        </label>
        <button className="rounded bg-orange-600 px-3 py-1 text-white" type="submit">Apply</button>
        <span className="text-sm text-muted-foreground">{data.daily_cells} daily cells{data.bbox ? ` in ${data.bbox}` : ""}</span>
      </form>
      {L && (
        <div className="rounded-lg border p-3" role="status">
          <b>Latest vs history:</b> {L.date} (month {L.month}) had {L.month_total} harmonized fires
          vs a historical median of {L.hist_median} for that month
          {L.ratio !== null && <> (×{L.ratio})</>} — <b>{L.verdict.replace("_", " ")}</b>.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="border-collapse text-center text-sm">
          <thead>
            <tr><th className="p-1" />{data.calendar.months.map((m) => <th key={m} className="p-1">{m}</th>)}
              <th className="p-1">Total</th></tr>
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
      <div>
        <h2 className="font-semibold">Yearly totals (harmonized)</h2>
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
