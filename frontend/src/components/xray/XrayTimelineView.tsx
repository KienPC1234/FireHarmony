import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, CheckCircle2, TrendingUp } from "lucide-react";
import { compact, num } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

interface XrayTimelineViewProps {
  months: Array<{
    year: number;
    month: number;
    modis_raw: number;
    viirs_ref: number;
    adjusted_stat: number;
    adjusted_calendar?: number | null;
    k_used?: number;
    ratio_source?: string;
  }>;
  units: string;
}

export function XrayTimelineView({ months, units }: XrayTimelineViewProps) {
  const { lang } = useLang();
  const vi = lang === "vi";

  const chartData = useMemo(() => {
    return months.map((m) => {
      const residual = Number((m.adjusted_stat - m.viirs_ref).toFixed(1));
      const rawDiscrepancy = Number((m.viirs_ref - m.modis_raw).toFixed(1));
      return {
        t: `${m.year}-${String(m.month).padStart(2, "0")}`,
        year: m.year,
        month: m.month,
        MODIS: m.modis_raw,
        VIIRS: m.viirs_ref,
        Harmonized: m.adjusted_stat,
        Calendar: m.adjusted_calendar ?? null,
        Residual: residual,
        RawGap: rawDiscrepancy,
        kRatio: m.k_used ?? 3.8,
      };
    });
  }, [months]);

  // Compute key summary telemetry
  const summary = useMemo(() => {
    if (!chartData.length) return null;
    const avgK = chartData.reduce((acc, d) => acc + d.kRatio, 0) / chartData.length;
    const meanAbsError =
      chartData.reduce((acc, d) => acc + Math.abs(d.Residual), 0) / chartData.length;
    const meanBias = chartData.reduce((acc, d) => acc + d.Residual, 0) / chartData.length;
    const totalRawModis = chartData.reduce((acc, d) => acc + d.MODIS, 0);
    const totalViirs = chartData.reduce((acc, d) => acc + d.VIIRS, 0);
    const totalHarmonized = chartData.reduce((acc, d) => acc + d.Harmonized, 0);

    return {
      avgK: avgK.toFixed(2),
      meanAbsError: meanAbsError.toFixed(1),
      meanBias: (meanBias > 0 ? "+" : "") + meanBias.toFixed(1),
      rawRatio: totalRawModis ? (totalViirs / totalRawModis).toFixed(2) : "3.70",
      harmonizedParity: totalViirs ? ((totalHarmonized / totalViirs) * 100).toFixed(1) + "%" : "100%",
    };
  }, [chartData]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Telemetry Indicator Badges */}
      {summary && (
        <div data-ui-review="xray-metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="min-w-0 rounded-xl border border-border/70 bg-slate-950/80 p-4 backdrop-blur space-y-2">
            <div className="flex items-start justify-between gap-1.5 text-[11px] font-semibold uppercase tracking-normal leading-5 text-slate-400">
              <span className="min-w-0 flex-1 break-words">{vi ? "Hệ số k trung bình" : "Mean Scaling (k)"}</span>
              <TrendingUp className="h-3.5 w-3.5 text-cyan-400" />
            </div>
            <p className="font-mono text-xl sm:text-2xl font-black leading-snug break-words text-cyan-300">{summary.avgK}x</p>
            <p className="text-xs text-slate-400">{vi ? "MODIS phóng đại theo 1/k" : "MODIS upscaled by 1/k"}</p>
          </div>

          <div className="min-w-0 rounded-xl border border-border/70 bg-slate-950/80 p-4 backdrop-blur space-y-2">
            <div className="flex items-start justify-between gap-1.5 text-[11px] font-semibold uppercase tracking-normal leading-5 text-slate-400">
              <span className="min-w-0 flex-1 break-words">{vi ? "Sai số tuyệt đối MAE" : "Holdout MAE"}</span>
              <Activity className="h-3.5 w-3.5 text-orange-400" />
            </div>
            <p className="font-mono text-xl sm:text-2xl font-black leading-snug break-words text-orange-300">±{summary.meanAbsError}</p>
            <p className="text-xs text-slate-400">{vi ? "Độ lệch dư phát hiện tháng" : "Monthly detection residual"}</p>
          </div>

          <div className="min-w-0 rounded-xl border border-border/70 bg-slate-950/80 p-4 backdrop-blur space-y-2">
            <div className="flex items-start justify-between gap-1.5 text-[11px] font-semibold uppercase tracking-normal leading-5 text-slate-400">
              <span className="min-w-0 flex-1 break-words">{vi ? "Độ lệch thiên vị Mean Bias" : "Mean Bias Error"}</span>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <p className="font-mono text-xl sm:text-2xl font-black leading-snug break-words text-emerald-300">{summary.meanBias}</p>
            <p className="text-xs text-slate-400">{vi ? "Hiệu chuẩn căn tâm 0" : "Zero-centered calibration"}</p>
          </div>

          <div className="min-w-0 rounded-xl border border-border/70 bg-slate-950/80 p-4 backdrop-blur space-y-2">
            <div className="flex items-start justify-between gap-1.5 text-[11px] font-semibold uppercase tracking-normal leading-5 text-slate-400">
              <span className="min-w-0 flex-1 break-words">{vi ? "Tương đồng tổng thể" : "Volume Parity"}</span>
              <Activity className="h-3.5 w-3.5 text-cyan-400" />
            </div>
            <p className="font-mono text-xl sm:text-2xl font-black leading-snug break-words text-white">{summary.harmonizedParity}</p>
            <p className="text-xs text-slate-400">{vi ? "Chuỗi hiệu chuẩn vs VIIRS chuẩn" : "Harmonized vs VIIRS Reference"}</p>
          </div>
        </div>
      )}

      {/* Main Dual Synchronized Chart */}
      <div className="rounded-2xl border border-border/80 bg-slate-950/85 p-5 shadow-card backdrop-blur space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight">
              {vi ? "Quỹ đạo quan trắc đa cảm biến theo thời gian" : "Multi-Sensor Observation Trajectory & Calibration Parity"}
            </h2>
            <p className="text-xs text-slate-400">
              {vi
                ? "So sánh MODIS thô (1km, xám), VIIRS thực tế (375m, xanh lục) và Chuỗi đã chuẩn hóa (cam)"
                : "Tracking raw MODIS (1km, grey), reference VIIRS (375m, emerald), and sensor-harmonized output (orange)"}
            </p>
          </div>
          <span className="font-mono text-xs px-2.5 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-950/40 text-cyan-300 font-semibold">
            Unit: {units}
          </span>
        </div>

        {/* Top Trajectory Line Chart */}
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 12, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="t" stroke="#64748b" fontSize={10} tick={false} />
              <YAxis stroke="#64748b" fontSize={10} tickFormatter={(v) => compact(v)} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="rounded-xl border border-border/80 bg-slate-900/95 p-3 font-mono text-xs shadow-2xl backdrop-blur space-y-1.5 min-w-[210px]">
                      <div className="font-bold text-white border-b border-border/40 pb-1 flex justify-between">
                        <span>{d.t}</span>
                        <span className="text-cyan-400 font-normal">k = {d.kRatio}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>{vi ? "MODIS thô (1 km):" : "Raw MODIS (1 km):"}</span>
                        <span className="text-slate-200 font-semibold">{num(d.MODIS)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-400">
                        <span>{vi ? "VIIRS tham chiếu (375 m):" : "VIIRS Reference (375 m):"}</span>
                        <span className="font-semibold">{num(d.VIIRS)}</span>
                      </div>
                      <div className="flex justify-between text-orange-400 font-bold">
                        <span>{vi ? "Chỉ số hiệu chuẩn:" : "Harmonized Index:"}</span>
                        <span>{num(d.Harmonized)}</span>
                      </div>
                      <div className="flex justify-between text-cyan-300">
                        <span>{vi ? "Tổng ma trận Calendar:" : "Calendar Matrix Total:"}</span>
                        <span>{d.Calendar != null ? num(d.Calendar) : "N/A"}</span>
                      </div>
                      <div className="border-t border-border/30 pt-1 flex justify-between text-xs text-slate-400">
                        <span>{vi ? "Sai số hiệu chuẩn:" : "Calibration Residual:"}</span>
                        <span className={d.Residual > 0 ? "text-amber-400" : "text-sky-400"}>
                          {d.Residual > 0 ? "+" : ""}{d.Residual}
                        </span>
                      </div>
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
              <Line
                dataKey="MODIS"
                stroke="#64748b"
                strokeWidth={1.5}
                dot={false}
                name={vi ? "MODIS thô (1 km)" : "Raw MODIS (1 km)"}
              />
              <Line
                dataKey="VIIRS"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                name={vi ? "VIIRS tham chiếu (375 m)" : "Reference VIIRS (375 m)"}
              />
              <Line
                dataKey="Harmonized"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                name={vi ? "Mô hình hiệu chuẩn thống kê" : "Harmonized Stat Model"}
              />
              <Line
                dataKey="Calendar"
                stroke="#06b6d4"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
                connectNulls={false}
                name={vi ? "Chỉ số Calendar công bố" : "Published Calendar Index"}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Bottom Residual Divergence Bar/Area Chart */}
        <div className="border-t border-border/40 pt-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-300">
              {vi ? "Biểu đồ sai số dư (Residuals: Harmonized - VIIRS Reference)" : "Model Residual Divergence (Δ = Harmonized - VIIRS Reference)"}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {vi ? "Đường 0 thể hiện sự trùng khớp hoàn toàn với VIIRS" : "Zero-line indicates exact agreement with VIIRS"}
            </span>
          </div>
          <div style={{ height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 12, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="t" stroke="#64748b" fontSize={10} />
                <YAxis stroke="#64748b" fontSize={10} />
                <ReferenceLine y={0} stroke="#475569" strokeWidth={1.5} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-lg border border-border/70 bg-slate-900 p-2 font-mono text-xs">
                        <span className="text-white font-bold">{d.t}: </span>
                        <span className={d.Residual > 0 ? "text-orange-400" : "text-sky-400"}>
                          {d.Residual > 0 ? "+" : ""}{d.Residual} {vi ? "điểm phát hiện" : "detections"}
                        </span>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="Residual" fill="#f97316" radius={[2, 2, 0, 0]} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
