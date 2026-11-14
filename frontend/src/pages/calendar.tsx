import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BookmarkPlus,
  CalendarDays,
  Download,
  Globe,
  Printer,
  ScanEye,
  Sparkles,
  Table as TableIcon,
  X,
  Zap,
} from "lucide-react";
import { api, describeError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { backendMethod, useResearchContext, type AoiId } from "@/lib/researchContext";
import { useCalendarData, AOI_BBOX, apiDetailMessage, parseBboxNumbers, type AppliedFilters } from "@/hooks/useCalendarData";
import { useMapPeriod } from "@/hooks/useMapPeriod";
import { useCalendarExport } from "@/hooks/useCalendarExport";
import { BackendProgressCard, ErrorState } from "@/components/states";
import { AoiMap } from "@/components/AoiMap";
import { SCENARIO_PRESETS, type ScenarioPreset } from "@/components/calendar/calendarPresets";
import type { HotspotCluster } from "@/components/map/clusterZones";
import { type CustomAoiProbe, type DockTab, type SavedCustomAoi } from "@/components/calendar/CalendarDock";
import { CalendarKpis } from "@/components/calendar/CalendarKpis";
import { CalendarMatrix } from "@/components/calendar/CalendarMatrix";
import { CalendarMapView } from "@/components/map/CalendarMapView";
import { Footer } from "@/components/Footer";
import { cn, compact } from "@/lib/utils";

const AOI_CENTER: Record<string, { c: [number, number]; z: number }> = {
  vietnam: { c: [13, 106.5], z: 6 },
  amazon: { c: [-4, -60], z: 4 },
  australia: { c: [-26, 133], z: 4 },
};

// P2-12: named view fallbacks instead of inline literals, so the AOI-center
// rule has one home and the map never depends on a fresh array identity.
const DEFAULT_AOI_CENTER: [number, number] = [13, 106.5];
const WORLD_CENTER: [number, number] = [15, 20];

/** CLAIM-024: user-saved custom AOIs live in the server AOI registry
 * (GET /api/firms/aois lists presets + custom with `dataset_ready`;
 * POST /api/firms/aois registers {label, bbox:[minLon,minLat,maxLon,maxLat]}).
 * Readiness is probed through the served stat path
 * (`GET /calendar?limit=1&method=stat`). Range badges come from observed
 * rows (`summary.period`, the same manifest-backed source as
 * `GET /data-status` `date_range`), never from a hardcoded span. The
 * registry stores bbox only — a drawn polygon is not persisted
 * server-side, so Apply restores the bbox. There is no DELETE endpoint, so
 * Delete only hides the entry locally for this session. */
const PRESET_AOI_IDS = new Set(Object.keys(AOI_BBOX));

type RangePreset = "all" | "1m" | "12m" | "custom";

function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function CalendarPage() {
  const { t } = useLang();
  const { aoi, dataFeed, mode, setAoi, setDataFeed, method, setMethod } = useResearchContext();
  const [search, setSearch] = useSearchParams();

  // Tab: map (default), matrix, scenarios
  const [activeTab, setActiveTab] = useState<"map" | "matrix" | "scenarios">("map");

  // Dock controls
  // On narrow viewports keep the map usable; the inspector opens as a sheet.
  const [dockOpen, setDockOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  const [dockTab, setDockTab] = useState<DockTab>("overview");

  // Matrix display mode: values vs z-score
  const [matrixMode, setMatrixMode] = useState<"compact" | "zscore">("compact");
  const [paletteMode, setPaletteMode] = useState<"standard" | "accessible">("standard");

  // Map temporal filter
  const [mapPeriod, setMapPeriod] = useState<string>(search.get("ym") || "all");
  const [activeZone, setActiveZone] = useState<HotspotCluster | null>(null);
  // Start at a neutral world-center view unless an AOI/bbox/geometry was explicitly requested
  const [hasExplicitRegion, setHasExplicitRegion] = useState<boolean>(() =>
    Boolean(search.get("aoi") || search.get("bbox") || search.get("geometry")),
  );

  // Data fetching lives in hooks (see useCalendarData/useMapPeriod/
  // useCalendarExport); this file keeps UI atoms + the three views.
  // CLAIM-024: custom AOIs come from the server registry (GET /aois),
  // never from localStorage. There is no DELETE endpoint, so deletions
  // only hide entries locally for this session (hiddenCustomIds).
  const [customAois, setCustomAois] = useState<SavedCustomAoi[]>([]);
  const [hiddenCustomIds, setHiddenCustomIds] = useState<string[]>([]);
  const [savingAoi, setSavingAoi] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aoiProbes, setAoiProbes] = useState<Record<string, CustomAoiProbe>>({});
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  // P2: manifest `date_range` per AOI from data-status; null = still pending.
  const [manifestRanges, setManifestRanges] = useState<Record<string, [string, string] | null> | null>(null);

  // P0-05: one validated range for calendar, map, export and evidence.
  const [rangePreset, setRangePreset] = useState<RangePreset>(
    search.get("from") || search.get("to") ? "custom" : "all",
  );
  const [fromDate, setFromDate] = useState<string>(search.get("from") || "");
  const [toDate, setToDate] = useState<string>(search.get("to") || "");

  // Filters state
  const [, setBbox] = useState<string>(AOI_BBOX[aoi] ?? AOI_BBOX.vietnam);

  const [activeMonth, setActiveMonth] = useState<{
    year: number;
    month: number;
    val: number | null;
    z: number | null;
    coverage: string;
    ratio?: number | null;
    isPartial?: boolean;
    coverageRatio?: number;
  } | null>(null);

  const [applied, setApplied] = useState<AppliedFilters>({
    bbox: AOI_BBOX[search.get("aoi") || aoi] ?? AOI_BBOX.vietnam,
    aoi: search.get("aoi") || aoi,
    data: dataFeed,
    // Never fire a 409 on first paint: HTS needs raw, the sample has no tiles.
    method: (method === "hts_anchor" || method === "stan") && dataFeed !== "raw"
      ? "stat"
      : backendMethod(method),
    dataset: search.get("dataset") || undefined,
    qa_min: search.get("qa_min") || "all",
    platform_set: search.get("platform_set") || "all",
    source_type: (search.get("source_type") as "all" | "land" | "vegetation") || "all",
    geometry: search.get("geometry") || null,
    from_date: search.get("from") || null,
    to_date: search.get("to") || null,
  });

  // Data fetching (calendar grid, map cells, evidence) + period derivations
  // live in hooks. The mapPeriod atom stays URL-initialized here and is
  // shared by both hooks, keeping them flat with no cyclic params.
  const {
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
  } = useCalendarData({ applied, activeTab, mapPeriod, activeMonth, t });
  const { periods, mapCells, mapPreview, yearly, scrubberYears } = useMapPeriod({
    data,
    monthCells,
    mapMeta,
    mapPeriod,
    setMapPeriod,
  });
  const { exporting, exportErr, handleExport } = useCalendarExport({ applied });

  const prevFeed = useRef(dataFeed);
  useEffect(() => {
    if (prevFeed.current !== dataFeed) {
      if (dataFeed === "raw") {
        if (method === "k_ratio") setMethod("stan");
        // Coerce in the same update so raw does not first run a cold stat pass
        // and then re-run as STAN.
        setApplied((prev) => ({
          ...prev,
          data: "raw",
          method: method === "k_ratio" ? "stan" : backendMethod(method),
        }));
      } else {
        if (method === "stan") setMethod("k_ratio");
        // Switch data and method in one update: sample has no tiles, so a
        // transient method=stan request would 409 before the method sync lands.
        setApplied((prev) => ({
          ...prev,
          data: "sample",
          method: prev.method === "stan" || prev.method === "hts" ? "stat" : prev.method,
        }));
      }
      prevFeed.current = dataFeed;
    }
  }, [dataFeed, method, setMethod]);

  useEffect(() => {
    if ((method === "hts_anchor" || method === "stan") && dataFeed === "sample") {
      // Keep explicit feed selection authoritative: sample has no tile
      // coverage, so STAN/HTS is unavailable. Correct method, not data.
      setMethod("k_ratio");
      setApplied((prev) =>
        prev.data === "sample" && prev.method === "stat"
          ? prev : { ...prev, data: "sample", method: "stat" });
      return;
    }
    const bm = backendMethod(method);
    setApplied((prev) => (prev.method === bm ? prev : { ...prev, method: bm }));
  }, [method, dataFeed, setMethod]);

  // P2: manifest `date_range` per AOI for the dock sensor table and the
  // saved-AOI badges. Null outer state = fetch still pending → loading text.
  useEffect(() => {
    let alive = true;
    api.dataStatus().then((st) => {
      if (!alive) return;
      const ranges: Record<string, [string, string] | null> = {};
      for (const d of st.datasets ?? []) {
        ranges[d.aoi] = d.date_range?.[0] && d.date_range?.[1]
          ? [d.date_range[0], d.date_range[1]]
          : null;
      }
      setManifestRanges(ranges);
    }).catch(() => {
      if (alive) setManifestRanges({});
    });
    return () => {
      alive = false;
    };
  }, []);

  // CLAIM-024: load the custom AOI list from the server registry. Preset
  // ids resolve from AOI_BBOX; every other GET /aois entry is custom and
  // becomes directly queryable (`GET /calendar?aoi=<id>`), so baseAoi is the
  // registry id itself and geometry stays null (polygons are not stored
  // server-side). A registry failure (e.g. an e2e fixture with no /aois
  // route) falls back to an empty list instead of breaking the calendar.
  useEffect(() => {
    let alive = true;
    api.aois().then((res) => {
      if (!alive) return;
      setCustomAois(
        (res.aois ?? [])
          .filter((a) => !PRESET_AOI_IDS.has(a.id) && typeof a.bbox === "string" && a.bbox)
          .map((a) => ({
            id: a.id,
            name: a.label,
            baseAoi: a.id,
            bbox: String(a.bbox),
            geometry: null,
          })),
      );
    }).catch(() => {
      if (alive) setCustomAois([]);
    });
    return () => {
      alive = false;
    };
  }, []);

  const visibleCustomAois = useMemo(
    () => customAois.filter((c) => !hiddenCustomIds.includes(c.id)),
    [customAois, hiddenCustomIds],
  );

  // CLAIM-024: probe each registry custom AOI through the served stat path.
  // pending → ready (with the served period as the range badge) / empty / error.
  useEffect(() => {
    if (visibleCustomAois.length === 0) return;
    let alive = true;
    setAoiProbes((prev) => {
      const next = { ...prev };
      for (const c of visibleCustomAois) {
        if (!next[c.id]) next[c.id] = { status: "pending" };
      }
      return next;
    });
    for (const c of visibleCustomAois) {
      api.calendar(
        1, c.bbox, c.baseAoi, applied.data, "stat",
        undefined, "all", "all",
        c.geometry ?? undefined,
        undefined, undefined, "all",
      ).then((res) => {
        if (!alive) return;
        const years = res.calendar?.years ?? [];
        const period = res.summary?.period;
        setAoiProbes((prev) => ({
          ...prev,
          [c.id]: years.length > 0
            ? { status: "ready", from: period?.from ?? null, to: period?.to ?? null }
            : { status: "empty" },
        }));
      }).catch((e) => {
        if (!alive) return;
        const st = typeof (e as { status?: number })?.status === "number"
          ? (e as { status: number }).status : 0;
        setAoiProbes((prev) => ({
          ...prev,
          [c.id]: st === 404 ? { status: "empty" } : { status: "error" },
        }));
      });
    }
    return () => {
      alive = false;
    };
    // Re-probe when the feed changes: raw/sample readiness differs.
  }, [visibleCustomAois, applied.data]);

  // URL sync is intentionally keyed on `applied` and `hasExplicitRegion`;
  // keep default parameters out of the URL until the user selects them.
  useEffect(() => {
    const next = new URLSearchParams(search);
    if (hasExplicitRegion || search.has("aoi")) next.set("aoi", applied.aoi); else next.delete("aoi");
    if (applied.data !== "raw" || search.has("data")) next.set("data", applied.data); else next.delete("data");
    if (applied.qa_min !== "all" || search.has("qa_min")) next.set("qa_min", applied.qa_min); else next.delete("qa_min");
    if (applied.platform_set !== "all" || search.has("platform_set")) next.set("platform_set", applied.platform_set); else next.delete("platform_set");
    if (applied.source_type !== "all") next.set("source_type", applied.source_type); else next.delete("source_type");
    if (applied.dataset) next.set("dataset", applied.dataset);
    if (applied.from_date) next.set("from", applied.from_date); else next.delete("from");
    if (applied.to_date) next.set("to", applied.to_date); else next.delete("to");
    if (applied.geometry) next.set("geometry", applied.geometry); else next.delete("geometry");
    if (mapPeriod !== "all") next.set("ym", mapPeriod); else next.delete("ym");
    if (next.toString() !== search.toString()) {
      setSearch(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, mapPeriod, hasExplicitRegion]);

  const applyRangePreset = (preset: RangePreset) => {
    setRangePreset(preset);
    if (preset === "custom") return;
    let lo = "";
    let hi = "";
    if (preset !== "all") {
      const anchor = data?.summary?.period?.to
        || new Date().toISOString().slice(0, 7);
      const start = preset === "12m" ? shiftMonth(anchor, -11) : anchor;
      lo = `${start}-01`;
      hi = monthEnd(anchor);
    }
    setFromDate(lo);
    setToDate(hi);
    setApplied((prev) => ({ ...prev, from_date: lo || null, to_date: hi || null }));
  };

  const setCustomRange = (lo: string, hi: string) => {
    setFromDate(lo);
    setToDate(hi);
    if (!lo || !hi || lo > hi) return;
    setApplied((prev) => ({ ...prev, from_date: lo, to_date: hi }));
  };

  // P1-07: Escape closes the month inspector opened from a matrix button.
  useEffect(() => {
    if (!activeMonth) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveMonth(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeMonth]);

  const handleSelectAoi = (newAoi: string) => {
    setHasExplicitRegion(true);
    setAoi(newAoi as AoiId);
    const b = AOI_BBOX[newAoi] ?? "";
    setBbox(b);
    setApplied({
      ...applied,
      aoi: newAoi,
      bbox: b,
      geometry: null,
    });
  };

  const handleSelectScenario = (sc: ScenarioPreset) => {
    setHasExplicitRegion(true);
    setAoi(sc.aoi as AoiId);
    const b = AOI_BBOX[sc.aoi] ?? "";
    setBbox(b);
    setApplied({
      ...applied,
      aoi: sc.aoi,
      bbox: b,
      geometry: null,
    });
    setMapPeriod(`${sc.year}-${String(sc.month).padStart(2, "0")}`);
    setActiveTab("map");
  };

  // Phase 1+2: the current bbox/polygon (produced by DrawPolygonLayer /
  // MapToolbar via onSelect) differs from the preset AOI box.
  const hasCustomRegion = Boolean(applied.geometry)
    || Boolean(applied.bbox && applied.bbox !== (AOI_BBOX[applied.aoi] ?? ""));

  const handleSaveAoi = async () => {
    if (savingAoi) return;
    const nums = parseBboxNumbers(applied.bbox);
    if (!nums) {
      setSaveError(t("calendar.coord_invalid"));
      return;
    }
    const name = saveName.trim()
      || t("calendar.save_aoi_default_name", { n: visibleCustomAois.length + 1 });
    setSavingAoi(true);
    setSaveError(null);
    try {
      // CLAIM-024: Save registers the current bbox in the server registry
      // (400 invalid bbox / 409 duplicate id surface below with the backend
      // message). A drawn polygon is not persisted server-side — only the
      // bbox is kept, so geometry is intentionally dropped here.
      const created = await api.createAoi(name, nums);
      setCustomAois((prev) => (
        prev.some((c) => c.id === created.id)
          ? prev.map((c) => (c.id === created.id
            ? { ...c, name: created.label, bbox: created.bbox } : c))
          : [...prev, {
            id: created.id,
            name: created.label,
            baseAoi: created.id,
            bbox: created.bbox,
            geometry: null,
          }]
      ));
      setHiddenCustomIds((prev) => prev.filter((id) => id !== created.id));
      setSaveName("");
      setShowSaveDialog(false);
    } catch (e) {
      setSaveError(t("calendar.save_aoi_failed", {
        message: apiDetailMessage(e) ?? (e instanceof Error ? e.message : describeError(e)),
      }));
    } finally {
      setSavingAoi(false);
    }
  };

  const handleApplyCustomAoi = (c: SavedCustomAoi) => {
    setHasExplicitRegion(true);
    setAoi(c.baseAoi as AoiId);
    setBbox(c.bbox);
    setActiveZone(null);
    setApplied((prev) => ({
      ...prev,
      aoi: c.baseAoi,
      bbox: c.bbox,
      geometry: c.geometry,
    }));
  };

  // No DELETE /api/firms/aois endpoint exists: deletion only hides the entry
  // locally for this session; the registry entry stays on the server.
  const handleDeleteCustomAoi = (id: string) => {
    setHiddenCustomIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setAoiProbes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // 409 recovery: the stat grid path is valid on any subset.
  const retryConflictWithStat = () => {
    setModelConflict(null);
    if (method !== "k_ratio") setMethod("k_ratio");
    setApplied((prev) => ({ ...prev, method: "stat" }));
  };

  // P2: dock sensor rows from the manifest date_range (data-status), never
  // from a hardcoded span. null = manifest still pending → loading text.
  const aoiManifestRange = manifestRanges ? manifestRanges[applied.aoi] ?? null : undefined;
  const modisRange = aoiManifestRange === undefined
    ? null
    : aoiManifestRange
    ? `${aoiManifestRange[0].slice(0, 4)}-${aoiManifestRange[1].slice(0, 4)}`
    : t("calendar.aoi_range_unknown");
  const viirsRange = aoiManifestRange === undefined
    ? null
    : aoiManifestRange
    ? `${Math.max(2012, Number(aoiManifestRange[0].slice(0, 4)))}-${aoiManifestRange[1].slice(0, 4)}`
    : t("calendar.aoi_range_unknown");

  // Empty-filter recovery: drop the spatial/temporal restrictions that matched
  // no rows and refetch the full AOI. The map stays mounted throughout.
  const clearRestrictiveFilters = () => {
    const defBbox = AOI_BBOX[applied.aoi] ?? "";
    setBbox(defBbox);
    setActiveZone(null);
    setEmptyFilter(null);
    setRangePreset("all");
    setFromDate("");
    setToDate("");
    setApplied((prev) => ({
      ...prev,
      bbox: defBbox,
      geometry: null,
      from_date: null,
      to_date: null,
      dataset: undefined,
    }));
    const next = new URLSearchParams(search);
    next.delete("bbox");
    next.delete("geometry");
    next.delete("from");
    next.delete("to");
    next.delete("dataset");
    if (next.toString() !== search.toString()) {
      setSearch(next, { replace: true });
    }
  };

  if (error) return <ErrorState error={error} onRetry={() => setApplied({ ...applied })} />;
  if (rawUnavailable && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
        <div className="max-w-lg w-full rounded-2xl border border-amber-500/40 bg-amber-950/30 p-6 space-y-4 text-sm text-amber-100">
          <div className="flex items-center gap-2 font-bold text-amber-300 text-base">
            <Zap className="h-5 w-5 shrink-0" />
            <span>{t("calendar.raw_unavailable_title")}</span>
          </div>
          <p className="text-xs text-amber-200/90 leading-relaxed">
            {rawUnavailable.message || t("calendar.raw_unavailable_body")}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setRawUnavailable(null);
                setApplied({ ...applied });
              }}
              className="rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30 transition"
            >
              {t("states.retry")}
            </button>
            <button
              type="button"
              onClick={() => {
                setRawUnavailable(null);
                // Update feed and method in ONE URL transaction, otherwise a
                // second setSearchParams call can restore the old raw feed.
                setSearch((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set("data", "sample");
                  next.set("method", "k_ratio");
                  return next;
                }, { replace: true });
                // The feed-change effect will synchronize applied filters.
              }}
              className="rounded-lg border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
            >
              {t("common.synthetic_feed")}
            </button>
          </div>
        </div>
      </div>
    );
  }
  // Phase 1+2: 404-behind-a-filter and 409-model-conflict both keep the map
  // mounted (never a full-page ErrorState): an inline banner plus Clear /
  // retry-with-stat actions. The map renders with zero cells until the
  // refetch lands.
  if (!data && (emptyFilter || modelConflict)) {
    return (
      <div className="relative flex-1 min-h-0 flex flex-col h-full w-full bg-[#060B13] text-slate-100 overflow-hidden">
        {modelConflict && (
          <div className="shrink-0 mx-3 mt-2 flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-950/50 px-3.5 py-2.5 text-xs text-amber-100">
            <div className="font-bold text-sm">{t("calendar.conflict_409_title")}</div>
            <p className="leading-relaxed text-amber-100/90">{modelConflict.message}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={retryConflictWithStat}
                className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 transition"
              >
                {t("calendar.conflict_409_retry")}
              </button>
            </div>
          </div>
        )}
        {emptyFilter && (
          <div data-testid="empty-filter-banner" className="shrink-0 mx-3 mt-2 flex items-center justify-between gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/50 px-3.5 py-2 text-xs text-cyan-100">
            <span className="flex flex-col gap-0.5">
              <span className="font-bold">{t("calendar.empty_filter_title")}</span>
              <span className="text-cyan-200/80">{t("calendar.empty_filter_body")}</span>
            </span>
            <button
              type="button"
              onClick={clearRestrictiveFilters}
              className="rounded-lg border border-cyan-500/50 bg-cyan-500/20 px-2.5 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30 transition shrink-0"
            >
              {t("calendar.clear_filter")}
            </button>
          </div>
        )}
        <div className="relative flex-1 min-h-0 m-3 rounded-2xl overflow-hidden border border-slate-800">
          <AoiMap
            center={hasExplicitRegion ? (AOI_CENTER[aoi]?.c ?? DEFAULT_AOI_CENTER) : WORLD_CENTER}
            zoom={hasExplicitRegion ? (AOI_CENTER[aoi]?.z ?? 6) : 2}
            bbox={applied.bbox || null}
            geometry={applied.geometry}
            hasCustomFilter={hasCustomRegion}
            cells={[]}
            preview={null}
            fullBleed={true}
            height="100%"
            hideToolbar={false}
            hideLegend={false}
            onClearBbox={clearRestrictiveFilters}
            onSelect={(b, geom) => {
              setBbox(b);
              setApplied({ ...applied, bbox: b, geometry: geom ?? null });
            }}
          />
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#060B13] p-6">
        <BackendProgressCard
          aoi={applied.aoi}
          data={applied.data}
          label={applied.data === "raw" ? t("calendar.loading_raw") : t("calendar.loading_sample")}
          hint={applied.data === "raw" ? t("calendar.loading_raw_hint") : t("calendar.loading_sample_hint")}
          unit={t("calendar.loading_elapsed")}
        />
      </div>
    );
  }

  const isSynthetic = applied.data === "sample";
  const summary = data.summary;
  // P0-01: server-side totals over the full filtered set. Never derive a KPI
  // from the capped `daily` slice, and never add MODIS+VIIRS as "fires".
  const totalObserved = summary?.sensor_detections_total ?? 0;
  const totalModis = summary?.modis_detections ?? 0;
  const totalViirs = summary?.viirs_detections ?? 0;
  const totalHarmonized = summary?.harmonized_total
    ?? data.calendar?.row_totals?.reduce((sum, v) => sum + (v || 0), 0) ?? 0;
  const criticalCount = data.critical_periods?.length ?? 0;
  const methodShown = data.effective_method || data.method_id || applied.method;
  const delayLine = summary
    ? `${compact(summary.n_daily_cells_returned)} / ${compact(summary.n_daily_cells_total)} ${t("calendar.cells_returned")}`
    : "";

  return (
    <div className="relative flex-1 min-h-0 flex flex-col h-full w-full bg-[#060B13] text-slate-100 overflow-hidden">
      {showLoadingOverlay && (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <BackendProgressCard
            aoi={applied.aoi}
            data={applied.data}
            label={applied.data === "raw" ? t("calendar.loading_raw") : t("calendar.loading_sample")}
            hint={applied.data === "raw" ? t("calendar.loading_raw_hint") : t("calendar.loading_sample_hint")}
            unit={t("calendar.loading_elapsed")}
          />
        </div>
      )}
      {/* 1. TOP HEADER & TELEMETRY STRIP */}
      <header className="border-b border-slate-800 bg-[#0B1220]/95 backdrop-blur-md px-2.5 py-1.5 flex flex-wrap lg:flex-nowrap items-center justify-between gap-1.5 shrink-0 overflow-x-auto">
        <div className="flex min-w-0 items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-cyan-400 shrink-0" />
            <h1 className="whitespace-nowrap text-xs sm:text-sm font-bold text-white tracking-tight">
              {t("calendar.title")}
            </h1>
          </div>

          {/* Mode Badge & Playwright Token */}
          {applied.dataset ? (
            <span className="rounded-md border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-xs font-mono font-bold text-amber-300">
              USER UPLOAD (UNVERIFIED)
            </span>
          ) : isSynthetic ? (
            <span className="rounded-md border border-sky-500/40 bg-sky-950/40 px-2 py-0.5 text-xs font-mono font-bold text-sky-300">
              SYNTHETIC DEMO
            </span>
          ) : (
            <span className="rounded-md border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 text-xs font-mono font-bold text-emerald-300">
              NASA OBSERVED
            </span>
          )}

          {/* Period Selector integrated cleanly in header (No floating overlay on map) */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-1 text-xs">
            <span className="text-slate-400 font-medium hidden 2xl:inline">{t("calendar.period")}</span>
            <select
              aria-label={t("calendar.period")}
              value={mapPeriod}
              onChange={(e) => setMapPeriod(e.target.value)}
              className="rounded bg-transparent font-mono text-xs text-cyan-300 focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-slate-900 text-slate-200">{t("calendar.all_months")}</option>
              {periods.map((p) => (
                <option key={p} value={p} className="bg-slate-900 text-slate-200">
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-1 text-xs">
            <span className="text-slate-400 font-medium hidden 2xl:inline">{t("calendar.date_range")}</span>
            <select
              value={rangePreset}
              onChange={(e) => applyRangePreset(e.target.value as RangePreset)}
              className="rounded bg-transparent font-mono text-xs text-cyan-300 focus:outline-none cursor-pointer"
              aria-label={t("calendar.date_range")}
            >
              <option value="all" className="bg-slate-900 text-slate-200">{t("calendar.range_all")}</option>
              <option value="1m" className="bg-slate-900 text-slate-200">{t("calendar.range_1m")}</option>
              <option value="12m" className="bg-slate-900 text-slate-200">{t("calendar.range_12m")}</option>
              <option value="custom" className="bg-slate-900 text-slate-200">{t("calendar.range_custom")}</option>
            </select>
            {rangePreset === "custom" && (
              <>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setCustomRange(e.target.value, toDate)}
                  className="rounded bg-slate-950 px-1 py-0.5 font-mono text-[11px] text-slate-200"
                  aria-label={t("calendar.from_date")}
                />
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setCustomRange(fromDate, e.target.value)}
                  className="rounded bg-slate-950 px-1 py-0.5 font-mono text-[11px] text-slate-200"
                  aria-label={t("calendar.to_date")}
                />
              </>
            )}
          </div>

          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => handleExport("cells")}
              title={exportErr ?? t("calendar.export_csv_title")}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:text-white transition min-h-[30px] disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5 text-cyan-400" />
              <span className="hidden sm:inline">
                {exporting === "cells" ? "…" : t("calendar.export_csv")}
              </span>
            </button>
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => handleExport("detections")}
              title={exportErr ?? t("calendar.export_detections_title")}
              className="border-l border-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-400 hover:text-white transition min-h-[30px] disabled:opacity-50"
            >
              {exporting === "detections" ? "…" : t("calendar.export_detections")}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              title={t("calendar.export_print_title")}
              className="border-l border-slate-800 px-2.5 py-1 text-xs font-semibold text-purple-300 hover:text-white transition min-h-[30px] inline-flex items-center gap-1"
            >
              <Printer className="h-3.5 w-3.5 text-purple-400" />
              <span className="hidden 2xl:inline">{t("calendar.export_print")}</span>
            </button>
          </div>
          {/* Phase 1+2: save the current bbox/polygon as a custom AOI. */}
          <button
            type="button"
            disabled={!hasCustomRegion}
            onClick={() => setShowSaveDialog((v) => !v)}
            title={hasCustomRegion ? t("calendar.save_aoi_btn") : t("calendar.save_aoi_hint")}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/50 transition min-h-[30px] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <BookmarkPlus className="h-3.5 w-3.5 text-emerald-400" />
            <span className="hidden sm:inline">{t("calendar.save_aoi_btn")}</span>
          </button>
          {exportErr && (
            <p role="alert" className="text-xs text-rose-300 font-mono max-w-[240px] truncate" title={exportErr}>
              {exportErr}
            </p>
          )}

          <div className="hidden 2xl:flex items-center gap-2 whitespace-nowrap text-xs text-slate-400 font-mono">
            <span>{compact(totalObserved)} {t("calendar.sensor_detections")}</span>
            <span>•</span>
            <span className="text-cyan-300">{compact(totalHarmonized)} {t("calendar.calibrated_short")}</span>
            <span>•</span>
            <span className="text-orange-400">{criticalCount} {t("common.anomalies")}</span>
          </div>
        </div>

        {/* View Mode Tabs (Map / Matrix / Scenarios) */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("map")}
            aria-pressed={activeTab === "map"}
            aria-label={t("calendar.view_map")}
            className={cn(
              "flex items-center gap-1 rounded px-2.5 py-1 font-semibold transition min-h-[30px]",
              activeTab === "map"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                : "text-slate-400 hover:text-white",
            )}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>{t("calendar.view_map")}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("matrix")}
            aria-pressed={activeTab === "matrix"}
            aria-label={t("calendar.view_matrix")}
            className={cn(
              "flex items-center gap-1 rounded px-2.5 py-1 font-semibold transition min-h-[30px]",
              activeTab === "matrix"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                : "text-slate-400 hover:text-white",
            )}
          >
            <TableIcon className="h-3.5 w-3.5" />
            <span>{t("calendar.view_matrix")}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("scenarios")}
            aria-pressed={activeTab === "scenarios"}
            aria-label={t("calendar.view_scenarios")}
            className={cn(
              "flex items-center gap-1 rounded px-2.5 py-1 font-semibold transition min-h-[30px]",
              activeTab === "scenarios"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                : "text-slate-400 hover:text-white",
            )}
          >
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            <span className="hidden sm:inline">{t("calendar.view_scenarios")}</span>
          </button>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setActiveTab("map");
              setDockTab("ai");
              setDockOpen(true);
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition min-h-[30px]",
              activeTab === "map" && dockOpen && dockTab === "ai"
                ? "border-purple-500/50 bg-purple-950/40 text-purple-200"
                : "border-slate-800 bg-slate-900 text-slate-300 hover:text-purple-300",
            )}
          >
            <Sparkles className="h-3.5 w-3.5 text-purple-400" />
            <span>{t("calendar.ask_ai")}</span>
          </button>

          <Link
            to={{ pathname: "/xray", search: search.toString() }}
            className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:text-white transition min-h-[30px]"
          >
            <ScanEye className="h-3.5 w-3.5 text-cyan-400" />
            <span>{t("calendar.xray")}</span>
          </Link>
        </div>
      </header>

      {rawUnavailable && (
        <div className="shrink-0 mx-3 mt-2 flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-950/50 px-3.5 py-2 text-xs text-amber-200 animate-fade-in">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400 shrink-0" />
            <span>{rawUnavailable.message || t("calendar.raw_unavailable_body")}</span>
          </div>
          <button
            type="button"
            onClick={() => setRawUnavailable(null)}
            className="text-amber-400 hover:text-white p-1"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {showSaveDialog && (
        <div className="shrink-0 mx-3 mt-2 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3.5 py-2.5 text-xs text-emerald-100 space-y-2">
          <div className="font-bold text-sm">{t("calendar.save_aoi_title")}</div>
          <p className="leading-relaxed text-emerald-100/80">{t("calendar.save_aoi_desc")}</p>
          <p className="font-mono text-[11px] text-emerald-300/80 truncate" title={applied.bbox}>
            {applied.bbox}{applied.geometry ? t("calendar.save_aoi_has_polygon") : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="custom-aoi-name">{t("calendar.save_aoi_name_label")}</label>
            <input
              id="custom-aoi-name"
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={t("calendar.save_aoi_name_ph")}
              maxLength={80}
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSaveAoi}
              disabled={savingAoi}
              className="rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30 transition disabled:opacity-50"
            >
              {savingAoi ? t("calendar.save_aoi_saving") : t("calendar.save_aoi_save")}
            </button>
            <button
              type="button"
              onClick={() => { setShowSaveDialog(false); setSaveError(null); }}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white transition"
            >
              {t("common.cancel")}
            </button>
          </div>
          {saveError && (
            <p role="alert" className="font-mono text-[11px] leading-relaxed text-rose-300">
              {saveError}
            </p>
          )}
        </div>
      )}

      {modelConflict && (
        <div className="shrink-0 mx-3 mt-2 flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-950/50 px-3.5 py-2.5 text-xs text-amber-100">
          <div className="font-bold text-sm">{t("calendar.conflict_409_title")}</div>
          <p className="leading-relaxed text-amber-100/90">{modelConflict.message}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={retryConflictWithStat}
              className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 transition"
            >
              {t("calendar.conflict_409_retry")}
            </button>
          </div>
        </div>
      )}

      {emptyFilter && (
        <div data-testid="empty-filter-banner" className="shrink-0 mx-3 mt-2 flex items-center justify-between gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/50 px-3.5 py-2 text-xs text-cyan-100 animate-fade-in">
          <span className="flex flex-col gap-0.5">
            <span className="font-bold">{t("calendar.empty_filter_title")}</span>
            <span className="text-cyan-200/80">{t("calendar.empty_filter_body")}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              const defaultBbox = AOI_BBOX[aoi] ?? "";
              setBbox(defaultBbox);
              setEmptyFilter(null);
              setApplied({ ...applied, bbox: defaultBbox, geometry: null, from_date: null, to_date: null });
            }}
            className="rounded-lg border border-cyan-500/50 bg-cyan-500/20 px-2.5 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30 transition shrink-0"
          >
            {t("calendar.clear_filter")}
          </button>
        </div>
      )}

      {/* P1-02: Research mode reveals provenance/coverage detail; Explore keeps
          the same page without model plumbing. */}
      {mode === "research" && summary && (
        <div className="shrink-0 border-b border-slate-800 bg-[#08101c] px-3 py-1.5 font-mono text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
          <span>method_id <span className="text-cyan-300">{data.method_id ?? "-"}</span></span>
          <span>effective <span className="text-cyan-300">{methodShown}</span></span>
          <span>scope <span className="text-cyan-300">{summary.source_scope}</span></span>
          <span>estimated_index <span className="text-cyan-300">{summary.estimated_index == null ? "-" : summary.estimated_index.toFixed(3)}</span></span>
          <span>filter_hash <span className="text-cyan-300">{summary.filter_hash}</span></span>
          {summary.period.from && (
            <span>period <span className="text-cyan-300">{summary.period.from} → {summary.period.to}</span></span>
          )}
          {applied.geometry && (
            <span>geometry_hash <span className="text-cyan-300">{data.geometry_hash}</span></span>
          )}
        </div>
      )}

      {/* CLAIM-034: stat-forcing used to be silent (STAN requested, stat
          served on subsets/samples). Keep one fixed badge near the method
          switcher quoting only fields already in the response. */}
      {statForced && (
        <div data-testid="stat-forced-badge" className="shrink-0 border-b border-amber-500/30 bg-amber-950/30 px-3 py-1.5 font-mono text-[11px] text-amber-200">
          {t("calendar.stat_forced_badge", { requested: requestedMethod, serving: servingMethod })}
        </div>
      )}

      {/* 2. BODY CONTENT */}

      {/* VIEW 1: SATELLITE GIS WORKSTATION (DEFAULT) */}
      {activeTab === "map" && (
        <CalendarMapView
          aoi={aoi}
          appliedAoi={applied.aoi}
          appliedBbox={applied.bbox || null}
          appliedGeometry={applied.geometry}
          hasCustomFilter={hasCustomRegion}
          hasExplicitRegion={hasExplicitRegion}
          cells={mapCells}
          preview={mapPreview}
          activeZone={activeZone}
          onSelectZone={setActiveZone}
          mapError={mapError}
          calendarYears={data.calendar?.years ?? []}
          scrubberYears={scrubberYears}
          mapPeriod={mapPeriod}
          onSelectPeriod={setMapPeriod}
          loadingData={loadingData}
          loadingMapCells={loadingMapCells}
          dockOpen={dockOpen}
          onToggleDock={() => setDockOpen(!dockOpen)}
          dockTab={dockTab}
          onDockTabChange={setDockTab}
          onSelectAoi={handleSelectAoi}
          dataFeed={applied.data}
          onSelectDataFeed={setDataFeed}
          method={method}
          onSelectMethod={setMethod}
          sourceType={applied.source_type}
          onSelectSourceType={(val) => setApplied((prev) => ({ ...prev, source_type: val }))}
          qaMin={applied.qa_min}
          onSelectQaMin={(val) => setApplied((prev) => ({ ...prev, qa_min: val }))}
          platformSet={applied.platform_set}
          onSelectPlatformSet={(val) => setApplied((prev) => ({ ...prev, platform_set: val }))}
          totalDetections={totalObserved}
          totalHarmonized={totalHarmonized}
          anomalyCount={criticalCount}
          dockActiveMonth={
            activeMonth
              ? {
                  year: activeMonth.year,
                  month: activeMonth.month,
                  val: activeMonth.val,
                  z: activeMonth.z,
                  isPartial: activeMonth.isPartial,
                }
              : null
          }
          onShowMonthOnMap={(ym) => {
            setMapPeriod(ym);
            setActiveTab("map");
          }}
          onOpenMatrix={() => setActiveTab("matrix")}
          customAois={visibleCustomAois}
          aoiProbes={aoiProbes}
          onApplyCustomAoi={handleApplyCustomAoi}
          onDeleteCustomAoi={handleDeleteCustomAoi}
          modisRange={modisRange}
          viirsRange={viirsRange}
          onSelectBbox={(b, geom) => {
            setBbox(b);
            setApplied({ ...applied, bbox: b, geometry: geom ?? null });
          }}
          onClearBbox={() => {
            const defaultBbox = AOI_BBOX[aoi] ?? "";
            setBbox(defaultBbox);
            setActiveZone(null);
            setApplied((prev) =>
              prev.bbox === defaultBbox && prev.geometry === null
                ? prev
                : { ...prev, bbox: defaultBbox, geometry: null },
            );
            if (search.has("bbox") || search.has("geometry")) {
              const next = new URLSearchParams(search);
              next.delete("bbox");
              next.delete("geometry");
              setSearch(next, { replace: true });
            }
          }}
        />
      )}

      {/* VIEW 2: 25-YEAR ACTIVITY MATRIX */}
      {activeTab === "matrix" && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 max-w-7xl mx-auto w-full">
          <CalendarKpis
            data={data}
            aoi={aoi}
            appliedAoi={applied.aoi}
            totalObserved={totalObserved}
            totalModis={totalModis}
            totalViirs={totalViirs}
            totalHarmonized={totalHarmonized}
            criticalCount={criticalCount}
            delayLine={delayLine}
            yearly={yearly}
            onViewOnMap={() => setActiveTab("map")}
            onSelectPeriod={(ym) => {
              setMapPeriod(ym);
              setActiveTab("map");
            }}
          />

          <CalendarMatrix
            data={data}
            activeMonth={activeMonth}
            monthEvidence={monthEvidence}
            methodShown={methodShown}
            matrixMode={matrixMode}
            onMatrixModeChange={setMatrixMode}
            paletteMode={paletteMode}
            onPaletteModeChange={setPaletteMode}
            onSelectMonth={(m) => setActiveMonth(m)}
            onCloseMonth={() => setActiveMonth(null)}
            onPreviewPeriod={(ym) => setMapPeriod(ym)}
            onLaunchMap={(ym) => {
              setMapPeriod(ym);
              setActiveTab("map");
            }}
            onExplainAi={(ym) => {
              setMapPeriod(ym);
              setActiveTab("map");
              setDockTab("ai");
              setDockOpen(true);
            }}
            onOpenMap={() => setActiveTab("map")}
          />

          <Footer />
        </div>
      )}

      {/* VIEW 3: BENCHMARK SCENARIOS */}
      {activeTab === "scenarios" && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 max-w-6xl mx-auto w-full">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-white">
              {t("scenarios.section_title")}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              {t("scenarios.section_desc")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SCENARIO_PRESETS.map((sc) => {
              const titleKey = `scenarios.${sc.id.replace(/-/g, "_")}_title`;
              const descKey = `scenarios.${sc.id.replace(/-/g, "_")}_desc`;
              return (
                <div
                  key={sc.id}
                  data-fh-card-link
                  onClick={() => handleSelectScenario(sc)}
                  className="cursor-pointer rounded-2xl border border-slate-800 bg-slate-950/80 p-5 space-y-3 hover:border-cyan-500/50 hover:bg-slate-900/60 transition-colors duration-150 group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-cyan-400 uppercase">
                      {sc.aoi} • {sc.year}-{String(sc.month).padStart(2, "0")}
                    </span>
                    <Zap className="h-4 w-4 text-amber-400 group-hover:scale-110 transition-transform" />
                  </div>
                  <h3 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                    {t(titleKey)}
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {t(descKey)}
                  </p>
                  <div className="pt-2 flex items-center justify-between text-xs text-cyan-400 font-semibold">
                    <span>{t("scenarios.load_btn")}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <Footer />
        </div>
      )}

    </div>
  );
}
