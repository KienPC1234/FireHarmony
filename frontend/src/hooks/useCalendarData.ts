import { useEffect, useState } from "react";
import { api, describeError, readErrorCode, type CalendarResponse } from "@/lib/api";

/** One validated filter set shared by calendar, map-cells, export and evidence. */
export type AppliedFilters = {
  bbox: string;
  aoi: string;
  data: string;
  method: string;
  dataset?: string;
  qa_min: string;
  platform_set: string;
  source_type: "all" | "land" | "vegetation";
  daynight?: "all" | "D" | "N";
  min_frp?: number;
  geometry: string | null;
  from_date: string | null;
  to_date: string | null;
};

export const AOI_BBOX: Record<string, string> = {
  vietnam: "104,10,109,16",
  amazon: "-70,-12,-50,3",
  australia: "113,-39,153,-12",
};

/** Focused high-density forest hotspot bounding boxes for live NASA FIRMS queries
 * (keeps all 3 preset regions well within the 20x20 deg / 150 deg^2 live fetch guard). */
export const LIVE_FOCUS_BBOX: Record<string, string> = {
  vietnam: "106.8,11.2,109.2,14.8",
  amazon: "-63,-11,-55,-4",
  australia: "145,-38,152,-31",
};

export const AOI_CENTER: Record<string, { c: [number, number]; z: number }> = {
  vietnam: { c: [13, 106.5], z: 6 },
  amazon: { c: [-4, -60], z: 4 },
  australia: { c: [-26, 133], z: 4 },
};

export const DEFAULT_AOI_CENTER: [number, number] = [13, 106.5];
export const WORLD_CENTER: [number, number] = [15, 20];

/** P2-07: one validated method/bbox rule for calendar, map-cells, export and
 * evidence. Custom bbox/geometry/date/dataset/source filters use the
 * point-level statistical forward rule (stat); HTS/STAN need raw tiles.
 * Geometry/dataset/date range and source_type have no server-side meaning on
 * /evidence (AOI-month scoped) and are therefore never forwarded there. */
export function requestMethodFor(a: AppliedFilters): { method: string; customBbox: string | undefined } {
  const customBbox = a.bbox && a.bbox !== (AOI_BBOX[a.aoi] ?? "") ? a.bbox : undefined;
  const forced = Boolean(customBbox || a.geometry || a.from_date || a.to_date || a.dataset)
    || a.source_type !== "all"
    || (a.daynight != null && a.daynight !== "all")
    || (a.min_frp != null && a.min_frp > 0);
  const method = forced
    ? "stat"
    : a.data !== "raw" && (a.method === "stan" || a.method === "hts")
    ? "stat"
    : a.method;
  return { method, customBbox };
}

/** A spatial/temporal restriction that can legitimately match zero rows. */
export function hasRestrictiveFilter(a: {
  bbox: string;
  aoi: string;
  geometry: string | null;
  from_date: string | null;
  to_date: string | null;
  dataset?: string;
}): boolean {
  const isCustomBbox = Boolean(a.bbox && a.bbox !== (AOI_BBOX[a.aoi] ?? ""));
  return isCustomBbox || Boolean(a.geometry || a.from_date || a.to_date || a.dataset);
}

/** Backend 409 bodies arrive as `{detail: {error_code, message}}`; surface
 * the inner message instead of a bare "409 Conflict". */
export function apiDetailMessage(e: unknown): string | null {
  const body = (e as { detail?: unknown }).detail as
    | { message?: unknown; detail?: unknown }
    | undefined;
  if (body && typeof body === "object") {
    if (typeof body.message === "string") return body.message;
    const inner = body.detail as { message?: unknown } | undefined;
    if (inner && typeof inner === "object" && typeof inner.message === "string") {
      return inner.message;
    }
  }
  return null;
}

