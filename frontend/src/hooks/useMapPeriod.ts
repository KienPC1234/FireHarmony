import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { CalendarResponse } from "@/lib/api";
import type { MapMeta, MonthCell } from "./useCalendarData";

/**
 * Map-period (scrubber) derivations from the fetched calendar data: the
 * selectable `periods` list, the aggregated `dailyMapCells`, the
 * period-aware `mapCells`/`mapPreview` selection, the `yearly` trend
 * series, and the scrubber's `scrubberYears`. The `mapPeriod` atom itself
 * is created in `CalendarPage` (lazy-initialized from the URL, as before)
 * and passed in, so this hook and `useCalendarData` stay flat with no
 * cyclic hook params. The empty-year reset that used to run inside the
 * calendar fetch callback now runs as an effect on `data`, with the same
 * end state.
 */
export function useMapPeriod(opts: {
  data: CalendarResponse | null;
  monthCells: MonthCell[];
  mapMeta: MapMeta | null;
  mapPeriod: string;
  setMapPeriod: Dispatch<SetStateAction<string>>;
}) {
  const { data, monthCells, mapMeta, mapPeriod, setMapPeriod } = opts;

  // Reset mapPeriod if the URL/state points to a year with no recorded
  // detections (e.g. 2026): fall back to the full-period view.
  useEffect(() => {
    if (!data) return;
    setMapPeriod((prev) => {
      if (!/^\d{4}-\d{2}$/.test(prev)) return prev;
      const yNum = Number(prev.slice(0, 4));
      const yIdx = data.calendar?.years?.indexOf(yNum) ?? -1;
      return yIdx < 0 || (data.calendar?.row_totals?.[yIdx] ?? 0) <= 0 ? "all" : prev;
    });
  }, [data, setMapPeriod]);

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

  const dailyMapCells = useMemo(() => {
    if (!data) return [];
    const rows = mapPeriod === "all" ? data.daily : data.daily.filter((d) => String(d.date).slice(0, 7) === mapPeriod);
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
  }, [data, mapPeriod]);

  const mapCells = mapPeriod === "all" ? dailyMapCells : monthCells;
  const mapPreview = mapPeriod === "all"
    ? {
        returned: data?.daily?.length ?? 0,
        total: data?.summary?.n_daily_cells_total ?? data?.daily_cells ?? 0,
        preview: (data?.daily?.length ?? 0) < (data?.summary?.n_daily_cells_total ?? data?.daily_cells ?? 0),
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

  return { mapPeriod, setMapPeriod, periods, mapCells, mapPreview, yearly, scrubberYears };
}
