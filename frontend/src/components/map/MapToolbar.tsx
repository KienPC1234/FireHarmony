import { Crosshair, Layers, MapPin, Pentagon, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

export type BasemapKey = "satellite" | "dark" | "terrain";
export type LayerMode = "all" | "zones" | "clusters" | "points";
export type DrawMode = "none" | "box" | "polygon";

interface MapToolbarProps {
  basemap: BasemapKey;
  setBasemap: (b: BasemapKey) => void;
  layerMode: LayerMode;
  setLayerMode: (m: LayerMode) => void;
  drawMode: DrawMode;
  setDrawMode: (d: DrawMode) => void;
  bbox: string | null;
  onClearBbox?: () => void;
  zoneCount: number;
  totalPoints: number;
  basemaps: Record<BasemapKey, { label: string }>;
}

export function MapToolbar({
  basemap,
  setBasemap,
  layerMode,
  setLayerMode,
  drawMode,
  setDrawMode,
  bbox,
  onClearBbox,
  zoneCount,
  totalPoints,
  basemaps,
}: MapToolbarProps) {
  const { t } = useLang();

  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-[#0B1220]/95 px-3 py-1.5 text-xs">
      {/* Cụm trái: Chế độ nền (Basemap) & Lớp dữ liệu */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Basemap Switcher */}
        <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5 shrink-0">
          {(Object.keys(basemaps) as BasemapKey[]).map((key) => {
            const label =
              key === "dark"
                ? t("calendar.basemap_dark")
                : key === "satellite"
                ? t("calendar.basemap_satellite")
                : t("calendar.basemap_terrain");
            return (
              <button
                key={key}
                type="button"
                onClick={() => setBasemap(key)}
                className={cn(
                  "rounded px-2 sm:px-2.5 py-1 text-xs font-medium transition min-h-[26px]",
                  basemap === key
                    ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30 shadow-sm"
                    : "text-slate-400 hover:text-white",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Layer Mode Toggle */}
        <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setLayerMode(layerMode === "all" ? "points" : "all")}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 sm:px-2.5 py-1 text-xs font-semibold transition min-h-[26px]",
              layerMode === "all"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "text-slate-400 hover:text-white",
            )}
            title={t("calendar.clusters", { count: zoneCount })}
          >
            <Layers className="h-3 w-3" />
            <span>{t("calendar.clusters", { count: zoneCount })}</span>
          </button>
        </div>

        {/* Spatial Draw Tool (Polygon / Box) */}
        <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setDrawMode(drawMode === "polygon" ? "none" : "polygon")}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 sm:px-2.5 py-1 text-xs font-medium transition min-h-[26px]",
              drawMode === "polygon"
                ? "bg-amber-500/25 text-amber-300 font-bold border border-amber-500/30"
                : "text-slate-400 hover:text-white",
            )}
            title={t("calendar.draw_polygon")}
          >
            <Pentagon className="h-3 w-3" />
            <span className="hidden sm:inline">{t("calendar.draw_polygon")}</span>
          </button>
          <button
            type="button"
            onClick={() => setDrawMode(drawMode === "box" ? "none" : "box")}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition min-h-[26px]",
              drawMode === "box"
                ? "bg-cyan-500/25 text-cyan-300 font-bold border border-cyan-500/30"
                : "text-slate-400 hover:text-white",
            )}
            title={t("calendar.draw_box")}
          >
            <Crosshair className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Cụm phải: Điểm nhiệt & BBox */}
      <div className="flex items-center gap-2 shrink-0">
        {bbox && (
          <div className="hidden lg:inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-950/40 px-2 py-0.5 text-xs font-mono text-cyan-300">
            <MapPin className="h-3 w-3 text-cyan-400 shrink-0" />
            <span className="truncate max-w-[100px]">{bbox}</span>
            {onClearBbox && (
              <button
                type="button"
                onClick={onClearBbox}
                className="ml-1 text-slate-400 hover:text-rose-400 p-0.5"
                title={t("calendar.clear_filter")}
              >
                <RotateCcw className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        )}

        <span className="text-xs font-mono text-slate-400">
          <span className="text-cyan-300 font-bold">{totalPoints.toLocaleString()}</span> {t("common.hotspots")}
        </span>
      </div>
    </div>
  );
}
