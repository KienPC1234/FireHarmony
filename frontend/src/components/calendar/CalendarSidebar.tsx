import {
  Check,
  Compass,
  Database,
  Download,
  FileText,
  Globe,
  Scale,
  Sparkles,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { SCENARIO_PRESETS, type ScenarioPreset } from "./calendarPresets";

export interface CalendarSidebarProps {
  aoi: string;
  onSelectAoi: (aoi: string) => void;
  bbox: string;
  setBbox: (b: string) => void;
  dsrc: string;
  setDsrc: (d: string) => void;
  method: string;
  setMethod: (m: string) => void;
  qaMin: string;
  setQaMin: (qa: string) => void;
  platformSet: string;
  setPlatformSet: (p: string) => void;
  isDirty: boolean;
  onApply: () => void;
  briefHref: string;
  onExport: () => void;
  onSelectScenario: (scenario: ScenarioPreset) => void;
}

export function CalendarSidebar({
  aoi,
  onSelectAoi,
  bbox,
  setBbox,
  dsrc,
  setDsrc,
  method,
  setMethod,
  qaMin,
  setQaMin,
  platformSet,
  setPlatformSet,
  isDirty,
  onApply,
  briefHref,
  onExport,
  onSelectScenario,
}: CalendarSidebarProps) {
  const { lang } = useLang();
  const vi = lang === "vi";

  return (
    <aside className="w-full space-y-4">
      {/* 1. Mission Control Deck Card */}
      <div className="rounded-2xl border border-border/80 bg-slate-950/90 p-4 sm:p-5 shadow-card backdrop-blur space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-cyan-400" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              {vi ? "Bảng điều khiển phân tích" : "Mission Control Panel"}
            </h2>
          </div>
          <span className="font-mono text-xs rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-cyan-300">
            {dsrc === "raw" ? (vi ? "NASA Lưu trữ" : "NASA Raw") : (vi ? "Dữ liệu mẫu" : "Sample Demo")}
          </span>
        </div>

        {/* Study Area Selector (3 Dedicated Region Cards) */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-cyan-400" />
              <span>{vi ? "Khu vực nghiên cứu (AOI)" : "Study Area Preset"}</span>
            </span>
            <span className="font-mono text-xs text-muted-foreground">3 AOIs</span>
          </label>

          <div className="grid grid-cols-1 gap-1.5">
            {[
              {
                id: "vietnam",
                title: vi ? "Việt Nam" : "Vietnam",
                sub: vi ? "Tây Nguyên & Duyên hải Nam Trung Bộ" : "Central Highlands & South Central",
                badge: vi ? "Mùa khô T12-T04" : "Dry Dec-Apr",
              },
              {
                id: "amazon",
                title: "Amazon",
                sub: vi ? "Nam bồn địa & Vùng Cerrado" : "Southern Basin & Cerrado transition",
                badge: vi ? "Đỉnh T07-T10" : "Peak Jul-Oct",
              },
              {
                id: "australia",
                title: "Australia",
                sub: vi ? "Đông Nam Úc (Rừng bạch đàn)" : "Southeast Australia eucalyptus belt",
                badge: vi ? "Đỉnh T12-T02" : "Peak Dec-Feb",
              },
            ].map((p) => {
              const isActive = aoi === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectAoi(p.id)}
                  aria-pressed={isActive}
                  className={cn(
                    "w-full text-left rounded-xl p-3 border transition-all text-xs flex items-center justify-between gap-2 min-h-[46px]",
                    isActive
                      ? "border-cyan-500/60 bg-cyan-950/40 text-white shadow-[0_0_15px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/40"
                      : "border-border/60 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900",
                  )}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 font-bold text-slate-100">
                      <span>{p.title}</span>
                      {isActive && <Check className="h-3.5 w-3.5 text-cyan-400" />}
                    </div>
                    <div className="text-xs text-slate-400 leading-tight">{p.sub}</div>
                  </div>
                  <span className="font-mono text-xs rounded-full border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-slate-300 shrink-0">
                    {p.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* One-Click Scenario Quick Insights */}
        <div className="space-y-2 border-t border-border/60 pt-3">
          <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              <span>{vi ? "Kịch bản lịch sử tiêu biểu" : "One-Click Scenario Insights"}</span>
            </span>
          </label>

          <div className="space-y-1.5">
            {SCENARIO_PRESETS.map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => onSelectScenario(sc)}
                className="w-full text-left rounded-xl border border-border/50 bg-slate-900/40 p-2.5 transition hover:border-amber-500/40 hover:bg-amber-950/20 text-xs space-y-1 group"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200 group-hover:text-amber-300 transition">
                    {vi ? sc.title.vi : sc.title.en}
                  </span>
                  <span className="font-mono text-xs rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 text-amber-300">
                    {vi ? sc.badge.vi : sc.badge.en}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {vi ? sc.desc.vi : sc.desc.en}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Processing Controls Form */}
        <div className="space-y-3 border-t border-border/60 pt-3 text-xs">
          {/* Data Feed */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-cyan-400" />
              <span>{vi ? "Nguồn cấp dữ liệu:" : "Data Feed:"}</span>
            </label>
            <select
              value={dsrc}
              onChange={(e) => setDsrc(e.target.value)}
              className="w-full rounded-xl border border-border/80 bg-slate-900 px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none min-h-[38px]"
            >
              <option value="sample">
                {vi ? "Dữ liệu mẫu ngoại tuyến (Synthetic Sample)" : "Synthetic Sample (Offline)"}
              </option>
              <option value="raw">
                {vi ? "NASA FIRMS quan trắc (Verified Archive)" : "NASA FIRMS Observed (Archive)"}
              </option>
            </select>
          </div>

          {/* Harmonization Method */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5 text-cyan-400" />
              <span>{vi ? "Phương pháp hiệu chuẩn:" : "Harmonization Method:"}</span>
            </label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full rounded-xl border border-border/80 bg-slate-900 px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none min-h-[38px]"
            >
              <option value="stat">
                {vi ? "Tỷ lệ k thực nghiệm (Stat Baseline)" : "Empirical Ratio k (Stat Baseline)"}
              </option>
              <option value="ml">
                {vi ? "HGBoost Residual (Mô hình ML B2-Res)" : "HGBoost Tree Residual (ML B2-Res)"}
              </option>
              <option value="ts">
                {vi ? "Pooled Transformer (Mô hình chuỗi TS)" : "Pooled Transformer (TS Log-Ratio)"}
              </option>
            </select>
          </div>

          {/* QA Level & Sensor Platform Grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="font-semibold text-slate-300 block">
                {vi ? "Ngưỡng QA:" : "QA Filter:"}
              </label>
              <select
                value={qaMin}
                onChange={(e) => setQaMin(e.target.value)}
                className="w-full rounded-xl border border-border/80 bg-slate-900 px-2.5 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none min-h-[38px]"
              >
                <option value="all">{vi ? "Tất cả" : "All (Any QA)"}</option>
                <option value="nominal">{vi ? "Tiêu chuẩn+" : "Nominal+"}</option>
                <option value="high">{vi ? "Chỉ cao" : "High Only"}</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-300 block">
                {vi ? "Cảm biến:" : "Sensors:"}
              </label>
              <select
                value={platformSet}
                onChange={(e) => setPlatformSet(e.target.value)}
                className="w-full rounded-xl border border-border/80 bg-slate-900 px-2.5 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none min-h-[38px]"
              >
                <option value="all">{vi ? "Toàn bộ" : "All Sensors"}</option>
                <option value="snpp">{vi ? "Chỉ S-NPP" : "Suomi NPP"}</option>
              </select>
            </div>
          </div>

          {/* BBox manual edit */}
          <div className="space-y-1">
            <label className="font-semibold text-slate-300 block">
              {vi ? "Tọa độ hộp giới hạn (BBox):" : "Bounding Box (minLon,minLat,maxLon,maxLat):"}
            </label>
            <input
              value={bbox}
              onChange={(e) => setBbox(e.target.value)}
              className="w-full rounded-xl border border-border/80 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none min-h-[38px]"
              placeholder="104,10,109,16"
            />
          </div>
        </div>

        {/* Action Button: Recalculate / Apply */}
        <div className="pt-2">
          <button
            type="button"
            onClick={onApply}
            className={cn(
              "w-full rounded-xl py-2.5 px-4 font-bold text-xs transition shadow-md flex items-center justify-center gap-2 min-h-[42px]",
              isDirty
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white ring-2 ring-cyan-400/50 shadow-cyan-950/60 animate-pulse"
                : "bg-cyan-600/30 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-600/40",
            )}
          >
            <Sparkles className="h-4 w-4" />
            <span>
              {isDirty
                ? vi
                  ? "Áp dụng & Tính toán lại"
                  : "Apply & Recalculate"
                : vi
                ? "Dữ liệu đang đồng bộ"
                : "Parameters Synchronized"}
            </span>
          </button>
        </div>

        {/* Download CSV & Brief Buttons */}
        <div className="grid grid-cols-2 gap-2 border-t border-border/60 pt-3">
          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-slate-900 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition min-h-[38px]"
          >
            <Download className="h-3.5 w-3.5 text-cyan-400" />
            <span>{vi ? "Xuất CSV" : "Export CSV"}</span>
          </button>

          <a
            href={briefHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-slate-900 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition min-h-[38px]"
          >
            <FileText className="h-3.5 w-3.5 text-orange-400" />
            <span>{vi ? "Tải Brief" : "Brief (.md)"}</span>
          </a>
        </div>
      </div>
    </aside>
  );
}
