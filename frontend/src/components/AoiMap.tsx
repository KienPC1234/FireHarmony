import { useState } from "react";
import { CircleMarker, MapContainer, Rectangle, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useLang } from "@/lib/i18n";

export interface Cell {
  lat: number;
  lon: number;
  harmonized_count: number;
  date: string;
  estimate_type?: string;
}

function DrawLayer({ active, onDone }: { active: boolean; onDone: (bbox: string) => void }) {
  const [start, setStart] = useState<[number, number] | null>(null);
  const [cur, setCur] = useState<[number, number] | null>(null);
  useMapEvents({
    mousedown(e) {
      if (!active) return;
      setStart([e.latlng.lat, e.latlng.lng]);
    },
    mousemove(e) {
      if (active && start) setCur([e.latlng.lat, e.latlng.lng]);
    },
    mouseup(e) {
      if (!active || !start) return;
      const la0 = Math.max(-90, Math.min(90, start[0]));
      const la1 = Math.max(-90, Math.min(90, e.latlng.lat));
      const lo0 = Math.max(-180, Math.min(180, start[1]));
      const lo1 = Math.max(-180, Math.min(180, e.latlng.lng));
      setStart(null);
      setCur(null);
      if (Math.abs(la1 - la0) < 0.05 || Math.abs(lo1 - lo0) < 0.05) return;
      onDone(`${Math.min(lo0, lo1).toFixed(2)},${Math.min(la0, la1).toFixed(2)},${Math.max(lo0, lo1).toFixed(2)},${Math.max(la0, la1).toFixed(2)}`);
    },
  });
  return start && cur ? <Rectangle bounds={[start, cur]} pathOptions={{ color: "#ea580c", weight: 2 }} /> : null;
}

export function AoiMap({ center, zoom, bbox, cells, onSelect }: {
  center: [number, number];
  zoom: number;
  bbox: string | null;
  cells: Cell[];
  onSelect: (bbox: string) => void;
}) {
  const { t } = useLang();
  const [drawing, setDrawing] = useState(false);
  const rect: [[number, number], [number, number]] | null = (() => {
    if (!bbox) return null;
    const [x0, y0, x1, y1] = bbox.split(",").map(Number);
    if ([x0, y0, x1, y1].some((v) => Number.isNaN(v))) return null;
    return [[y0, x0], [y1, x1]];
  })();
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button
          className={`rounded px-3 py-1 text-sm text-white ${drawing ? "bg-zinc-700" : "bg-orange-600"}`}
          onClick={() => setDrawing((d) => !d)}
        >
          {drawing ? t("map.drawing") : t("map.draw")}
        </button>
        {bbox && <span className="font-mono text-xs text-muted-foreground">{bbox}</span>}
      </div>
      <MapContainer
        center={center} zoom={zoom} dragging={!drawing}
        style={{ height: 360, width: "100%", borderRadius: 8 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <DrawLayer active={drawing} onDone={(b) => { setDrawing(false); onSelect(b); }} />
        {rect && <Rectangle bounds={rect} pathOptions={{ color: "#ea580c", weight: 2, dashArray: "4 4" }} />}
        {cells.slice(0, 800).map((c, i) => (
          <CircleMarker
            key={i} center={[c.lat, c.lon]}
            radius={2 + Math.sqrt(Math.max(c.harmonized_count, 0)) * 1.5}
            pathOptions={{ color: "#ea580c", fillOpacity: 0.5, weight: 1 }}
          >
            <Tooltip>{c.date}: {c.harmonized_count} {t("common.detections")}{c.estimate_type ? ` (${c.estimate_type})` : ""}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      <p className="mt-1 text-xs text-muted-foreground">{t("map.note")}</p>
    </div>
  );
}
