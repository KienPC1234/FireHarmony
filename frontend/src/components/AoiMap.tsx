import { useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polygon, Rectangle, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Flame, Info, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { buildFireZones, FireZone, HotspotCell } from "./map/clusterZones";
import { DrawPolygonLayer } from "./map/DrawPolygonLayer";
import { BasemapKey, DrawMode, LayerMode, MapToolbar } from "./map/MapToolbar";

export type { HotspotCell as Cell };

const BASEMAPS: Record<BasemapKey, { label: string; url: string; attribution: string; maxZoom: number }> = {
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 18,
  },
  dark: {
    label: "Dark Canvas",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, HERE, Garmin",
    maxZoom: 16,
  },
  terrain: {
    label: "Topography",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, DeLorme, NAVTEQ",
    maxZoom: 18,
  },
};

export function AoiMap({
  center,
  zoom,
  bbox,
  cells,
  onSelect,
  onClearBbox,
}: {
  center: [number, number];
  zoom: number;
  bbox: string | null;
  cells: HotspotCell[];
  onSelect: (bbox: string) => void;
  onClearBbox?: () => void;
}) {
  const { lang } = useLang();
  const vi = lang === "vi";

  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [basemap, setBasemap] = useState<BasemapKey>("satellite");
  const [layerMode, setLayerMode] = useState<LayerMode>("all");
  const [selectedZone, setSelectedZone] = useState<FireZone | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showAmbient, setShowAmbient] = useState(true);

  // Compute Active Fire Zones (Convex Hulls with km² area)
  const fireZones = useMemo(() => buildFireZones(cells, 0.32, 10), [cells]);

  // Compute cluster focal nodes and ambient points
  const { primaryCells, ambientDots } = useMemo(() => {
    const sorted = [...cells].sort((a, b) => b.harmonized_count - a.harmonized_count);
    return {
      primaryCells: sorted.slice(0, 150),
      ambientDots: sorted.slice(150, 900),
    };
  }, [cells]);

  const rect: [[number, number], [number, number]] | null = useMemo(() => {
    if (!bbox) return null;
    const [x0, y0, x1, y1] = bbox.split(",").map(Number);
    if ([x0, y0, x1, y1].some((v) => Number.isNaN(v))) return null;
    return [
      [y0, x0],
      [y1, x1],
    ];
  }, [bbox]);

  const currentMap = BASEMAPS[basemap];

  const getZoneColor = (severity: FireZone["severity"]) => {
    switch (severity) {
      case "extreme":
        return { stroke: "#ef4444", fill: "#dc2626", glow: "rgba(239, 68, 68, 0.35)" };
      case "high":
        return { stroke: "#f97316", fill: "#ea580c", glow: "rgba(249, 115, 22, 0.3)" };
      case "moderate":
        return { stroke: "#eab308", fill: "#ca8a04", glow: "rgba(234, 179, 8, 0.25)" };
      default:
        return { stroke: "#38bdf8", fill: "#0284c7", glow: "rgba(56, 189, 248, 0.2)" };
    }
  };

  return (
    <div className="relative rounded-2xl border border-border/80 bg-slate-950/90 shadow-card overflow-hidden">
      {/* Top Controls Toolbar */}
      <MapToolbar
        basemap={basemap}
        setBasemap={setBasemap}
        layerMode={layerMode}
        setLayerMode={setLayerMode}
        drawMode={drawMode}
        setDrawMode={setDrawMode}
        bbox={bbox}
        onClearBbox={onClearBbox}
        zoneCount={fireZones.length}
        totalPoints={cells.length}
        basemaps={BASEMAPS}
      />

      {/* Main Map Canvas */}
      <div className="relative">
        <MapContainer
          center={center}
          zoom={zoom}
          preferCanvas={true}
          dragging={drawMode === "none"}
          style={{ height: 500, width: "100%", background: "#050a14" }}
        >
          <TileLayer
            key={basemap}
            attribution={currentMap.attribution}
            url={currentMap.url}
            maxZoom={currentMap.maxZoom}
          />

          <DrawPolygonLayer
            mode={drawMode}
            onDone={(b) => {
              setDrawMode("none");
              onSelect(b);
            }}
          />

          {/* Active Bounding Rectangle if set */}
          {rect && (
            <Rectangle
              bounds={rect}
              pathOptions={{
                color: "#38bdf8",
                weight: 2,
                dashArray: "6 6",
                fillColor: "#0284c7",
                fillOpacity: 0.08,
              }}
            />
          )}

          {/* 1. REGIONAL FIRE PERIMETER POLYGONS ("Vẽ Vùng") */}
          {(layerMode === "all" || layerMode === "zones") &&
            fireZones.map((zone) => {
              const colors = getZoneColor(zone.severity);
              const isSelected = selectedZone?.id === zone.id;

              return (
                <Polygon
                  key={zone.id}
                  positions={zone.coordinates}
                  pathOptions={{
                    color: isSelected ? "#38bdf8" : colors.stroke,
                    weight: isSelected ? 3 : 2,
                    dashArray: isSelected ? undefined : "5 5",
                    fillColor: colors.fill,
                    fillOpacity: isSelected ? 0.38 : 0.2,
                  }}
                  eventHandlers={{
                    click: () => setSelectedZone(isSelected ? null : zone),
                  }}
                >
                  <Tooltip sticky>
                    <div className="font-mono text-xs p-1 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-amber-300">
                        <Flame className="h-3.5 w-3.5 text-orange-400" />
                        <span>{zone.name}</span>
                      </div>
                      <div className="text-slate-200">
                        {vi ? "Diện tích ước lượng:" : "Area Footprint:"}{" "}
                        <span className="font-semibold text-white">{zone.areaKm2} km²</span>
                      </div>
                      <div className="text-orange-400 font-semibold">
                        {zone.totalDetections} {vi ? "điểm nhiệt trên" : "detections across"} {zone.cellCount} {vi ? "ô" : "cells"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {vi ? "Đỉnh điểm:" : "Peak Date:"} {zone.peakDate} · {vi ? "Mức độ:" : "Severity:"} {zone.severity.toUpperCase()}
                      </div>
                    </div>
                  </Tooltip>
                </Polygon>
              );
            })}

          {/* 2. AMBIENT HOTSPOT DENSITY PARTICLES */}
          {showAmbient &&
            (layerMode === "all" || layerMode === "points") &&
            ambientDots.map((c, i) => {
              const isEst = c.estimate_type !== "viirs_observed";
              return (
                <CircleMarker
                  key={`amb-${i}`}
                  center={[c.lat, c.lon]}
                  radius={1.2}
                  pathOptions={{
                    color: "transparent",
                    fillColor: isEst ? "#38bdf8" : "#f97316",
                    fillOpacity: 0.25,
                    weight: 0,
                  }}
                />
              );
            })}

          {/* 3. PRIMARY CLUSTER FOCUS NODES */}
          {(layerMode === "all" || layerMode === "clusters") &&
            primaryCells.map((c, i) => {
              const isEst = c.estimate_type !== "viirs_observed";
              const color = isEst ? "#38bdf8" : "#f97316";
              const r = Math.min(8.5, Math.max(3.5, 2.5 + Math.sqrt(Math.max(c.harmonized_count, 0)) * 0.8));

              return (
                <CircleMarker
                  key={`pri-${i}`}
                  center={[c.lat, c.lon]}
                  radius={r}
                  pathOptions={{
                    color,
                    fillColor: color,
                    fillOpacity: 0.8,
                    weight: 1.5,
                  }}
                >
                  <Tooltip>
                    <div className="font-mono text-xs">
                      <div className="font-bold text-white">{c.date}</div>
                      <div className="text-orange-400 font-semibold">
                        {c.harmonized_count} {vi ? "điểm phát hiện" : "detections"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {isEst ? `${vi ? "Ước lượng" : "Estimate"}: ${c.estimate_type}` : vi ? "Quan sát VIIRS" : "Observed VIIRS"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {c.lat.toFixed(3)}°, {c.lon.toFixed(3)}°
                      </div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })}
        </MapContainer>

        {/* Floating TerraCroma-style Map Configuration Card */}
        <div className="absolute top-3 left-3 z-[1000] pointer-events-auto">
          {showConfig ? (
            <div className="w-64 rounded-xl border border-border/80 bg-slate-950/90 p-3.5 shadow-2xl backdrop-blur space-y-3 animate-fade-in text-xs">
              <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
                <span className="font-bold text-slate-200 tracking-wider uppercase text-xs">
                  {vi ? "Cấu hình lớp bản đồ" : "Map Configuration"}
                </span>
                <button
                  type="button"
                  onClick={() => setShowConfig(false)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-2">
                <label className="flex items-center justify-between text-slate-300">
                  <span>{vi ? "Hiện đa giác vùng cháy" : "Show Fire Polygons"}</span>
                  <input
                    type="checkbox"
                    checked={layerMode === "all" || layerMode === "zones"}
                    onChange={(e) => setLayerMode(e.target.checked ? "all" : "clusters")}
                    className="rounded border-slate-700 bg-slate-800 text-cyan-500"
                  />
                </label>

                <label className="flex items-center justify-between text-slate-300">
                  <span>{vi ? "Hiện điểm mật độ nền" : "Show Ambient Points"}</span>
                  <input
                    type="checkbox"
                    checked={showAmbient}
                    onChange={(e) => setShowAmbient(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-800 text-cyan-500"
                  />
                </label>
              </div>

              <div className="border-t border-border/40 pt-2 text-xs text-slate-400">
                {vi
                  ? `Nhận diện ${fireZones.length} vùng cháy từ ${cells.length.toLocaleString()} ô dữ liệu.`
                  : `Found ${fireZones.length} active regional zones across ${cells.length.toLocaleString()} detections.`}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowConfig(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-slate-950/85 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur hover:bg-slate-900 transition-all min-h-[32px]"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-400" />
              <span>{vi ? "Lớp bản đồ" : "Map Layers"}</span>
            </button>
          )}
        </div>

        {/* Floating TerraCroma-style Active Fire Zones Quick-Inspector */}
        {fireZones.length > 0 && (
          <div className="absolute bottom-3 right-3 z-[1000] pointer-events-auto max-w-sm hidden md:block">
            <div className="rounded-xl border border-border/80 bg-slate-950/90 p-3 shadow-2xl backdrop-blur space-y-2">
              <div className="flex items-center justify-between gap-4 text-xs font-bold text-slate-300 border-b border-border/50 pb-1">
                <div className="flex items-center gap-1.5">
                  <Flame className="h-3.5 w-3.5 text-orange-400" />
                  <span>{vi ? `Vùng cháy khu vực (${fireZones.length})` : `Regional Fire Zones (${fireZones.length})`}</span>
                </div>
                <span className="font-mono text-cyan-400 text-xs">{vi ? "Đã khoanh vùng" : "Polygons Mapped"}</span>
              </div>

              <div className="max-h-36 overflow-y-auto space-y-1 pr-1 font-mono text-xs">
                {fireZones.slice(0, 4).map((z) => {
                  const isSel = selectedZone?.id === z.id;
                  return (
                    <div
                      key={z.id}
                      onClick={() => setSelectedZone(isSel ? null : z)}
                      className={cn(
                        "flex items-center justify-between p-1.5 rounded cursor-pointer transition-all",
                        isSel
                          ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-200"
                          : "hover:bg-slate-800/60 text-slate-300",
                      )}
                    >
                      <div>
                        <div className="font-semibold text-slate-100">{z.name}</div>
                        <div className="text-xs text-slate-400">
                          {z.areaKm2} km² · {z.totalDetections} {vi ? "điểm nhiệt" : "fires"}
                        </div>
                      </div>
                      <span className={cn(
                        "text-xs px-1.5 py-0.5 rounded font-bold uppercase",
                        z.severity === "extreme" ? "bg-red-500/20 text-red-300 border border-red-500/40" :
                        z.severity === "high" ? "bg-orange-500/20 text-orange-300 border border-orange-500/40" :
                        "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                      )}>
                        {z.severity}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Status Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-slate-900/95 px-4 py-2.5 text-xs text-slate-300 backdrop-blur">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-orange-500 border border-orange-400 shadow-sm" />
            <span className="font-semibold text-slate-200">{vi ? "Vùng cháy (Đa giác lồi)" : "Active Fire Zone (Polygon Hull)"}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-sm" />
            <span>{vi ? "Ước lượng MODIS upscaled" : "MODIS Upscaled Estimate"}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-orange-400 shadow-sm" />
            <span>{vi ? "Quan sát VIIRS (375 m)" : "Observed VIIRS (375 m)"}</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Info className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
          <span>{vi ? "Click đa giác hoặc vẽ hộp để lọc không gian" : "Click polygons or drag boxes to define custom spatial bounds"}</span>
        </div>
      </div>
    </div>
  );
}
