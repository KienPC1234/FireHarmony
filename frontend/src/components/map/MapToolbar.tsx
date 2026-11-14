import { Crosshair, Eye, Layers, MapPin, Pentagon, RotateCcw } from "lucide-react";
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
  const { lang } = useLang();
  const vi = lang === "vi";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border/70 bg-slate-900/95 px-3.5 py-2.5 backdrop-blur">
      {/* Left: Region Draw Tools & Coordinates */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Draw Tools Dropdown / Buttons */}
        <div className="flex items-center rounded-lg border border-border/70 bg-slate-950/80 p-0.5">
          <button
            type="button"
            onClick={() => setDrawMode(drawMode === "polygon" ? "none" : "polygon")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-all min-h-[32px]",
              drawMode === "polygon"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 ring-1 ring-amber-500/30"
                : "text-slate-300 hover:text-white hover:bg-slate-800/60",
            )}
            title={vi ? "Click để vẽ viền đa giác, click đúp để hoàn thành" : "Click to draw polygon perimeter, double-click to finish"}
          >
            <Pentagon className="h-3.5 w-3.5 text-amber-400" />
            <span>{vi ? "Vẽ vùng" : "Draw Region"}</span>
          </button>

          <button
            type="button"
            onClick={() => setDrawMode(drawMode === "box" ? "none" : "box")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-all min-h-[32px]",
              drawMode === "box"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 ring-1 ring-cyan-500/30"
                : "text-slate-300 hover:text-white hover:bg-slate-800/60",
            )}
            title={vi ? "Kéo thả hình chữ nhật giới hạn toạ độ" : "Click and drag bounding rectangle"}
          >
            <Crosshair className="h-3.5 w-3.5 text-cyan-400" />
            <span>{vi ? "Vẽ hộp" : "Draw Box"}</span>
          </button>
        </div>

        {/* Active BBox / Polygon Tag */}
        {bbox && (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-950/40 px-2.5 py-1 text-xs font-mono text-cyan-300">
            <MapPin className="h-3 w-3 text-cyan-400 shrink-0" />
            <span className="truncate max-w-[150px] sm:max-w-none">{bbox}</span>
            {onClearBbox && (
              <button
                type="button"
                onClick={onClearBbox}
                className="ml-1 text-slate-400 hover:text-rose-400 transition-colors p-0.5"
                title={vi ? "Đặt lại toạ độ" : "Reset Region"}
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Center: Layer Visualization Modes (Polygons / Clusters / Points) */}
      <div className="flex items-center rounded-lg border border-border/70 bg-slate-950/80 p-0.5">
        <button
          type="button"
          onClick={() => setLayerMode("zones")}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold transition-all min-h-[32px]",
            layerMode === "zones"
              ? "bg-orange-500/25 text-orange-300 border border-orange-500/40 shadow-sm"
              : "text-slate-400 hover:text-white",
          )}
        >
          <Layers className="h-3 w-3" />
          <span>{vi ? `Vùng cháy (${zoneCount})` : `Fire Zones (${zoneCount})`}</span>
        </button>

        <button
          type="button"
          onClick={() => setLayerMode("clusters")}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-semibold transition-all min-h-[32px]",
            layerMode === "clusters"
              ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 shadow-sm"
              : "text-slate-400 hover:text-white",
          )}
        >
          {vi ? "Cụm tâm" : "Clusters"}
        </button>

        <button
          type="button"
          onClick={() => setLayerMode("points")}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-semibold transition-all min-h-[32px]",
            layerMode === "points"
              ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 shadow-sm"
              : "text-slate-400 hover:text-white",
          )}
        >
          {vi ? "Điểm nhiệt" : "Hotspots"}
        </button>

        <button
          type="button"
          onClick={() => setLayerMode("all")}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold transition-all min-h-[32px]",
            layerMode === "all"
              ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 shadow-sm"
              : "text-slate-400 hover:text-white",
          )}
        >
          <Eye className="h-3 w-3" />
          <span>{vi ? "Tất cả lớp" : "All Layers"}</span>
        </button>
      </div>

      {/* Right: Keyless Satellite / Canvas Basemap */}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-border/70 bg-slate-950/80 p-0.5">
          {(Object.keys(basemaps) as BasemapKey[]).map((key) => {
            const label = vi
              ? key === "satellite"
                ? "Vệ tinh"
                : key === "dark"
                ? "Nền tối"
                : "Địa hình"
              : basemaps[key].label;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setBasemap(key)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-all min-h-[32px]",
                  basemap === key
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm font-semibold"
                    : "text-slate-400 hover:text-white",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="text-xs font-mono text-slate-400 hidden xl:block">
          {totalPoints.toLocaleString()} {vi ? "ô dữ liệu" : "mapped cells"}
        </div>
      </div>
    </div>
  );
}
