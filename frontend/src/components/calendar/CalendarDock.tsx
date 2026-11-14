import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Database, Globe, Info, Sparkles, Table as TableIcon } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { backendMethod, type CalibMethod } from "@/lib/researchContext";
import { cn, compact } from "@/lib/utils";
import { DataStatus } from "@/components/common/DataStatus";
import { IntegratedAiAssistant } from "@/components/ai/IntegratedAiAssistant";

export type DockTab = "overview" | "month" | "ai";

export interface ActiveMonth {
  year: number;
  month: number;
  val: number | null;
  z: number | null;
  isPartial?: boolean;
}

interface CalendarDockProps {
  open: boolean;
  onToggle: () => void;
  tab: DockTab;
  onTabChange: (tab: DockTab) => void;
  aoi: string;
  onSelectAoi: (aoi: string) => void;
  data: string;
  onSelectDataFeed?: (feed: "raw" | "sample") => void;
  method: CalibMethod;
  onSelectMethod: (method: CalibMethod) => void;
  totalDetections: number;
  totalHarmonized: number;
  anomalyCount: number;
  activeMonth: ActiveMonth | null;
  onShowMonthOnMap: (ym: string) => void;
  onOpenMatrix: () => void;
}

const AOI_OPTIONS = [
  { id: "vietnam", key: "aoi.vietnam_short" },
  { id: "amazon", key: "aoi.amazon_short" },
  { id: "australia", key: "aoi.australia_short" },
];

function anomalyLabel(z: number | null, t: (k: string) => string): { text: string; tone: string } {
  if (z === null) return { text: t("calendar.dock_z_no_data"), tone: "text-slate-400" };
  if (z >= 2) return { text: t("calendar.dock_z_unusually_high"), tone: "text-rose-300" };
  if (z >= 1) return { text: t("calendar.dock_z_above_typical"), tone: "text-amber-300" };
  if (z <= -1) return { text: t("calendar.dock_z_below_typical"), tone: "text-sky-300" };
  return { text: t("calendar.dock_z_within_typical"), tone: "text-emerald-300" };
}

