import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLang } from "@/lib/i18n";
import { cn, compact } from "@/lib/utils";
import type { CalendarResponse } from "@/lib/api";
import { SeasonComparisonCard } from "./SeasonComparisonCard";

/**
 * CLAIM-017: KPI cards + the single SeasonComparisonCard mount + the
 * multi-decadal trend chart, extracted from `pages/calendar.tsx`.
 * Only one SeasonComparisonCard is mounted (the duplicate mount that used
 * to sit below the month detail card is gone).
 */
export function CalendarKpis({
  data,
  aoi,
  appliedAoi,
  totalObserved,
  totalModis,
  totalViirs,
  totalHarmonized,
  criticalCount,
  delayLine,
  yearly,
  onViewOnMap,
  onSelectPeriod,
}: {
  data: CalendarResponse;
  aoi: string;
  appliedAoi: string;
  totalObserved: number;
  totalModis: number;
  totalViirs: number;
  totalHarmonized: number;
  criticalCount: number;
  delayLine: string;
  yearly: Array<{ year: number; detections: number }>;
  onViewOnMap: () => void;
  onSelectPeriod: (ym: string) => void;
}) {
  const { t } = useLang();

  return (
    <>
      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-1">
          <span className="text-xs text-slate-400 block font-medium">
            {t("calendar.kpi_observed")}
          </span>
          <span className="text-xl sm:text-2xl font-extrabold font-mono text-white">
            {totalObserved.toLocaleString()}
          </span>
          <span className="text-xs text-slate-400 block">
            {t("calendar.kpi_observed_sub", {
              modis: totalModis.toLocaleString(),
              viirs: totalViirs.toLocaleString(),
            })}
          </span>
          <span className="text-[11px] font-mono text-slate-500 block">{delayLine}</span>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-1">
          <span className="text-xs text-slate-400 block font-medium">
            {t("calendar.kpi_calibrated")}
          </span>
          <span className="text-xl sm:text-2xl font-extrabold font-mono text-cyan-300">
            {compact(totalHarmonized)}
          </span>
          <span className="text-xs text-cyan-400 block">
            {t("calendar.kpi_calibrated_sub")}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-1">
          <span className="text-xs text-slate-400 block font-medium">
            {t("calendar.kpi_anomalous")}
          </span>
          <span className="text-xl sm:text-2xl font-extrabold font-mono text-orange-400">
            {criticalCount}
          </span>
          <span className="text-xs text-slate-400 block">
            {t("calendar.kpi_anomalous_sub")}
          </span>
        </div>

        {data.latest && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-1">
            <span className="text-xs text-slate-400 block font-medium">
              {t("calendar.kpi_latest_vs_median")}
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl sm:text-2xl font-extrabold font-mono text-cyan-300">
                {compact(data.latest.month_total)}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                / {compact(data.latest.hist_median)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-bold font-mono",
                (data.latest.ratio ?? 1) >= 1.5
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  : (data.latest.ratio ?? 1) <= 0.7
                  ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
              )}>
                {data.latest.ratio ? `${data.latest.ratio.toFixed(1)}x` : "1.0x"} · {data.latest.verdict.replace("_", " ")}
              </span>
            </div>
            <span className="text-[11px] font-mono text-slate-500 block truncate">
              {t("calendar.kpi_latest_sub", { date: data.latest.date, years: data.latest.hist_years ?? 24 })}
            </span>
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-1">
          <span className="text-xs text-slate-400 block font-medium">
            {t("calendar.kpi_aoi_data")}
          </span>
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-sm font-bold text-emerald-400 capitalize">{aoi}</span>
            <span className="text-xs text-slate-400 font-mono">({data.calendar?.years?.length ?? 0}y)</span>
          </div>
          <button
            type="button"
            onClick={onViewOnMap}
            className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold block text-left pt-0.5"
          >
            {t("calendar.view_on_map")}
          </button>
        </div>
      </div>

      <SeasonComparisonCard
        years={data.calendar.years}
        matrix={data.calendar.matrix}
        months={data.calendar.months}
        eligibleMask={data.calendar.eligible_mask}
        aoi={appliedAoi}
        onSelectPeriod={onSelectPeriod}
      />

      {/* 25-Year Trend Chart */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-white">
              {t("calendar.multi_decadal_trend", {
                from: data.calendar.years[0] ?? "-",
                to: data.calendar.years.at(-1) ?? "-",
              })}
            </h3>
            <p className="text-xs text-slate-400">
              {t("calendar.annual_index_desc")}
            </p>
          </div>
          <span className="font-mono text-xs text-orange-400">{t("calendar.years_tracked_badge", { count: data.calendar.years.length })}</span>
        </div>

        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={yearly} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="year" stroke="#64748b" fontSize={12} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={12} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0B1220",
                  borderColor: "#334155",
                  borderRadius: "10px",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="detections" fill="#f97316" radius={[4, 4, 0, 0]} name={t("calendar.month_val")} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}
