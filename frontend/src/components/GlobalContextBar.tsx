import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Copy, Database, Filter, Info, Layers, MapPin } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { api, type Aoi } from "@/lib/api";
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

/** CLAIM-034: the 3 presets above stay the default; anything else in the
 * server AOI registry (GET /api/firms/aois) is custom and listed under
 * "More…" with its registry meta (dataset_ready/coverage_class/months). */
const PRESET_AOI_IDS = new Set(["vietnam", "amazon", "australia"]);

export function GlobalContextBar({
  onToggleFilters,
  isFiltersOpen = false,
  totalHotspots,
}: GlobalContextBarProps) {
  const { t } = useLang();
  const [searchParams] = useSearchParams();
  const { aoi, setAoi, dataFeed, setDataFeed, method, setMethod, updateParams } = useResearchContext();

  const [copied, setCopied] = useState(false);

  // CLAIM-034: custom AOIs from the server registry (GET /api/firms/aois),
  // never hardcoded. A registry failure falls back to presets-only.
  const [registryAois, setRegistryAois] = useState<Aoi[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    api.aois().then((res) => {
      if (!alive) return;
      setRegistryAois((res.aois ?? []).filter((a) => !PRESET_AOI_IDS.has(a.id)));
    }).catch(() => {
      if (alive) setRegistryAois([]);
    });
    return () => {
      alive = false;
    };
  }, []);

  const hasUrlRegion = Boolean(
    searchParams.get("aoi") || searchParams.get("bbox") || searchParams.get("geometry") || searchParams.get("dataset"),
  );
  const currentAoi = hasUrlRegion ? ((searchParams.get("aoi") as AoiId) || aoi || "vietnam") : null;
  const currentData = searchParams.get("data") || dataFeed || "raw";
  const isRaw = currentData === "raw";
  const isCustomOrFiltered = currentAoi === "custom"
    || Boolean(
      searchParams.get("dataset")
      || searchParams.get("bbox")
      || searchParams.get("geometry")
      || searchParams.get("from_date")
      || searchParams.get("to_date")
      || searchParams.get("from")
      || searchParams.get("to")
      || (searchParams.get("qa_min") && searchParams.get("qa_min") !== "all")
      || (searchParams.get("platform_set") && searchParams.get("platform_set") !== "all")
      || (searchParams.get("source_type") && searchParams.get("source_type") !== "all")
    );

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
    <div data-tour="global-context-bar" className="rounded-2xl border border-slate-800 bg-[#0B1220] px-4 py-2.5 text-xs shadow-sm space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
            <button
              type="button"
              onClick={() => setAoi("custom" as AoiId)}
              aria-pressed={currentAoi === "custom"}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-semibold transition min-h-[28px] flex items-center",
                currentAoi === "custom"
                  ? "bg-orange-500/20 text-orange-300 border border-orange-500/40 font-bold"
                  : "text-slate-400 hover:text-orange-200 hover:bg-slate-800/80"
              )}
            >
              Custom
            </button>
            {/* CLAIM-034: registry custom AOIs beyond the 3 presets. Labels
                and meta (coverage_class/months/dataset_ready) come from the
                GET /api/firms/aois entry, never from a hardcoded span. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
                aria-label={t("common.aoi_more")}
                title={t("common.aoi_more")}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-semibold transition min-h-[28px] flex items-center gap-1",
                  registryAois.some((a) => a.id === currentAoi)
                    ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 font-bold shadow-sm"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/80"
                )}
              >
                <span>{t("common.aoi_more")}{registryAois.length > 0 ? ` (${registryAois.length})` : ""}</span>
              </button>
              {moreOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-full z-50 mt-1 min-w-[220px] max-h-[280px] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl"
                >
                  {registryAois.length === 0 ? (
                    <p className="px-2.5 py-2 text-[11px] text-slate-400">
                      {t("calendar.custom_aois_empty")}
                    </p>
                  ) : (
                    registryAois.map((a) => {
                      const active = currentAoi === a.id;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setAoi(a.id as AoiId);
                            setMoreOpen(false);
                          }}
                          aria-pressed={active}
                          title={a.label}
                          className={cn(
                            "flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left transition",
                            active
                              ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40"
                              : "text-slate-300 hover:bg-slate-800 hover:text-white"
                          )}
                        >
                          <span className="text-xs font-semibold">{a.label}</span>
                          <span className="font-mono text-[10px] text-slate-400">
                            {a.coverage_class ?? "—"} · {a.months ?? "—"} · {a.dataset_ready ? "✓" : "—"}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
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
              disabled={isCustomOrFiltered}
              onClick={() => updateParams({ data: "raw", method: "stan" })}
              title={isCustomOrFiltered ? t("custom_panel.ml_disabled_reason") : t("calendar.stan_tooltip")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-semibold transition min-h-[26px]",
                isCustomOrFiltered && "opacity-40 cursor-not-allowed",
                method === "stan" && !isCustomOrFiltered
                  ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 font-bold"
                  : "text-slate-400 hover:text-white"
              )}
            >
              STAN
            </button>
            <button
              type="button"
              disabled={isCustomOrFiltered}
              onClick={() => updateParams({ data: "raw", method: "hts_anchor" })}
              title={isCustomOrFiltered ? t("custom_panel.ml_disabled_reason") : t("calendar.hts_tooltip")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-semibold transition min-h-[26px]",
                isCustomOrFiltered && "opacity-40 cursor-not-allowed",
                method === "hts_anchor" && !isCustomOrFiltered
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

      {(isCustomOrFiltered || method === "k_ratio") && (
        <div className="flex items-start gap-2 rounded-xl border border-slate-800/90 bg-slate-900/60 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          <Info className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", isCustomOrFiltered ? "text-orange-400" : "text-cyan-400")} />
          <span>
            {isCustomOrFiltered ? t("custom_panel.stat_custom_explain") : t("custom_panel.stat_preset_explain")}
          </span>
        </div>
      )}
    </div>
  );
}
