import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Download,
  FileText,
  Filter,
  Sliders,
  Sparkles,
  X,
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
import { ErrorState, Loading } from "@/components/states";
import { AoiMap } from "@/components/AoiMap";
import { GlobalContextBar } from "@/components/GlobalContextBar";
import { cn, compact } from "@/lib/utils";

function colorFor(z: number | null): string {
  if (z === null || z === undefined) return "bg-slate-900/60 text-slate-500 border-slate-800/50";
  if (z >= 3) return "bg-rose-950/90 text-rose-200 border-rose-600/70 font-bold";
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
  const { t, lang } = useLang();
  const vi = lang === "vi";

  const [search, setSearch] = useSearchParams();
  const initialData = ["sample", "raw"].includes(search.get("data") || "") ? search.get("data")! : "sample";
  const initialMethod = ["stat", "ml", "ts"].includes(search.get("method") || "") ? search.get("method")! : "stat";

  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [aoi, setAoi] = useState(search.get("aoi") || "vietnam");
  const [bbox, setBbox] = useState(AOI_BBOX[search.get("aoi") || "vietnam"] ?? AOI_BBOX.vietnam);
  const [dsrc, setDsrc] = useState(initialData);
  const [method, setMethod] = useState(initialMethod);
  const [exportStatus, setExportStatus] = useState("");
  const [mapPeriod, setMapPeriod] = useState("all");
  const [qaMin, setQaMin] = useState(search.get("qa_min") || "all");
  const [platformSet, setPlatformSet] = useState(search.get("platform_set") || "all");
  const [matrixMode, setMatrixMode] = useState<"compact" | "heatmap" | "zscore">("compact");

  // Filters Drawer Toggle State
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  // Active Month Detail Drawer
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
    bbox: AOI_BBOX[search.get("aoi") || "vietnam"] ?? AOI_BBOX.vietnam,
    aoi: search.get("aoi") || "vietnam",
    data: initialData,
    method: initialMethod,
    dataset: search.get("dataset") || undefined,
    qa_min: search.get("qa_min") || "all",
    platform_set: search.get("platform_set") || "all",
  });

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
      .catch(setError);
  }, [applied]);

  useEffect(() => {
    const next = new URLSearchParams();
    next.set("aoi", applied.aoi);
    next.set("data", applied.data);
    next.set("method", applied.method);
    next.set("qa_min", applied.qa_min);
    next.set("platform_set", applied.platform_set);
    if (applied.dataset) next.set("dataset", applied.dataset);
    setSearch(next, { replace: true });
  }, [applied, setSearch]);

  const periods = useMemo(() => {
    if (!data) return [] as string[];
    return Array.from(new Set(data.daily.map((d) => String(d.date).slice(0, 7)))).sort();
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

  const csvHref = useMemo(
    () =>
      api.exportUrl(
        25000,
        applied.bbox || undefined,
        applied.aoi,
        applied.data,
        applied.method,
        applied.dataset,
        applied.qa_min,
        applied.platform_set,
      ),
    [applied],
  );

  const briefHref = useMemo(
    () =>
      api.briefUrl(
        applied.bbox || undefined,
        applied.aoi,
        applied.data,
        applied.method,
        applied.dataset,
        applied.qa_min,
        applied.platform_set,
      ),
    [applied],
  );

  async function handleExport() {
    setExportStatus("");
    try {
      const res = await fetch(csvHref);
      if (!res.ok) {
        const text = await res.text();
        setExportStatus(text || `${res.status} ${res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `harmonized_hotspots_${applied.aoi}_${applied.data}_${applied.method}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportStatus(e instanceof Error ? e.message : String(e));
    }
  }

  // Quick preset area change
  const handleSelectAoi = (newAoi: string) => {
    setAoi(newAoi);
    const b = AOI_BBOX[newAoi] ?? "";
    setBbox(b);
    setApplied({
      ...applied,
      aoi: newAoi,
      bbox: b,
    });
  };

  const isDirty =
    bbox !== applied.bbox ||
    dsrc !== applied.data ||
    method !== applied.method ||
    qaMin !== applied.qa_min ||
    platformSet !== applied.platform_set;

  const handleApplyFilters = () => {
    setApplied({
      bbox,
      aoi,
      data: dsrc,
      method,
      dataset: applied.dataset,
      qa_min: qaMin,
      platform_set: platformSet,
    });
    setIsFiltersOpen(false);
  };

  if (error) return <ErrorState error={error} onRetry={() => setApplied({ ...applied })} />;
  if (!data) return <Loading label={t("cal.loading")} />;

  const L = data.latest;
  const criticalCount = data.critical_periods?.length ?? 0;
  const totalObserved = data.daily?.reduce((sum, d) => sum + (Number(d.count) || 1), 0) ?? 0;
  const totalHarmonized = data.calendar?.row_totals?.reduce((sum, v) => sum + (v || 0), 0) ?? 0;

  return (
    <div className="space-y-6 pb-12">
      {/* 1. Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-[#111C2E] p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/60 shadow-sm">
            <CalendarDays className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                {vi ? "Fire Calendar: Lịch hoạt động cháy" : "Burning-activity Calendar"}
              </h1>
              <span className="font-mono text-xs font-semibold uppercase px-2.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-200">
                {applied.data === "raw" ? "NASA Observed" : "SYNTHETIC DEMO"}
              </span>
              {data?.calibration?._calibration_status === "insufficient_overlap" && (
                <span
                  className="font-mono text-xs font-semibold uppercase px-2.5 py-0.5 rounded-full border border-rose-500/40 bg-rose-500/15 text-rose-200"
                  title="Fewer than 3 co-observed months: upscaled cells carry no calibrated uncertainty band."
                >
                  {vi ? "Chưa hiệu chuẩn" : "Not calibrated"}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300">
              {vi
                ? "Chuỗi quan trắc chuẩn hóa MODIS (1 km) & VIIRS (375 m) giai đoạn 2001 - 2025"
                : "Harmonized Earth Observation: MODIS (1 km) & VIIRS (375 m) Multi-Decadal Record"}
            </p>
          </div>
        </div>

        {/* Action Buttons: Export & Filters Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition min-h-[40px]"
          >
            <Download className="h-4 w-4 text-cyan-400" />
            <span>{vi ? "Tải CSV" : "Download CSV"}</span>
          </button>
          <a
            href={briefHref}
            download
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition min-h-[40px]"
          >
            <FileText className="h-4 w-4 text-orange-400" />
            <span>{vi ? "Tải tóm tắt (.md)" : "Download Brief (.md)"}</span>
          </a>
          <button
            type="button"
            onClick={() => setIsFiltersOpen(!isFiltersOpen)}
            aria-pressed={isFiltersOpen}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition min-h-[40px]",
              isFiltersOpen
                ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 shadow-sm"
                : "border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700",
            )}
          >
            <Filter className="h-4 w-4 text-cyan-400" />
            <span>{vi ? "Bộ lọc & Tham số" : "Filters & Parameters"}</span>
          </button>
        </div>
      </div>

      {/* 2. Global Context Bar */}
      {exportStatus && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 px-4 py-2 text-xs text-rose-300">
          {exportStatus}
        </div>
      )}
      <GlobalContextBar
        onToggleFilters={() => setIsFiltersOpen(!isFiltersOpen)}
        isFiltersOpen={isFiltersOpen}
        totalHotspots={totalObserved}
      />

      {/* 3. Preset Region Pills Bar (Accessible Buttons, no 300px sidebar crowding) */}
      <div className="flex flex-wrap items-center gap-2 bg-[#111C2E] border border-slate-800 p-2.5 rounded-xl text-xs">
        <span className="text-slate-400 font-semibold px-2">
          {vi ? "Khu vực phân tích:" : "Study Area:"}
        </span>
        {([
          { id: "vietnam", label: vi ? "Việt Nam (Tây Nguyên)" : "Vietnam (Central Highlands)" },
          { id: "amazon", label: vi ? "Amazon (Nam bồn địa)" : "Amazon (Southern Basin)" },
          { id: "australia", label: vi ? "Úc (Black Summer)" : "Australia (Black Summer)" },
        ]).map((p) => {
          const isActive = aoi === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelectAoi(p.id)}
              aria-pressed={isActive}
              className={cn(
                "rounded-lg px-3.5 py-2 font-medium transition min-h-[38px] flex items-center gap-1.5",
                isActive
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold shadow-sm"
                  : "bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800",
              )}
            >
              {isActive && <Check className="h-3.5 w-3.5 text-cyan-400" />}
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>

      {/* 4. Filter Panel Drawer (Collapsible) */}
      {isFiltersOpen && (
        <div className="rounded-2xl border border-cyan-500/30 bg-[#111C2E] p-5 shadow-lg space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-orange-400" />
              <span className="font-bold text-sm text-white">
                {vi ? "Bộ lọc & Thông số phân tích" : "Analysis Filters & Processing Controls"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsFiltersOpen(false)}
              className="text-slate-400 hover:text-white p-1 rounded-lg min-h-[36px] min-w-[36px] flex items-center justify-center"
              aria-label="Close filters"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            {/* Data Feed */}
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300 block">
                {vi ? "Nguồn dữ liệu:" : "Data Feed:"}
              </label>
              <select
                value={dsrc}
                onChange={(e) => setDsrc(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200 focus:outline-none min-h-[40px]"
              >
                <option value="sample">{vi ? "Dữ liệu mẫu (Synthetic Sample)" : "Synthetic Sample (Offline)"}</option>
                <option value="raw">{vi ? "NASA FIRMS quan trắc (Verified Archive)" : "NASA FIRMS Observed (Archive)"}</option>
              </select>
            </div>

            {/* Harmonization Method */}
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300 block">
                {vi ? "Phương pháp hiệu chỉnh:" : "Harmonization Method:"}
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200 focus:outline-none min-h-[40px]"
              >
                <option value="stat">{vi ? "Tỷ lệ thực nghiệm k (Baseline thống kê)" : "Empirical Ratio k (Stat Baseline)"}</option>
                <option value="ml">{vi ? "HGBoost Tree (Mô hình phần dư ML)" : "HGBoost Tree Residual (ML B2-Res)"}</option>
                <option value="ts">{vi ? "Transformer Pooling (Mô hình chuỗi TS)" : "Pooled Transformer (TS Log-Ratio)"}</option>
              </select>
            </div>

            {/* QA Confidence */}
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300 block">
                {vi ? "Ngưỡng tin cậy QA:" : "QA Confidence Level:"}
              </label>
              <select
                value={qaMin}
                onChange={(e) => setQaMin(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200 focus:outline-none min-h-[40px]"
              >
                <option value="all">{vi ? "Tất cả (Bao gồm thấp)" : "All (Include Low)"}</option>
                <option value="nominal">{vi ? "Tiêu chuẩn trở lên (Nominal+)" : "Nominal+"}</option>
                <option value="high">{vi ? "Chỉ mức cao (High Only)" : "High Only"}</option>
              </select>
            </div>

            {/* Sensors */}
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300 block">
                {vi ? "Nhóm cảm biến:" : "Sensor Group:"}
              </label>
              <select
                value={platformSet}
                onChange={(e) => setPlatformSet(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200 focus:outline-none min-h-[40px]"
              >
                <option value="all">{vi ? "Toàn bộ khả dụng" : "All Available"}</option>
                <option value="snpp">{vi ? "Chỉ Suomi NPP" : "Suomi NPP Only"}</option>
              </select>
            </div>
          </div>

          {/* Custom Bounding Box & Apply Button */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-slate-800">
            <div className="flex items-center gap-2 flex-1 max-w-xl">
              <span className="text-xs font-semibold text-slate-400 whitespace-nowrap">
                {vi ? "Tọa độ BBox:" : "BBox:"}
              </span>
              <input
                value={bbox}
                onChange={(e) => setBbox(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200 focus:outline-none min-h-[40px]"
                placeholder="minLon,minLat,maxLon,maxLat"
              />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isDirty && (
                <span className="text-xs text-amber-400 font-medium animate-pulse">
                  {vi ? "Có thay đổi chưa áp dụng" : "Unapplied changes"}
                </span>
              )}
              <button
                type="button"
                onClick={handleApplyFilters}
                className="rounded-xl bg-cyan-600 hover:bg-cyan-500 px-5 py-2 text-xs font-bold text-white shadow-sm transition min-h-[40px]"
              >
                {vi ? "Áp dụng thay đổi" : "Apply Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. 4 Core Scientific KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 space-y-1">
          <span className="text-xs text-slate-400 block font-medium">
            {vi ? "Lượt điểm nóng quan trắc" : "Observed Hotspots"}
          </span>
          <span className="text-xl sm:text-2xl font-extrabold font-mono text-white">
            {totalObserved.toLocaleString()}
          </span>
          <span className="text-xs text-slate-400 block">
            {vi ? "MODIS & VIIRS cộng gộp" : "Combined satellite hits"}
          </span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 space-y-1">
          <span className="text-xs text-slate-400 block font-medium">
            {vi ? "Chỉ số hoạt động hiệu chuẩn" : "Calibrated Activity"}
          </span>
          <span className="text-xl sm:text-2xl font-extrabold font-mono text-cyan-300">
            {compact(totalHarmonized)}
          </span>
          <span className="text-xs text-cyan-400 block">
            {vi ? "Thang đo chuẩn hóa k-ratio" : "k-ratio standardized"}
          </span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 space-y-1">
          <span className="text-xs text-slate-400 block font-medium">
            {vi ? "Tháng dị thường (|z| >= 2)" : "Anomalous Months"}
          </span>
          <span className="text-xl sm:text-2xl font-extrabold font-mono text-orange-400">
            {criticalCount}
          </span>
          <span className="text-xs text-slate-400 block">
            {vi ? "Đoạn mùa cháy cực đoan" : "High departure from median"}
          </span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 space-y-1">
          <span className="text-xs text-slate-400 block font-medium">
            {vi ? "Trạng thái dữ liệu" : "Data Status"}
          </span>
          <span className="text-sm sm:text-base font-bold text-emerald-400 flex items-center gap-1.5 pt-1">
            <Check className="h-4 w-4" />
            <span>{applied.data === "raw" ? (vi ? "Đã xác thực" : "NASA Verified") : (vi ? "Dữ liệu mẫu" : "Demo Sample")}</span>
          </span>
          <span className="text-xs text-slate-400 block">
            {data.calendar?.years?.length ?? 0} {vi ? "năm quan trắc" : "years tracked"}
          </span>
        </div>
      </div>

      {/* 6. Key Finding Banner */}
      {L && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-cyan-400 shrink-0" />
            <div className="space-y-0.5">
              <span className="font-bold text-white text-sm">
                {vi ? `Tháng gần nhất ghi nhận: ${L.date}` : `Latest Period Observed: ${L.date}`}
              </span>
              <p className="text-slate-300">
                {vi
                  ? `Chỉ số hoạt động ${L.month_total.toLocaleString()} (so với trung vị lịch sử ${L.hist_median}). Đánh giá: ${L.verdict}.`
                  : `Activity index: ${L.month_total.toLocaleString()} (historical median: ${L.hist_median}). Evaluation: ${L.verdict}.`}
              </p>
            </div>
          </div>
          <Link
            to={`/evidence?aoi=${applied.aoi}&data=${applied.data}&ym=${L.date}`}
            className="inline-flex items-center gap-1 font-semibold text-cyan-300 hover:text-white transition shrink-0"
          >
            <span>{vi ? "Xem sổ chứng cứ tháng này" : "Inspect month evidence"}</span>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* 7. Main Visual Area: Map (55%) + Calendar Grid (45%) on Desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Map Canvas (7 cols on lg) */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#111C2E] p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">
                {vi ? "Trường điểm nóng vệ tinh" : "Satellite Hotspot Field"}
              </h2>
              <span className="font-mono text-xs text-slate-400">
                ({mapCells.length.toLocaleString()} {vi ? "điểm hiển thị" : "points plotted"})
              </span>
            </div>

            {/* Map Period Filter */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">{vi ? "Lọc theo tháng:" : "Filter:"}</span>
              <select
                value={mapPeriod}
                onChange={(e) => setMapPeriod(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 font-mono text-xs text-slate-200 focus:outline-none"
              >
                <option value="all">{vi ? "Tất cả các tháng" : "All Months"}</option>
                {periods.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Interactive Map */}
          <AoiMap
            key={`${aoi}-${mapPeriod}`}
            center={AOI_CENTER[aoi]?.c ?? [13, 106.5]}
            zoom={AOI_CENTER[aoi]?.z ?? 5}
            bbox={applied.bbox || null}
            cells={mapCells}
            onSelect={(b) => {
              setBbox(b);
              setApplied({
                ...applied,
                bbox: b,
              });
            }}
          />
        </div>

        {/* Calendar Matrix Grid (5 cols on lg) */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#111C2E] p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-cyan-400" />
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">
                {vi ? "Ma trận tháng x năm" : "Year x Month Matrix"}
              </h2>
            </div>

            {/* Matrix View Toggle */}
            <div className="flex items-center rounded-lg border border-slate-700 bg-slate-900 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMatrixMode("compact")}
                className={cn(
                  "rounded px-2 py-1 font-medium transition",
                  matrixMode === "compact"
                    ? "bg-cyan-500/20 text-cyan-300 font-semibold"
                    : "text-slate-400 hover:text-white"
                )}
              >
                {vi ? "Số liệu" : "Values"}
              </button>
              <button
                type="button"
                onClick={() => setMatrixMode("zscore")}
                className={cn(
                  "rounded px-2 py-1 font-medium transition",
                  matrixMode === "zscore"
                    ? "bg-cyan-500/20 text-cyan-300 font-semibold"
                    : "text-slate-400 hover:text-white"
                )}
              >
                Z-Score
              </button>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/80 max-h-[460px] overflow-y-auto">
            <table className="w-full border-collapse text-center text-xs tabular-nums">
              <thead className="sticky top-0 bg-[#0B1220] z-10 border-b border-slate-800">
                <tr>
                  <th className="p-2 text-left font-semibold text-slate-400">{vi ? "Năm" : "Year"}</th>
                  {data.calendar.months.map((m) => (
                    <th key={m} className="p-1.5 font-semibold text-slate-300">
                      {vi ? "T" : "M"}{String(m).padStart(2, "0")}
                    </th>
                  ))}
                  <th className="p-2 font-bold text-cyan-400">{vi ? "Tổng" : "Total"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {data.calendar.years.map((y, yi) => (
                  <tr key={y} className="hover:bg-white/[0.03] transition-colors">
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
                          onClick={() =>
                            setActiveMonth({
                              year: y,
                              month: m,
                              val: v,
                              z,
                              coverage: isPartial ? (vi ? "Một phần (Thiếu)" : "Partial (Data gaps)") : (vi ? "Đầy đủ quan trắc" : "Full coverage"),
                              ratio: z,
                              isPartial,
                              coverageRatio: cinfo?.coverage_ratio ?? undefined,
                            })
                          }
                          className={cn(
                            "p-1.5 transition-all border border-slate-800/40 cursor-pointer select-none text-xs",
                            colorFor(z),
                            isSelected && "ring-2 ring-cyan-400 z-10 scale-105 font-bold shadow-md",
                          )}
                          title={`${y}-${m}: ${v === null ? (vi ? "Không có dữ liệu" : "No data") : `${v.toLocaleString()} (z=${z ?? 0})`}`}
                        >
                          {cellDisplay}
                        </td>
                      );
                    })}
                    <td className="p-2 font-bold text-slate-100 bg-slate-900/40">
                      {compact(data.calendar.row_totals[yi])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400 px-1 pt-1">
            <span>{vi ? "Nhấp ô tháng để mở chi tiết kiểm chứng" : "Click any cell to inspect month details"}</span>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              <span>|z| &gt;= 2: {vi ? "Bất thường" : "Anomalous"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 8. Interactive Month Detail Drawer / Panel (440px or responsive banner) */}
      {activeMonth && (
        <div className="rounded-2xl border border-cyan-500/40 bg-[#111C2E] p-5 shadow-lg space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-950 border border-cyan-500/30 text-cyan-300 font-mono font-bold text-sm">
                {activeMonth.month}
              </div>
              <div>
                <span className="font-bold text-white text-base">
                  {vi ? `Chi tiết tháng ${activeMonth.month} năm ${activeMonth.year}` : `Month Audit: ${activeMonth.year}-${String(activeMonth.month).padStart(2, "0")}`}
                </span>
                <p className="text-xs text-slate-400">
                  {vi ? "Bằng chứng quan trắc và đối chiếu sai khác cảm biến" : "Observation evidence and sensor harmonization audit"}
                </p>
              </div>
            </div>

            {/* 3 Direct Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/investigator?aoi=${applied.aoi}&data=${applied.data}&ym=${activeMonth.year}-${String(activeMonth.month).padStart(2, "0")}`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-3.5 py-2 text-xs font-bold text-white transition min-h-[38px]"
              >
                <span>{vi ? "Giải thích tháng này" : "Explain Month"}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                to={`/evidence?aoi=${applied.aoi}&data=${applied.data}&ym=${activeMonth.year}-${String(activeMonth.month).padStart(2, "0")}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-200 transition min-h-[38px]"
              >
                <span>{vi ? "Kiểm tra bằng chứng" : "Inspect Evidence"}</span>
              </Link>
              <Link
                to={`/lab?tab=simulator&aoi=${applied.aoi}&data=${applied.data}&year=${activeMonth.year}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-200 transition min-h-[38px]"
              >
                <span>{vi ? "Mô phỏng trong Lab" : "Simulate in Lab"}</span>
              </Link>
              <button
                type="button"
                onClick={() => setActiveMonth(null)}
                className="text-slate-400 hover:text-white p-2 rounded-lg min-h-[38px] min-w-[38px] flex items-center justify-center"
                aria-label="Close month detail"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="rounded-xl bg-slate-900/80 p-3 border border-slate-800 space-y-1">
              <span className="text-slate-400 text-xs block font-sans">
                {vi ? "Chỉ số hoạt động" : "Activity Index"}
              </span>
              <span className="text-white font-bold text-lg">
                {activeMonth.val == null ? (vi ? "Không có dữ liệu" : "No data") : activeMonth.val.toLocaleString()}
              </span>
            </div>

            <div className="rounded-xl bg-slate-900/80 p-3 border border-slate-800 space-y-1">
              <span className="text-slate-400 text-xs block font-sans">
                {vi ? "Mức độ bất thường (z)" : "Robust Z-Score"}
              </span>
              <span className="text-cyan-300 font-bold text-lg">
                {activeMonth.z == null ? "-" : activeMonth.z.toFixed(2)}
              </span>
            </div>

            <div className="rounded-xl bg-slate-900/80 p-3 border border-slate-800 space-y-1">
              <span className="text-slate-400 text-xs block font-sans">
                {vi ? "Phương pháp áp dụng" : "Applied Method"}
              </span>
              <span className="text-purple-300 font-semibold text-sm">
                {applied.method.toUpperCase()} Baseline
              </span>
            </div>

            <div className="rounded-xl bg-slate-900/80 p-3 border border-slate-800 space-y-1">
              <span className="text-slate-400 text-xs block font-sans">
                {vi ? "Độ phủ quan sát" : "Coverage Quality"}
              </span>
              <span className="text-emerald-400 font-semibold text-sm">
                {activeMonth.coverage}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 9. Full Width Trend Chart: Multi-Decadal Historical Signal */}
      <div className="rounded-2xl border border-slate-800 bg-[#111C2E] p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-white">
              {vi ? "Xu hướng hoạt động cháy qua các năm (2001 - 2025)" : "Multi-Decadal Harmonized Fire Trend (2001 - 2025)"}
            </h3>
            <p className="text-xs text-slate-400">
              {vi ? "Tổng chỉ số hoạt động chuẩn hóa theo năm (không phải số vụ cháy thực tế)" : "Annual harmonized activity index (not individual fire incident counts)"}
            </p>
          </div>
          <span className="font-mono text-xs text-orange-400">{vi ? "25 năm quan trắc" : "25 Years Tracked"}</span>
        </div>

        <div style={{ height: 260 }}>
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
              <Bar dataKey="detections" fill="#f97316" radius={[4, 4, 0, 0]} name={vi ? "Chỉ số hoạt động" : "Harmonized Activity"} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
