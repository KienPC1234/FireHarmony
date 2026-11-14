import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Copy, Database, Filter, Layers, MapPin } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { useResearchContext, type AoiId } from "@/lib/researchContext";
import { cn } from "@/lib/utils";

interface GlobalContextBarProps {
  onToggleFilters?: () => void;
  isFiltersOpen?: boolean;
  totalHotspots?: number;
}

const AOI_LIST: Array<{ id: AoiId; key: string; fullKey: string }> = [
  { id: "vietnam", key: "aoi.vietnam_short", fullKey: "aoi.vietnam" },
  { id: "amazon", key: "aoi.amazon_short", fullKey: "aoi.amazon" },
  { id: "australia", key: "aoi.australia_short", fullKey: "aoi.australia" },
];

export function GlobalContextBar({
  onToggleFilters,
  isFiltersOpen = false,
  totalHotspots,
}: GlobalContextBarProps) {
  const { t } = useLang();
  const [searchParams] = useSearchParams();
  const { aoi, setAoi, dataFeed, setDataFeed, method, setMethod } = useResearchContext();

  const [copied, setCopied] = useState(false);

  const currentAoi = (searchParams.get("aoi") as AoiId) || aoi || "vietnam";
  const currentData = searchParams.get("data") || dataFeed || "raw";
  const isRaw = currentData === "raw";

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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-[#0B1220] px-4 py-2.5 text-xs shadow-sm">
      {/* 1. Interactive Context Segments */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-slate-300">
        {/* Interactive AOI Switcher */}
        <div className="flex items-center gap-1.5 font-medium">
          <MapPin className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5" role="group" aria-label="Target AOI">
            {AOI_LIST.map((item) => {
              const active = currentAoi === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setAoi(item.id)}
                  aria-pressed={active}
                  title={t(item.fullKey)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-semibold transition min-h-[28px] flex items-center gap-1",
                    active
                      ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 font-bold shadow-sm"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/80"
                  )}
                >
                  <span>{t(item.key)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <span className="text-slate-700 hidden sm:inline">|</span>

        {/* Time period: the served range is on every calendar/evidence card. */}
        <div className="text-slate-400 font-mono hidden md:inline">
          <span>{t("common.recorded_range")}</span>
        </div>

        <span className="text-slate-700 hidden md:inline">|</span>

        {/* Interactive Data Feed Switcher */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDataFeed(isRaw ? "sample" : "raw")}
            title={t("common.toggle_data_feed")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-mono font-semibold transition min-h-[28px]",
              isRaw
                ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50 shadow-sm"
                : "border-sky-500/40 bg-sky-950/40 text-sky-300 hover:bg-sky-900/50 shadow-sm"
            )}
          >
            <Database className="h-3.5 w-3.5 shrink-0" />
            <span>{isRaw ? t("common.observed_feed") : t("common.synthetic_feed")}</span>
          </button>
        </div>

        <span className="text-slate-700 hidden lg:inline">|</span>

        {/* Interactive Method Switcher */}
        <div className="hidden lg:flex items-center gap-1.5 text-slate-300">
          <Layers className="h-3.5 w-3.5 text-purple-400 shrink-0" />
          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5">
            <button
              type="button"
              onClick={() => setMethod("k_ratio")}
              title={t("calendar.b2_tooltip")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-semibold transition min-h-[26px]",
                method === "k_ratio"
                  ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 font-bold"
                  : "text-slate-400 hover:text-white"
              )}
            >
              B2 Anchor
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isRaw) setDataFeed("raw");
                setMethod("stan");
              }}
              title={t("calendar.stan_tooltip")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-semibold transition min-h-[26px]",
                method === "stan"
                  ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 font-bold"
                  : "text-slate-400 hover:text-white"
              )}
            >
              STAN
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isRaw) setDataFeed("raw");
                setMethod("hts_anchor");
              }}
              title={t("calendar.hts_tooltip")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-semibold transition min-h-[26px]",
                method === "hts_anchor"
                  ? "bg-amber-500/25 text-amber-300 border border-amber-500/40 font-bold"
                  : "text-slate-400 hover:text-white"
              )}
            >
              HTS (Tile)
            </button>
          </div>
        </div>

        {totalHotspots !== undefined && totalHotspots > 0 && (
          <>
            <span className="text-slate-700 hidden xl:inline">|</span>
            <div className="hidden xl:flex items-center gap-1 text-slate-400 font-mono">
              <span className="text-slate-200 font-bold">{totalHotspots.toLocaleString()}</span>
              <span>{t("common.detections")}</span>
            </div>
          </>
        )}
      </div>

      {/* 2. Action Buttons */}
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
            <span>{t("common.filters")}</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleShare}
          title={t("common.copy_share_link")}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition min-h-[36px]"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-300 font-bold">{t("common.copied")}</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>{t("common.share")}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
