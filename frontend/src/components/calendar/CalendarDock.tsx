import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Database, Globe, Info, Sparkles, Table as TableIcon } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { backendMethod, useResearchContext, type CalibMethod } from "@/lib/researchContext";
import { cn, compact } from "@/lib/utils";
import { anomalyLabel } from "./anomaly";
import { SENSOR_LEGEND_KEYS } from "../map/sensorLegend";
import { DataStatus } from "@/components/common/DataStatus";
import { IntegratedAiAssistant } from "@/components/ai/IntegratedAiAssistant";

export type DockTab = "overview" | "month" | "ai";

export interface SavedCustomAoi {
  id: string;
  name: string;
  baseAoi: string;
  bbox: string;
  geometry: string | null;
}

export type CustomAoiProbe =
  | { status: "pending" }
  | { status: "ready"; from: string | null; to: string | null }
  | { status: "empty" }
  | { status: "error" };

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
  sourceType?: "all" | "land" | "vegetation";
  onSelectSourceType?: (val: "all" | "land" | "vegetation") => void;
  qaMin?: string;
  onSelectQaMin?: (val: string) => void;
  platformSet?: string;
  onSelectPlatformSet?: (val: string) => void;
  daynight?: "all" | "D" | "N";
  onSelectDaynight?: (val: "all" | "D" | "N") => void;
  minFrp?: number;
  onSelectMinFrp?: (val: number) => void;
  onResetFilters?: () => void;
  totalDetections: number;
  totalHarmonized: number;
  anomalyCount: number;
  activeMonth: ActiveMonth | null;
  onShowMonthOnMap: (ym: string) => void;
  onOpenMatrix: () => void;
  customAois?: SavedCustomAoi[];
  aoiProbes?: Record<string, CustomAoiProbe>;
  onApplyCustomAoi?: (aoi: SavedCustomAoi) => void;
  onDeleteCustomAoi?: (id: string) => void;
  modisRange?: string | null;
  viirsRange?: string | null;
  dataset?: string;
  bbox?: string | null;
}