export function parseBboxNumbers(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

export interface MonthCell {
  lat: number;
  lon: number;
  harmonized_count: number;
  date: string;
  estimate_type: string;
}

export interface MapMeta {
  returned: number;
  total: number;
  preview: boolean;
  level: string;
}

export interface MonthEvidence {
  method_id?: string;
  effective_method?: string;
  notes?: string[];
}

export interface RawUnavailable {
  status: number;
  code?: string;
  message: string;
}

/**
 * All calendar data fetching: the /calendar grid, the /map-cells month
 * slice, and the /evidence month card. Error handling splits into three
 * branches — 409 model_conflict, 404 empty-filter, raw-unavailable — so the
 * caller can keep the map mounted instead of swapping to ErrorState.
 */
export function useCalendarData(opts: {
  applied: AppliedFilters;
  activeTab: string;
  mapPeriod: string;
  activeMonth: { year: number; month: number } | null;
  enabled?: boolean;
  t: (key: string) => string;
}) {
  const { applied, activeTab, mapPeriod, activeMonth, enabled = true, t } = opts;

  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!loadingData) {
      setShowLoadingOverlay(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowLoadingOverlay(true);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [loadingData]);

  const [rawUnavailable, setRawUnavailable] = useState<RawUnavailable | null>(null);
  // 404/no_raw_data behind a restrictive filter means the filter matched no
  // rows, not that the server lacks raw: keep the map mounted with an inline
  // empty state instead of the full-page raw-unavailable panel.
  const [emptyFilter, setEmptyFilter] = useState<{ message: string } | null>(null);
  // 409 model_requires_full_aoi / geometry_requires_stat_method: the model
  // targets are AOI-level totals, not per-polygon predictions. Surface the
  // backend message with a retry-with-stat action instead of ErrorState.
  const [modelConflict, setModelConflict] = useState<RawUnavailable | null>(null);

  // P0-06: map cells for the selected month come from /map-cells, not from
  // the capped /calendar daily slice.
  const [monthCells, setMonthCells] = useState<MonthCell[]>([]);
  const [loadingMapCells, setLoadingMapCells] = useState(false);
  const [mapMeta, setMapMeta] = useState<MapMeta | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [monthEvidence, setMonthEvidence] = useState<MonthEvidence | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoadingData(false);
      setData(null);
      setError(null);
      setRawUnavailable(null);
      setEmptyFilter(null);
      setModelConflict(null);
      return;
    }
    const controller = new AbortController();
    let alive = true;
    setLoadingData(true);
    setError(null);
    setRawUnavailable(null);
    setEmptyFilter(null);
    setModelConflict(null);
    // P0-06 / P1-12: Subset filters (custom bbox/geometry/date range) or source_type filters use point-level statistical forward rule (stat).
    const { method: requestMethod, customBbox: effectiveBbox } = requestMethodFor(applied);
    api
      .calendar(
        25000,
        effectiveBbox,
        applied.aoi,
        applied.data,
        requestMethod,
        applied.dataset,
        applied.qa_min,
        applied.platform_set,
        applied.geometry || undefined,
        applied.from_date || undefined,
        applied.to_date || undefined,
        applied.source_type,
        controller.signal,
        applied.daynight ?? "all",
        applied.min_frp ?? 0,
      )
      .then((res) => {
        if (!alive) return;
        setData(res);
        if ((res as { empty_filter?: boolean }).empty_filter) {
          setEmptyFilter({
            message: t("calendar.empty_filter_body"),
          });
        } else {
          setEmptyFilter(null);
        }
        setModelConflict(null);
      })
      .catch((e) => {
        if (!alive || controller.signal.aborted) return;
        // Phase 1+2: a 409 with model_requires_full_aoi /
        // geometry_requires_stat_method means the caller asked an AOI-level
        // model for a polygon/date subset. Model targets are AOI-level
        // totals and cannot be reallocated to a polygon — keep the map and
        // offer a retry with the stat grid path.
        if (
          typeof (e as { status?: number })?.status === "number" &&
          (e as { status: number }).status === 409
        ) {
          const code = readErrorCode(e);
          if (code === "model_requires_full_aoi" || code === "geometry_requires_stat_method") {
            setModelConflict({
              status: 409,
              code,
              message: apiDetailMessage(e) ?? (e instanceof Error ? e.message : describeError(e)),
            });
            return;
          }
        }
        // P1: split "server has no raw" from "filter matched no rows". Both
        // surface as 404/no_raw_data; a restrictive filter (custom
        // bbox/polygon/date range/dataset) means the latter, so keep the map
        // mounted with an inline empty state and a Clear button.
        if (
          typeof (e as { status?: number })?.status === "number" &&
          (e as { status: number }).status === 404 &&
          hasRestrictiveFilter(applied)
        ) {
          setEmptyFilter({
            message: e instanceof Error ? e.message : describeError(e),
          });
          return;
        }
        // P0-04: never swap NASA raw for the synthetic demo behind the user's
        // back. Keep the raw selection and offer an explicit opt-in.
        if (applied.data === "raw") {
          const status = typeof (e as { status?: number })?.status === "number"
            ? (e as { status: number }).status : 0;
          const detail = (e as { detail?: { detail?: { message?: string }; message?: string } })?.detail;
          setRawUnavailable({
            status,
            code: readErrorCode(e),
            message: (typeof detail === "object" && detail !== null
              ? (detail.detail?.message ?? detail.message)
              : undefined)
              || (e instanceof Error ? e.message : t("calendar.raw_unavailable_body")),
          });
          return;
        }
        setError(e);
      })
      .finally(() => {
        if (alive) setLoadingData(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [applied, enabled, t]);

  // P0-06: fetch map cells for exactly the selected month.
  useEffect(() => {
    if (!enabled || activeTab !== "map" || !/^\d{4}-\d{2}$/.test(mapPeriod)) {
      setLoadingMapCells(false);
      return;
    }
    const controller = new AbortController();
    let alive = true;
    setLoadingMapCells(true);
    setMapError(null);
    setMapMeta(null);
    const { method: mapMethod, customBbox: effectiveBbox } = requestMethodFor(applied);
    api
      .mapCells(
        mapPeriod,
        effectiveBbox,
        applied.aoi,
        applied.data,
        mapMethod,
        applied.dataset,
        applied.qa_min,
        applied.platform_set,
        applied.geometry || undefined,
        6,
        applied.from_date || undefined,
        applied.to_date || undefined,
        applied.source_type,
        controller.signal,
        undefined,
        applied.daynight ?? "all",
        applied.min_frp ?? 0,
      )
      .then((r) => {
        if (!alive) return;
        setMonthCells(
          r.cells.map((c) => ({
            lat: c.lat,
            lon: c.lon,
            harmonized_count: c.harmonized_count,
            date: mapPeriod,
            estimate_type: c.estimate_type,
          })),
        );
        setMapMeta({ returned: r.returned, total: r.total, preview: r.preview, level: r.aggregation_level });
      })
      .catch((e) => {
        if (!alive || controller.signal.aborted) return;
        setMonthCells([]);
        setMapMeta(null);
        const status = typeof (e as { status?: number })?.status === "number" ? (e as { status: number }).status : 0;
        setMapError(status === 404 ? null : e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoadingMapCells(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [mapPeriod, activeTab, applied, enabled]);

  // P1-12: the month inspector names the method that actually served that
  // month (STAN falls back to HTS before 2024) instead of hardcoding a model.
  // P2-07: the card must quote the same cells as the calendar/map, so it uses
  // the shared stat-forcing rule and forwards the custom bbox. Geometry,
  // dataset, date range and source_type are AOI-month-scoped out server-side
  // (see api.evidence) and are intentionally not forwarded.
  useEffect(() => {
    if (!activeMonth) {
      setMonthEvidence(null);
      return;
    }
    let alive = true;
    const { method: evidenceMethod, customBbox } = requestMethodFor(applied);
    api
      .evidence(
        applied.aoi,
        applied.data,
        evidenceMethod,
        activeMonth.year,
        activeMonth.month,
        applied.qa_min,
        applied.platform_set,
        { bbox: customBbox, dataset: applied.dataset },
      )
      .then((d) => {
        if (alive) setMonthEvidence(d as MonthEvidence);
      })
      .catch(() => {
        if (alive) setMonthEvidence(null);
      });
    return () => {
      alive = false;
    };
  }, [activeMonth, applied]);

  // CLAIM-034: surface stat-forcing without extra fetches. `applied.method`
  // is what the caller asked for; the served path is quoted by fields
  // already in the response (`effective_method`, else `method_id`).
  // Forcing logic itself is untouched (see requestMethodFor above).
  const { method: sentMethod } = requestMethodFor(applied);
  const servingMethod = data?.effective_method || data?.method_id || sentMethod;
  const requestedMethod = applied.method;
  const statForced = Boolean(
    data && requestedMethod && servingMethod
      && servingMethod === "stat" && requestedMethod !== servingMethod,
  );

  return {
    data,
    loadingData,
    showLoadingOverlay,
    error,
    rawUnavailable,
    setRawUnavailable,
    emptyFilter,
    setEmptyFilter,
    modelConflict,
    setModelConflict,
    monthCells,
    loadingMapCells,
    mapMeta,
    mapError,
    monthEvidence,
    requestedMethod,
    servingMethod,
    statForced,
  };
}
