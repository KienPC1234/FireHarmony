import { useEffect, useMemo, useRef, useState } from "react";
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

function parseBboxBounds(bbox?: string | null): [[number, number], [number, number]] | null {
  if (!bbox) return null;
  const parts = bbox.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts;
  if (w >= e || s >= n) return null;
  return [[s, w], [n, e]];
}

function MapResizer({ center, zoom, bbox, hasCustomFilter }: { center: [number, number]; zoom: number; bbox?: string | null; hasCustomFilter?: boolean }) {
  const map = useMap();
  const mountedRef = useRef(false);
  // P2-12: remember the last applied view so a parent re-render that passes
  // an equal (but newly allocated) center/zoom does not yank the map back
  // while the user is panning.
  const appliedRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);
  const bboxRef = useRef<string | null>(null);

  useEffect(() => {
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 500);
    const container = map.getContainer();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            map.invalidateSize({ pan: false });
          })
        : null;
    ro?.observe(container);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro?.disconnect();
    };
  }, [map]);

  const [lat, lng] = center;
  useEffect(() => {
    const customBounds = hasCustomFilter ? parseBboxBounds(bbox) : null;
    if (customBounds) {
      if (bboxRef.current !== bbox) {
        bboxRef.current = bbox ?? null;
        map.fitBounds(customBounds, { padding: [36, 36], maxZoom: 10, animate: mountedRef.current });
      }
      mountedRef.current = true;
      appliedRef.current = { lat, lng, zoom };
      return;
    }
    bboxRef.current = null;
    if (!mountedRef.current) {
      mountedRef.current = true;
      appliedRef.current = { lat, lng, zoom };
      return;
    }
    const prev = appliedRef.current;
    if (prev && prev.lat === lat && prev.lng === lng && prev.zoom === zoom) return;
    appliedRef.current = { lat, lng, zoom };
    map.setView([lat, lng], zoom, { animate: true });
  }, [map, lat, lng, zoom, bbox, hasCustomFilter]);

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
  hasCustomFilter = false,
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
  hasCustomFilter?: boolean;
  onSelect: (bbox: string, geometry?: string | null) => void;
  onClearBbox?: () => void;
  fullBleed?: boolean;
  height?: string | number;
  hideToolbar?: boolean;
  hideLegend?: boolean;
  activeZoneId?: string;
  onSelectZone?: (z: HotspotCluster | null) => void;
}) {
  const { t } = useLang();

  const [basemap, setBasemap] = useState<BasemapKey>("satellite");
  const [layerMode, setLayerMode] = useState<LayerMode>("all");
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [drawVertices, setDrawVertices] = useState<[number, number][]>([]);
  const [showLegend, setShowLegend] = useState<boolean>(true);
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
            hasCustomFilter={hasCustomFilter || Boolean(drawnRing)}
            onClearBbox={onClearBbox}
            onSetBbox={(b) => onSelect(b, null)}
            zoneCount={fireZones.length}
            totalPoints={cells.length}
            basemaps={BASEMAPS}
          />
        </div>
      )}

      {/* 2. MAIN MAP CANVAS (ABSOLUTE FILL OVER FLEX-1 CONTAINER) */}
      <div className="relative flex-1 min-h-0 w-full bg-[#060B13]">
        <div
          className={cn("absolute inset-0", drawMode !== "none" && "cursor-crosshair")}
          role="region"
          aria-label={t("map.region_label")}
        >
          <MapContainer
            center={center}
            zoom={zoom}
            preferCanvas={true}
            dragging={drawMode === "none"}
            doubleClickZoom={drawMode === "none"}
            className="h-full w-full"
            style={{ height: "100%", width: "100%", background: "#060B13", cursor: drawMode !== "none" ? "crosshair" : undefined }}
          >
            <MapResizer center={center} zoom={zoom} bbox={bbox} hasCustomFilter={hasCustomFilter} />

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
              vertices={drawVertices}
              setVertices={setDrawVertices}
              onCancel={() => setDrawMode("none")}
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

            {/* Active Bounding Rectangle if user drew/entered a custom box */}
            {hasCustomFilter && !drawnRing && rect && (
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
                          {t("map.zone_summary", {
                            detections: zone.totalDetections,
                            cells: zone.cellCount,
                          })}
                        </div>
                        <div className="text-xs text-slate-400">
                          {t("map.peak_date")} {zone.peakDate}
                        </div>
                        <div className="max-w-[280px] text-[11px] leading-snug text-amber-200/90">
                          {t("map.hull_note")}
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
                          {t("map.zone_hotspots", {
                            detections: zone.totalDetections,
                            cells: zone.cellCount,
                          })}
                        </div>
                        <div className="max-w-[200px] text-[11px] text-amber-200/90">
                          {t("map.cluster_note")}
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
            {(layerMode === "all" || layerMode === "points" || layerMode === "clusters") &&
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
                          {t("map.detections_count", { count: c.harmonized_count })}
                        </div>
                        <div className="text-xs text-slate-300">
                          {isEst ? t("map.modis_baseline") : t("map.viirs_observed")}
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

        {drawMode !== "none" && (
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-[900] flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-[#0B1220]/95 px-3 py-1.5 text-xs text-slate-200 shadow-xl backdrop-blur-md max-w-[95%]">
            <span className="font-mono text-[11px] text-amber-300 font-semibold">
              {drawMode === "box"
                ? t("map.draw_box_hint")
                : t("map.draw_polygon_hint", { count: drawVertices.length })}
            </span>
            {drawMode === "polygon" && drawVertices.length > 0 && (
              <button
                type="button"
                onClick={() => setDrawVertices((prev) => prev.slice(0, -1))}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800"
              >
                {t("map.draw_undo")}
              </button>
            )}
            {drawMode === "polygon" && drawVertices.length >= 3 && (
              <button
                type="button"
                onClick={() => {
                  if (drawVertices.length < 3) return;
                  const lats = drawVertices.map((p) => p[0]);
                  const lons = drawVertices.map((p) => p[1]);
                  const bboxStr = `${Math.min(...lons).toFixed(2)},${Math.min(...lats).toFixed(2)},${Math.max(...lons).toFixed(2)},${Math.max(...lats).toFixed(2)}`;
                  const coords = drawVertices.map(([lat, lon]) => [Number(lon.toFixed(4)), Number(lat.toFixed(4))]);
                  coords.push(coords[0]);
                  setDrawMode("none");
                  onSelect(bboxStr, JSON.stringify({ type: "Polygon", coordinates: [coords] }));
                }}
                className="rounded border border-emerald-500/50 bg-emerald-600/30 px-2 py-0.5 text-[11px] font-bold text-emerald-200 hover:bg-emerald-600/50"
              >
                {t("map.draw_finish")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setDrawMode("none")}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-400 hover:text-white"
            >
              {t("map.draw_cancel")}
            </button>
          </div>
        )}

        {hideToolbar && drawMode === "none" && (hasCustomFilter || Boolean(drawnRing)) && onClearBbox && (
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-[900]">
            <button
              type="button"
              onClick={onClearBbox}
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/50 bg-[#0B1220]/95 px-3 py-1 text-xs font-semibold text-rose-200 shadow-xl backdrop-blur-md hover:bg-rose-950/90 hover:text-white transition"
            >
              <span>×</span>
              <span>{t("calendar.clear_filter")}</span>
            </button>
          </div>
        )}

        {!hideLegend && (
          <div className="absolute top-2.5 right-2.5 z-[800] max-w-[220px] rounded-lg border border-white/10 bg-[#0B1220]/85 px-2.5 py-1.5 text-[11px] text-slate-200 shadow-lg backdrop-blur-md">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">{t("map.legend_title")}</span>
              <button
                type="button"
                onClick={() => setShowLegend((v) => !v)}
                className="text-[10px] text-cyan-400 hover:text-cyan-200"
              >
                {showLegend ? t("map.legend_hide") : t("map.legend_show")}
              </button>
            </div>
            {showLegend && (
              <div className="mt-1 flex flex-col gap-1">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full border border-white bg-[#2DD4BF]" />
                  <span className="truncate">{t("map.legend_viirs")}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full border border-white bg-[#60A5FA]" />
                  <span className="truncate">{t("map.legend_modis")}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-sm border border-dashed border-amber-300 bg-amber-500/20" />
                  <span className="truncate">{t("map.legend_cluster")}</span>
                </span>
                {preview && (
                  <span className="mt-0.5 border-t border-white/10 pt-1 text-[10px] text-slate-300">
                    {preview.preview
                      ? t("map.preview_of", {
                          returned: preview.returned.toLocaleString(),
                          total: preview.total.toLocaleString(),
                          level: preview.level ?? t("map.level_cell_month"),
                        })
                      : t("map.cells_returned", {
                          returned: preview.returned.toLocaleString(),
                          level: preview.level ?? t("map.level_cell_month"),
                        })}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
