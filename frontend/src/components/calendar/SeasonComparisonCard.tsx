import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart2, TrendingDown, TrendingUp } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { cn, compact } from "@/lib/utils";

interface SeasonComparisonCardProps {
  years: number[];
  matrix: (number | null)[][];
  months: number[];
  aoi?: string;
  onSelectPeriod?: (period: string) => void;
}

export function SeasonComparisonCard({
  years,
  matrix,
  months,
  aoi,
  onSelectPeriod,
}: SeasonComparisonCardProps) {
  const { t } = useLang();

  // Default to a notable historical year and the recent holdout year
  const defaultYearA = years.includes(2016) ? 2016 : years[0] ?? 2015;
  const defaultYearB = years.includes(2024) ? 2024 : years[years.length - 1] ?? 2024;

  const [yearA, setYearA] = useState<number>(defaultYearA);
  const [yearB, setYearB] = useState<number>(defaultYearB);

  // Compute 20-year climatological baseline mean for each month
  const monthlyBaseline = useMemo(() => {
    return months.map((_, mi) => {
      let sum = 0;
      let count = 0;
      years.forEach((_, yi) => {
        const val = matrix[yi]?.[mi];
        if (val !== undefined && val !== null && !isNaN(val)) {
          sum += val;
          count += 1;
        }
      });
      return count > 0 ? Math.round(sum / count) : 0;
    });
  }, [years, matrix, months]);

  // Extract monthly values for year A and year B
  const indexA = years.indexOf(yearA);
  const indexB = years.indexOf(yearB);

  const seriesA = useMemo(
    () => (indexA >= 0 ? matrix[indexA] ?? [] : []),
    [indexA, matrix]);
  const seriesB = useMemo(
    () => (indexB >= 0 ? matrix[indexB] ?? [] : []),
    [indexB, matrix]);

  const totalA = seriesA.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const totalB = seriesB.reduce<number>((sum, v) => sum + (v ?? 0), 0);

  const deltaTotal = totalA > 0 ? ((totalB - totalA) / totalA) * 100 : 0;

  // Find peak months
  const peakA = useMemo(() => {
    let maxVal = -1;
    let maxMonth = 1;
    seriesA.forEach((v, i) => {
      const val = v ?? 0;
      if (val > maxVal) {
        maxVal = val;
        maxMonth = months[i] ?? i + 1;
      }
    });
    return { month: maxMonth, val: maxVal };
  }, [seriesA, months]);

  const peakB = useMemo(() => {
    let maxVal = -1;
    let maxMonth = 1;
    seriesB.forEach((v, i) => {
      const val = v ?? 0;
      if (val > maxVal) {
        maxVal = val;
        maxMonth = months[i] ?? i + 1;
      }
    });
    return { month: maxMonth, val: maxVal };
  }, [seriesB, months]);

  // Chart data
  const chartData = useMemo(() => {
    return months.map((m, i) => ({
      monthLabel: t("calendar.month_abbr", { m }),
      monthNum: m,
      periodA: `${yearA}-${String(m).padStart(2, "0")}`,
      periodB: `${yearB}-${String(m).padStart(2, "0")}`,
      [yearA]: seriesA[i] ?? 0,
      [yearB]: seriesB[i] ?? 0,
      baseline: monthlyBaseline[i] ?? 0,
    }));
  }, [months, yearA, yearB, seriesA, seriesB, monthlyBaseline, t]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-5 shadow-sm space-y-4">
      {/* Header with year selectors and quick presets */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white tracking-tight">
              {t("calendar.season_comparison_title")}
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            {t("calendar.season_comparison_desc", { aoi: (aoi ?? "").toUpperCase() })}
          </p>
        </div>

        {/* Year Selectors */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-1 text-xs">
            <span className="font-semibold text-cyan-400">{t("calendar.year_a_label")}</span>
            <select
              value={yearA}
              onChange={(e) => setYearA(Number(e.target.value))}
              className="bg-transparent font-mono font-bold text-white focus:outline-none cursor-pointer"
            >
              {years.map((y) => (
                <option key={y} value={y} className="bg-slate-900 text-white">
                  {y}
                </option>
              ))}
            </select>
          </div>

          <span className="text-slate-500 font-bold">vs</span>

          <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-1 text-xs">
            <span className="font-semibold text-amber-400">{t("calendar.year_b_label")}</span>
            <select
              value={yearB}
              onChange={(e) => setYearB(Number(e.target.value))}
              className="bg-transparent font-mono font-bold text-white focus:outline-none cursor-pointer"
            >
              {years.map((y) => (
                <option key={y} value={y} className="bg-slate-900 text-white">
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Quick Benchmark Presets */}
          <div className="hidden lg:flex items-center gap-1 pl-2 border-l border-slate-800">
            <button
              type="button"
              onClick={() => {
                if (years.includes(2016)) setYearA(2016);
                if (years.includes(2024)) setYearB(2024);
              }}
              className="rounded px-2 py-0.5 text-[11px] font-mono border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700 transition"
            >
              2016 vs 2024
            </button>
            <button
              type="button"
              onClick={() => {
                if (years.includes(2019)) setYearA(2019);
                if (years.includes(2024)) setYearB(2024);
              }}
              className="rounded px-2 py-0.5 text-[11px] font-mono border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700 transition"
            >
              2019 vs 2024
            </button>
          </div>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Year A Summary */}
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3 space-y-1">
          <span className="text-[11px] font-semibold text-cyan-300 flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-cyan-400" />
            <span>{t("calendar.year_prefix", { year: yearA })}</span>
          </span>
          <div className="text-lg font-bold font-mono text-white">
            {compact(Math.round(totalA))}
          </div>
          <span className="text-[11px] text-slate-400 block font-mono">
            {t("calendar.peak_label", { month: peakA.month, val: compact(Math.round(peakA.val)) })}
          </span>
        </div>

        {/* Year B Summary */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 space-y-1">
          <span className="text-[11px] font-semibold text-amber-300 flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span>{t("calendar.year_prefix", { year: yearB })}</span>
          </span>
          <div className="text-lg font-bold font-mono text-white">
            {compact(Math.round(totalB))}
          </div>
          <span className="text-[11px] text-slate-400 block font-mono">
            {t("calendar.peak_label", { month: peakB.month, val: compact(Math.round(peakB.val)) })}
          </span>
        </div>

        {/* Delta Total */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-1">
          <span className="text-[11px] font-semibold text-slate-400 block">
            {t("calendar.yoy_delta")}
          </span>
          <div className={cn("text-lg font-bold font-mono flex items-center gap-1", deltaTotal >= 0 ? "text-rose-400" : "text-emerald-400")}>
            {deltaTotal >= 0 ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )}
            <span>{deltaTotal >= 0 ? `+${deltaTotal.toFixed(1)}%` : `${deltaTotal.toFixed(1)}%`}</span>
          </div>
          <span className="text-[11px] text-slate-400 block font-mono">
            {deltaTotal >= 0 ? t("calendar.activity_increased") : t("calendar.activity_decreased")}
          </span>
        </div>

        {/* Peak Shift Analysis */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-1">
          <span className="text-[11px] font-semibold text-slate-400 block">
            {t("calendar.peak_season_shift")}
          </span>
          <div className="text-lg font-bold font-mono text-slate-200">
            {peakA.month === peakB.month
              ? t("calendar.same_peak", { month: peakA.month })
              : t("calendar.peak_shift_months", { a: peakA.month, b: peakB.month })}
          </div>
          <span className="text-[11px] text-slate-400 block font-mono">
            {peakB.month > peakA.month
              ? t("calendar.later_by_months", { count: peakB.month - peakA.month })
              : peakB.month < peakA.month
              ? t("calendar.earlier_by_months", { count: peakA.month - peakB.month })
              : t("calendar.identical_phase")}
          </span>
        </div>
      </div>

      {/* Recharts Area Curve */}
      <div className="h-64 sm:h-72 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorYearA" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorYearB" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="monthLabel"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => compact(v)}
            />
            <RechartsTooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0]?.payload;
                if (!d) return null;
                return (
                  <div className="rounded-xl border border-slate-700 bg-slate-950 p-3 shadow-xl text-xs space-y-1.5 font-mono">
                    <span className="font-bold text-white block border-b border-slate-800 pb-1 font-sans">
                      {d.monthLabel}
                    </span>
                    <div className="flex items-center justify-between gap-4 text-cyan-300">
                      <span>{yearA}:</span>
                      <span className="font-bold">{Number(d[yearA]).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 text-amber-300">
                      <span>{yearB}:</span>
                      <span className="font-bold">{Number(d[yearB]).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 text-slate-400 pt-1 border-t border-slate-800">
                      <span>{t("calendar.baseline_mean")}</span>
                      <span>{Number(d.baseline).toLocaleString()}</span>
                    </div>
                    {onSelectPeriod && (
                      <div className="pt-1.5 text-[10px] text-cyan-400 font-sans">
                        {t("calendar.click_to_view_map")}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              wrapperStyle={{ paddingBottom: "10px", fontSize: "11px" }}
            />
            {/* Climatological Baseline */}
            <Area
              type="monotone"
              dataKey="baseline"
              name={t("calendar.baseline_20y")}
              stroke="#475569"
              strokeDasharray="4 4"
              fill="transparent"
              strokeWidth={1.5}
            />
            {/* Year A */}
            <Area
              type="monotone"
              dataKey={yearA}
              name={String(yearA)}
              stroke="#06b6d4"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#colorYearA)"
              activeDot={{ r: 6 }}
            />
            {/* Year B */}
            <Area
              type="monotone"
              dataKey={yearB}
              name={String(yearB)}
              stroke="#f59e0b"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#colorYearB)"
              activeDot={{ r: 6 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
