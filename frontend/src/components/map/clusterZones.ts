export interface HotspotCell {
  lat: number;
  lon: number;
  harmonized_count: number;
  date: string;
  estimate_type?: string;
}

/**
 * A convex hull drawn around nearby hotspot cells.
 *
 * This is NOT a fire perimeter, burned area, or a certified risk zone. The
 * hull is a display aid that groups detections; the polygon's area is not
 * measured or reported and no severity grade is assigned (audit P0-02).
 */
export interface HotspotCluster {
  id: string;
  name: string;
  coordinates: [number, number][]; // [lat, lon] polygon ring
  center: [number, number];
  cellCount: number;
  totalDetections: number;
  peakDate: string;
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

/** Expand a hull slightly so point clusters have visible padding. */
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

const ZONE_GREEK = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa"];

/** Group nearby cells into observed hotspot clusters (display only). */
export function buildHotspotClusters(cells: HotspotCell[], clusterRadiusDeg = 0.28, maxZones = 12): HotspotCluster[] {
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

    return {
      id: `cluster-${idx + 1}`,
      name: `Observed hotspot cluster ${ZONE_GREEK[idx % ZONE_GREEK.length]}`,
      coordinates,
      center: [centerLat, centerLon],
      cellCount: cluster.length,
      totalDetections,
      peakDate,
    };
  });
}
