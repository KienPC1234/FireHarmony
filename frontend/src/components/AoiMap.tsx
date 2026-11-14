import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polygon, Rectangle, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Flame } from "lucide-react";
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

const createClusterCentroidIcon = (count: number, severity: FireZone["severity"], isSelected: boolean) => {
  const bg =
    severity === "extreme"
      ? "bg-rose-600/90 text-white border-rose-400"
      : severity === "high"
      ? "bg-orange-600/90 text-white border-orange-300"
      : "bg-amber-500/90 text-slate-950 border-amber-200";
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
  cells,
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
  cells: HotspotCell[];
  onSelect: (bbox: string) => void;
  onClearBbox?: () => void;
  fullBleed?: boolean;
  height?: string | number;
  hideToolbar?: boolean;
  hideLegend?: boolean;
  activeZoneId?: string;
  onSelectZone?: (z: FireZone | null) => void;
}) {
  const { lang } = useLang();
  const vi = lang === "vi";

  const [basemap, setBasemap] = useState<BasemapKey>("satellite");
  const [layerMode, setLayerMode] = useState<LayerMode>("all");
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [selectedZone, setSelectedZone] = useState<FireZone | null>(null);

  const fireZones = useMemo(() => buildFireZones(cells, 0.45), [cells]);

  const { primaryCells, ambientDots } = useMemo(() => {
    const sorted = [...cells].sort((a, b) => b.harmonized_count - a.harmonized_count);
    return {
      primaryCells: sorted.slice(0, 160),
      ambientDots: sorted.slice(160, 1000),
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
        return { stroke: "#ef4444", fill: "#dc2626" };
      case "high":
        return { stroke: "#f97316", fill: "#ea580c" };
      case "moderate":
        return { stroke: "#eab308", fill: "#ca8a04" };
      default:
        return { stroke: "#38bdf8", fill: "#0284c7" };
    }
  };

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

            {/* 1. REGIONAL FIRE PERIMETER POLYGONS */}
            {(layerMode === "all" || layerMode === "zones") &&
              fireZones.map((zone) => {
                const colors = getZoneColor(zone.severity);
                const isSelected = effectiveSelectedZone?.id === zone.id;

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

            {/* 2. SCIENTIFIC CLUSTER CENTROID BADGES */}
            {(layerMode === "all" || layerMode === "zones") &&
              fireZones.map((zone) => {
                const isSelected = effectiveSelectedZone?.id === zone.id;
                return (
                  <Marker
                    key={`marker-${zone.id}`}
                    position={zone.center}
                    icon={createClusterCentroidIcon(zone.cellCount, zone.severity, isSelected)}
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
                          {zone.areaKm2} km² · {zone.totalDetections} {vi ? "điểm phát hiện" : "hotspots"}
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
                <span className="h-2.5 w-2.5 rounded-sm border border-orange-300 bg-orange-500/60" />
                {vi ? "Vùng tập trung điểm nóng" : "Hotspot cluster zone"}
              </span>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