const AOI_OPTIONS = [
  { id: "vietnam", key: "aoi.vietnam_short" },
  { id: "amazon", key: "aoi.amazon_short" },
  { id: "australia", key: "aoi.australia_short" },
];

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
  sourceType = "all",
  onSelectSourceType,
  qaMin = "all",
  onSelectQaMin,
  platformSet = "all",
  onSelectPlatformSet,
  daynight = "all",
  onSelectDaynight,
  minFrp = 0,
  onSelectMinFrp,
  onResetFilters,
  totalDetections,
  totalHarmonized,
  anomalyCount,
  activeMonth,
  onShowMonthOnMap,
  onOpenMatrix,
  customAois = [],
  aoiProbes = {},
  onApplyCustomAoi,
  onDeleteCustomAoi,
  modisRange = null,
  viirsRange = null,
  dataset,
  bbox = null,
}: CalendarDockProps) {
  const { t } = useLang();
  const { mode, setMode } = useResearchContext();
  const isResearch = mode === "research";
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
                "flex-1 rounded-md px-1.5 py-1.5 text-xs font-medium transition whitespace-nowrap",
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
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <section className="space-y-1.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {t("calendar.dock_aoi_title")}
            </h2>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-900/80 p-1">
              {AOI_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onSelectAoi(o.id)}
                  className={cn(
                    "rounded-md py-1.5 text-xs font-medium transition",
                    aoi === o.id ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:text-white",
                  )}
                >
                  {t(o.key)}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-1.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {t("calendar.custom_aois_title")}
            </h2>
            {customAois.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-800 px-2.5 py-2 text-[11px] leading-snug text-slate-500">
                {t("calendar.custom_aois_empty")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {customAois.map((c) => {
                  const probe = aoiProbes[c.id] ?? { status: "pending" as const };
                  const rangeLabel = probe.status === "ready" && probe.from && probe.to
                    ? `${probe.from.slice(0, 4)}-${probe.to.slice(0, 4)}`
                    : t("calendar.aoi_range_unknown");
                  const statusLabel = probe.status === "ready"
                    ? t("calendar.aoi_status_ready")
                    : probe.status === "empty"
                    ? t("calendar.aoi_status_empty")
                    : probe.status === "error"
                    ? t("calendar.aoi_status_error")
                    : t("calendar.aoi_status_pending");
                  return (
                    <li
                      key={c.id}
                      className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-slate-200" title={c.name}>
                          {c.name}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-cyan-300">
                          {rangeLabel}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500" title={c.bbox}>
                        {c.bbox}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className={cn(
                          "font-mono text-[10px]",
                          probe.status === "ready" ? "text-emerald-300"
                          : probe.status === "pending" ? "text-slate-400"
                          : "text-amber-300",
                        )}>
                          {statusLabel}
                        </span>
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onApplyCustomAoi?.(c)}
                            className="rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/30 transition"
                          >
                            {t("common.apply")}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteCustomAoi?.(c.id)}
                            className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 hover:text-rose-300 hover:border-rose-500/40 transition"
                          >
                            {t("calendar.aoi_delete")}
                          </button>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="space-y-1.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
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
                <span>{t("calendar.feed_raw")}</span>
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
                <span>{t("calendar.feed_sample")}</span>
              </button>
            </div>
          </section>

          {isResearch && (
          <section className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {t("calendar.dock_calibration_title")}
              </h2>
              <span className="font-mono text-[10px] text-slate-400">
                {method === "stan" ? "main" : method === "hts_anchor" ? "fallback" : "baseline"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-900/80 p-1">
              <button
                type="button"
                onClick={() => {
                  if (isSynthetic) onSelectDataFeed?.("raw");
                  onSelectMethod?.("stan");
                }}
                className={cn(
                  "rounded-md py-1.5 px-2 text-xs font-semibold transition",
                  method === "stan"
                    ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40"
                    : "text-slate-400 hover:text-white",
                )}
              >
                STAN
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isSynthetic) onSelectDataFeed?.("raw");
                  onSelectMethod?.("hts_anchor");
                }}
                className={cn(
                  "rounded-md py-1.5 px-2 text-xs font-semibold transition",
                  method === "hts_anchor"
                    ? "bg-amber-500/20 text-amber-200 border border-amber-500/40"
                    : "text-slate-400 hover:text-white",
                )}
              >
                HTS
              </button>
              <button
                type="button"
                onClick={() => onSelectMethod?.("k_ratio")}
                className={cn(
                  "rounded-md py-1.5 px-2 text-xs font-semibold transition",
                  method === "k_ratio"
                    ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/40"
                    : "text-slate-400 hover:text-white",
                )}
              >
                B2
              </button>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-slate-900/40 px-2.5 py-1.5 text-[11px] leading-snug text-slate-300 space-y-1">
              <p>
                {method === "stan"
                  ? t("calendar.stan_summary_short")
                  : method === "hts_anchor"
                  ? t("calendar.hts_summary_short")
                  : t("calendar.b2_summary_short")}
              </p>
              <details className="group">
                <summary className="cursor-pointer select-none text-[10px] font-medium text-slate-400 hover:text-slate-200 transition">
                  {t("calendar.model_details_toggle")}
                </summary>
                <p className="mt-1 pt-1 border-t border-slate-800/70 text-[11px] text-slate-400">
                  {method === "stan"
                    ? t("calendar.stan_desc")
                    : method === "hts_anchor"
                    ? t("calendar.hts_desc")
                    : t("calendar.b2_desc")}
                </p>
              </details>
            </div>
          </section>
          )}

          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t("calendar.dock_filters_title")}
              </h2>
              {(sourceType !== "all" || qaMin !== "all" || platformSet !== "all" || daynight !== "all" || minFrp > 0) && onResetFilters && (
                <button
                  type="button"
                  onClick={onResetFilters}
                  className="text-[10px] font-semibold text-cyan-400 hover:text-cyan-300 transition"
                >
                  {t("calendar.filters_reset")}
                </button>
              )}
            </div>
            <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
              <div>
                <span className="mb-1 block text-[11px] font-medium text-slate-400">
                  {t("calendar.filter_source_type")}
                </span>
                <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-950/80 p-0.5">
                  {([
                    { id: "all", key: "calendar.source_all" },
                    { id: "land", key: "calendar.source_land" },
                    { id: "vegetation", key: "calendar.source_vegetation" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onSelectSourceType?.(opt.id)}
                      className={cn(
                        "rounded px-1.5 py-1 text-[11px] font-medium transition text-center leading-tight",
                        sourceType === opt.id
                          ? "bg-emerald-500/25 text-emerald-200 border border-emerald-500/40"
                          : "text-slate-400 hover:text-white",
                      )}
                    >
                      {t(opt.key)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="mb-1 block text-[11px] font-medium text-slate-400">
                    {t("calendar.filter_qa")}
                  </span>
                  <select
                    aria-label={t("calendar.filter_qa")}
                    value={qaMin}
                    onChange={(e) => onSelectQaMin?.(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:outline-none"
                  >
                    <option value="all">{t("calendar.qa_all")}</option>
                    <option value="nominal">{t("calendar.qa_nominal")}</option>
                    <option value="high">{t("calendar.qa_high")}</option>
                  </select>
                </div>
                <div>
                  <span className="mb-1 block text-[11px] font-medium text-slate-400">
                    {t("calendar.filter_platform")}
                  </span>
                  <select
                    aria-label={t("calendar.filter_platform")}
                    value={platformSet}
                    onChange={(e) => onSelectPlatformSet?.(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:outline-none"
                  >
                    <option value="all">{t("calendar.platform_all")}</option>
                    <option value="snpp">{t("calendar.platform_snpp")}</option>
                  </select>
                </div>
              </div>

              <div>
                <span className="mb-1 block text-[11px] font-medium text-slate-400">
                  {t("calendar.filter_daynight")}
                </span>
                <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-950/80 p-0.5">
                  {([
                    { id: "all", key: "calendar.daynight_all" },
                    { id: "D", key: "calendar.daynight_day" },
                    { id: "N", key: "calendar.daynight_night" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onSelectDaynight?.(opt.id)}
                      className={cn(
                        "rounded px-1.5 py-1 text-[11px] font-medium transition text-center leading-tight",
                        daynight === opt.id
                          ? "bg-amber-500/25 text-amber-200 border border-amber-500/40"
                          : "text-slate-400 hover:text-white",
                      )}
                    >
                      {t(opt.key)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="mb-1 block text-[11px] font-medium text-slate-400">
                  {t("calendar.filter_min_frp")}
                </span>
                <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-950/80 p-0.5">
                  {([
                    { val: 0, key: "calendar.frp_all" },
                    { val: 10, key: "calendar.frp_10" },
                    { val: 50, key: "calendar.frp_50" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => onSelectMinFrp?.(opt.val)}
                      className={cn(
                        "rounded px-1.5 py-1 text-[11px] font-medium transition text-center leading-tight",
                        minFrp === opt.val
                          ? "bg-orange-500/25 text-orange-200 border border-orange-500/40"
                          : "text-slate-400 hover:text-white",
                      )}
                    >
                      {t(opt.key)}
                    </button>
                  ))}
                </div>
              </div>
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

          {isResearch ? (
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
                  <td className="py-2 font-medium text-teal-300">{t(SENSOR_LEGEND_KEYS.viirs)}</td>
                  <td className="py-2 text-slate-300">375 m</td>
                  <td className="py-2 text-right font-mono text-slate-400">{viirsRange ?? t("calendar.sensor_range_loading")}</td>
                </tr>
                <tr>
                  <td className="py-2 font-medium text-blue-300">{t(SENSOR_LEGEND_KEYS.modis)}</td>
                  <td className="py-2 text-slate-300">1 km</td>
                  <td className="py-2 text-right font-mono text-slate-400">{modisRange ?? t("calendar.sensor_range_loading")}</td>
                </tr>
              </tbody>
            </table>
          </section>
          ) : (
            <button
              type="button"
              onClick={() => setMode("research")}
              className="w-full rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-3 py-2 text-left text-[11px] font-medium text-cyan-300 hover:bg-cyan-950/40 transition"
            >
              {t("calendar.switch_to_research")}
            </button>
          )}

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
                  // P2-07: carry the QA/platform filters so the evidence card
                  // quotes the same cells as this calendar view.
                  to={`/evidence?aoi=${aoi}&data=${data}&ym=${ym}&qa_min=${qaMin}&platform_set=${platformSet}`}
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
            key={`${aoi}-${data}-${dataset ?? ""}-${ym ?? "all"}`}
            aoi={aoi}
            data={data}
            method={backendMethod(method)}
            year={activeMonth?.year}
            month={activeMonth?.month}
            dataset={dataset}
            bbox={bbox}
          />
        </div>
      )}
    </aside>
  );
}