export function CalendarDock({
  open,
  onToggle,
  tab,
  onTabChange,
  aoi,
  onSelectAoi,
  data,
  onSelectDataFeed,
  method,
  onSelectMethod,
  totalDetections,
  totalHarmonized,
  anomalyCount,
  activeMonth,
  onShowMonthOnMap,
  onOpenMatrix,
}: CalendarDockProps) {
  const { t } = useLang();
  const isSynthetic = data !== "raw";
  const ym = activeMonth ? `${activeMonth.year}-${String(activeMonth.month).padStart(2, "0")}` : null;

  const tabs: Array<{ id: DockTab; label: string }> = [
    { id: "overview", label: t("calendar.dock_overview") },
    { id: "month", label: t("calendar.dock_selected_month") },
    { id: "ai", label: t("calendar.dock_ai") },
  ];

  if (!open) {
    return (
      <aside aria-label="Fire activity inspector"
        className="relative z-10 flex w-11 shrink-0 flex-col items-center gap-3 border-l border-slate-800 bg-[#0B1220] py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={t("calendar.dock_overview")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            onTabChange("ai");
            onToggle();
          }}
          aria-label={t("calendar.dock_ai")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-purple-300 hover:bg-slate-800"
        >
          <Sparkles className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside aria-label="Fire activity inspector"
      className="absolute inset-y-0 right-0 z-[1300] flex w-[min(360px,calc(100vw-20px))] shrink-0 flex-col border-l border-slate-800 bg-[#0B1220] shadow-2xl lg:static lg:z-auto lg:w-[340px] lg:shadow-none">
      <div className="flex shrink-0 items-center gap-1 border-b border-slate-800 px-2 py-2">
        <div className="flex flex-1 items-center gap-1 rounded-lg bg-slate-900/80 p-1" role="tablist">
          {tabs.map((tabItem) => (
            <button
              key={tabItem.id}
              type="button"
              role="tab"
              aria-selected={tab === tabItem.id}
              onClick={() => onTabChange(tabItem.id)}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition",
                tab === tabItem.id ? "bg-slate-700/80 text-white" : "text-slate-400 hover:text-white",
              )}
            >
              {tabItem.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label={t("common.close_menu")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {tab === "overview" && (
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("calendar.dock_aoi_title")}
            </h2>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-900/80 p-1">
              {AOI_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onSelectAoi(o.id)}
                  className={cn(
                    "rounded-md py-2 text-sm font-medium transition",
                    aoi === o.id ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:text-white",
                  )}
                >
                  {t(o.key)}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("calendar.dock_feed_title")}
            </h2>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-900/80 p-1">
              <button
                type="button"
                onClick={() => onSelectDataFeed?.("raw")}
                className={cn(
                  "rounded-md py-1.5 px-2 text-xs font-semibold transition flex items-center justify-center gap-1.5",
                  !isSynthetic
                    ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 shadow-sm"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/60",
                )}
              >
                <Database className="h-3.5 w-3.5 shrink-0" />
                <span>NASA Raw</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectDataFeed?.("sample")}
                className={cn(
                  "rounded-md py-1.5 px-2 text-xs font-semibold transition flex items-center justify-center gap-1.5",
                  isSynthetic
                    ? "bg-sky-500/25 text-sky-300 border border-sky-500/40 shadow-sm"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/60",
                )}
              >
                <span>Sample</span>
              </button>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("calendar.dock_calibration_title")}
            </h2>
            <div className="grid gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (isSynthetic) onSelectDataFeed?.("raw");
                  onSelectMethod?.("stan");
                }}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition",
                  method === "stan"
                    ? "border-emerald-500/50 bg-emerald-950/25"
                    : "border-slate-800 bg-slate-900/50 hover:border-slate-700",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">STAN</span>
                  <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                    main
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-slate-400">
                  {t("calendar.stan_desc")}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (isSynthetic) onSelectDataFeed?.("raw");
                  onSelectMethod?.("hts_anchor");
                }}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition",
                  method === "hts_anchor"
                    ? "border-amber-500/50 bg-amber-950/20"
                    : "border-slate-800 bg-slate-900/50 hover:border-slate-700",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">HTS</span>
                  <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                    fallback
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-slate-400">
                  {t("calendar.hts_desc")}
                </span>
              </button>

              <button
                type="button"
                onClick={() => onSelectMethod?.("k_ratio")}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition",
                  method === "k_ratio"
                    ? "border-cyan-500/50 bg-cyan-950/30"
                    : "border-slate-800 bg-slate-900/50 hover:border-slate-700",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">B2 anchor</span>
                  <span className="rounded border border-slate-600/40 bg-slate-700/20 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                    baseline
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-slate-400">
                  {t("calendar.b2_desc")}
                </span>
              </button>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-400">{t("common.detections")}</p>
              <p className="mt-1 font-mono text-lg font-semibold text-white">{totalDetections.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-400">{t("calendar.kpi_calibrated")}</p>
              <p className="mt-1 font-mono text-lg font-semibold text-cyan-300">{compact(totalHarmonized)}</p>
            </div>
            <div className="col-span-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-400">{t("calendar.kpi_anomalous")}</p>
              <p className="mt-1 font-mono text-lg font-semibold text-orange-300">{anomalyCount}</p>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("calendar.dock_sensor_title")}
            </h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="pb-2 font-medium">{t("calendar.th_sensor")}</th>
                  <th className="pb-2 font-medium">{t("calendar.th_resolution")}</th>
                  <th className="pb-2 text-right font-medium">{t("calendar.th_period")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                <tr>
                  <td className="py-2 font-medium text-teal-300">VIIRS</td>
                  <td className="py-2 text-slate-300">375 m</td>
                  <td className="py-2 text-right font-mono text-slate-400">2012-2025</td>
                </tr>
                <tr>
                  <td className="py-2 font-medium text-blue-300">MODIS</td>
                  <td className="py-2 text-slate-300">1 km</td>
                  <td className="py-2 text-right font-mono text-slate-400">2001-2025</td>
                </tr>
              </tbody>
            </table>
          </section>

          <DataStatus state={isSynthetic ? "synthetic" : "observed"} />

          <button
            type="button"
            onClick={onOpenMatrix}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 py-2.5 text-sm font-medium text-slate-200 transition hover:border-cyan-500/50 hover:text-white"
          >
            <TableIcon className="h-4 w-4" />
            {t("calendar.dock_view_matrix_btn")}
          </button>
        </div>
      )}

      {tab === "month" && (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {activeMonth && ym ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-slate-400">{t("calendar.month_selected")}</p>
                <p className="mt-0.5 text-xl font-semibold text-white">
                  {t("calendar.dock_month_format", { month: activeMonth.month, year: activeMonth.year })}
                </p>
                <p className={cn("mt-1 text-sm font-medium", anomalyLabel(activeMonth.z, t).tone)}>
                  {anomalyLabel(activeMonth.z, t).text}
                </p>
              </div>

              <dl className="divide-y divide-slate-800 rounded-lg border border-slate-800 text-sm">
                <div className="flex justify-between px-3 py-2.5">
                  <dt className="text-slate-400">{t("calendar.month_val")}</dt>
                  <dd className="font-mono text-white">{activeMonth.val === null ? "-" : activeMonth.val.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between px-3 py-2.5">
                  <dt className="text-slate-400">{t("calendar.month_z")}</dt>
                  <dd className="font-mono text-white">{activeMonth.z === null ? "-" : activeMonth.z.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between px-3 py-2.5">
                  <dt className="text-slate-400">{t("calendar.month_coverage")}</dt>
                  <dd className={activeMonth.isPartial ? "text-amber-300" : "text-slate-200"}>
                    {activeMonth.isPartial ? t("calendar.dock_partial") : t("calendar.dock_complete")}
                  </dd>
                </div>
              </dl>

              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => onShowMonthOnMap(ym)}
                  className="flex items-center justify-center gap-2 rounded-lg bg-cyan-600 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500"
                >
                  <Globe className="h-4 w-4" />
                  {t("calendar.month_show_on_map")}
                </button>
                <button
                  type="button"
                  onClick={() => onTabChange("ai")}
                  className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 py-2.5 text-sm font-medium text-slate-200 hover:border-purple-400/60 hover:text-white"
                >
                  <Sparkles className="h-4 w-4 text-purple-300" />
                  {t("calendar.month_explain_ai")}
                </button>
                <Link
                  to={`/evidence?aoi=${aoi}&data=${data}&ym=${ym}`}
                  className="flex items-center justify-center rounded-lg border border-slate-700 py-2.5 text-sm font-medium text-slate-200 hover:border-slate-500 hover:text-white"
                >
                  {t("calendar.month_evidence")}
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-800 px-4 py-8 text-center">
              <Info className="h-5 w-5 text-slate-500" />
              <p className="text-sm text-slate-300">
                {t("calendar.no_month_selected")}
              </p>
              <p className="text-xs text-slate-500">
                {t("calendar.no_month_hint")}
              </p>
              <button
                type="button"
                onClick={onOpenMatrix}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:text-white"
              >
                {t("calendar.open_matrix")}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "ai" && (
        <div className="min-h-0 flex-1">
          <IntegratedAiAssistant
            key={`${aoi}-${data}-${ym ?? "all"}`}
            aoi={aoi}
            data={data}
            method={backendMethod(method)}
            year={activeMonth?.year}
            month={activeMonth?.month}
          />
        </div>
      )}
    </aside>
  );
}
