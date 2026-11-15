import { useState } from "react";
import { Check, Crosshair, Layers, MapPin, Pentagon, RotateCcw, X } from "lucide-react";
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
  hasCustomFilter?: boolean;
  onClearBbox?: () => void;
  onSetBbox?: (b: string) => void;
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
  hasCustomFilter = false,
  onClearBbox,
  onSetBbox,
  zoneCount,
  totalPoints,
  basemaps,
}: MapToolbarProps) {
  const { t } = useLang();
  const [showCoordDialog, setShowCoordDialog] = useState(false);
  const [minLon, setMinLon] = useState("");
  const [minLat, setMinLat] = useState("");
  const [maxLon, setMaxLon] = useState("");
  const [maxLat, setMaxLat] = useState("");
  const [coordError, setCoordError] = useState("");

  const handleOpenCoordDialog = () => {
    if (bbox) {
      const parts = bbox.split(",");
      if (parts.length === 4) {
        setMinLon(parts[0]);
        setMinLat(parts[1]);
        setMaxLon(parts[2]);
        setMaxLat(parts[3]);
      }
    }
    setCoordError("");
    setShowCoordDialog(!showCoordDialog);
  };

  const handleApplyCoords = (e: React.FormEvent) => {
    e.preventDefault();
    const w = parseFloat(minLon);
    const s = parseFloat(minLat);
    const eLon = parseFloat(maxLon);
    const n = parseFloat(maxLat);

    if (isNaN(w) || isNaN(s) || isNaN(eLon) || isNaN(n)) {
      setCoordError(t("map.invalid_coords"));
      return;
    }
    if (w < -180 || eLon > 180 || w >= eLon) {
      setCoordError(t("calendar.coord_lon_range"));
      return;
    }
    if (s < -90 || n > 90 || s >= n) {
      setCoordError(t("calendar.coord_lat_range"));
      return;
    }

    if (onSetBbox) {
      onSetBbox(`${w},${s},${eLon},${n}`);
    }
    setShowCoordDialog(false);
  };

  return (
    <div data-testid="calendar-map-toolbar" className="relative border-b border-slate-800 bg-[#0B1220]/95 px-2.5 py-1 text-[11px]">
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-1.5 sm:flex-nowrap sm:justify-between sm:overflow-x-auto">
        {/* Cụm trái: Chế độ nền (Basemap) & Lớp dữ liệu */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap sm:shrink-0">
          {/* Basemap Switcher */}
          <div className="flex max-w-full flex-wrap items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5">
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
                    "rounded px-1.5 sm:px-2 py-0.5 text-[11px] font-medium transition min-h-[24px]",
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
                "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold transition min-h-[24px]",
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

          {/* Spatial Draw Tool (Polygon / Box) + Direct Lat/Lon Input */}
          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setDrawMode(drawMode === "polygon" ? "none" : "polygon")}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition min-h-[24px]",
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
                "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition min-h-[24px]",
                drawMode === "box"
                  ? "bg-cyan-500/25 text-cyan-300 font-bold border border-cyan-500/30"
                  : "text-slate-400 hover:text-white",
              )}
              title={t("calendar.draw_box")}
            >
              <Crosshair className="h-3 w-3" />
              <span className="hidden md:inline">Box</span>
            </button>
            {onSetBbox && (
              <button
                type="button"
                onClick={handleOpenCoordDialog}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition min-h-[24px]",
                  showCoordDialog
                    ? "bg-purple-500/25 text-purple-300 font-bold border border-purple-500/30"
                    : "text-slate-400 hover:text-white",
                )}
                title={t("calendar.enter_lat_lon")}
              >
                <MapPin className="h-3 w-3" />
                <span className="hidden md:inline font-mono">{t("calendar.enter_lat_lon")}</span>
              </button>
            )}
            {hasCustomFilter && onClearBbox && (
              <button
                type="button"
                onClick={() => {
                  setDrawMode("none");
                  setShowCoordDialog(false);
                  onClearBbox();
                }}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold text-rose-300 bg-rose-950/60 border border-rose-500/40 hover:bg-rose-900/70 transition min-h-[24px]"
                title={t("calendar.clear_filter")}
              >
                <RotateCcw className="h-3 w-3" />
                <span>{t("calendar.clear_filter")}</span>
              </button>
            )}
          </div>
        </div>

        {/* Cụm phải: Điểm nhiệt & BBox */}
        <div className="flex items-center gap-1.5 shrink-0">
          {bbox && (
            <div className="hidden 2xl:inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-950/40 px-1.5 py-0.5 text-[11px] font-mono text-cyan-300">
              <MapPin className="h-3 w-3 text-cyan-400 shrink-0" />
              <span className="truncate max-w-[100px]">{bbox}</span>
              {onClearBbox && (
                <button
                  type="button"
                  onClick={onClearBbox}
                  className="ml-0.5 text-slate-400 hover:text-rose-400 p-0.5"
                  title={t("calendar.clear_filter")}
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )}

          <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap">
            <span className="text-cyan-300 font-bold">{totalPoints.toLocaleString()}</span> {t("common.hotspots")}
          </span>
        </div>
      </div>

      {/* Manual Lat/Lon Coordinate Input Dialog */}
      {showCoordDialog && onSetBbox && (
        <form
          onSubmit={handleApplyCoords}
          className="mt-2 p-3 rounded-xl border border-purple-500/30 bg-slate-950/95 shadow-xl space-y-2 animate-fade-in"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="font-bold text-xs text-purple-300 font-mono">
              {t("calendar.coord_title")}
            </span>
            <button
              type="button"
              onClick={() => setShowCoordDialog(false)}
              className="text-slate-400 hover:text-white p-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-0.5">{t("calendar.coord_min_lon")}</label>
              <input
                type="number"
                step="any"
                required
                placeholder="104.0"
                value={minLon}
                onChange={(e) => setMinLon(e.target.value)}
                className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-white font-mono focus:border-purple-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-0.5">{t("calendar.coord_min_lat")}</label>
              <input
                type="number"
                step="any"
                required
                placeholder="10.0"
                value={minLat}
                onChange={(e) => setMinLat(e.target.value)}
                className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-white font-mono focus:border-purple-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-0.5">{t("calendar.coord_max_lon")}</label>
              <input
                type="number"
                step="any"
                required
                placeholder="109.0"
                value={maxLon}
                onChange={(e) => setMaxLon(e.target.value)}
                className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-white font-mono focus:border-purple-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-0.5">{t("calendar.coord_max_lat")}</label>
              <input
                type="number"
                step="any"
                required
                placeholder="16.0"
                value={maxLat}
                onChange={(e) => setMaxLat(e.target.value)}
                className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-white font-mono focus:border-purple-400 focus:outline-none"
              />
            </div>
          </div>
          {coordError && (
            <p className="text-[11px] text-rose-400 font-mono">{coordError}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowCoordDialog(false)}
              className="rounded px-2.5 py-1 text-xs text-slate-400 hover:text-white"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded bg-purple-600 hover:bg-purple-500 text-white px-3 py-1 text-xs font-semibold shadow-sm transition"
            >
              <Check className="h-3 w-3" />
              <span>{t("calendar.apply_coords")}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
