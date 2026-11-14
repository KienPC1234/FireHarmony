import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { CalendarResponse } from "@/lib/api";
import type { MapMeta, MonthCell } from "./useCalendarData";

/**
 * Map-period (scrubber) derivations from the fetched calendar data: the
 * selectable `periods` list, the aggregated `dailyMapCells`, the
 * period-aware `mapCells`/`mapPreview` selection, the `yearly` trend
 * series, and the scrubber's `scrubberYears`. The `mapPeriod` atom itself
 * is created in `CalendarPage` (lazy-initialized from the URL, as before)
 * and passed in, so this hook and `useCalendarData` stay flat with no
 * cyclic hook params. Explicit research months remain selected even
 * when a year has zero detections or missing coverage. Lack of an observation
 * is not permission to silently widen the research period.
 */
export function useMapPeriod(opts: {
  data: CalendarResponse | null;
  monthCells: MonthCell[];
  mapMeta: MapMeta | null;
  mapPeriod: string;
  setMapPeriod: Dispatch<SetStateAction<string>>;
  fromDate?: string | null;
  toDate?: string | null;
}) {
  const { data, monthCells, mapMeta, mapPeriod, setMapPeriod, fromDate, toDate } = opts;

  const periods = useMemo(() => {
    if (!data) return [];
    const available = new Set<string>();
    // Calendar.matrix describes the complete served time grid. The daily
    // details are capped and cannot define which months the UI can select.
    // A null matrix cell means unknown/missing coverage, not a zero.
    data.calendar.years.forEach((year, yi) => {
      data.calendar.months.forEach((month, mi) => {
        const value = data.calendar.matrix[yi]?.[mi];
        if (value !== null && value !== undefined && Number.isFinite(value)) {
          available.add(String(year) + "-" + String(month).padStart(2, "0"));
        }
      });
    });
    for (const d of data.daily) {
      const month = String(d.date ?? "").slice(0, 7);
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) available.add(month);
    }
    // The viewer can select a month with no observations via URL or the time
    // scrubber. Keep that month visible instead of rendering a blank select.
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(mapPeriod)) available.add(mapPeriod);
    return Array.from(available).sort();
  }, [data, mapPeriod]);

  const activeDays = useMemo(() => {
    if (!data?.daily?.length) return [];
    const days = new Set<string>();
    for (const d of data.daily) {
      const ds = String(d.date ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(ds) && Number(d.harmonized_count) > 0) {
        days.add(ds);
      }
    }
    return Array.from(days).sort();
  }, [data]);

  const availableDays = useMemo(() => {
    const days = new Set<string>();
    if (fromDate && toDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(toDate) && fromDate <= toDate) {
      const startMs = Date.parse(`${fromDate}T00:00:00Z`);
      const endMs = Date.parse(`${toDate}T00:00:00Z`);
      const span = Math.floor((endMs - startMs) / 86400000) + 1;
      if (span >= 1 && span <= 62) {
        for (let i = 0; i < span; i++) {
          days.add(new Date(startMs + i * 86400000).toISOString().slice(0, 10));
        }
      }
    }
    if (data?.daily?.length) {
      for (const d of data.daily) {
        const ds = String(d.date ?? "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) days.add(ds);
      }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(mapPeriod)) days.add(mapPeriod);
    return Array.from(days).sort();
  }, [data, mapPeriod, fromDate, toDate]);

  const isDayPeriod = /^\d{4}-\d{2}-\d{2}$/.test(mapPeriod);

  const dailyMapCells = useMemo(() => {
    if (!data) return [];
    const rows = mapPeriod === "all"
      ? data.daily
      : isDayPeriod
        ? data.daily.filter((d) => String(d.date).slice(0, 10) === mapPeriod)
        : data.daily.filter((d) => String(d.date).slice(0, 7) === mapPeriod);
    const byCell = new Map<string, { lat: number; lon: number; harmonized_count: number; date: string; estimate_type: string }>();
    for (const d of rows) {
      const lat = Number(d.lat);
      const lon = Number(d.lon);
      const key = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
      const existing = byCell.get(key);
      if (existing) {
        existing.harmonized_count += Number(d.harmonized_count);
      } else {
        byCell.set(key, {
          lat,
          lon,
          harmonized_count: Number(d.harmonized_count),
          date: mapPeriod === "all" ? "all" : String(d.date),
          estimate_type: String(d.estimate_type ?? ""),
        });
      }
    }
    return Array.from(byCell.values());
  }, [data, mapPeriod, isDayPeriod]);

  const mapCells = mapPeriod === "all" || isDayPeriod ? dailyMapCells : monthCells;
  const mapPreview = mapPeriod === "all" || isDayPeriod
    ? {
        returned: isDayPeriod ? dailyMapCells.length : (data?.daily?.length ?? 0),
        total: data?.summary?.n_daily_cells_total ?? data?.daily_cells ?? 0,
        preview: !isDayPeriod && (data?.daily?.length ?? 0) < (data?.summary?.n_daily_cells_total ?? data?.daily_cells ?? 0),
        level: "cell-day",
      }
    : mapMeta;

  const yearly = useMemo(
    () => (data ? data.calendar.years.map((y, i) => ({ year: y, detections: data.calendar.row_totals[i] })) : []),
    [data],
  );

  // Years with at least one recorded detection drive the scrubber; an
  // all-zero grid falls back to the full year list (same rule as before).
  const scrubberYears = useMemo(() => {
    if (!data?.calendar?.years?.length) return [];
    const active = data.calendar.years.filter((_, idx) => (data.calendar.row_totals[idx] ?? 0) > 0);
    return active.length > 0 ? active : data.calendar.years;
  }, [data]);

  return { mapPeriod, setMapPeriod, periods, availableDays, activeDays, mapCells, mapPreview, yearly, scrubberYears };
}
