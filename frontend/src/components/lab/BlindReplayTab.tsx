import { useState, useMemo } from "react";
import {
  EyeOff,
  HelpCircle,
  Lock,
  RefreshCw,
  Unlock,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn, num } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

type ReplayModelKey = "stan" | "sf" | "hts" | "hgb" | "ts";

interface BlindReplayTabProps {
  aoi: string;
  data: string;
  backtest: {
    train_years: number[];
    test_years: number[];
    months: Array<{
      year: number;
      month: number;
      modis: number;
      viirs_ref: number;
      ml_pred: number;
      ts_pred: number | null;
      sf_pred?: number | null;
      stan_pred?: number | null;
      hts_pred?: number | null;
      b2_pred: number;
    }>;
  } | null;
  loading?: boolean;
}

export function BlindReplayTab({ aoi, data, backtest, loading }: BlindReplayTabProps) {
  const { t } = useLang();

  const [revealed, setRevealed] = useState(false);
  const [showFailuresOnly, setShowFailuresOnly] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ReplayModelKey>("stan");

  const months = useMemo(() => backtest?.months ?? [], [backtest]);

  // Transform data for chart based on selected model and revealed state
  const chartData = useMemo(() => {
    return months.map((m) => {
      let predVal = m.b2_pred;
      if (selectedModel === "stan") {
        predVal = m.stan_pred ?? m.b2_pred;
      } else if (selectedModel === "sf") {
        predVal = m.sf_pred ?? m.b2_pred;
      } else if (selectedModel === "hts") {
        predVal = m.hts_pred ?? m.b2_pred;
      } else if (selectedModel === "hgb") {
        predVal = m.ml_pred ?? m.b2_pred;
      } else if (selectedModel === "ts") {
        predVal = m.ts_pred ?? m.b2_pred;
      }

      const b2_anchor = m.b2_pred;
      const residual = Math.round(predVal - m.viirs_ref);
      const absErrModel = Math.abs(predVal - m.viirs_ref);
      const absErrB2 = Math.abs(b2_anchor - m.viirs_ref);
      const isFailure = absErrModel > absErrB2;

      return {
        period: `${m.year}-${String(m.month).padStart(2, "0")}`,
        year: m.year,
        month: m.month,
        modis: m.modis,
        predicted: Math.round(predVal),
        b2_anchor: Math.round(b2_anchor),
        viirs: revealed ? m.viirs_ref : null,
        residual,
        isFailure,
      };
    });
  }, [months, revealed, selectedModel]);

  const displayedMonths = useMemo(() => {
    if (!showFailuresOnly) return chartData;
    return chartData.filter((m) => m.isFailure);
  }, [chartData, showFailuresOnly]);

  const failureCount = useMemo(() => {
    return chartData.filter((m) => m.isFailure).length;
  }, [chartData]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
        <RefreshCw className="h-6 w-6 animate-spin text-cyan-400" />
        <span className="text-xs font-mono">
          {t("replay.loading")}
        </span>
      </div>
    );
  }

  if (!backtest || months.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/10 p-8 text-center space-y-3">
        <HelpCircle className="h-8 w-8 text-amber-400 mx-auto" />
        <h3 className="text-base font-bold text-white">
          {t("replay.no_data_title")}
        </h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          {t("replay.no_data_desc", { aoi: aoi.toUpperCase(), data })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Protocol Header Card */}
      <div className="rounded-2xl border border-cyan-500/30 bg-slate-950/85 p-5 shadow-card backdrop-blur space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/50 pb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-300">
                {t("replay.protocol_badge")}
              </span>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-xs font-mono text-cyan-300">
                {t("replay.holdout_badge", { years: backtest.test_years.join(", ") })}
              </span>
            </div>
            <p className="text-xs text-slate-300">
              {t("replay.protocol_desc")}
            </p>
          </div>

          {/* Reveal Toggle CTA */}
          <button
            type="button"
            onClick={() => setRevealed(!revealed)}
            className={cn(
              "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition shadow-lg shrink-0",
              revealed
                ? "bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700"
                : "bg-orange-600 text-white hover:bg-orange-500 shadow-orange-950/50 animate-pulse",
            )}
          >
            {revealed ? (
              <>
                <EyeOff className="h-4 w-4" />
                <span>{t("replay.rehide_btn")}</span>
              </>
            ) : (
              <>
                <Unlock className="h-4 w-4 text-amber-300" />
                <span>{t("replay.reveal_btn")}</span>
              </>
            )}
          </button>
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          <div className="rounded-lg border border-border/60 bg-slate-900/80 px-2.5 py-1 text-slate-300">
            <span className="text-muted-foreground mr-1.5">{t("replay.train_window")}</span>
            <span className="text-cyan-300 font-semibold">{backtest.train_years.join(", ")}</span>
          </div>
          <div className="rounded-lg border border-border/60 bg-slate-900/80 px-2.5 py-1 text-slate-300">
            <span className="text-muted-foreground mr-1.5">{t("replay.test_window")}</span>
            <span className="text-emerald-300 font-semibold">{backtest.test_years.join(", ")}</span>
          </div>
          <div className="rounded-lg border border-border/60 bg-slate-900/80 px-2.5 py-1 text-slate-300">
            <span className="text-muted-foreground mr-1.5">{t("replay.evaluated_months")}</span>
            <span className="text-white font-semibold">{t("replay.months_count", { count: months.length })}</span>
          </div>
          <div className="rounded-lg border border-border/60 bg-slate-900/80 px-2.5 py-1 text-slate-300">
            <span className="text-muted-foreground mr-1.5">{t("replay.status_label")}</span>
            <span className={revealed ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
              {revealed ? t("replay.status_revealed") : t("replay.status_blindfolded")}
            </span>
          </div>
        </div>
      </div>

      {/* Main Chart Canvas */}
      <div className="rounded-2xl border border-border/80 bg-slate-950/85 p-5 shadow-card backdrop-blur space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">
              {revealed ? t("replay.chart_title_revealed") : t("replay.chart_title_blind")}
            </h3>
            <p className="text-xs text-slate-400">
              {revealed ? t("replay.chart_sub_revealed") : t("replay.chart_sub_blind")}
            </p>
          </div>

          {/* Model Switcher & Failure Toggle */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
              <span className="text-[11px] text-slate-400 px-1.5 font-mono">{t("replay.select_model")}</span>
              <button
                type="button"
                onClick={() => setSelectedModel("stan")}
                className={cn(
                  "rounded px-2 py-1 text-xs font-semibold transition",
                  selectedModel === "stan"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white",
                )}
              >
                STAN
              </button>
              <button
                type="button"
                onClick={() => setSelectedModel("sf")}
                className={cn(
                  "rounded px-2 py-1 text-xs font-semibold transition",
                  selectedModel === "sf"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white",
                )}
              >
                SensorFormer
              </button>
              <button
                type="button"
                onClick={() => setSelectedModel("hts")}
                className={cn(
                  "rounded px-2 py-1 text-xs font-semibold transition",
                  selectedModel === "hts"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white",
                )}
              >
                HTS
              </button>
              <button
                type="button"
                onClick={() => setSelectedModel("hgb")}
                className={cn(
                  "rounded px-2 py-1 text-xs font-semibold transition",
                  selectedModel === "hgb"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white",
                )}
              >
                HGB
              </button>
              <button
                type="button"
                onClick={() => setSelectedModel("ts")}
                className={cn(
                  "rounded px-2 py-1 text-xs font-semibold transition",
                  selectedModel === "ts"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white",
                )}
              >
                Transformer
              </button>
            </div>

            {revealed && (
              <button
                type="button"
                onClick={() => setShowFailuresOnly(!showFailuresOnly)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-semibold border transition flex items-center gap-1.5",
                  showFailuresOnly
                    ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                    : "border-border/60 bg-slate-900 text-slate-300 hover:bg-slate-800",
                )}
              >
                <span>{t("replay.show_failures_only")}</span>
                <span className="font-mono text-xs rounded-full bg-rose-500/20 px-1.5 py-0.2 text-rose-300">
                  {failureCount}
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="h-80 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="period" stroke="#64748b" tick={{ fontSize: 11, fill: "#94a3b8" }} angle={-35} textAnchor="end" />
              <YAxis stroke="#64748b" tick={{ fontSize: 11, fill: "#94a3b8" }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#020617",
                  borderColor: "#334155",
                  borderRadius: "0.75rem",
                  fontSize: "12px",
                  fontFamily: "monospace",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }} />
              <Line
                type="monotone"
                dataKey="modis"
                name={t("replay.modis_raw")}
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="b2_anchor"
                name={t("replay.b2_anchor")}
                stroke="#eab308"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="predicted"
                name={
                  selectedModel === "stan"
                    ? t("replay.model_stan")
                    : selectedModel === "sf"
                    ? t("replay.model_sf")
                    : selectedModel === "hts"
                    ? t("replay.model_hts")
                    : selectedModel === "hgb"
                    ? t("replay.model_hgb")
                    : t("replay.model_ts")
                }
                stroke="#a855f7"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#a855f7" }}
              />
              {revealed && (
                <Line
                  type="monotone"
                  dataKey="viirs"
                  name={t("replay.viirs_actual")}
                  stroke="#14b8a6"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#14b8a6" }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Hidden Reference Overlay Notification */}
        {!revealed && (
          <div className="flex items-center justify-between rounded-xl border border-dashed border-amber-500/40 bg-amber-950/20 p-3.5 text-xs">
            <div className="flex items-center gap-2 text-amber-200">
              <Lock className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                {t("replay.locked_notice")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="font-bold text-amber-300 hover:underline shrink-0 font-mono"
            >
              {t("replay.reveal_now")}
            </button>
          </div>
        )}
      </div>

      {/* Disclosed Error Ledger Table */}
      <div className="rounded-2xl border border-border/80 bg-slate-950/85 p-5 shadow-card backdrop-blur space-y-3">
        <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">
              {t("replay.ledger_title")}
            </h3>
            <p className="text-xs text-slate-400">
              {showFailuresOnly
                ? t("replay.ledger_sub_failures", { count: displayedMonths.length })
                : t("replay.ledger_sub_all", { count: displayedMonths.length })}
            </p>
          </div>
          <span className="font-mono text-xs text-cyan-400 font-semibold">
            {t("replay.months_count", { count: displayedMonths.length })}
          </span>
        </div>

        <div className="max-h-72 overflow-y-auto overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="sticky top-0 bg-slate-950 border-b border-border/60 text-xs uppercase text-slate-400">
              <tr>
                <th className="p-2">{t("replay.th_period")}</th>
                <th className="p-2 text-right">{t("replay.th_modis")}</th>
                <th className="p-2 text-right">{t("replay.th_b2")}</th>
                <th className="p-2 text-right">{t("replay.th_pred")}</th>
                <th className="p-2 text-right">{t("replay.th_viirs")}</th>
                <th className="p-2 text-right">{t("replay.th_residual")}</th>
                <th className="p-2 text-center">{t("replay.th_status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y border-border/30">
              {displayedMonths.map((m, idx) => {
                return (
                  <tr key={idx} className="hover:bg-white/5 transition-colors">
                    <td className="p-2 font-bold text-slate-200">{m.period}</td>
                    <td className="p-2 text-right text-blue-400 font-semibold">{num(m.modis)}</td>
                    <td className="p-2 text-right text-amber-300">{num(m.b2_anchor)}</td>
                    <td className="p-2 text-right text-purple-300 font-semibold">{num(m.predicted)}</td>
                    <td className="p-2 text-right text-teal-300 font-bold">
                      {revealed && m.viirs !== null ? num(m.viirs) : t("replay.status_locked")}
                    </td>
                    <td className="p-2 text-right text-slate-300">
                      {revealed && m.viirs !== null ? `${m.residual > 0 ? "+" : ""}${m.residual}` : "-"}
                    </td>
                    <td className="p-2 text-center">
                      {!revealed ? (
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                          {t("replay.status_blind")}
                        </span>
                      ) : m.isFailure ? (
                        <span className="rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-400">
                          {t("replay.status_lost")}
                        </span>
                      ) : (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-400">
                          {t("replay.status_beat")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
