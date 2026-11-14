import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  Download,
  Eye,
  Globe,
  Loader2,
  Printer,
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
import { ErrorState } from "@/components/states";
import { AoiMap } from "@/components/AoiMap";
import { SCENARIO_PRESETS, type ScenarioPreset } from "@/components/calendar/calendarPresets";
import type { HotspotCluster } from "@/components/map/clusterZones";
import { CalendarDock, type DockTab } from "@/components/calendar/CalendarDock";
import { SeasonComparisonCard } from "@/components/calendar/SeasonComparisonCard";
import { MapTimeScrubber } from "@/components/calendar/MapTimeScrubber";
import { Footer } from "@/components/Footer";
import { cn, compact } from "@/lib/utils";

function colorFor(z: number | null, palette: "standard" | "accessible" = "standard"): string {
  if (z === null || z === undefined) return "bg-slate-900/60 text-slate-500 border-slate-800/50";
  if (palette === "accessible") {
    // High-contrast, colorblind-safe (Viridis/Cividis inspired, deuteranopia/protanopia verified)
    if (z >= 3) return "bg-amber-400 text-slate-950 border-2 border-white font-black shadow-[inset_0_0_8px_rgba(255,255,255,0.5)]";
    if (z >= 2) return "bg-amber-500 text-slate-950 border-amber-300 font-bold";
    if (z >= 1) return "bg-amber-800/80 text-amber-100 border-amber-500 font-medium";
    if (z <= -1.5) return "bg-indigo-900/90 text-indigo-100 border-indigo-400 font-bold";
    if (z <= -0.75) return "bg-teal-950/80 text-teal-200 border-teal-600 font-medium";
    return "bg-slate-900/70 text-slate-300 border-slate-800/60";
  }
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

function SlowLoading({ label, hint, unit }: { label: string; hint: string; unit: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div role="status" aria-live="polite" className="flex flex-1 items-center justify-center bg-[#060B13] p-6">
      <div className="max-w-md space-y-3 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-cyan-400" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-200">{label}</p>
        <p className="text-xs text-slate-400">{hint}</p>
        <p className="font-mono text-xs text-cyan-300">{seconds} {unit}</p>
      </div>
    </div>
  );
}

const AOI_BBOX: Record<string, string> = {
  vietnam: "104,10,109,16",
  amazon: "-70,-12,-50,3",
  australia: "113,-39,153,-12",
};

type RangePreset = "all" | "1m" | "12m" | "custom";

function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function CalendarPage() {
  const { t } = useLang();
  const { aoi, dataFeed, mode, setAoi, setDataFeed, method, setMethod } = useResearchContext();
  const [search, setSearch] = useSearchParams();

  // Tab: map (default), matrix, scenarios
  const [activeTab, setActiveTab] = useState<"map" | "matrix" | "scenarios">("map");

  // Dock controls
  // On narrow viewports keep the map usable; the inspector opens as a sheet.
  const [dockOpen, setDockOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  const [dockTab, setDockTab] = useState<DockTab>("overview");

  // Matrix display mode: values vs z-score
  const [matrixMode, setMatrixMode] = useState<"compact" | "zscore">("compact");
  const [paletteMode, setPaletteMode] = useState<"standard" | "accessible">("standard");

  // Map temporal filter
  const [mapPeriod, setMapPeriod] = useState<string>(search.get("ym") || "all");
  const [activeZone, setActiveZone] = useState<HotspotCluster | null>(null);

  // Data state
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [rawUnavailable, setRawUnavailable] = useState<{ status: number; code?: string; message: string } | null>(null);

  // P0-05: one validated range for calendar, map, export and evidence.
  const [rangePreset, setRangePreset] = useState<RangePreset>(
    search.get("from") || search.get("to") ? "custom" : "all",
  );
  const [fromDate, setFromDate] = useState<string>(search.get("from") || "");
  const [toDate, setToDate] = useState<string>(search.get("to") || "");

  // P0-06: map cells for the selected month come from /map-cells, not from
  // the capped /calendar daily slice.
  const [monthCells, setMonthCells] = useState<Array<{
    lat: number; lon: number; harmonized_count: number; date: string; estimate_type: string;
  }>>([]);
  const [mapMeta, setMapMeta] = useState<{ returned: number; total: number; preview: boolean; level: string } | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [monthEvidence, setMonthEvidence] = useState<{
    method_id?: string; effective_method?: string; notes?: string[];
  } | null>(null);

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
    geometry: string | null;
    from_date: string | null;
    to_date: string | null;
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
    geometry: search.get("geometry") || null,
    from_date: search.get("from") || null,
    to_date: search.get("to") || null,
  });

  const prevFeed = useRef(dataFeed);
  useEffect(() => {
    if (prevFeed.current !== dataFeed) {
      if (dataFeed === "raw") {
        if (method === "k_ratio") setMethod("stan");
        // Coerce in the same update so raw does not first run a cold stat pass
        // and then re-run as STAN.
        setApplied((prev) => ({
          ...prev,
          data: "raw",
          method: method === "k_ratio" ? "stan" : prev.method,
        }));
      } else {
        if (method === "stan") setMethod("k_ratio");
        // Switch data and method in one update: sample has no tiles, so a
        // transient method=stan request would 409 before the method sync lands.
        setApplied((prev) => ({
          ...prev,
          data: "sample",
          method: prev.method === "stan" || prev.method === "hts" ? "stat" : prev.method,
        }));
      }
      prevFeed.current = dataFeed;
    }
  }, [dataFeed, method, setMethod]);

  useEffect(() => {
    if ((method === "hts_anchor" || method === "stan") && dataFeed !== "raw") {
      setDataFeed("raw");
      setApplied((prev) => ({ ...prev, data: "raw", method: backendMethod(method) }));
      return;
    }
    const bm = backendMethod(method);
    setApplied((prev) => (prev.method === bm ? prev : { ...prev, method: bm }));
  }, [method, dataFeed, setDataFeed]);

  useEffect(() => {
    setData(null);
    setError(null);
    setRawUnavailable(null);
    // P0-06 / P1-12: Custom geometry uses point-in-polygon statistical forward rule (stat).
    const requestMethod = applied.geometry || applied.dataset
      ? "stat"
      : applied.data !== "raw" && (applied.method === "stan" || applied.method === "hts")
      ? "stat"
      : applied.method;
    api
      .calendar(
        25000,
        applied.bbox || undefined,
        applied.aoi,
        applied.data,
        requestMethod,
        applied.dataset,
        applied.qa_min,
        applied.platform_set,
        applied.geometry || undefined,
        applied.from_date || undefined,
        applied.to_date || undefined,
      )
      .then(setData)
      .catch((e) => {
        // P0-04: never swap NASA raw for the synthetic demo behind the user's
        // back. Keep the raw selection and offer an explicit opt-in.
        if (applied.data === "raw") {
          const status = typeof (e as { status?: number })?.status === "number"
            ? (e as { status: number }).status : 0;
          const detail = (e as { detail?: { error_code?: string; message?: string } })?.detail;
          setRawUnavailable({
            status,
            code: detail?.error_code,
            message: detail?.message
              || (e instanceof Error ? e.message : t("calendar.raw_unavailable_body")),
          });
          setDataFeed("sample");
          setMethod("k_ratio");
          setApplied((prev) => ({ ...prev, data: "sample", method: "k_ratio" }));
          return;
        }
        setError(e);
      });
  }, [applied, t, setDataFeed, setMethod]);

  // P0-06: fetch map cells for exactly the selected month.
  useEffect(() => {
    if (activeTab !== "map" || !/^\d{4}-\d{2}$/.test(mapPeriod)) return;
    let alive = true;
    setMapError(null);
    setMapMeta(null);
    api
      .mapCells(
        mapPeriod,
        applied.bbox || undefined,
        applied.aoi,
        applied.data,
        applied.geometry || applied.dataset ? "stat" : applied.method,
        applied.dataset,
        applied.qa_min,
        applied.platform_set,
        applied.geometry || undefined,
        6,
        applied.from_date || undefined,
        applied.to_date || undefined,
      )
      .then((r) => {
        if (!alive) return;
        setMonthCells(
          r.cells.map((c) => ({
            lat: c.lat,
            lon: c.lon,
            harmonized_count: c.harmonized_count,
            date: mapPeriod,
            estimate_type: c.estimate_type,
          })),
        );
        setMapMeta({ returned: r.returned, total: r.total, preview: r.preview, level: r.aggregation_level });
      })
      .catch((e) => {
        if (!alive) return;
        setMonthCells([]);
        setMapMeta(null);
        setMapError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [mapPeriod, activeTab, applied]);

  // URL sync is intentionally keyed on `applied`; including `search` would
  // re-run on the write it performs.
  useEffect(() => {
    const next = new URLSearchParams(search);
    next.set("aoi", applied.aoi);
    next.set("data", applied.data);
    next.set("qa_min", applied.qa_min);
    next.set("platform_set", applied.platform_set);
    if (applied.dataset) next.set("dataset", applied.dataset);
    if (applied.from_date) next.set("from", applied.from_date); else next.delete("from");
    if (applied.to_date) next.set("to", applied.to_date); else next.delete("to");
    if (applied.geometry) next.set("geometry", applied.geometry); else next.delete("geometry");
    if (mapPeriod !== "all") next.set("ym", mapPeriod); else next.delete("ym");
    setSearch(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, mapPeriod]);

  const applyRangePreset = (preset: RangePreset) => {
    setRangePreset(preset);
    if (preset === "custom") return;
    let lo = "";
    let hi = "";
    if (preset !== "all") {
      const anchor = data?.summary?.period?.to
        || new Date().toISOString().slice(0, 7);
      const start = preset === "12m" ? shiftMonth(anchor, -11) : anchor;
      lo = `${start}-01`;
      hi = monthEnd(anchor);
    }
    setFromDate(lo);
    setToDate(hi);
    setApplied((prev) => ({ ...prev, from_date: lo || null, to_date: hi || null }));
  };

  const setCustomRange = (lo: string, hi: string) => {
    setFromDate(lo);
    setToDate(hi);
    if (!lo || !hi || lo > hi) return;
    setApplied((prev) => ({ ...prev, from_date: lo, to_date: hi }));
  };

  const geometryForRequest = applied.geometry;

  // P1-12: the month inspector names the method that actually served that
  // month (STAN falls back to HTS before 2024) instead of hardcoding a model.
  useEffect(() => {
    if (!activeMonth) {
      setMonthEvidence(null);
      return;
    }
    let alive = true;
    api
      .evidence(
        applied.aoi,
        applied.data,
        applied.method,
        activeMonth.year,
        activeMonth.month,
        applied.qa_min,
        applied.platform_set,
      )
      .then((d) => {
        if (alive) setMonthEvidence(d as { method_id?: string; effective_method?: string; notes?: string[] });
      })
      .catch(() => {
        if (alive) setMonthEvidence(null);
      });
    return () => {
      alive = false;
    };
  }, [activeMonth, applied.aoi, applied.data, applied.method, applied.qa_min, applied.platform_set]);

  // P1-07: Escape closes the month inspector opened from a matrix button.
  useEffect(() => {
    if (!activeMonth) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveMonth(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeMonth]);

  const periods = useMemo(() => {
    if (!data) return [];
    const available = new Set<string>();
    // Calendar.matrix describes the complete served time grid. The daily
    // details are capped and cannot define which months the UI can select.
    // A null matrix cell means unknown/missing coverage, not a zero.
    data.calendar.years.forEach((year, yi) => {
      data.calendar.months.forEach((month, mi) => {
        const value = data.calendar.matrix[yi]?.[mi];
        if (value !== null && value !== undefined && Number.isFinite(value)) {
          available.add(String(year) + "-" + String(month).padStart(2, "0"));
        }
      });
    });
    for (const d of data.daily) {
      const month = String(d.date ?? "").slice(0, 7);
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) available.add(month);
    }
    // The viewer can select a month with no observations via URL or the time
    // scrubber. Keep that month visible instead of rendering a blank select.
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(mapPeriod)) available.add(mapPeriod);
    return Array.from(available).sort();
  }, [data, mapPeriod]);

  const dailyMapCells = useMemo(() => {
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

  const mapCells = mapPeriod === "all" ? dailyMapCells : monthCells;
  const mapPreview = mapPeriod === "all"
    ? {
        returned: data?.daily?.length ?? 0,
        total: data?.summary?.n_daily_cells_total ?? data?.daily_cells ?? 0,
        preview: (data?.daily?.length ?? 0) < (data?.summary?.n_daily_cells_total ?? data?.daily_cells ?? 0),
        level: "cell-day",
      }
    : mapMeta;

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
      geometry: null,
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
      geometry: null,
    });
    setMapPeriod(`${sc.year}-${String(sc.month).padStart(2, "0")}`);
    setActiveTab("map");
  };

  if (error) return <ErrorState error={error} onRetry={() => setApplied({ ...applied })} />;
  if (!data) {
    return applied.data === "raw"
      ? <SlowLoading
          label={t("calendar.loading_raw")}
          hint={t("calendar.loading_raw_hint")}
          unit={t("calendar.loading_elapsed")}
        />
      : <SlowLoading
          label={t("calendar.loading_sample")}
          hint={t("calendar.loading_sample_hint")}
          unit={t("calendar.loading_elapsed")}
        />;
  }

  const isSynthetic = applied.data === "sample";
  const summary = data.summary;
  // P0-01: server-side totals over the full filtered set. Never derive a KPI
  // from the capped `daily` slice, and never add MODIS+VIIRS as "fires".
  const totalObserved = summary?.sensor_detections_total ?? 0;
  const totalModis = summary?.modis_detections ?? 0;
  const totalViirs = summary?.viirs_detections ?? 0;
  const totalHarmonized = summary?.harmonized_total
    ?? data.calendar?.row_totals?.reduce((sum, v) => sum + (v || 0), 0) ?? 0;
  const criticalCount = data.critical_periods?.length ?? 0;
  const methodShown = data.effective_method || data.method_id || applied.method;
  const delayLine = summary
    ? `${compact(summary.n_daily_cells_returned)} / ${compact(summary.n_daily_cells_total)} ${t("calendar.cells_returned")}`
    : "";

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
          {applied.dataset ? (
            <span className="rounded-md border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-xs font-mono font-bold text-amber-300">
              USER UPLOAD (UNVERIFIED)
            </span>
          ) : isSynthetic ? (
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
              aria-label={t("calendar.period")}
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

          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-1 text-xs">
            <span className="text-slate-400 font-medium hidden sm:inline">{t("calendar.date_range")}</span>
            <select
              value={rangePreset}
              onChange={(e) => applyRangePreset(e.target.value as RangePreset)}
              className="rounded bg-transparent font-mono text-xs text-cyan-300 focus:outline-none cursor-pointer"
              aria-label={t("calendar.date_range")}
            >
              <option value="all" className="bg-slate-900 text-slate-200">{t("calendar.range_all")}</option>
              <option value="1m" className="bg-slate-900 text-slate-200">{t("calendar.range_1m")}</option>
              <option value="12m" className="bg-slate-900 text-slate-200">{t("calendar.range_12m")}</option>
              <option value="custom" className="bg-slate-900 text-slate-200">{t("calendar.range_custom")}</option>
            </select>
            {rangePreset === "custom" && (
              <>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setCustomRange(e.target.value, toDate)}
                  className="rounded bg-slate-950 px-1 py-0.5 font-mono text-[11px] text-slate-200"
                  aria-label={t("calendar.from_date")}
                />
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setCustomRange(fromDate, e.target.value)}
                  className="rounded bg-slate-950 px-1 py-0.5 font-mono text-[11px] text-slate-200"
                  aria-label={t("calendar.to_date")}
                />
              </>
            )}
          </div>

          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
            <a
              href={api.exportUrl(
                2000000, applied.bbox || undefined, applied.aoi, applied.data,
                geometryForRequest || applied.dataset ? "stat" : applied.method, applied.dataset, applied.qa_min,
                applied.platform_set, geometryForRequest || undefined,
                applied.from_date || undefined, applied.to_date || undefined,
              )}
              title={t("calendar.export_csv_title")}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:text-white transition min-h-[30px]"
            >
              <Download className="h-3.5 w-3.5 text-cyan-400" />
              <span className="hidden sm:inline">{t("calendar.export_csv")}</span>
            </a>
            <a
              href={api.exportDetectionsUrl(
                applied.bbox || undefined, applied.aoi, applied.data,
                applied.dataset, applied.qa_min, applied.platform_set,
                geometryForRequest || undefined,
                applied.from_date || undefined, applied.to_date || undefined,
              )}
              title={t("calendar.export_detections_title")}
              className="border-l border-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-400 hover:text-white transition min-h-[30px]"
            >
              {t("calendar.export_detections")}
            </a>
            <button
              type="button"
              onClick={() => window.print()}
              title={t("calendar.export_print_title")}
              className="border-l border-slate-800 px-2.5 py-1 text-xs font-semibold text-purple-300 hover:text-white transition min-h-[30px] inline-flex items-center gap-1"
            >
              <Printer className="h-3.5 w-3.5 text-purple-400" />
              <span className="hidden sm:inline">{t("calendar.export_print")}</span>
            </button>
          </div>

          <div className="hidden 2xl:flex items-center gap-2 whitespace-nowrap text-xs text-slate-400 font-mono">
            <span>{compact(totalObserved)} {t("calendar.sensor_detections")}</span>
            <span>•</span>
            <span className="text-cyan-300">{compact(totalHarmonized)} {t("calendar.calibrated_short")}</span>
            <span>•</span>
            <span className="text-orange-400">{criticalCount} {t("common.anomalies")}</span>
          </div>
        </div>

        {/* View Mode Tabs (Map / Matrix / Scenarios) */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("map")}
            aria-pressed={activeTab === "map"}
            aria-label={t("calendar.view_map")}
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
            aria-pressed={activeTab === "matrix"}
            aria-label={t("calendar.view_matrix")}
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
            aria-pressed={activeTab === "scenarios"}
            aria-label={t("calendar.view_scenarios")}
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
            to={{ pathname: "/xray", search: search.toString() }}
            className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:text-white transition min-h-[30px]"
          >
            <ScanEye className="h-3.5 w-3.5 text-cyan-400" />
            <span>{t("calendar.xray")}</span>
          </Link>
        </div>
      </header>

      {rawUnavailable && (
        <div className="shrink-0 mx-3 mt-2 flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-950/50 px-3.5 py-2 text-xs text-amber-200 animate-fade-in">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400 shrink-0" />
            <span>{rawUnavailable.message || t("calendar.raw_unavailable_body")}</span>
          </div>
          <button
            type="button"
            onClick={() => setRawUnavailable(null)}
            className="text-amber-400 hover:text-white p-1"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* P1-02: Research mode reveals provenance/coverage detail; Explore keeps
          the same page without model plumbing. */}
      {mode === "research" && summary && (
        <div className="shrink-0 border-b border-slate-800 bg-[#08101c] px-3 py-1.5 font-mono text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
          <span>method_id <span className="text-cyan-300">{data.method_id ?? "-"}</span></span>
          <span>effective <span className="text-cyan-300">{methodShown}</span></span>
          <span>scope <span className="text-cyan-300">{summary.source_scope}</span></span>
          <span>estimated_index <span className="text-cyan-300">{summary.estimated_index == null ? "-" : summary.estimated_index.toFixed(3)}</span></span>
          <span>filter_hash <span className="text-cyan-300">{summary.filter_hash}</span></span>
          {summary.period.from && (
            <span>period <span className="text-cyan-300">{summary.period.from} → {summary.period.to}</span></span>
          )}
          {applied.geometry && (
            <span>geometry_hash <span className="text-cyan-300">{data.geometry_hash}</span></span>
          )}
        </div>
      )}

      {/* 2. BODY CONTENT */}

      {/* VIEW 1: SATELLITE GIS WORKSTATION (DEFAULT) */}
      {activeTab === "map" && (
        <div className="relative isolate flex-1 min-h-0 min-w-0 w-full h-full flex items-stretch overflow-hidden">
          {/* Main Map Canvas: retain width when the mobile inspector is open. */}
          <div className="relative flex-1 min-w-0 min-h-0 h-full self-stretch flex flex-col overflow-hidden">
            <AoiMap
              center={AOI_CENTER[aoi]?.c ?? [13, 106.5]}
              zoom={AOI_CENTER[aoi]?.z ?? 6}
              bbox={applied.bbox || null}
              geometry={applied.geometry}
              cells={mapCells}
              preview={mapPreview}
              fullBleed={true}
              height="100%"
              hideToolbar={false}
              hideLegend={false}
              activeZoneId={activeZone?.id}
              onSelectZone={(z) => setActiveZone(z)}
              onClearBbox={() => {
                setApplied({ ...applied, bbox: AOI_BBOX[aoi] ?? "", geometry: null });
              }}
              onSelect={(b, geom) => {
                setBbox(b);
                setApplied({ ...applied, bbox: b, geometry: geom ?? null });
              }}
            />

            {/* Interactive Temporal Scrubber & Playback Bar */}
            {mapError && (
              <div className="absolute left-3 top-14 z-[800] rounded-lg border border-rose-500/40 bg-rose-950/90 px-3 py-2 text-xs text-rose-200">
                {t("calendar.map_cells_error")}: {mapError}
              </div>
            )}
            {data.calendar?.years && data.calendar.years.length > 0 && (
              <MapTimeScrubber
                currentPeriod={mapPeriod}
                onSelectPeriod={(p) => setMapPeriod(p)}
                availableYears={data.calendar.years}
              />
            )}
          </div>

          {dockOpen && (
            <button type="button" onClick={() => setDockOpen(false)}
              aria-label={t("common.close_menu")}
              className="absolute inset-0 z-[1200] bg-black/55 lg:hidden" />
          )}
          {/* Desktop dock / mobile overlay inspector */}
          <CalendarDock
            open={dockOpen}
            onToggle={() => setDockOpen(!dockOpen)}
            tab={dockTab}
            onTabChange={setDockTab}
            aoi={applied.aoi}
            onSelectAoi={handleSelectAoi}
            data={applied.data}
            onSelectDataFeed={setDataFeed}
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
            eligibleMask={data.calendar.eligible_mask}
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

                <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setPaletteMode("standard")}
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
                    onClick={() => setPaletteMode("accessible")}
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

                        const label = `${y}-${String(m).padStart(2, "0")}: ${
                          v === null ? t("common.no_data") : `${v.toLocaleString()} detections`
                        }, z=${z == null ? "-" : z.toFixed(1)}${isPartial ? `, ${t("common.partial_coverage")}` : ""}`;
                        return (
                          <td key={m} className="p-0.5 border border-slate-800/40">
                            <button
                              type="button"
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
            <div data-fh-popover className="rounded-2xl border border-cyan-500/40 bg-slate-950/95 p-5 shadow-2xl space-y-4">
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

          {/* Multi-Year Seasonal Profile Curve Comparator */}
          {data.calendar && data.calendar.years && data.calendar.years.length > 1 && (
            <SeasonComparisonCard
              years={data.calendar.years}
              matrix={data.calendar.matrix}
              months={data.calendar.months}
              eligibleMask={data.calendar.eligible_mask}
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
                  data-fh-card-link
                  onClick={() => handleSelectScenario(sc)}
                  className="cursor-pointer rounded-2xl border border-slate-800 bg-slate-950/80 p-5 space-y-3 hover:border-cyan-500/50 hover:bg-slate-900/60 transition-colors duration-150 group"
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
