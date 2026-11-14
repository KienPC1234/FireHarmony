import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { ErrorState, Loading } from "@/components/states";

export function XrayPage() {
  const { t, lang } = useLang();
  const [sp, setSp] = useSearchParams();
  const aoi = sp.get("aoi") || "vietnam";
  const data = sp.get("data") || "sample";
  const [xr, setXr] = useState<Awaited<ReturnType<typeof api.xray>> | null>(null);
  const [bt, setBt] = useState<Awaited<ReturnType<typeof api.backtest>> | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setXr(null); setBt(null); setError(null);
    api.xray(aoi, data).then(setXr).catch(setError);
    api.backtest(aoi, data).then(setBt).catch(() => undefined);
  }, [aoi, data]);

  const series = useMemo(() => (xr ? xr.months.map((m) => ({
    t: `${m.year}-${String(m.month).padStart(2, "0")}`,
    MODIS: m.modis_raw, VIIRS: m.viirs_ref, Adjusted: m.adjusted_stat,
    AdjustedCalendar: m.adjusted_calendar ?? null,
  })) : []), [xr]);

  if (error) return <ErrorState error={error} />;
  if (!xr) return <Loading label={t("common.loading")} />;
  const mets = xr.backtest_metrics;
  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold">{lang === "vi" ? "Sensor Bias X-Ray" : "Sensor Bias X-Ray"}</h1>
        <span className="rounded bg-amber-100 px-2 py-1 font-mono text-xs text-amber-900">{xr.data_source}</span>
        <div className="ml-auto flex gap-2 text-sm">
          <label>AOI
            <select value={aoi} onChange={(e) => setSp({ aoi: e.target.value, data })}
              className="ml-1 rounded border px-2 py-1">
              {["vietnam", "amazon", "australia"].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>Data
            <select value={data} onChange={(e) => setSp({ aoi, data: e.target.value })}
              className="ml-1 rounded border px-2 py-1">
              <option value="sample">sample</option>
              <option value="raw">raw</option>
            </select>
          </label>
        </div>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        {lang === "vi"
          ? `Trái: MODIS thô. Giữa: VIIRS tham chiếu (không phải ground truth cháy thật). Phải: ước lượng sau chỉnh sensor. ${xr.units}.`
          : `Left: raw MODIS. Middle: VIIRS reference (not fire ground truth). Right: sensor-adjusted estimate. ${xr.units}.`}
      </p>

      <div className="card-glow rounded-lg border bg-card p-4">
        <h2 className="font-bold">MODIS raw vs VIIRS reference vs adjusted</h2>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={false} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line dataKey="MODIS" stroke="#64748b" dot={false} />
              <Line dataKey="VIIRS" stroke="#16a34a" dot={false} />
              <Line dataKey="Adjusted" stroke="#ea580c" dot={false} />
              <Line dataKey="AdjustedCalendar" stroke="#0ea5e9" dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="card-glow rounded-lg border bg-card p-4">
          <h2 className="font-bold">{lang === "vi" ? "Sai số holdout (tháng)" : "Holdout error (monthly)"}</h2>
          {!mets ? <p className="text-sm text-muted-foreground">n/a</p> : (
            <table className="mt-2 w-full text-sm">
              <thead><tr className="text-left text-muted-foreground">
                <th>method</th><th>MAE</th><th>WAPE</th><th>bias</th>
              </tr></thead>
              <tbody>
                {(["b0_raw_modis", "b1_global_ratio", "b2_seasonal_ratio", "hgb_b2res_v4", "ts_logratio_pool_v2"] as const).map((k) => (
                  mets[k] ? (
                    <tr key={k} className="border-t font-mono text-xs">
                      <td>{k}</td><td>{mets[k].mae.toFixed(2)}</td>
                      <td>{mets[k].wape.toFixed(3)}</td><td>{mets[k].bias.toFixed(2)}</td>
                    </tr>
                  ) : null
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {lang === "vi"
              ? "Time-travel: train năm đầu, giấu VIIRS ở năm test, dự đoán từ MODIS. VIIRS là tham chiếu sensor, không phải số vụ cháy thật."
              : "Time-travel: train on early years, hide VIIRS in test years, predict from MODIS. VIIRS is a sensor reference, not true fire counts."}
          </p>
        </div>
        <div className="card-glow rounded-lg border bg-card p-4">
          <h2 className="font-bold">Provenance</h2>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            <li>units: {xr.units}</li>
            <li>evaluation: {String((xr as { evaluation_version?: string }).evaluation_version ?? "n/a")} · {String((xr as { eval_unit?: string }).eval_unit ?? "")}</li>
            <li>hgb artifact: {xr.ml_trained ? "trained" : "missing"} · {String((xr as { effective_ml_method?: string }).effective_ml_method ?? "")}</li>
            <li>transformer: {xr.ts_trained ? `trained (${String((xr.ts_meta as { params?: number })?.params ?? "?")} params)` : "missing"}</li>
            <li>months: {xr.months.length}</li>
            <li>adjusted_stat ratio source: {String((xr.months[0] as { ratio_source?: string })?.ratio_source ?? "?")}</li>
          </ul>
          {bt && (
            <p className="mt-2 text-xs text-muted-foreground">
              train {bt.train_years[0]}–{bt.train_years[bt.train_years.length - 1]} → test {bt.test_years.join(", ")} · {bt.months.length} months
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
