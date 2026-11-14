import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polygon, Rectangle, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { buildHotspotClusters, HotspotCluster, HotspotCell } from "./map/clusterZones";
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
    url: "https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, HERE, Garmin",
    maxZoom: 16,
  },
  terrain: {
    label: "Topography",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, NAVTEQ",
    maxZoom: 18,
  },
};

const SATELLITE_LABELS_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [map]);
  return null;
}

const createClusterCentroidIcon = (count: number, isSelected: boolean) => {
  const bg = "bg-amber-500/90 text-slate-950 border-amber-200";
  const ring = isSelected ? "ring-2 ring-cyan-300 scale-125 z-50 shadow-cyan-500/50" : "hover:scale-110";

  return L.divIcon({
    className: "firms-cluster-centroid",
    html: `
      <div style="transform: translate(-50%, -50%);" class="cursor-pointer transition-transform ${ring}">
        <div class="flex items-center justify-center w-6 h-6 rounded-full ${bg} border shadow-lg font-mono text-[10px] font-extrabold tracking-tight">
          ${count > 99 ? "99+" : count}
        </div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

export function AoiMap({
  center,
  zoom,
  bbox,
  geometry = null,
  cells,
  preview = null,
  onSelect,
  onClearBbox,
  fullBleed = false,
  height = "100%",
  hideToolbar = false,
  hideLegend = false,
  activeZoneId,
  onSelectZone,
}: {
  center: [number, number];
  zoom: number;
  bbox: string | null;
  geometry?: string | null;
  cells: HotspotCell[];
  preview?: { returned: number; total: number; preview: boolean; level?: string } | null;
  onSelect: (bbox: string, geometry?: string | null) => void;
  onClearBbox?: () => void;
  fullBleed?: boolean;
  height?: string | number;
  hideToolbar?: boolean;
  hideLegend?: boolean;
  activeZoneId?: string;
  onSelectZone?: (z: HotspotCluster | null) => void;
}) {
  const { lang } = useLang();
  const vi = lang === "vi";

  const [basemap, setBasemap] = useState<BasemapKey>("dark");
  const [layerMode, setLayerMode] = useState<LayerMode>("all");
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [selectedZone, setSelectedZone] = useState<HotspotCluster | null>(null);

  const fireZones = useMemo(() => buildHotspotClusters(cells, 0.45), [cells]);

  const { primaryCells, ambientDots } = useMemo(() => {
    const sorted = [...cells].sort((a, b) => b.harmonized_count - a.harmonized_count);
    return {
      primaryCells: sorted.slice(0, 160),
      ambientDots: sorted.slice(160, 1000),
    };
  }, [cells]);

  const drawnRing: [number, number][] | null = useMemo(() => {
    if (!geometry) return null;
    try {
      const g = JSON.parse(geometry) as { coordinates?: number[][][] };
      const ring = g.coordinates?.[0];
      if (!ring) return null;
      return ring.map(([lon, lat]) => [lat, lon] as [number, number]);
    } catch {
      return null;
    }
  }, [geometry]);

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

  const effectiveSelectedZone = activeZoneId
    ? fireZones.find((z) => z.id === activeZoneId) ?? selectedZone
    : selectedZone;

  return (
    <div
      className={cn(
        "relative flex flex-col w-full min-h-0 overflow-hidden",
        fullBleed
          ? "h-full bg-[#060B13]"
          : "rounded-2xl border border-border/80 bg-slate-950/90 shadow-card",
      )}
      style={{ height }}
    >
      {/* 1. TOP TOOLBAR DOCKED CLEANLY */}
      {!hideToolbar && (
        <div className="shrink-0">
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
        </div>
      )}

      {/* 2. MAIN MAP CANVAS (ABSOLUTE FILL OVER FLEX-1 CONTAINER) */}
      <div className="relative flex-1 min-h-0 w-full bg-[#060B13]">
        <div className="absolute inset-0">
          <MapContainer
            center={center}
            zoom={zoom}
            preferCanvas={true}
            dragging={drawMode === "none"}
            className="h-full w-full"
            style={{ height: "100%", width: "100%", background: "#060B13" }}
          >
            <MapResizer />

            <TileLayer
              key={basemap}
              attribution={currentMap.attribution}
              url={currentMap.url}
              maxZoom={currentMap.maxZoom}
            />
            {basemap === "satellite" && (
              <TileLayer key="satellite-labels" url={SATELLITE_LABELS_URL} maxZoom={18} opacity={0.85} />
            )}

            <DrawPolygonLayer
              mode={drawMode}
              onDone={(b, pts) => {
                setDrawMode("none");
                if (!pts) {
                  onSelect(b, null);
                  return;
                }
                const coords = pts.map(([lat, lon]) => [Number(lon.toFixed(4)), Number(lat.toFixed(4))]);
                coords.push(coords[0]);
                onSelect(b, JSON.stringify({ type: "Polygon", coordinates: [coords] }));
              }}
            />

            {drawnRing && (
              <Polygon
                positions={drawnRing}
                pathOptions={{ color: "#38bdf8", weight: 2, dashArray: "5 4", fillColor: "#0284c7", fillOpacity: 0.08 }}
              />
            )}

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

            {/* 1. OBSERVED HOTSPOT CLUSTERS (convex hull, not a fire perimeter) */}
            {(layerMode === "all" || layerMode === "zones") &&
              fireZones.map((zone) => {
                const isSelected = effectiveSelectedZone?.id === zone.id;

                return (
                  <Polygon
                    key={zone.id}
                    positions={zone.coordinates}
                    pathOptions={{
                      color: isSelected ? "#38bdf8" : "#f59e0b",
                      weight: isSelected ? 3 : 2,
                      dashArray: "5 5",
                      fillColor: "#f59e0b",
                      fillOpacity: isSelected ? 0.22 : 0.08,
                    }}
                    eventHandlers={{
                      click: () => {
                        const next = isSelected ? null : zone;
                        setSelectedZone(next);
                        if (onSelectZone) onSelectZone(next);
                      },
                    }}
                  >
                    <Tooltip sticky>
                      <div className="font-mono text-xs p-1 space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-amber-300">
                          <Flame className="h-3.5 w-3.5 text-orange-400" />
                          <span>{zone.name}</span>
                        </div>
                        <div className="text-orange-400 font-semibold">
                          {zone.totalDetections} {vi ? "điểm nhiệt trên" : "detections across"} {zone.cellCount} {vi ? "ô" : "cells"}
                        </div>
                        <div className="text-xs text-slate-400">
                          {vi ? "Đỉnh điểm:" : "Peak date:"} {zone.peakDate}
                        </div>
                        <div className="max-w-[220px] text-[11px] leading-snug text-amber-200/90">
                          {vi
                            ? "Bao hình học quanh các ô phát hiện — KHÔNG phải đường viền cháy, diện tích cháy hay mức nguy cơ."
                            : "Convex hull around detected cells — NOT a fire perimeter, burned area, or risk grade."}
                        </div>
                      </div>
                    </Tooltip>
                  </Polygon>
                );
              })}

            {/* 2. SCIENTIFIC CLUSTER CENTROID BADGES */}
            {(layerMode === "all" || layerMode === "zones") &&
              fireZones.map((zone) => {
                const isSelected = effectiveSelectedZone?.id === zone.id;
                return (
                  <Marker
                    key={`marker-${zone.id}`}
                    position={zone.center}
                    icon={createClusterCentroidIcon(zone.cellCount, isSelected)}
                    eventHandlers={{
                      click: () => {
                        const next = isSelected ? null : zone;
                        setSelectedZone(next);
                        if (onSelectZone) onSelectZone(next);
                      },
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -10]}>
                      <div className="font-mono text-xs p-1">
                        <div className="font-bold text-amber-300 flex items-center gap-1">
                          <span>{zone.name}</span>
                        </div>
                        <div className="text-white">
                          {zone.totalDetections} {vi ? "điểm phát hiện" : "hotspots"} · {zone.cellCount} {vi ? "ô" : "cells"}
                        </div>
                        <div className="max-w-[200px] text-[11px] text-amber-200/90">
                          {vi ? "Cụm quan sát, không phải ranh giới cháy" : "Observed cluster, not a fire perimeter"}
                        </div>
                      </div>
                    </Tooltip>
                  </Marker>
                );
              })}

            {/* 3. AMBIENT HOTSPOT DENSITY PARTICLES */}
            {(layerMode === "all" || layerMode === "points") &&
              ambientDots.map((c, i) => {
                const isEst = c.estimate_type !== "viirs_observed";
                return (
                  <CircleMarker
                    key={`amb-${i}`}
                    center={[c.lat, c.lon]}
                    radius={2}
                    pathOptions={{
                      color: "#0B1220",
                      fillColor: isEst ? "#60A5FA" : "#2DD4BF",
                      fillOpacity: 0.75,
                      weight: 0.5,
                    }}
                  />
                );
              })}

            {/* 4. PRIMARY CLUSTER FOCUS NODES */}
            {(layerMode === "all" || layerMode === "clusters") &&
              primaryCells.map((c, i) => {
                const isEst = c.estimate_type !== "viirs_observed";
                const color = isEst ? "#60A5FA" : "#2DD4BF";
                const r = Math.min(6.5, Math.max(3.0, 2.5 + Math.sqrt(Math.max(c.harmonized_count, 0)) * 0.5));

                return (
                  <CircleMarker
                    key={`pri-${i}`}
                    center={[c.lat, c.lon]}
                    radius={r}
                    pathOptions={{
                      color: "#ffffff",
                      fillColor: color,
                      fillOpacity: 0.9,
                      weight: 1,
                    }}
                  >
                    <Tooltip>
                      <div className="font-mono text-xs">
                        <div className="font-bold text-white">{c.date}</div>
                        <div className="text-teal-300 font-semibold">
                          {c.harmonized_count} {vi ? "điểm phát hiện" : "detections"}
                        </div>
                        <div className="text-xs text-slate-300">
                          {isEst ? `${vi ? "MODIS chuỗi nền (1km)" : "MODIS Baseline (1km)"}` : vi ? "VIIRS quan sát (375m)" : "VIIRS Observed (375m)"}
                        </div>
                        <div className="text-xs text-slate-400">
                          {c.lat.toFixed(3)}°, {c.lon.toFixed(3)}°
                        </div>
                      </div>
                    </Tooltip>
                  </CircleMarker>
                );
              })}
          </MapContainer>
        </div>

        {!hideLegend && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-[800] rounded-lg border border-white/10 bg-[#0B1220]/85 px-3 py-2 text-xs text-slate-200 shadow-lg backdrop-blur-md">
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full border border-white bg-[#2DD4BF]" />
                {vi ? "VIIRS quan sát (375 m)" : "VIIRS observed (375 m)"}
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full border border-white bg-[#60A5FA]" />
                {vi ? "MODIS chuỗi nền (1 km)" : "MODIS baseline (1 km)"}
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-amber-300 bg-amber-500/20" />
                {vi ? "Cụm điểm nóng (bao lồi, không phải ranh giới cháy)" : "Hotspot cluster (convex hull, not a fire perimeter)"}
              </span>
              {preview && (
                <span className="mt-1 border-t border-white/10 pt-1.5 text-[11px] text-slate-300">
                  {preview.preview
                    ? (vi
                        ? `Xem trước ${preview.returned.toLocaleString()} / ${preview.total.toLocaleString()} ô (${preview.level ?? "ô-tháng"})`
                        : `Preview ${preview.returned.toLocaleString()} of ${preview.total.toLocaleString()} cells (${preview.level ?? "cell-month"})`)
                    : (vi
                        ? `${preview.returned.toLocaleString()} ô đã trả về (${preview.level ?? "ô-tháng"})`
                        : `${preview.returned.toLocaleString()} cells returned (${preview.level ?? "cell-month"})`)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
