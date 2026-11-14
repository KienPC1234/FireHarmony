import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  Globe,
  ScanEye,
  Sparkles,
  Table as TableIcon,
  X,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type CalendarResponse } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { backendMethod, useResearchContext, type AoiId } from "@/lib/researchContext";
import { ErrorState, Loading } from "@/components/states";
import { AoiMap } from "@/components/AoiMap";
import { SCENARIO_PRESETS, type ScenarioPreset } from "@/components/calendar/calendarPresets";
import type { FireZone } from "@/components/map/clusterZones";
import { CalendarDock, type DockTab } from "@/components/calendar/CalendarDock";
import { SeasonComparisonCard } from "@/components/calendar/SeasonComparisonCard";
import { MapTimeScrubber } from "@/components/calendar/MapTimeScrubber";
import { Footer } from "@/components/Footer";
import { cn, compact } from "@/lib/utils";

function colorFor(z: number | null): string {
  if (z === null || z === undefined) return "bg-slate-900/60 text-slate-500 border-slate-800/50";
  if (z >= 3) return "bg-rose-950/90 text-rose-200 border-rose-600/70 font-bold shadow-[inset_0_0_10px_rgba(225,29,72,0.35)]";
  if (z >= 2) return "bg-orange-950/80 text-orange-200 border-orange-600/60 font-semibold";
  if (z >= 1) return "bg-amber-950/50 text-amber-200 border-amber-700/50";
  if (z <= -1.5) return "bg-blue-950/70 text-blue-200 border-blue-700/50";
  if (z <= -0.75) return "bg-sky-950/50 text-sky-200 border-sky-800/40";
  return "bg-slate-900/70 text-slate-300 border-slate-800/60";
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
  const { aoi, dataFeed, setAoi, setDataFeed, method, setMethod } = useResearchContext();
  const [search, setSearch] = useSearchParams();

  // Tab: map (default), matrix, scenarios
  const [activeTab, setActiveTab] = useState<"map" | "matrix" | "scenarios">("map");

  // Dock controls
  const [dockOpen, setDockOpen] = useState(true);
  const [dockTab, setDockTab] = useState<DockTab>("overview");

  // Matrix display mode: values vs z-score
  const [matrixMode, setMatrixMode] = useState<"compact" | "zscore">("compact");

  // Map temporal filter
  const [mapPeriod, setMapPeriod] = useState<string>("all");
  const [activeZone, setActiveZone] = useState<FireZone | null>(null);

  // Data state
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Filters state
  const [, setBbox] = useState<string>(AOI_BBOX[aoi] ?? AOI_BBOX.vietnam);

  const [activeMonth, setActiveMonth] = useState<{
    year: number;
    month: number;
    val: number | null;
    z: number | null;
    coverage: string;
    ratio?: number | null;
    isPartial?: boolean;
    coverageRatio?: number;
  } | null>(null);

  const [applied, setApplied] = useState<{
    bbox: string;
    aoi: string;
    data: string;
    method: string;
    dataset?: string;
    qa_min: string;
    platform_set: string;
  }>({
    bbox: AOI_BBOX[search.get("aoi") || aoi] ?? AOI_BBOX.vietnam,
    aoi: search.get("aoi") || aoi,
    data: dataFeed,
    // Never fire a 409 on first paint: HTS needs raw, the sample has no tiles.
    method: (method === "hts_anchor" || method === "stan") && dataFeed !== "raw"
      ? "stat"
      : backendMethod(method),
    dataset: search.get("dataset") || undefined,
    qa_min: search.get("qa_min") || "all",
    platform_set: search.get("platform_set") || "all",
  });

  const prevFeed = useRef(dataFeed);
  useEffect(() => {
    if (prevFeed.current !== dataFeed) {
      if (dataFeed === "raw" && method === "k_ratio") setMethod("stan");
      if (dataFeed === "sample" && method === "stan") setMethod("k_ratio");
      prevFeed.current = dataFeed;
    }
  }, [dataFeed, method, setMethod]);

  useEffect(() => {
    if ((method === "hts_anchor" || method === "stan") && dataFeed !== "raw") {
      setMethod("k_ratio");
      return;
    }
    const bm = backendMethod(method);
    setApplied((prev) => (prev.method === bm ? prev : { ...prev, method: bm }));
  }, [method, dataFeed, setMethod]);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .calendar(
        25000,
        applied.bbox || undefined,
        applied.aoi,
        applied.data,
        applied.method,
        applied.dataset,
        applied.qa_min,
        applied.platform_set,
      )
      .then(setData)
      .catch((e) => {
        if (applied.data === "raw") {
          setDataFeed("sample");
          setApplied({ ...applied, data: "sample" });
          return;
        }
        setError(e);
      });
  }, [applied, setDataFeed]);

  // URL sync is intentionally keyed on `applied`; including `search` would
  // re-run on the write it performs.
  useEffect(() => {
    const next = new URLSearchParams(search);
    next.set("aoi", applied.aoi);
    next.set("data", applied.data);
    next.set("qa_min", applied.qa_min);
    next.set("platform_set", applied.platform_set);
    if (applied.dataset) next.set("dataset", applied.dataset);
    setSearch(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  const periods = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const d of data.daily) {
      if (d.date) set.add(String(d.date).slice(0, 7));
    }
    return Array.from(set).sort();
  }, [data]);

  const mapCells = useMemo(() => {
    if (!data) return [];
    const rows = mapPeriod === "all" ? data.daily : data.daily.filter((d) => String(d.date).slice(0, 7) === mapPeriod);
    return rows.map((d) => ({
      lat: Number(d.lat),
      lon: Number(d.lon),
      harmonized_count: Number(d.harmonized_count),
      date: String(d.date),
      estimate_type: String(d.estimate_type ?? ""),
    }));
  }, [data, mapPeriod]);

  const yearly = useMemo(
    () => (data ? data.calendar.years.map((y, i) => ({ year: y, detections: data.calendar.row_totals[i] })) : []),
    [data],
  );

  const handleSelectAoi = (newAoi: string) => {
    setAoi(newAoi as AoiId);
    const b = AOI_BBOX[newAoi] ?? "";
    setBbox(b);
    setApplied({
      ...applied,
      aoi: newAoi,
      bbox: b,
    });
  };

  const handleSelectScenario = (sc: ScenarioPreset) => {
    setAoi(sc.aoi as AoiId);
    const b = AOI_BBOX[sc.aoi] ?? "";
    setBbox(b);
    setApplied({
      ...applied,
      aoi: sc.aoi,
      bbox: b,
    });
    setMapPeriod(`${sc.year}-${String(sc.month).padStart(2, "0")}`);
    setActiveTab("map");
  };

  if (error) return <ErrorState error={error} onRetry={() => setApplied({ ...applied })} />;
  if (!data) return <Loading label={t("common.loading")} />;

  const isSynthetic = applied.data === "sample";
  const totalObserved = data.daily?.reduce((sum, d) => sum + (Number(d.count) || 1), 0) ?? 0;
  const totalHarmonized = data.calendar?.row_totals?.reduce((sum, v) => sum + (v || 0), 0) ?? 0;
  const criticalCount = data.critical_periods?.length ?? 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full w-full bg-[#060B13] text-slate-100 overflow-hidden">
      {/* 1. TOP HEADER & TELEMETRY STRIP */}
      <header className="border-b border-slate-800 bg-[#0B1220]/95 backdrop-blur-md px-3 sm:px-4 py-2 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 sm:gap-3 shrink-0">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3 flex-wrap lg:flex-nowrap">
          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-cyan-400" />
            <h1 className="whitespace-nowrap text-sm font-bold text-white tracking-tight">
              {t("calendar.title")}
            </h1>
          </div>

          {/* Mode Badge & Playwright Token */}
          {isSynthetic ? (
            <span className="rounded-md border border-sky-500/40 bg-sky-950/40 px-2 py-0.5 text-xs font-mono font-bold text-sky-300">
              SYNTHETIC DEMO
            </span>
          ) : (
            <span className="rounded-md border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 text-xs font-mono font-bold text-emerald-300">
              NASA OBSERVED
            </span>
          )}

          {/* Period Selector integrated cleanly in header (No floating overlay on map) */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-1 text-xs">
            <span className="text-slate-400 font-medium">{t("calendar.period")}</span>
            <select
              value={mapPeriod}
              onChange={(e) => setMapPeriod(e.target.value)}
              className="rounded bg-transparent font-mono text-xs text-cyan-300 focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-slate-900 text-slate-200">{t("calendar.all_months")}</option>
              {periods.map((p) => (
                <option key={p} value={p} className="bg-slate-900 text-slate-200">
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="hidden 2xl:flex items-center gap-2 whitespace-nowrap text-xs text-slate-400 font-mono">
            <span>{compact(totalObserved)} {t("common.hotspots")}</span>
            <span>•</span>
            <span className="text-cyan-300">{compact(totalHarmonized)} k-ratio</span>
            <span>•</span>
            <span className="text-orange-400">{criticalCount} {t("common.anomalies")}</span>
          </div>
        </div>

        {/* View Mode Tabs (Map / Matrix / Scenarios) */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("map")}
            className={cn(
              "flex items-center gap-1 rounded px-2.5 py-1 font-semibold transition min-h-[30px]",
              activeTab === "map"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                : "text-slate-400 hover:text-white",
            )}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>{t("calendar.view_map")}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("matrix")}
            className={cn(
              "flex items-center gap-1 rounded px-2.5 py-1 font-semibold transition min-h-[30px]",
              activeTab === "matrix"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                : "text-slate-400 hover:text-white",
            )}
          >
            <TableIcon className="h-3.5 w-3.5" />
            <span>{t("calendar.view_matrix")}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("scenarios")}
            className={cn(
              "flex items-center gap-1 rounded px-2.5 py-1 font-semibold transition min-h-[30px]",
              activeTab === "scenarios"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                : "text-slate-400 hover:text-white",
            )}
          >
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            <span className="hidden sm:inline">{t("calendar.view_scenarios")}</span>
          </button>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setActiveTab("map");
              setDockTab("ai");
              setDockOpen(true);
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition min-h-[30px]",
              activeTab === "map" && dockOpen && dockTab === "ai"
                ? "border-purple-500/50 bg-purple-950/40 text-purple-200"
                : "border-slate-800 bg-slate-900 text-slate-300 hover:text-purple-300",
            )}
          >
            <Sparkles className="h-3.5 w-3.5 text-purple-400" />
            <span>{t("calendar.ask_ai")}</span>
          </button>

          <Link
            to={`/xray?aoi=${applied.aoi}&data=${applied.data}`}
            className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:text-white transition min-h-[30px]"
          >
            <ScanEye className="h-3.5 w-3.5 text-cyan-400" />
            <span>{t("calendar.xray")}</span>
          </Link>
        </div>
      </header>

      {/* 2. BODY CONTENT */}

      {/* VIEW 1: SATELLITE GIS WORKSTATION (DEFAULT) */}
      {activeTab === "map" && (
        <div className="relative flex-1 min-h-0 w-full h-full flex items-stretch overflow-hidden">
          {/* Main Map Canvas - Clean, Zero Overlapping Floating Box */}
          <div className="relative flex-1 min-h-0 h-full self-stretch flex flex-col overflow-hidden">
            <AoiMap
              key={`${aoi}-${mapPeriod}`}
              center={AOI_CENTER[aoi]?.c ?? [13, 106.5]}
              zoom={AOI_CENTER[aoi]?.z ?? 6}
              bbox={applied.bbox || null}
              cells={mapCells}
              fullBleed={true}
              height="100%"
              hideToolbar={false}
              hideLegend={false}
              activeZoneId={activeZone?.id}
              onSelectZone={(z) => setActiveZone(z)}
              onSelect={(b) => {
                setBbox(b);
                setApplied({ ...applied, bbox: b });
              }}
            />

            {/* Interactive Temporal Scrubber & Playback Bar */}
            {data.calendar?.years && data.calendar.years.length > 0 && (
              <MapTimeScrubber
                currentPeriod={mapPeriod}
                onSelectPeriod={(p) => setMapPeriod(p)}
                availableYears={data.calendar.years}
              />
            )}
          </div>

          {/* Right-Docked NASA FIRMS Tool & Inspection Dock */}
          <CalendarDock
            open={dockOpen}
            onToggle={() => setDockOpen(!dockOpen)}
            tab={dockTab}
            onTabChange={setDockTab}
            aoi={applied.aoi}
            onSelectAoi={handleSelectAoi}
            data={applied.data}
            method={method}
            onSelectMethod={setMethod}
            totalDetections={totalObserved}
            totalHarmonized={totalHarmonized}
            anomalyCount={criticalCount}
            activeMonth={
              activeMonth
                ? {
                    year: activeMonth.year,
                    month: activeMonth.month,
                    val: activeMonth.val,
                    z: activeMonth.z,
                    isPartial: activeMonth.isPartial,
                  }
                : null
            }
            onShowMonthOnMap={(ym) => {
              setMapPeriod(ym);
              setActiveTab("map");
            }}
            onOpenMatrix={() => setActiveTab("matrix")}
          />
        </div>
      )}

      {/* VIEW 2: 25-YEAR ACTIVITY MATRIX */}
      {activeTab === "matrix" && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 max-w-7xl mx-auto w-full">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-1">
              <span className="text-xs text-slate-400 block font-medium">
                {t("calendar.kpi_observed")}
              </span>
              <span className="text-xl sm:text-2xl font-extrabold font-mono text-white">
                {totalObserved.toLocaleString()}
              </span>
              <span className="text-xs text-slate-400 block">
                {t("calendar.kpi_observed_sub")}
              </span>
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
                onClick={() => setActiveTab("map")}
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
            aoi={applied.aoi}
            onSelectPeriod={(ym) => {
              setMapPeriod(ym);
              setActiveTab("map");
            }}
          />

          {/* Matrix Card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-cyan-400" />
                  <h2 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                    {t("calendar.matrix_title")}
                  </h2>
                  <span className="text-xs text-slate-400 font-mono">(2001 - 2025)</span>
                </div>
                <p className="text-xs text-slate-400">
                  {t("calendar.matrix_desc")}
                </p>
              </div>

              {/* Mode Toggle & Map CTA */}
              <div className="flex items-center gap-2.5">
                <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setMatrixMode("compact")}
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
                    onClick={() => setMatrixMode("zscore")}
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

                <button
                  type="button"
                  onClick={() => setActiveTab("map")}
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
                        setActiveMonth({
                          year: cp.year,
                          month: cp.month,
                          val: cp.count,
                          z: cp.z,
                          coverage: t("common.complete_coverage"),
                          isPartial: false,
                        });
                        setMapPeriod(periodKey);
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

                        return (
                          <td
                            key={m}
                            onClick={() => {
                              setActiveMonth({
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
                              setMapPeriod(ck);
                            }}
                            className={cn(
                              "p-1.5 transition-all border border-slate-800/40 cursor-pointer select-none text-xs",
                              colorFor(z),
                              isSelected && "ring-2 ring-cyan-400 z-10 scale-105 font-bold shadow-md",
                            )}
                            title={`${y}-${m}: ${v === null ? t("common.no_data") : `${v.toLocaleString()} (z=${z ?? 0})`}`}
                          >
                            {cellDisplay}
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
            <div className="rounded-2xl border border-cyan-500/40 bg-slate-950/95 p-5 shadow-2xl space-y-4">
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
                    onClick={() => {
                      setMapPeriod(`${activeMonth.year}-${String(activeMonth.month).padStart(2, "0")}`);
                      setActiveTab("map");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-3.5 py-2 text-xs font-bold text-white transition min-h-[40px]"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    <span>{t("calendar.matrix_launch_map")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMapPeriod(`${activeMonth.year}-${String(activeMonth.month).padStart(2, "0")}`);
                      setActiveTab("map");
                      setDockTab("ai");
                      setDockOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition min-h-[40px]"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                    <span>{t("calendar.month_explain_ai")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveMonth(null)}
                    className="text-slate-400 hover:text-white p-2 rounded-lg"
                    aria-label="Close month detail"
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
                    SensorFormer anchor
                  </span>
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

          {/* Multi-Year Seasonal Profile Curve Comparator */}
          {data.calendar && data.calendar.years && data.calendar.years.length > 1 && (
            <SeasonComparisonCard
              years={data.calendar.years}
              matrix={data.calendar.matrix}
              months={data.calendar.months}
              aoi={applied.aoi}
              onSelectPeriod={(period) => {
                setMapPeriod(period);
                setActiveTab("map");
              }}
            />
          )}

          {/* 25-Year Trend Chart */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="space-y-0.5">
                <h3 className="text-sm font-bold text-white">
                  {t("calendar.multi_decadal_trend")}
                </h3>
                <p className="text-xs text-slate-400">
                  {t("calendar.annual_index_desc")}
                </p>
              </div>
              <span className="font-mono text-xs text-orange-400">{t("calendar.years_tracked_badge")}</span>
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

          <Footer />
        </div>
      )}

      {/* VIEW 3: BENCHMARK SCENARIOS */}
      {activeTab === "scenarios" && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 max-w-6xl mx-auto w-full">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-white">
              {t("scenarios.section_title")}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              {t("scenarios.section_desc")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SCENARIO_PRESETS.map((sc) => {
              const titleKey = `scenarios.${sc.id.replace(/-/g, "_")}_title`;
              const descKey = `scenarios.${sc.id.replace(/-/g, "_")}_desc`;
              return (
                <div
                  key={sc.id}
                  onClick={() => handleSelectScenario(sc)}
                  className="cursor-pointer rounded-2xl border border-slate-800 bg-slate-950/80 p-5 space-y-3 hover:border-cyan-500/50 hover:bg-slate-900/60 transition group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-cyan-400 uppercase">
                      {sc.aoi} • {sc.year}-{String(sc.month).padStart(2, "0")}
                    </span>
                    <Zap className="h-4 w-4 text-amber-400 group-hover:scale-110 transition-transform" />
                  </div>
                  <h3 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                    {t(titleKey)}
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {t(descKey)}
                  </p>
                  <div className="pt-2 flex items-center justify-between text-xs text-cyan-400 font-semibold">
                    <span>{t("scenarios.load_btn")}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <Footer />
        </div>
      )}

    </div>
  );
}
