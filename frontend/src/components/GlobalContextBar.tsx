import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Copy, Database, Filter, Layers, MapPin } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface GlobalContextBarProps {
  onToggleFilters?: () => void;
  isFiltersOpen?: boolean;
  totalHotspots?: number;
}

export function GlobalContextBar({
  onToggleFilters,
  isFiltersOpen = false,
  totalHotspots,
}: GlobalContextBarProps) {
  const { lang } = useLang();
  const vi = lang === "vi";
  const [searchParams] = useSearchParams();

  const [copied, setCopied] = useState(false);

  const aoi = searchParams.get("aoi") || "vietnam";
  const dataMode = searchParams.get("data") || "sample";
  const method = searchParams.get("method") || "stat";

  const aoiLabels: Record<string, { vi: string; en: string }> = {
    vietnam: { vi: "Việt Nam (Tây Nguyên)", en: "Vietnam (Central Highlands)" },
    amazon: { vi: "Amazon (Nam bồn địa)", en: "Amazon (Southern basin)" },
    australia: { vi: "Úc (Black Summer)", en: "Australia (Black Summer)" },
  };

  const methodLabels: Record<string, { vi: string; en: string }> = {
    stat: { vi: "Thống kê (k-ratio)", en: "Statistical (k-ratio)" },
    ml: { vi: "HGBoost ML (v4)", en: "HGBoost ML (v4)" },
    ts: { vi: "Transformer (v2)", en: "Transformer (v2)" },
  };

  const currentAoi = aoiLabels[aoi] || { vi: aoi, en: aoi };
  const currentMethod = methodLabels[method] || { vi: method, en: method };
  const isRaw = dataMode === "raw";

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#111C2E] px-4 py-2.5 text-xs shadow-sm">
      {/* Context segments */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-slate-300">
        {/* Area */}
        <div className="flex items-center gap-1.5 font-medium text-slate-200">
          <MapPin className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
          <span>{vi ? currentAoi.vi : currentAoi.en}</span>
        </div>

        <span className="text-slate-600 hidden sm:inline">|</span>

        {/* Time period */}
        <div className="text-slate-300 font-mono">
          <span>2001 - 2025</span>
        </div>

        <span className="text-slate-600 hidden sm:inline">|</span>

        {/* Data Feed */}
        <div className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span
            className={cn(
              "font-semibold rounded px-1.5 py-0.5",
              isRaw
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
            )}
          >
            {isRaw
              ? (vi ? "NASA quan trắc" : "NASA Observed")
              : (vi ? "Dữ liệu mẫu" : "Synthetic Feed")}
          </span>
        </div>

        <span className="text-slate-600 hidden md:inline">|</span>

        {/* Method */}
        <div className="hidden md:flex items-center gap-1.5 text-slate-300">
          <Layers className="h-3.5 w-3.5 text-purple-400 shrink-0" />
          <span>{vi ? currentMethod.vi : currentMethod.en}</span>
        </div>

        {totalHotspots !== undefined && totalHotspots > 0 && (
          <>
            <span className="text-slate-600 hidden lg:inline">|</span>
            <div className="hidden lg:flex items-center gap-1 text-slate-400">
              <span className="font-mono text-slate-200">{totalHotspots.toLocaleString()}</span>
              <span>{vi ? "lượt điểm nóng" : "hotspot detections"}</span>
            </div>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 shrink-0">
        {onToggleFilters && (
          <button
            type="button"
            onClick={onToggleFilters}
            aria-pressed={isFiltersOpen}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition min-h-[36px]",
              isFiltersOpen
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/50"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700"
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            <span>{vi ? "Bộ lọc" : "Filters"}</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleShare}
          title={vi ? "Sao chép liên kết chia sẻ" : "Copy deep share link"}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition min-h-[36px]"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-300">{vi ? "Đã chép" : "Copied"}</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>{vi ? "Chia sẻ" : "Share"}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
