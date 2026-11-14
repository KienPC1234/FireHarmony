import { ArrowRight, Cpu, Database, Globe, Layers, ScanEye } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

interface XraySidebarProps {
  aoi: string;
  setAoi: (aoi: string) => void;
  data: string;
  setData: (data: string) => void;
  dataSrcLabel: string;
  units: string;
  mlTrained: boolean;
  tsTrained: boolean;
  totalMonths: number;
  viewTab: "trajectory" | "transition" | "backtest";
  setViewTab: (tab: "trajectory" | "transition" | "backtest") => void;
}

const AOIS = [
  {
    id: "vietnam",
    name: { vi: "Việt Nam", en: "Vietnam" },
    desc: { vi: "Tây Nguyên & Duyên hải Nam Trung Bộ", en: "Central Highlands & Mekong" },
    coords: "104°E - 109°E",
  },
  {
    id: "amazon",
    name: { vi: "Amazon", en: "Amazon" },
    desc: { vi: "Nam bồn địa Amazon / Cerrado", en: "Southern Basin / Cerrado transition" },
    coords: "70°W - 50°W",
  },
  {
    id: "australia",
    name: { vi: "Úc (Australia)", en: "Australia" },
    desc: { vi: "Đông Nam Úc (Vùng Black Summer)", en: "Southeast Black Summer zone" },
    coords: "113°E - 153°E",
  },
];

