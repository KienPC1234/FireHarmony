import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe2, Loader2, MapPin } from "lucide-react";
import { AoiMap, type Cell as HotspotCell } from "@/components/AoiMap";
import { BackendProgressCard } from "@/components/states";
import { api, describeError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { notifyAlert, notifyToast } from "@/lib/notify";

const MAX_LIVE_DAYS = 14;
const MAX_BBOX_DEG = 35;

function isoToday(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function parseBboxNums(bboxStr: string | null | undefined): [number, number, number, number] | null {
  if (!bboxStr) return null;
  const parts = bboxStr.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts;
  if (w >= e || s >= n) return null;
  return [w, s, e, n];
}

export interface CustomLiveRegionPanelProps {
  bbox?: string | null;
  geometry?: string | null;
  dataset?: string | null;
  fromDateProp?: string | null;
  toDateProp?: string | null;
  onLoaded: (res: {
    dataset: string;
    bbox: string;
    geometry?: string | null;
    fromDate: string;
    toDate: string;
    rows: number;
    cached?: boolean;
  }) => void;
  onClear?: () => void;
}

export function CustomLiveRegionPanel({
  bbox,
  geometry,
  dataset,
  fromDateProp,
  toDateProp,
  onLoaded,
  onClear,
}: CustomLiveRegionPanelProps) {
  const { t } = useLang();
  const [selectedBbox, setSelectedBbox] = useState<string>(bbox || "");
  const [selectedGeometry, setSelectedGeometry] = useState<string | null>(geometry ?? null);
  const [fromDate, setFromDate] = useState<string>(() => fromDateProp || isoToday(-9));
  const [toDate, setToDate] = useState<string>(() => toDateProp || isoToday(0));
  const [fetching, setFetching] = useState(false);
  const [cells, setCells] = useState<HotspotCell[]>([]);
  const [lastFetch, setLastFetch] = useState<{
    rows: number;
    fromDate: string;
    toDate: string;
    bbox: string;
    cached?: boolean;
  } | null>(null);

  useEffect(() => {
    setSelectedBbox(bbox || "");
  }, [bbox]);

  useEffect(() => {
    if (geometry !== undefined) setSelectedGeometry(geometry ?? null);
  }, [geometry]);

  useEffect(() => {
    if (fromDateProp && /^\d{4}-\d{2}-\d{2}$/.test(fromDateProp)) setFromDate(fromDateProp);
  }, [fromDateProp]);

  useEffect(() => {
    if (toDateProp && /^\d{4}-\d{2}-\d{2}$/.test(toDateProp)) setToDate(toDateProp);
  }, [toDateProp]);

  const bboxNums = useMemo(() => parseBboxNums(selectedBbox), [selectedBbox]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (!bboxNums) return [20, 10];
    return [(bboxNums[1] + bboxNums[3]) / 2, (bboxNums[0] + bboxNums[2]) / 2];
  }, [bboxNums]);

  const loadMapCells = useCallback(async (
    targetDataset: string,
    targetYm: string,
    targetBbox: string,
    targetGeom: string | null,
    targetFrom: string,
    targetTo: string,
  ) => {
    try {
      const res = await api.mapCells(
        targetYm,
        targetBbox,
        "custom",
        "raw",
        "stat",
        targetDataset,
        "all",
        "all",
        targetGeom ?? undefined,
        6,
        targetFrom,
        targetTo,
        "all",
      );
      setCells(
        (res.cells ?? []).map((c) => ({
          lat: c.lat,
          lon: c.lon,
          harmonized_count: c.harmonized_count,
          date: targetYm,
          estimate_type: c.estimate_type,
        })),
      );
    } catch {
      setCells([]);
    }
  }, []);

  useEffect(() => {
    if (!dataset || !bboxNums) return;
    const targetYm = toDate.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(targetYm)) return;
    void loadMapCells(dataset, targetYm, selectedBbox, selectedGeometry, fromDate, toDate);
  }, [dataset, bboxNums, selectedBbox, selectedGeometry, fromDate, toDate, loadMapCells]);

  const handleFetch = async () => {
    if (fetching) return;
    if (!bboxNums) {
      notifyToast({ icon: "warning", title: t("custom_panel.bbox_empty") });
      return;
    }
    const lonSpan = bboxNums[2] - bboxNums[0];
    const latSpan = bboxNums[3] - bboxNums[1];
    if (lonSpan > MAX_BBOX_DEG || latSpan > MAX_BBOX_DEG) {
      notifyToast({
        icon: "warning",
        title: t("custom_panel.bbox_too_large", { max: MAX_BBOX_DEG }),
      });
      return;
    }
    if (!fromDate || !toDate || fromDate > toDate) {
      notifyToast({ icon: "warning", title: t("custom_panel.date_invalid") });
      return;
    }
    const msDiff = Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`);
    const days = Math.floor(msDiff / 86_400_000) + 1;
    if (days > MAX_LIVE_DAYS || days < 1) {
      notifyToast({
        icon: "warning",
        title: t("custom_panel.days_too_many", { max: MAX_LIVE_DAYS }),
      });
      return;
    }

    setFetching(true);
    try {
      const res = await api.fetchLiveFirms({
        bbox: bboxNums,
        days,
        from_date: fromDate,
        to_date: toDate,
      });
      const shownFrom = res.date_range?.[0] || fromDate;
      const shownTo = res.date_range?.[1] || toDate;
      const targetYm = shownTo.slice(0, 7);

      await loadMapCells(res.dataset, targetYm, selectedBbox, selectedGeometry, shownFrom, shownTo);

      setLastFetch({
        rows: res.rows,
        fromDate: shownFrom,
        toDate: shownTo,
        bbox: selectedBbox,
        cached: res.cached,
      });

      const title = res.cached
        ? t("custom_panel.cached_reused", { n: res.rows, from: shownFrom, to: shownTo })
        : t("custom_panel.fetched_new", { n: res.rows, from: shownFrom, to: shownTo });

      void notifyAlert({
        icon: res.rows > 0 ? "success" : "info",
        title,
        text: `BBox: ${selectedBbox} | ${shownFrom} -> ${shownTo}`,
        confirmButtonText: "OK",
      });

      onLoaded({
        dataset: res.dataset,
        bbox: selectedBbox,
        geometry: selectedGeometry,
        fromDate: shownFrom,
        toDate: shownTo,
        rows: res.rows,
        cached: res.cached,
      });
    } catch (err) {
      notifyToast({ icon: "error", title: describeError(err) });
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="rounded-xl border border-orange-500/30 bg-[#0B1220]/90 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-orange-200">
            <Globe2 className="h-4 w-4 text-orange-400 shrink-0" />
            <span>{t("custom_panel.title")}</span>
            {dataset && (
              <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                {dataset}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            {t("custom_panel.subtitle", { maxDays: MAX_LIVE_DAYS, maxDeg: MAX_BBOX_DEG })}
          </p>
          <p className="text-[11px] text-orange-200/80 leading-relaxed">
            {t("custom_panel.stat_custom_explain")}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            <span>{t("custom_panel.from_date")}</span>
            <input
              type="date"
              value={fromDate}
              max={toDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            <span>{t("custom_panel.to_date")}</span>
            <input
              type="date"
              value={toDate}
              min={fromDate}
              max={isoToday(0)}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
            />
          </label>
          <button
            type="button"
            disabled={fetching || !bboxNums}
            onClick={() => void handleFetch()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white transition"
          >
            {fetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MapPin className="h-3.5 w-3.5" />
            )}
            <span>{fetching ? t("custom_panel.fetching") : t("custom_panel.fetch_btn")}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">{t("custom_panel.bbox_label")}:</span>
          <span className="font-mono text-cyan-300">
            {bboxNums ? selectedBbox : t("custom_panel.bbox_empty")}
          </span>
        </div>
        {lastFetch && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
            {lastFetch.cached
              ? t("custom_panel.cached_reused", { n: lastFetch.rows, from: lastFetch.fromDate, to: lastFetch.toDate })
              : t("custom_panel.fetched_new", { n: lastFetch.rows, from: lastFetch.fromDate, to: lastFetch.toDate })}
          </span>
        )}
      </div>

      <div className="relative h-[420px] sm:h-[480px] w-full overflow-hidden rounded-lg border border-slate-800">
        <AoiMap
          center={mapCenter}
          zoom={bboxNums ? 5 : 2}
          bbox={bboxNums ? selectedBbox : null}
          geometry={selectedGeometry}
          cells={cells}
          hasCustomFilter={Boolean(bboxNums)}
          onSelect={(b, geom) => {
            setSelectedBbox(b);
            setSelectedGeometry(geom ?? null);
          }}
          onClearBbox={() => {
            setSelectedBbox("");
            setSelectedGeometry(null);
            setCells([]);
            setLastFetch(null);
            onClear?.();
          }}
        />
        {fetching && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-[#060B13]/75 backdrop-blur-sm p-4">
            <BackendProgressCard
              aoi="custom"
              data="raw"
              label={t("custom_panel.fetching")}
              liveScan
              unit="s"
            />
          </div>
        )}
      </div>
    </div>
  );
}
