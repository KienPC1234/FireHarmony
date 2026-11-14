import { Check, Database, Globe, Loader2, Play, Sliders } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { PRESETS, SENSORS, Tab } from "./types";

interface LabSidebarProps {
  aoi: string;
  setAoi: (aoi: string) => void;
  dsrc: string;
  setDsrc: (dsrc: string) => void;
  year: number;
  setYear: (y: number) => void;
  month: number;
  setMonth: (m: number) => void;
  sensors: string[];
  toggleSensor: (id: string) => void;
  busy: boolean;
  onRun: () => void;
  activeTab: Tab;
}

export function LabSidebar({
  aoi,
  setAoi,
  dsrc,
  setDsrc,
  year,
  setYear,
  month,
  setMonth,
  sensors,
  toggleSensor,
  busy,
  onRun,
  activeTab,
}: LabSidebarProps) {
  const { lang } = useLang();
  const vi = lang === "vi";

  return (
    <aside className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-[#111C2E] p-4 sm:p-5 shadow-sm space-y-4">
        {/* Target AOI Selector (Select 0) */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-cyan-400" />
            <span>{vi ? "Khu vực phân tích (AOI)" : "Target Area (AOI)"}</span>
          </label>
          <select
            value={aoi}
            onChange={(e) => setAoi(e.target.value)}
            aria-label="Target AOI"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white focus:outline-none min-h-[40px]"
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {vi ? p.name.vi : p.name.en} ({vi ? p.region.vi : p.region.en})
              </option>
            ))}
          </select>
        </div>

        {/* Data Stream Selector (Select 1: required for smoke test) */}
        <div className="space-y-1.5 border-t border-slate-800 pt-3">
          <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5 text-cyan-400" />
            <span>{vi ? "Nguồn dữ liệu thử nghiệm" : "Data Feed"}</span>
          </label>
          <select
            value={dsrc}
            onChange={(e) => setDsrc(e.target.value)}
            aria-label="Data feed"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white focus:outline-none min-h-[40px]"
          >
            <option value="sample">{vi ? "Dữ liệu mẫu (Synthetic Sample)" : "Synthetic Sample (In-Memory)"}</option>
            <option value="raw">{vi ? "NASA FIRMS quan trắc (Archive)" : "NASA FIRMS Observed (Archive)"}</option>
          </select>
          <p className="text-xs text-slate-400">
            {dsrc === "sample"
              ? (vi ? "Dữ liệu mẫu kiểm thử ngoại tuyến (phản hồi tức thì)" : "Fast verified sample (instant response)")
              : (vi ? "Dữ liệu quan trắc NASA FIRMS đầy đủ" : "Direct NASA FIRMS files (full coverage)")}
          </p>
        </div>

        {/* Temporal Filters: Year & Month */}
        <div className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">
              {vi ? "Năm phân tích" : "Year"}
            </label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white focus:outline-none min-h-[40px]"
            >
              {Array.from({ length: 14 }, (_, i) => 2012 + i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">
              {vi ? "Tháng" : "Month"}
            </label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white focus:outline-none min-h-[40px]"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {vi ? "T" : "M"}{String(m).padStart(2, "0")}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Sensor Constellation Active Checklist (Used in Simulator) */}
        {activeTab === "simulator" && (
          <div className="space-y-2 border-t border-slate-800 pt-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5 text-cyan-400" />
                <span>{vi ? "Cấu hình vệ tinh" : "Active Constellation"}</span>
              </span>
              <span className="font-mono text-xs text-cyan-400">
                {sensors.length}/{SENSORS.length} {vi ? "bật" : "active"}
              </span>
            </div>

            <div className="space-y-1.5">
              {SENSORS.map((s) => {
                const active = sensors.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSensor(s.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl border p-2.5 text-left text-xs transition min-h-[44px]",
                      active
                        ? "border-cyan-500/40 bg-cyan-950/30 text-white"
                        : "border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200",
                    )}
                  >
                    <div>
                      <div className="font-semibold text-slate-200">{s.label}</div>
                      <div className="text-xs text-slate-400">{s.res}</div>
                    </div>
                    <div
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded border",
                        active
                          ? "border-cyan-500 bg-cyan-500 text-slate-950"
                          : "border-slate-700 bg-slate-800",
                      )}
                    >
                      {active && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Execution Run Button */}
        <div className="border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={onRun}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 hover:bg-orange-500 py-3 text-xs font-bold text-white shadow-sm transition active:scale-95 disabled:opacity-50 min-h-[44px]"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{vi ? "Đang chạy mô phỏng..." : "Running Simulation..."}</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-white" />
                <span>{vi ? "Chạy thử nghiệm" : "Run Experiment"}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