export function XraySidebar({
  aoi,
  setAoi,
  data,
  setData,
  dataSrcLabel,
  units,
  mlTrained,
  tsTrained,
  totalMonths,
  viewTab,
  setViewTab,
}: XraySidebarProps) {
  const { lang, t } = useLang();
  const vi = lang === "vi";

  return (
    <aside className="space-y-4">
      {/* Target AOI Console Card */}
      <div className="rounded-2xl border border-slate-800 bg-[#111C2E] p-4 shadow-sm space-y-3.5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider">
            <Globe className="h-3.5 w-3.5 text-cyan-400" />
            <span>{t("xray.sidebar_region")}</span>
          </div>
          <span className="font-mono text-xs text-cyan-400">{t("xray.sidebar_target")}</span>
        </div>

        <div className="space-y-1.5">
          {AOIS.map((item) => {
            const active = aoi === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAoi(item.id)}
                className={cn(
                  "w-full text-left rounded-xl p-2.5 transition-all border flex items-center justify-between min-h-[44px]",
                  active
                    ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-200 shadow-sm"
                    : "border-slate-800 bg-slate-900/40 text-slate-400 hover:text-slate-200 hover:bg-slate-900/80",
                )}
              >
                <div>
                  <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                    <span>{vi ? item.name.vi : item.name.en}</span>
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />}
                  </div>
                  <div className="text-xs text-slate-400 truncate max-w-[190px]">{vi ? item.desc.vi : item.desc.en}</div>
                </div>
                <span className="font-mono text-xs text-slate-500">{item.coords}</span>
              </button>
            );
          })}
        </div>

        {/* Data Stream Selector */}
        <div className="space-y-1.5 border-t border-slate-800 pt-3">
          <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5 text-cyan-400" />
            <span>{t("xray.sidebar_dataset")}</span>
          </label>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 p-1">
            <button
              type="button"
              onClick={() => setData("sample")}
              className={cn(
                "rounded-md py-1.5 text-center text-xs font-semibold transition-all min-h-[36px]",
                data === "sample"
                  ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 shadow-sm"
                  : "text-slate-400 hover:text-white",
              )}
            >
              {t("common.synthetic_feed")}
            </button>
            <button
              type="button"
              onClick={() => setData("raw")}
              className={cn(
                "rounded-md py-1.5 text-center text-xs font-semibold transition-all min-h-[36px]",
                data === "raw"
                  ? "bg-amber-500/25 text-amber-300 border border-amber-500/40 shadow-sm"
                  : "text-slate-400 hover:text-white",
              )}
            >
              {t("common.observed_feed")}
            </button>
          </div>
          <p className="text-xs text-slate-500 italic">{dataSrcLabel}</p>
        </div>

        {/* Scientific Audit View Mode */}
        <div className="space-y-1.5 border-t border-slate-800 pt-3">
          <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <ScanEye className="h-3.5 w-3.5 text-orange-400" />
            <span>{t("xray.sidebar_specs")}</span>
          </label>
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setViewTab("trajectory")}
              className={cn(
                "w-full text-left rounded-lg p-2.5 text-xs font-semibold transition-all border flex items-center gap-2 min-h-[40px]",
                viewTab === "trajectory"
                  ? "border-cyan-500/40 bg-cyan-950/40 text-cyan-200"
                  : "border-transparent text-slate-400 hover:bg-slate-900 hover:text-white",
              )}
            >
              <span className="h-2 w-2 rounded-full bg-cyan-400 shrink-0" />
              <span>{t("xray.tab_trajectory")}</span>
            </button>

            <button
              type="button"
              onClick={() => setViewTab("transition")}
              className={cn(
                "w-full text-left rounded-lg p-2.5 text-xs font-semibold transition-all border flex items-center gap-2 min-h-[40px]",
                viewTab === "transition"
                  ? "border-amber-500/40 bg-amber-950/40 text-amber-200"
                  : "border-transparent text-slate-400 hover:bg-slate-900 hover:text-white",
              )}
            >
              <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
              <span>{t("xray.tab_transition")}</span>
            </button>

            <button
              type="button"
              onClick={() => setViewTab("backtest")}
              className={cn(
                "w-full text-left rounded-lg p-2.5 text-xs font-semibold transition-all border flex items-center gap-2 min-h-[40px]",
                viewTab === "backtest"
                  ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200"
                  : "border-transparent text-slate-400 hover:bg-slate-900 hover:text-white",
              )}
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
              <span>{t("xray.tab_backtest")}</span>
            </button>
          </div>
        </div>

        {/* Telemetry Hardware Specs Card */}
        <div className="border-t border-slate-800 pt-3 space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between text-slate-400">
            <span>{t("xray.units")}:</span>
            <span className="text-slate-200 font-semibold">{units}</span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>{t("xray.total_months")}:</span>
            <span className="text-slate-200">
              {vi ? `${totalMonths} cặp tháng` : `${totalMonths} monthly pairs`}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>{t("xray.ml_status")}:</span>
            <span className={mlTrained ? "text-emerald-400 font-bold" : "text-amber-400"}>
              {mlTrained ? (vi ? "Sẵn sàng" : "Operational") : (vi ? "Dự phòng" : "Offline fallback")}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>{t("xray.ts_status")}:</span>
            <span className={tsTrained ? "text-emerald-400 font-bold" : "text-amber-400"}>
              {tsTrained ? (vi ? "Đang bật" : "Active") : (vi ? "Dự phòng" : "Offline fallback")}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Navigation to Ecosystem */}
      <div className="rounded-2xl border border-slate-800 bg-[#111C2E] p-3.5 shadow-sm space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
          {vi ? "Công cụ liên quan" : "Related Cockpit Tools"}
        </div>
        <div className="space-y-1">
          <Link
            to={`/calendar?aoi=${aoi}&data=${data}`}
            className="flex items-center justify-between p-2 rounded-lg text-xs text-slate-300 hover:bg-slate-900 hover:text-cyan-300 transition min-h-[40px]"
          >
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-cyan-400" />
              <span>{t("calendar.title")}</span>
            </span>
            <ArrowRight className="h-3 w-3 text-slate-500" />
          </Link>
          <Link
            to={`/lab`}
            className="flex items-center justify-between p-2 rounded-lg text-xs text-slate-300 hover:bg-slate-900 hover:text-orange-300 transition min-h-[40px]"
          >
            <span className="flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-orange-400" />
              <span>{t("nav.lab")}</span>
            </span>
            <ArrowRight className="h-3 w-3 text-slate-500" />
          </Link>
        </div>
      </div>
    </aside>
  );
}
