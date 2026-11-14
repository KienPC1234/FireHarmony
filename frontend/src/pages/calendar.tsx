import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart } from "recharts";
import { api, type Aoi, type CalendarResponse } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { EmptyState, ErrorState, Loading } from "@/components/states";
import { AoiMap } from "@/components/AoiMap";

function colorFor(z: number | null): string {
  if (z === null || z === undefined) return "bg-muted text-muted-foreground";
  if (z >= 3) return "bg-red-700 text-white";
  if (z >= 2) return "bg-red-500 text-white";
  if (z >= 1) return "bg-orange-300";
  if (z <= -1.5) return "bg-blue-300";
  if (z <= -0.75) return "bg-blue-100";
  return "bg-amber-100";
}

const AOI_CENTER: Record<string, { c: [number, number]; z: number }> = {
  vietnam: { c: [13, 106.5], z: 6 },
  amazon: { c: [-4, -60], z: 4 },
  australia: { c: [-26, 133], z: 4 },
};

const AOI_BBOX: Record<string, string> = {
  vietnam: "104,10,109,16",
  amazon: "-70,-12,-50,3",
  australia: "113,-39,153,-12",
};

export function CalendarPage() {
  const { t } = useLang();
  const LEGEND: Array<[string, string]> = [
    ["bg-red-700 text-white", "z ≥ 3 extreme"],
    ["bg-red-500 text-white", "z ≥ 2 anomalous"],
    ["bg-orange-300", "z ≥ 1 above"],
    ["bg-amber-100", "near median"],
    ["bg-blue-100", "z ≤ −0.75 below"],
    ["bg-blue-300", "z ≤ −1.5 low"],
    ["bg-muted text-muted-foreground", t("cal.nodata")],
  ];
  const [search] = useSearchParams();
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [aois, setAois] = useState<Aoi[]>([]);
  const [aoi, setAoi] = useState(search.get("aoi") || "vietnam");
  const [bbox, setBbox] = useState(AOI_BBOX[search.get("aoi") || "vietnam"] ?? AOI_BBOX.vietnam);
  const [dsrc, setDsrc] = useState("sample");
  const [method, setMethod] = useState("stat");
  const [exportStatus, setExportStatus] = useState("");
  const [applied, setApplied] = useState<{ bbox: string; aoi: string; data: string; method: string }>(
    { bbox: AOI_BBOX[search.get("aoi") || "vietnam"] ?? AOI_BBOX.vietnam, aoi: search.get("aoi") || "vietnam", data: "sample", method: "stat" });

  useEffect(() => {
    api.aois().then((r) => setAois(r.aois)).catch(() => undefined);
  }, []);
  useEffect(() => {
    setData(null);
    setError(null);
    api.calendar(25000, applied.bbox || undefined, applied.aoi, applied.data, applied.method).then(setData).catch(setError);
  }, [applied]);

  const yearly = useMemo(
    () => (data ? data.calendar.years.map((y, i) => ({ year: y, detections: data.calendar.row_totals[i] })) : []),
    [data],
  );
  const csvHref = useMemo(() => api.exportUrl(25000, applied.bbox || undefined, applied.aoi, applied.data, applied.method), [applied]);
  const briefHref = useMemo(() => api.briefUrl(applied.bbox || undefined, applied.aoi, applied.data, applied.method), [applied]);

  async function handleExport() {
    setExportStatus("");
    try {
      const res = await fetch(csvHref);
      if (!res.ok) {
        const text = await res.text();
        setExportStatus(text || `${res.status} ${res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `harmonized_hotspots_${applied.aoi}_${applied.data}_${applied.method}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportStatus(e instanceof Error ? e.message : String(e));
    }
  }

  const reliability = useMemo(() => {
    const comp = data?.calendar.completeness;
    if (!comp) return null;
    const keys = Object.keys(comp).sort();
    if (keys.length === 0) return null;
    const partials = keys.filter((k) => comp[k].partial);
    return { total: keys.length, full: keys.length - partials.length, partials: partials.map((k) => ({ key: k, days: comp[k].days })) };
  }, [data]);
  const clima = useMemo(() => {
    if (!data) return [];
    const last = data.calendar.matrix[data.calendar.matrix.length - 1] ?? [];
    return data.calendar.months.map((m, mi) => {
      const med = data.calendar.col_medians[mi];
      const lv = last[mi];
      return { month: m, median: med, latest: lv };
    }).filter((p) => p.median !== null);
  }, [data]);
  if (error) return <ErrorState error={error} onRetry={() => setApplied({ ...applied })} />;
  if (!data) return <Loading label={t("cal.loading")} />;
  const L = data.latest;
  const F = data.forecast;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold">{t("cal.title")}</h1>
        <span className="rounded bg-amber-100 px-2 py-1 font-mono text-xs text-amber-900">{data.data_source ?? t("common.synthetic")}</span>
        <div className="ml-auto flex flex-wrap gap-2">
        <button className="rounded border px-3 py-2 text-sm" onClick={handleExport} type="button">
          {t("cal.csv")}
        </button>
        <a className="rounded border px-3 py-2 text-sm" href={briefHref} download>
          {t("cal.brief")}
        </a>
      </div>
      </div>
      {exportStatus && <p className="text-sm text-red-600" role="status">{exportStatus}</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Preset regions">
        {(aois.length ? aois : [{ id: "vietnam", label: "Vietnam" }]).map((a) => (
          <button
            key={a.id}
            title={a.label}
            onClick={() => { setAoi(a.id); const b = AOI_BBOX[a.id] ?? ""; setBbox(b); setApplied({ bbox: b, aoi: a.id, data: dsrc, method }); }}
            className={`rounded-full border px-3 py-1 text-sm ${aoi === a.id ? "bg-orange-600 text-white" : "hover:bg-accent"}`}
          >
            {a.id}
          </button>
        ))}
        <label className="ml-2 text-sm">data
          <select value={dsrc} onChange={(e) => setDsrc(e.target.value)} className="ml-1 rounded border px-2 py-1 text-sm">
            <option value="sample">sample (synthetic)</option>
            <option value="raw">raw (NASA FIRMS)</option>
          </select>
        </label>
        <label className="text-sm">method
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="ml-1 rounded border px-2 py-1 text-sm">
            <option value="stat">stat (ratio)</option>
            <option value="ml">ml (HGB)</option>
            <option value="ts">transformer</option>
          </select>
        </label>
        <a className="rounded-full border px-3 py-1 text-sm underline" href={`/xray?aoi=${applied.aoi}&data=${applied.data}`}>X-Ray</a>
      </div>
      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border p-3"
        onSubmit={(e) => { e.preventDefault(); setApplied({ bbox, aoi, data: dsrc, method }); }}
      >
        <label className="text-sm">{t("cal.bbox")}
          <input value={bbox} onChange={(e) => setBbox(e.target.value)}
            className="ml-2 rounded border px-2 py-1 font-mono text-sm" size={24} aria-label="Bounding box" />
        </label>
        <button className="rounded bg-orange-600 px-3 py-1 text-white" type="submit">{t("cal.apply")}</button>
        <span className="text-sm text-muted-foreground">{data.daily_cells} {t("cal.cells")} · {data.method_id}</span>
      </form>
      <AoiMap
        key={aoi}
        center={AOI_CENTER[aoi]?.c ?? [13, 106.5]}
        zoom={AOI_CENTER[aoi]?.z ?? 5}
        bbox={applied.bbox || null}
        cells={data.daily.map((d) => ({ lat: Number(d.lat), lon: Number(d.lon), harmonized_count: Number(d.harmonized_count), date: String(d.date), estimate_type: String(d.estimate_type ?? "") }))}
        onSelect={(b) => { setBbox(b); setApplied({ bbox: b, aoi, data: dsrc, method }); }}
      />
      {L && (
        <div className="rounded-lg border-l-4 border-orange-600 bg-accent/50 p-3" role="status">
          <b>{t("cal.latest")} {L.date}:</b> {L.month_total} {t("common.detections")} {t("cal.vs_median")} {L.hist_median}
          {L.ratio !== null && <> (×{L.ratio})</>} — <b>{L.verdict.replace("_", " ")}</b>.
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-xs" aria-label="Legend">
        {LEGEND.map(([cls, label]) => (
          <span key={label} className={`rounded px-2 py-1 ${cls}`}>{label}</span>
        ))}
      </div>
      {reliability && (
        <p className="text-sm text-muted-foreground" role="status">
          {reliability.partials.length === 0
            ? `${t("cal.fullmonths")}: ${reliability.full}/${reliability.total}`
            : `${t("cal.fullmonths")} ${reliability.full}/${reliability.total} · ${t("cal.partialmonths")}: ${reliability.partials.map((p) => `${p.key} (${p.days})`).join(", ")}`}
        </p>
      )}
      {data.calendar.years.length === 0 ? <EmptyState message={t("cal.empty")} /> : (
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
                {data.calendar.months.map((m, mi) => {
                  const v = data.calendar.matrix[yi][mi];
                  const z = data.calendar.anomalies[yi][mi];
                  const ck = `${y}-${String(m).padStart(2, "0")}`;
                  const cinfo = data.calendar.completeness?.[ck];
                  const isPartial = cinfo?.partial === true;
                  const title = v === null
                    ? `${y}-${m}: ${t("cal.nodata")}`
                    : isPartial
                      ? `${y}-${m}: ${v} (z=${z}, ${t("cal.partial")}: ${cinfo?.days} days)`
                      : `${y}-${m}: ${v} (z=${z})`;
                  return (
                    <td key={m} title={title}
                      className={`border p-2 ${colorFor(z)}`}>
                      {v === null ? "—" : v}{isPartial && cinfo ? <span title={`${t("cal.partialmonths")}: ${cinfo.days} days`}> ◐</span> : null}
                    </td>
                  );
                })}
                <td className="p-1 font-semibold">{data.calendar.row_totals[yi]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {F && (
        <div className="rounded-lg border p-3" role="status">
          <b>{t("cal.outlook")} {F.year}-{String(F.month).padStart(2, "0")}:</b> median {F.median} {t("common.detections")}
          (P25–P75 {F.p25}–{F.p75}, n={F.n_years}). {t("cal.outlook_note")}
        </div>
      )}
      <div>
        <h2 className="font-semibold">{t("cal.clima")}</h2>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={clima}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="median" fill="#93c5fd" name="Historical median" />
              <Line dataKey="latest" stroke="#ea580c" name="Latest year" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <h2 className="font-semibold">{t("cal.yearly")}</h2>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={yearly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="detections" fill="#ea580c" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <h2 className="font-semibold">{t("cal.critical")}</h2>
        <ul className="list-disc pl-6 text-sm">
          {data.critical_periods.map((p) => (
            <li key={`${p.year}-${p.month}`}>{p.year}-{String(p.month).padStart(2, "0")}: {p.count} {t("common.detections")}, z={p.z} ({p.label})</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
