export interface HotspotCell {
  lat: number;
  lon: number;
  harmonized_count: number;
  date: string;
  estimate_type?: string;
}

export interface FireZone {
  id: string;
  name: string;
  coordinates: [number, number][]; // [lat, lon] polygon ring
  center: [number, number];
  cellCount: number;
  totalDetections: number;
  peakDate: string;
  areaKm2: number;
  severity: "extreme" | "high" | "moderate" | "low";
}

/** Compute 2D convex hull via Monotone Chain algorithm (Graham scan variant). */
function computeConvexHull(points: [number, number][]): [number, number][] {
  if (points.length <= 2) return points;

  // Sort primarily by lat, secondarily by lon
  const sorted = [...points].sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]);

  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);

  // Lower hull
  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // Upper hull
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Expand a hull slightly so point clusters have visible perimeter padding. */
function expandHull(hull: [number, number][], paddingDeg = 0.04): [number, number][] {
  if (hull.length === 1) {
    const [lat, lon] = hull[0];
    return [
      [lat - paddingDeg, lon - paddingDeg],
      [lat - paddingDeg, lon + paddingDeg],
      [lat + paddingDeg, lon + paddingDeg],
      [lat + paddingDeg, lon - paddingDeg],
    ];
  }
  if (hull.length === 2) {
    const [p1, p2] = hull;
    return [
      [p1[0] - paddingDeg, p1[1] - paddingDeg],
      [p2[0] - paddingDeg, p2[1] + paddingDeg],
      [p2[0] + paddingDeg, p2[1] + paddingDeg],
      [p1[0] + paddingDeg, p1[1] - paddingDeg],
    ];
  }

  // Calculate centroid
  const centerLat = hull.reduce((acc, p) => acc + p[0], 0) / hull.length;
  const centerLon = hull.reduce((acc, p) => acc + p[1], 0) / hull.length;

  return hull.map(([lat, lon]) => {
    const dLat = lat - centerLat;
    const dLon = lon - centerLon;
    const dist = Math.sqrt(dLat * dLat + dLon * dLon) || 1;
    return [
      lat + (dLat / dist) * paddingDeg,
      lon + (dLon / dist) * paddingDeg,
    ];
  });
}

/** Approximate polygon area in km² using planar projection at mean latitude. */
function calculatePolygonAreaKm2(polygon: [number, number][]): number {
  if (polygon.length < 3) return 5.0; // Minimal cell footprint
  const meanLat = (polygon.reduce((acc, p) => acc + p[0], 0) / polygon.length) * (Math.PI / 180);
  const kx = 111.32 * Math.cos(meanLat);
  const ky = 110.574;

  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const xi = polygon[i][1] * kx;
    const yi = polygon[i][0] * ky;
    const xj = polygon[j][1] * kx;
    const yj = polygon[j][0] * ky;
    area += xi * yj - xj * yi;
  }
  return Math.max(2.5, Math.round(Math.abs(area) / 2));
}

const ZONE_GREEK = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa"];

/** Group nearby cells into cohesive spatial fire zones / regional polygons. */
export function buildFireZones(cells: HotspotCell[], clusterRadiusDeg = 0.28, maxZones = 12): FireZone[] {
  if (!cells || cells.length === 0) return [];

  // Sort cells by harmonized activity count descending
  const sorted = [...cells].sort((a, b) => b.harmonized_count - a.harmonized_count);
  const unassigned = [...sorted];
  const clusters: HotspotCell[][] = [];

  while (unassigned.length > 0 && clusters.length < maxZones) {
    const seed = unassigned.shift()!;
    const cluster: HotspotCell[] = [seed];
    const remaining: HotspotCell[] = [];

    for (const other of unassigned) {
      const dLat = other.lat - seed.lat;
      const dLon = other.lon - seed.lon;
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);
      if (dist <= clusterRadiusDeg) {
        cluster.push(other);
      } else {
        remaining.push(other);
      }
    }
    clusters.push(cluster);
    unassigned.length = 0;
    unassigned.push(...remaining);
  }

  return clusters.map((cluster, idx) => {
    const rawPoints = cluster.map((c) => [c.lat, c.lon] as [number, number]);
    const hull = computeConvexHull(rawPoints);
    const coordinates = expandHull(hull, 0.05);

    const centerLat = cluster.reduce((sum, c) => sum + c.lat, 0) / cluster.length;
    const centerLon = cluster.reduce((sum, c) => sum + c.lon, 0) / cluster.length;
    const totalDetections = Math.round(cluster.reduce((sum, c) => sum + c.harmonized_count, 0));
    const peakDate = cluster.reduce((peak, c) => c.harmonized_count > peak.harmonized_count ? c : peak, cluster[0]).date;
    const areaKm2 = calculatePolygonAreaKm2(coordinates);

    let severity: FireZone["severity"] = "low";
    if (totalDetections > 300 || areaKm2 > 500) severity = "extreme";
    else if (totalDetections > 100 || areaKm2 > 200) severity = "high";
    else if (totalDetections > 30 || areaKm2 > 60) severity = "moderate";

    const greekName = ZONE_GREEK[idx % ZONE_GREEK.length];
    return {
      id: `zone-${idx + 1}`,
      name: `Fire Sector ${greekName}`,
      coordinates,
      center: [centerLat, centerLon],
      cellCount: cluster.length,
      totalDetections,
      peakDate,
      areaKm2,
      severity,
    };
  });
}
