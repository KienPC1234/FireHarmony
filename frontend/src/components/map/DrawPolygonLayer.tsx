import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { CircleMarker, Polygon, Polyline, Rectangle, useMap, useMapEvents } from "react-leaflet";

interface DrawPolygonLayerProps {
  mode: "none" | "box" | "polygon";
  vertices: [number, number][];
  setVertices: Dispatch<SetStateAction<[number, number][]>>;
  onDone: (bbox: string, polygon?: [number, number][]) => void;
  onCancel?: () => void;
}

function finishPolygonPoints(
  pts: [number, number][],
  onDone: (bbox: string, polygon?: [number, number][]) => void,
) {
  if (pts.length < 3) return;
  const lats = pts.map((p) => p[0]);
  const lons = pts.map((p) => p[1]);
  const minLat = Math.min(...lats).toFixed(2);
  const maxLat = Math.max(...lats).toFixed(2);
  const minLon = Math.min(...lons).toFixed(2);
  const maxLon = Math.max(...lons).toFixed(2);
  onDone(`${minLon},${minLat},${maxLon},${maxLat}`, pts);
}

export function DrawPolygonLayer({
  mode,
  vertices,
  setVertices,
  onDone,
  onCancel,
}: DrawPolygonLayerProps) {
  const map = useMap();
  const [start, setStart] = useState<[number, number] | null>(null);
  const [cur, setCur] = useState<[number, number] | null>(null);
  const [mousePos, setMousePos] = useState<[number, number] | null>(null);

  useEffect(() => {
    setStart(null);
    setCur(null);
    setMousePos(null);
    setVertices([]);
  }, [mode, setVertices]);

  // Imperatively lock map dragging/double-click zoom while drawing, since
  // MapContainer props are only read on initial mount in react-leaflet.
  useEffect(() => {
    if (mode === "box") {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
    if (mode === "polygon") {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }
    return () => {
      map.dragging.enable();
      map.doubleClickZoom.enable();
    };
  }, [map, mode]);

  useEffect(() => {
    if (mode === "none") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel?.();
      } else if (e.key === "Enter" && mode === "polygon" && vertices.length >= 3) {
        finishPolygonPoints(vertices, onDone);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, vertices, onDone, onCancel]);

  useMapEvents({
    mousedown(e) {
      if (mode === "box") {
        setStart([e.latlng.lat, e.latlng.lng]);
        setCur([e.latlng.lat, e.latlng.lng]);
      }
    },
    mousemove(e) {
      if (mode === "box" && start) {
        setCur([e.latlng.lat, e.latlng.lng]);
      } else if (mode === "polygon" && vertices.length > 0) {
        setMousePos([e.latlng.lat, e.latlng.lng]);
      }
    },
    mouseup(e) {
      if (mode === "box" && start) {
        const la0 = Math.max(-90, Math.min(90, start[0]));
        const la1 = Math.max(-90, Math.min(90, e.latlng.lat));
        const lo0 = Math.max(-180, Math.min(180, start[1]));
        const lo1 = Math.max(-180, Math.min(180, e.latlng.lng));
        setStart(null);
        setCur(null);
        const p0 = map.latLngToContainerPoint(start);
        const p1 = map.latLngToContainerPoint(e.latlng);
        if (Math.abs(p1.x - p0.x) < 12 || Math.abs(p1.y - p0.y) < 12) return;
        const bbox = `${Math.min(lo0, lo1).toFixed(2)},${Math.min(la0, la1).toFixed(2)},${Math.max(lo0, lo1).toFixed(2)},${Math.max(la0, la1).toFixed(2)}`;
        onDone(bbox);
      }
    },
    click(e) {
      if (mode !== "polygon") return;
      const lat = e.latlng.lat;
      const lon = e.latlng.lng;
      const clickPt = map.latLngToContainerPoint(e.latlng);

      // Close polygon when clicking near the first vertex (16px screen radius)
      if (vertices.length >= 3) {
        const firstPt = map.latLngToContainerPoint(vertices[0]);
        if (clickPt.distanceTo(firstPt) < 16) {
          finishPolygonPoints(vertices, onDone);
          return;
        }
      }

      // Deduplicate rapid clicks (e.g. from dblclick)
      if (vertices.length > 0) {
        const lastPt = map.latLngToContainerPoint(vertices[vertices.length - 1]);
        if (clickPt.distanceTo(lastPt) < 4) return;
      }

      setVertices((prev) => [...prev, [lat, lon]]);
    },
    dblclick(e) {
      if (mode === "polygon" && vertices.length >= 3) {
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
        finishPolygonPoints(vertices, onDone);
      }
    },
  });

  if (mode === "box" && start && cur) {
    return (
      <Rectangle
        bounds={[start, cur]}
        pathOptions={{ color: "#38bdf8", weight: 2, dashArray: "4 4", fillOpacity: 0.18 }}
      />
    );
  }

  if (mode === "polygon" && vertices.length > 0) {
    const previewPoints: [number, number][] = mousePos
      ? [...vertices, mousePos]
      : vertices;

    return (
      <>
        {previewPoints.length >= 3 ? (
          <Polygon
            positions={previewPoints}
            pathOptions={{
              color: "#f59e0b",
              weight: 2,
              dashArray: "5 5",
              fillColor: "#fbbf24",
              fillOpacity: 0.2,
            }}
          />
        ) : (
          <Polyline
            positions={previewPoints}
            pathOptions={{
              color: "#f59e0b",
              weight: 2,
              dashArray: "5 5",
            }}
          />
        )}
        {vertices.map((pt, idx) => (
          <CircleMarker
            key={`draw-v-${idx}`}
            center={pt}
            radius={idx === 0 && vertices.length >= 3 ? 6 : 4}
            pathOptions={{
              color: idx === 0 && vertices.length >= 3 ? "#38bdf8" : "#ffffff",
              fillColor: idx === 0 && vertices.length >= 3 ? "#0ea5e9" : "#f59e0b",
              fillOpacity: 1,
              weight: 1.5,
            }}
          />
        ))}
      </>
    );
  }

  return null;
}
