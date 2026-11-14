import { useState } from "react";
import { Polygon, Rectangle, useMapEvents } from "react-leaflet";

interface DrawPolygonLayerProps {
  mode: "none" | "box" | "polygon";
  onDone: (bbox: string, polygon?: [number, number][]) => void;
  onPolygonCreated?: (points: [number, number][]) => void;
}

export function DrawPolygonLayer({ mode, onDone, onPolygonCreated }: DrawPolygonLayerProps) {
  // Box mode state
  const [start, setStart] = useState<[number, number] | null>(null);
  const [cur, setCur] = useState<[number, number] | null>(null);

  // Polygon mode state (list of vertices)
  const [vertices, setVertices] = useState<[number, number][]>([]);
  const [mousePos, setMousePos] = useState<[number, number] | null>(null);

  useMapEvents({
    mousedown(e) {
      if (mode === "box") {
        setStart([e.latlng.lat, e.latlng.lng]);
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
        if (Math.abs(la1 - la0) < 0.05 || Math.abs(lo1 - lo0) < 0.05) return;
        const bbox = `${Math.min(lo0, lo1).toFixed(2)},${Math.min(la0, la1).toFixed(2)},${Math.max(lo0, lo1).toFixed(2)},${Math.max(la0, la1).toFixed(2)}`;
        onDone(bbox);
      }
    },
    click(e) {
      if (mode === "polygon") {
        const nextVert: [number, number][] = [...vertices, [e.latlng.lat, e.latlng.lng]];
        setVertices(nextVert);

        // If >= 3 points and clicking near origin, close polygon
        if (nextVert.length >= 3) {
          const [firstLat, firstLon] = nextVert[0];
          const d = Math.hypot(firstLat - e.latlng.lat, firstLon - e.latlng.lng);
          if (d < 0.08 && nextVert.length > 3) {
            // Closed polygon!
            finishPolygon(nextVert.slice(0, -1));
          }
        }
      }
    },
    dblclick(e) {
      if (mode === "polygon" && vertices.length >= 3) {
        e.originalEvent.preventDefault();
        finishPolygon(vertices);
      }
    },
  });

  const finishPolygon = (pts: [number, number][]) => {
    if (pts.length < 3) return;
    const lats = pts.map((p) => p[0]);
    const lons = pts.map((p) => p[1]);
    const minLat = Math.min(...lats).toFixed(2);
    const maxLat = Math.max(...lats).toFixed(2);
    const minLon = Math.min(...lons).toFixed(2);
    const maxLon = Math.max(...lons).toFixed(2);
    const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;
    onPolygonCreated?.(pts);
    setVertices([]);
    setMousePos(null);
    onDone(bbox, pts);
  };

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
      <Polygon
        positions={previewPoints}
        pathOptions={{
          color: "#f59e0b",
          weight: 2,
          dashArray: "5 5",
          fillColor: "#fbbf24",
          fillOpacity: 0.22,
        }}
      />
    );
  }

  return null;
}
