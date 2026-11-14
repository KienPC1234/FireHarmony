import { useEffect, useRef } from "react";
import { CalendarDays, Eye, Globe, Sparkles, X, Zap } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { cn, compact } from "@/lib/utils";
import type { CalendarResponse } from "@/lib/api";
import type { MonthEvidence } from "@/hooks/useCalendarData";
import { colorFor, type AnomalyPalette } from "./anomaly";

export interface MatrixActiveMonth {
  year: number;
  month: number;
  val: number | null;
  z: number | null;
  coverage: string;
  ratio?: number | null;
  isPartial?: boolean;
  coverageRatio?: number;
}

export type MatrixMode = "compact" | "zscore";

/**
 * CLAIM-017: month × year activity matrix (table + cell buttons) and the
 * month inspector card, extracted from `pages/calendar.tsx`. Cell colors
 * and legend keys funnel through the shared `anomaly` + `map.legend_*`
 * homes; no `calendar.legend_*` reference lives here.
 */
export function CalendarMatrix({
  data,
  activeMonth,
  monthEvidence,
  methodShown,
  matrixMode,
  onMatrixModeChange,
  paletteMode,
  onPaletteModeChange,
  onSelectMonth,
  onCloseMonth,
  onPreviewPeriod,
  onLaunchMap,
  onExplainAi,
  onOpenMap,
}: {
  data: CalendarResponse;
  activeMonth: MatrixActiveMonth | null;
  monthEvidence: MonthEvidence | null;
  methodShown: string;
  matrixMode: MatrixMode;
  onMatrixModeChange: (mode: MatrixMode) => void;
  paletteMode: AnomalyPalette;
  onPaletteModeChange: (palette: AnomalyPalette) => void;
  onSelectMonth: (m: MatrixActiveMonth) => void;
  onCloseMonth: () => void;
  onPreviewPeriod: (ym: string) => void;
  onLaunchMap: (ym: string) => void;
  onExplainAi: (ym: string) => void;
  onOpenMap: () => void;
}) {
  const { t } = useLang();
  const detailRef = useRef<HTMLDivElement>(null);

  // CLAIM-025: Escape closes the month inspector; focus moves into the
  // dialog on open so keyboard users land inside it.
  useEffect(() => {
    if (!activeMonth) return;
    detailRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseMonth();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeMonth, onCloseMonth]);

  return (
    <>
      {/* Matrix Card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-cyan-400" />
              <h2 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                {t("calendar.matrix_title")}
              </h2>
              <span className="text-xs text-slate-400 font-mono">
                ({data.calendar.years[0] ?? "-"} - {data.calendar.years.at(-1) ?? "-"})
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {t("calendar.matrix_desc")}
            </p>
          </div>

          {/* Mode Toggle & Map CTA */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => onMatrixModeChange("compact")}
                className={cn(
                  "rounded px-2.5 py-1 font-medium transition min-h-[32px]",
                  matrixMode === "compact"
                    ? "bg-cyan-500/20 text-cyan-300 font-semibold"
                    : "text-slate-400 hover:text-white",
                )}
              >
                {t("calendar.matrix_mode_values")}
              </button>
              <button
                type="button"
                onClick={() => onMatrixModeChange("zscore")}
                className={cn(
                  "rounded px-2.5 py-1 font-medium transition min-h-[32px]",
                  matrixMode === "zscore"
                    ? "bg-cyan-500/20 text-cyan-300 font-semibold"
                    : "text-slate-400 hover:text-white",
                )}
              >
                {t("calendar.matrix_mode_zscore")}
              </button>
            </div>

            <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => onPaletteModeChange("standard")}
                className={cn(
                  "rounded px-2.5 py-1 font-medium transition min-h-[32px]",
                  paletteMode === "standard"
                    ? "bg-cyan-500/20 text-cyan-300 font-semibold"
                    : "text-slate-400 hover:text-white",
                )}
                title={t("calendar.palette_standard_title")}
              >
                {t("calendar.palette_standard")}
              </button>
              <button
                type="button"
                onClick={() => onPaletteModeChange("accessible")}
                className={cn(
                  "rounded px-2.5 py-1 font-medium transition min-h-[32px] inline-flex items-center gap-1",
                  paletteMode === "accessible"
                    ? "bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30"
                    : "text-slate-400 hover:text-white",
                )}
                title={t("calendar.palette_accessible_title")}
              >
                <Eye className="h-3.5 w-3.5 text-emerald-400" />
                <span>{t("calendar.palette_accessible")}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onOpenMap}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/40 px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-900/60 transition min-h-[36px]"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>{t("calendar.matrix_launch_map")}</span>
            </button>
          </div>
        </div>

        {/* Top Historical Anomalies Quick Jump Strip */}
        {data.critical_periods && data.critical_periods.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-2 border-b border-slate-800/80">
            <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1 shrink-0 font-mono">
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              <span>{t("calendar.anomalies_highlight")}</span>
            </span>
            {data.critical_periods.slice(0, 10).map((cp) => {
              const periodKey = `${cp.year}-${String(cp.month).padStart(2, "0")}`;
              const isCurrent = activeMonth?.year === cp.year && activeMonth?.month === cp.month;
              return (
                <button
                  key={periodKey}
                  type="button"
                  onClick={() => {
                    onSelectMonth({
                      year: cp.year,
                      month: cp.month,
                      val: cp.count,
                      z: cp.z,
                      coverage: t("common.complete_coverage"),
                      isPartial: false,
                    });
                    onPreviewPeriod(periodKey);
                  }}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-mono transition shrink-0 flex items-center gap-1.5 min-h-[28px] border",
                    isCurrent
                      ? "bg-rose-500/25 text-rose-200 border-rose-500/50 font-bold shadow-sm"
                      : "border-slate-800 bg-slate-900/90 text-slate-300 hover:text-white hover:border-slate-700"
                  )}
                >
                  <span className="font-semibold">{periodKey}</span>
                  <span className="text-amber-400 font-bold text-[11px]">{cp.z > 0 ? `+${cp.z.toFixed(1)}σ` : `${cp.z.toFixed(1)}σ`}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Matrix Table Element */}
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/90 max-h-[460px] overflow-y-auto">
          <table className="w-full border-collapse text-center text-xs tabular-nums">
            <thead className="sticky top-0 bg-slate-950 z-10 border-b border-slate-800 text-slate-300">
              <tr>
                <th className="p-2.5 text-left font-semibold text-slate-400">{t("calendar.matrix_year")}</th>
                {data.calendar.months.map((m) => (
                  <th key={m} className="p-1.5 font-semibold">
                    {t("calendar.matrix_month_prefix")}{String(m).padStart(2, "0")}
                  </th>
                ))}
                <th className="p-2.5 font-bold text-cyan-400">{t("calendar.matrix_total")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40 font-mono text-xs">
              {data.calendar.years.map((y, yi) => (
                <tr key={y} className="hover:bg-white/[0.04] transition-colors">
                  <th className="p-2 text-left font-bold text-slate-300">{y}</th>
                  {data.calendar.months.map((m, mi) => {
                    const v = data.calendar.matrix[yi]?.[mi] ?? null;
                    const z = data.calendar.anomalies[yi]?.[mi] ?? null;
                    const ck = `${y}-${String(m).padStart(2, "0")}`;
                    const cinfo = data.calendar.completeness?.[ck];
                    const isPartial = cinfo?.partial === true;
                    const isSelected = activeMonth?.year === y && activeMonth?.month === m;

                    const cellDisplay = (() => {
                      if (v === null) return "-";
                      if (matrixMode === "zscore") return z == null ? "-" : `${z > 0 ? "+" : ""}${z.toFixed(1)}`;
                      return compact(v);
                    })();

                    const label = `${y}-${String(m).padStart(2, "0")}: ${
                      v === null ? t("common.no_data") : `${v.toLocaleString()} ${t("common.detections")}`
                    }, z=${z == null ? "-" : z.toFixed(1)}${isPartial ? `, ${t("common.partial_coverage")}` : ""}`;
                    return (
                      <td key={m} className="p-0.5 border border-slate-800/40">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectMonth({
                              year: y,
                              month: m,
                              val: v,
                              z,
                              coverage: isPartial
                                ? t("common.partial_coverage")
                                : t("common.complete_coverage"),
                              ratio: z,
                              isPartial,
                              coverageRatio: cinfo?.coverage_ratio ?? undefined,
                            });
                            onPreviewPeriod(ck);
                          }}
                          aria-label={label}
                          title={label}
                          className={cn(
                            "w-full rounded px-1 py-1.5 transition-[background-color,border-color,color,transform] duration-150 select-none text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                            colorFor(z, paletteMode),
                            isSelected && "ring-2 ring-cyan-400 font-bold shadow-md",
                          )}
                        >
                          {cellDisplay}
                        </button>
                      </td>
                    );
                  })}
                  <td className="p-2 font-bold text-slate-100 bg-slate-900/50">
                    {compact(data.calendar.row_totals[yi])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active Month Detail Card */}
      {activeMonth && (
        <div
          ref={detailRef}
          tabIndex={-1}
          role="dialog"
          aria-label={t("calendar.month_audit_title", {
            month: String(activeMonth.month).padStart(2, "0"),
            year: activeMonth.year,
          })}
          data-fh-popover
          className="rounded-2xl border border-cyan-500/40 bg-slate-950/95 p-5 shadow-2xl space-y-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-950 border border-cyan-500/30 text-cyan-300 font-mono font-bold text-sm">
                {activeMonth.month}
              </div>
              <div>
                <span className="font-bold text-white text-base">
                  {t("calendar.month_audit_title", {
                    month: String(activeMonth.month).padStart(2, "0"),
                    year: activeMonth.year,
                  })}
                </span>
                <p className="text-xs text-slate-400">
                  {t("calendar.month_audit_desc")}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onLaunchMap(`${activeMonth.year}-${String(activeMonth.month).padStart(2, "0")}`)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-3.5 py-2 text-xs font-bold text-white transition min-h-[40px]"
              >
                <Globe className="h-3.5 w-3.5" />
                <span>{t("calendar.matrix_launch_map")}</span>
              </button>
              <button
                type="button"
                onClick={() => onExplainAi(`${activeMonth.year}-${String(activeMonth.month).padStart(2, "0")}`)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition min-h-[40px]"
              >
                <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                <span>{t("calendar.month_explain_ai")}</span>
              </button>
              <button
                type="button"
                onClick={onCloseMonth}
                className="text-slate-400 hover:text-white p-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                aria-label={t("common.close_menu")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="rounded-xl bg-slate-900/80 p-3 border border-slate-800 space-y-1">
              <span className="text-slate-400 text-xs block font-sans">
                {t("calendar.month_val")}
              </span>
              <span className="text-white font-bold text-lg">
                {activeMonth.val == null ? "-" : activeMonth.val.toLocaleString()}
              </span>
            </div>

            <div className="rounded-xl bg-slate-900/80 p-3 border border-slate-800 space-y-1">
              <span className="text-slate-400 text-xs block font-sans">
                {t("calendar.month_z")}
              </span>
              <span className="text-cyan-300 font-bold text-lg">
                {activeMonth.z == null ? "-" : activeMonth.z.toFixed(2)}
              </span>
            </div>

            <div className="rounded-xl bg-slate-900/80 p-3 border border-slate-800 space-y-1">
              <span className="text-slate-400 text-xs block font-sans">
                {t("calendar.dock_calibration_title")}
              </span>
              <span className="text-purple-300 font-semibold text-sm">
                {monthEvidence?.effective_method || methodShown}
              </span>
              <span className="block text-[11px] text-slate-500">
                {t("calendar.month_method_note", {
                  method: monthEvidence?.effective_method || methodShown,
                })}
              </span>
              {monthEvidence?.notes?.length ? (
                <span className="mt-1 block text-[11px] leading-snug text-amber-300/90">
                  {monthEvidence.notes[monthEvidence.notes.length - 1]}
                </span>
              ) : null}
            </div>

            <div className="rounded-xl bg-slate-900/80 p-3 border border-slate-800 space-y-1">
              <span className="text-slate-400 text-xs block font-sans">
                {t("calendar.month_coverage")}
              </span>
              <span className="text-emerald-400 font-semibold text-sm">
                {activeMonth.coverage}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
