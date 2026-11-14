import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, Flame, Scale } from "lucide-react";
import { cn, compact, num } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

interface XrayTransitionIllusionViewProps {
  months: Array<{
    year: number;
    month: number;
    modis_raw: number;
    viirs_ref: number;
    adjusted_stat: number;
  }>;
}

export function XrayTransitionIllusionView({ months }: XrayTransitionIllusionViewProps) {
  const { t } = useLang();
  const [showHarmonized, setShowHarmonized] = useState(true);

  // Synthesize multi-year timeline showing pre-2012 and post-2012
  const transitionData = useMemo(() => {
    // Group by year to get annual detection totals
    const byYear: Record<number, { modis: number; viirs: number; harmonized: number; count: number }> = {};
    for (const m of months) {
      if (!byYear[m.year]) {
        byYear[m.year] = { modis: 0, viirs: 0, harmonized: 0, count: 0 };
      }
      byYear[m.year].modis += m.modis_raw;
      byYear[m.year].viirs += m.viirs_ref;
      byYear[m.year].harmonized += m.adjusted_stat;
      byYear[m.year].count += 1;
    }

    return Object.entries(byYear).map(([yStr, val]) => {
      const year = Number(yStr);
      // Naive sum: If pre-2012, only MODIS existed. If post-2012, naive people sum MODIS + VIIRS or switch abruptly to VIIRS!
      const naiveRawSwitched = year < 2012 ? val.modis : val.viirs;
      const naiveRawSummed = year < 2012 ? val.modis : val.modis + val.viirs;

      return {
        year,
        yearLabel: String(year),
        modisOnly: Math.round(val.modis),
        viirsRef: Math.round(val.viirs),
        harmonizedContinuous: Math.round(val.harmonized),
        naiveRawSwitched,
        naiveRawSummed,
        stepJumpRatio: val.modis > 0 ? (val.viirs / val.modis).toFixed(1) : "3.7",
      };
    });
  }, [months]);

  const renderTransitionTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: ReadonlyArray<{ payload?: (typeof transitionData)[number] }>;
  }) => {
    const d = payload?.[0]?.payload;
    if (!active || !d) return null;
    return (
      <div className="rounded-xl border border-border/80 bg-slate-900/95 p-3 font-mono text-xs shadow-2xl backdrop-blur space-y-1.5 min-w-[220px]">
        <div className="font-bold text-white border-b border-border/40 pb-1 flex justify-between">
          <span>{t("xray.trans_tip_year", { year: d.year })}</span>
          <span className="text-amber-400">{t("xray.trans_tip_jump", { ratio: d.stepJumpRatio })}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>{t("xray.trans_tip_modis")}</span>
          <span className="text-slate-200">{num(d.modisOnly)}</span>
        </div>
        <div className="flex justify-between text-rose-400 font-semibold">
          <span>{t("xray.trans_tip_naive")}</span>
          <span>{num(d.naiveRawSwitched)}</span>
        </div>
        {showHarmonized && (
          <div className="flex justify-between text-cyan-300 font-bold border-t border-border/30 pt-1">
            <span>{t("xray.trans_tip_harm")}</span>
            <span>{num(d.harmonizedContinuous)}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Educational Banner */}
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 shadow-card backdrop-blur space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <span>{t("xray.trans_banner_title")}</span>
        </div>
        <p className="text-xs text-amber-100/90 leading-relaxed">
          {t("xray.trans_banner_body")}
        </p>
      </div>

      {/* Interactive Demonstration Chart */}
      <div className="rounded-2xl border border-border/80 bg-slate-950/85 p-5 shadow-card backdrop-blur space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight">
              {t("xray.trans_chart_title")}
            </h2>
            <p className="text-xs text-slate-400">
              {t("xray.trans_chart_sub")}
            </p>
          </div>

          {/* Interactive Toggle Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowHarmonized((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 border shadow-sm",
                showHarmonized
                  ? "border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                  : "border-border/60 bg-slate-900 text-slate-400 hover:text-white",
              )}
            >
              <Scale className="h-3.5 w-3.5" />
              <span>
                {showHarmonized ? t("xray.trans_hide") : t("xray.trans_show")}
              </span>
            </button>
          </div>
        </div>

        {/* Chart View */}
        <div style={{ height: 340 }}>
          <ResponsiveContainer width="100%" height="100%">
            {transitionData.length <= 1 ? (
              <BarChart data={transitionData} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="yearLabel" stroke="#94a3b8" fontSize={12} />
                <YAxis width={44} stroke="#94a3b8" fontSize={12} tickFormatter={(v) => compact(v)} />
                <Tooltip cursor={{ fill: "rgba(56, 189, 248, 0.08)" }} content={renderTransitionTooltip} />
                <Legend align="center" wrapperStyle={{ fontSize: "12px", paddingTop: "8px", width: "100%", left: 0 }} />
                <Bar
                  dataKey="naiveRawSwitched"
                  fill="#ef4444"
                  maxBarSize={64}
                  radius={[4, 4, 0, 0]}
                  name={t("xray.trans_legend_naive")}
                />
                {showHarmonized && (
                  <Bar
                    dataKey="harmonizedContinuous"
                    fill="#06b6d4"
                    maxBarSize={64}
                    radius={[4, 4, 0, 0]}
                    name={t("xray.trans_legend_harm")}
                  />
                )}
              </BarChart>
            ) : (
              <AreaChart data={transitionData} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
                <defs>
                  <linearGradient id="harmFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="naiveFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="yearLabel" stroke="#94a3b8" fontSize={12} />
                <YAxis width={44} stroke="#94a3b8" fontSize={12} tickFormatter={(v) => compact(v)} />
                <ReferenceLine
                  x="2012"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  label={{
                    value: t("xray.trans_ref_label"),
                    fill: "#f59e0b",
                    fontSize: 12,
                    position: "insideTopLeft",
                  }}
                />
                <Tooltip cursor={{ stroke: "#475569", strokeDasharray: "3 3" }} content={renderTransitionTooltip} />
                <Legend align="center" wrapperStyle={{ fontSize: "12px", paddingTop: "8px", width: "100%", left: 0 }} />
                <Area
                  type="monotone"
                  dataKey="naiveRawSwitched"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={transitionData.length <= 8 ? { r: 4, strokeWidth: 2, fill: "#0b1220" } : false}
                  fill="url(#naiveFill)"
                  name={t("xray.trans_legend_naive")}
                />
                {showHarmonized && (
                  <Area
                    type="monotone"
                    dataKey="harmonizedContinuous"
                    stroke="#06b6d4"
                    strokeWidth={2.5}
                    dot={transitionData.length <= 8 ? { r: 4, strokeWidth: 2, fill: "#0b1220" } : false}
                    fill="url(#harmFill)"
                    name={t("xray.trans_legend_harm")}
                  />
                )}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* Scientific Breakdown Grid */}
        <div className="grid gap-3 pt-2 sm:grid-cols-3 text-xs">
          <div className="rounded-xl border border-border/70 bg-slate-900/70 p-3.5 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-slate-200">
              <Flame className="h-4 w-4 text-orange-400" />
              <span>{t("xray.trans_card1_title")}</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t("xray.trans_card1_body")}
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-slate-900/70 p-3.5 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-slate-200">
              <Scale className="h-4 w-4 text-cyan-400" />
              <span>{t("xray.trans_card2_title")}</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t("xray.trans_card2_body")}
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-slate-900/70 p-3.5 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-slate-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>{t("xray.trans_card3_title")}</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t("xray.trans_card3_body")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
