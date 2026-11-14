import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BookmarkPlus,
  CalendarDays,
  ChevronDown,
  Download,
  Globe,
  Loader2,
  Printer,
  Radio,
  ScanEye,
  Sparkles,
  Table as TableIcon,
  X,
  Zap,
} from "lucide-react";
import { api, describeError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { backendMethod, useResearchContext, type AoiId } from "@/lib/researchContext";
import {
  useCalendarData,
  AOI_BBOX,
  LIVE_FOCUS_BBOX,
  AOI_CENTER,
  DEFAULT_AOI_CENTER,
  WORLD_CENTER,
  apiDetailMessage,
  parseBboxNumbers,
  type AppliedFilters,
} from "@/hooks/useCalendarData";
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
import { notifyAlert, notifyToast, promptExtendDays, promptLiveDateRange } from "@/lib/notify";
import { cn, compact } from "@/lib/utils";

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
  // Start at a neutral world-center view unless an AOI/bbox/geometry/dataset was explicitly requested
  const [hasExplicitRegion, setHasExplicitRegion] = useState<boolean>(() =>
    Boolean(search.get("aoi") || search.get("bbox") || search.get("geometry") || search.get("dataset")),
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!actionsOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [actionsOpen]);
  // P2: manifest `date_range` per AOI from data-status; null = still pending.
  const [manifestRanges, setManifestRanges] = useState<Record<string, [string, string] | null> | null>(null);

  // P0-05: one validated range for calendar, map, export and evidence.
  const [rangePreset, setRangePreset] = useState<RangePreset>(
    search.get("from") || search.get("to") ? "custom" : "all",
  );
  const [fromDate, setFromDate] = useState<string>(search.get("from") || "");
  const [toDate, setToDate] = useState<string>(search.get("to") || "");

  const MAX_LIVE_DAYS = 31;
  const MAX_HYBRID_DAYS = 62;
const MAX_LIVE_BBOX_SPAN_DEG = 20;
const MAX_LIVE_BBOX_AREA_DEG2 = 150;

function isoDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function diffDaysInclusive(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}

function shiftIsoDate(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
  const [, setBbox] = useState<string>(search.get("bbox") || (AOI_BBOX[aoi] ?? AOI_BBOX.vietnam));
  const [fetchingLive, setFetchingLive] = useState(false);
  const [liveFromDate, setLiveFromDate] = useState<string>(() => search.get("from") || isoDaysAgo(4));
  const [liveToDate, setLiveToDate] = useState<string>(() => search.get("to") || isoDaysAgo(0));
  const [liveFetchError, setLiveFetchError] = useState<string | null>(null);

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
    bbox: search.get("bbox") || (AOI_BBOX[search.get("aoi") || aoi] ?? AOI_BBOX.vietnam),
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
  } = useCalendarData({ applied, activeTab, mapPeriod, activeMonth, enabled: hasExplicitRegion, t });
  const { periods, availableDays, activeDays, mapCells, mapPreview, yearly, scrubberYears } = useMapPeriod({
    data,
    monthCells,
    mapMeta,
    mapPeriod,
    setMapPeriod,
    fromDate: applied.from_date,
    toDate: applied.to_date,
  });
  const { exporting, exportErr, handleExport } = useCalendarExport({ applied });

  const todayIso = isoDaysAgo(0);
  const curTimelineFrom = applied.from_date || availableDays[0] || liveFromDate;
  const curTimelineTo = applied.to_date || availableDays[availableDays.length - 1] || liveToDate;
  const maxTimelineTotal = applied.data !== "raw" ? MAX_HYBRID_DAYS : MAX_LIVE_DAYS;
  const timelineSpan = Math.max(1, diffDaysInclusive(curTimelineFrom, curTimelineTo));
  const remainingTimelineBudget = Math.max(0, maxTimelineTotal - timelineSpan);
  const canExtendLeft = Boolean(hasExplicitRegion && remainingTimelineBudget > 0 && curTimelineFrom > "2001-01-01");
  const canExtendRight = Boolean(hasExplicitRegion && remainingTimelineBudget > 0 && curTimelineTo < todayIso);

  const prevFeed = useRef(dataFeed);
  useEffect(() => {
    if (mode === "explore") {
      if (method !== "k_ratio") setMethod("k_ratio");
      if (activeTab === "scenarios") setActiveTab("map");
      setApplied((prev) =>
        prev.method !== "stat" || prev.qa_min !== "all" || prev.platform_set !== "all"
          ? { ...prev, method: "stat", qa_min: "all", platform_set: "all" }
          : prev,
      );
    }
  }, [mode, method, activeTab, setMethod]);

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
  // functional update avoids clobbering concurrent ResearchContext updates.
  useEffect(() => {
    setSearch((prev) => {
      const next = new URLSearchParams(prev);
      if (hasExplicitRegion) next.set("aoi", applied.aoi); else next.delete("aoi");
      if (applied.data !== "raw" || prev.has("data")) next.set("data", applied.data); else next.delete("data");
      if (applied.qa_min !== "all" || prev.has("qa_min")) next.set("qa_min", applied.qa_min); else next.delete("qa_min");
      if (applied.platform_set !== "all" || prev.has("platform_set")) next.set("platform_set", applied.platform_set); else next.delete("platform_set");
      if (applied.source_type !== "all") next.set("source_type", applied.source_type); else next.delete("source_type");
      if (applied.dataset) next.set("dataset", applied.dataset); else next.delete("dataset");
      if (applied.from_date) next.set("from", applied.from_date); else next.delete("from");
      if (applied.to_date) next.set("to", applied.to_date); else next.delete("to");
      const defaultAoiBbox = AOI_BBOX[applied.aoi] ?? "";
      if (applied.bbox && applied.bbox !== defaultAoiBbox) next.set("bbox", applied.bbox); else next.delete("bbox");
      if (applied.geometry) next.set("geometry", applied.geometry); else next.delete("geometry");
      if (mapPeriod !== "all") next.set("ym", mapPeriod); else next.delete("ym");
      return next.toString() !== prev.toString() ? next : prev;
    }, { replace: true });
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

  const handleSelectAoi = async (newAoi: string) => {
    const inSampleCatalog = applied.data !== "raw" && PRESET_AOI_IDS.has(newAoi);
    const b = (inSampleCatalog
      ? AOI_BBOX[newAoi]
      : (LIVE_FOCUS_BBOX[newAoi] ?? AOI_BBOX[newAoi])) ?? "";
    const nums = parseBboxNumbers(b);
    if (!nums) {
      setHasExplicitRegion(true);
      setAoi(newAoi as AoiId);
      setBbox(b);
      setMapPeriod("all");
      setApplied({
        ...applied,
        aoi: newAoi,
        bbox: b,
        geometry: null,
        dataset: undefined,
      });
      return;
    }
    const dlon = nums[2] - nums[0];
    const dlat = nums[3] - nums[1];
    const maxDays = inSampleCatalog ? MAX_HYBRID_DAYS : MAX_LIVE_DAYS;
    if (!inSampleCatalog && (dlon > MAX_LIVE_BBOX_SPAN_DEG || dlat > MAX_LIVE_BBOX_SPAN_DEG || dlon * dlat > MAX_LIVE_BBOX_AREA_DEG2)) {
      await notifyAlert({
        icon: "warning",
        title: t("calendar.live_guard_title"),
        text: t("calendar.live_bbox_too_large", { span: MAX_LIVE_BBOX_SPAN_DEG, area: MAX_LIVE_BBOX_AREA_DEG2 }),
      });
      return;
    }
    const picked = await promptLiveDateRange({
      title: t("calendar.live_prompt_title"),
      subtitle: inSampleCatalog
        ? t("calendar.hybrid_prompt_subtitle", {
            dlon: dlon.toFixed(1),
            dlat: dlat.toFixed(1),
            max: MAX_HYBRID_DAYS,
            liveMax: MAX_LIVE_DAYS,
          })
        : t("calendar.live_prompt_subtitle", {
            dlon: dlon.toFixed(1),
            dlat: dlat.toFixed(1),
            area: (dlon * dlat).toFixed(1),
            max: MAX_LIVE_DAYS,
          }),
      fromLabel: t("calendar.from_label"),
      toLabel: t("calendar.to_label"),
      confirmText: t("calendar.live_prompt_confirm"),
      cancelText: t("common.cancel"),
      initialFrom: liveFromDate,
      initialTo: liveToDate,
      maxDate: isoDaysAgo(0),
      maxDays,
      invalidRangeError: t("calendar.live_range_invalid"),
      tooLongError: t("calendar.live_range_too_long", { max: maxDays }),
    });
    if (!picked) return;
    setBbox(b);
    setLiveFromDate(picked.from);
    setLiveToDate(picked.to);
    await handleFetchLiveFirms(b, null, newAoi as AoiId, picked.from, picked.to);
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
      dataset: undefined,
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
    setMapPeriod("all");
    setApplied((prev) => ({
      ...prev,
      aoi: c.baseAoi,
      bbox: c.bbox,
      geometry: c.geometry,
      dataset: undefined,
    }));
  };

  const handleDeleteCustomAoi = async (id: string) => {
    setHiddenCustomIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setAoiProbes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (applied.aoi === id) {
      setAoi("vietnam");
      setBbox(AOI_BBOX.vietnam ?? "");
      setHasExplicitRegion(false);
      setApplied((prev) => ({
        ...prev,
        aoi: "vietnam",
        bbox: AOI_BBOX.vietnam ?? "",
        geometry: null,
        dataset: undefined,
      }));
    }
    try {
      await api.deleteAoi(id);
      setCustomAois((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // Fall back gracefully if offline or 404 (entry stays hidden for this session)
    }
  };

  const findOverlappingPreset = (nums: [number, number, number, number]): AoiId | null => {
    for (const [id, boxStr] of Object.entries(AOI_BBOX)) {
      const ab = parseBboxNumbers(boxStr);
      if (!ab) continue;
      if (!(nums[2] < ab[0] || nums[0] > ab[2] || nums[3] < ab[1] || nums[1] > ab[3])) {
        return id as AoiId;
      }
    }
    return null;
  };

  const liveSpanDays = diffDaysInclusive(liveFromDate, liveToDate);

  const handleFetchLiveFirms = async (
    overrideBbox?: string,
    overrideGeom?: string | null,
    overrideAoi?: AoiId,
    overrideFrom?: string,
    overrideTo?: string,
  ) => {
    if (fetchingLive) return;
    const targetBbox = overrideBbox ?? applied.bbox;
    const nums = parseBboxNumbers(targetBbox);
    if (!nums) {
      setLiveFetchError(t("calendar.coord_invalid"));
      return;
    }
    const dlon = nums[2] - nums[0];
    const dlat = nums[3] - nums[1];
    if (dlon <= 0 || dlat <= 0) {
      setLiveFetchError(t("calendar.coord_invalid"));
      return;
    }
    const useSampleMode = applied.data !== "raw";
    const effectiveMaxDays = useSampleMode ? MAX_HYBRID_DAYS : MAX_LIVE_DAYS;
    if (!useSampleMode && (dlon > MAX_LIVE_BBOX_SPAN_DEG || dlat > MAX_LIVE_BBOX_SPAN_DEG || dlon * dlat > MAX_LIVE_BBOX_AREA_DEG2)) {
      void notifyAlert({
        icon: "warning",
        title: t("calendar.live_guard_title"),
        text: t("calendar.live_bbox_too_large", { span: MAX_LIVE_BBOX_SPAN_DEG, area: MAX_LIVE_BBOX_AREA_DEG2 }),
      });
      return;
    }

    const targetFrom = overrideFrom ?? liveFromDate;
    const targetTo = overrideTo ?? liveToDate;
    const todayIso = isoDaysAgo(0);
    const span = diffDaysInclusive(targetFrom, targetTo);
    if (!targetFrom || !targetTo || span < 1 || targetFrom > todayIso) {
      void notifyAlert({
        icon: "warning",
        title: t("calendar.live_guard_title"),
        text: t("calendar.live_range_invalid"),
      });
      return;
    }
    if (span > effectiveMaxDays) {
      void notifyAlert({
        icon: "warning",
        title: t("calendar.live_guard_title"),
        text: t("calendar.live_range_too_long", { max: effectiveMaxDays }),
      });
      return;
    }

    setFetchingLive(true);
    setLiveFetchError(null);
    try {
      const res = await api.fetchLiveFirms({
        bbox: nums,
        from_date: targetFrom,
        to_date: targetTo,
        aoi: overrideAoi ?? applied.aoi,
        use_sample: useSampleMode,
      });
      setHasExplicitRegion(true);
      setEmptyFilter(null);
      setModelConflict(null);
      setMapPeriod("all");
      setLiveFromDate(targetFrom);
      setLiveToDate(targetTo);
      if (method !== "k_ratio") setMethod("k_ratio");
      notifyToast({
        icon: res.rows > 0 ? "success" : "info",
        title: res.cached
          ? t("calendar.fetch_live_cached", { n: res.rows })
          : t("calendar.fetch_live_done", { n: res.rows }),
        text: t("calendar.fetch_live_detail", {
          from: targetFrom,
          to: targetTo,
          sources: res.sources_fetched.join(", ") || "NASA FIRMS",
        }),
        timer: 6500,
      });
      setApplied((prev) => ({
        ...prev,
        aoi: overrideAoi ?? prev.aoi,
        bbox: targetBbox,
        geometry: overrideGeom !== undefined ? overrideGeom : prev.geometry,
        from_date: targetFrom,
        to_date: targetTo,
        dataset: res.dataset,
        method: "stat",
      }));
    } catch (e) {
      const msg = apiDetailMessage(e) ?? (e instanceof Error ? e.message : describeError(e));
      setLiveFetchError(msg);
      void notifyAlert({
        icon: "warning",
        title: t("calendar.live_guard_title"),
        text: msg,
      });
    } finally {
      setFetchingLive(false);
    }
  };

  const selectWorldBbox = async (b: string, geom?: string | null) => {
    const nums = parseBboxNumbers(b);
    if (!nums) {
      setLiveFetchError(t("calendar.coord_invalid"));
      return;
    }
    const dlon = nums[2] - nums[0];
    const dlat = nums[3] - nums[1];
    if (dlon <= 0 || dlat <= 0) {
      setLiveFetchError(t("calendar.coord_invalid"));
      return;
    }

    const matched = findOverlappingPreset(nums);
    const targetAoi: AoiId = matched ?? "custom";
    const inSampleCatalog = applied.data !== "raw" && Boolean(matched);
    const maxDays = inSampleCatalog ? MAX_HYBRID_DAYS : MAX_LIVE_DAYS;

    if (!inSampleCatalog && (dlon > MAX_LIVE_BBOX_SPAN_DEG || dlat > MAX_LIVE_BBOX_SPAN_DEG || dlon * dlat > MAX_LIVE_BBOX_AREA_DEG2)) {
      await notifyAlert({
        icon: "warning",
        title: t("calendar.live_guard_title"),
        text: t("calendar.live_bbox_too_large", { span: MAX_LIVE_BBOX_SPAN_DEG, area: MAX_LIVE_BBOX_AREA_DEG2 }),
      });
      return;
    }

    const picked = await promptLiveDateRange({
      title: t("calendar.live_prompt_title"),
      subtitle: inSampleCatalog
        ? t("calendar.hybrid_prompt_subtitle", {
            dlon: dlon.toFixed(1),
            dlat: dlat.toFixed(1),
            max: MAX_HYBRID_DAYS,
            liveMax: MAX_LIVE_DAYS,
          })
        : t("calendar.live_prompt_subtitle", {
            dlon: dlon.toFixed(1),
            dlat: dlat.toFixed(1),
            area: (dlon * dlat).toFixed(1),
            max: MAX_LIVE_DAYS,
          }),
      fromLabel: t("calendar.from_label"),
      toLabel: t("calendar.to_label"),
      confirmText: t("calendar.live_prompt_confirm"),
      cancelText: t("common.cancel"),
      initialFrom: liveFromDate,
      initialTo: liveToDate,
      maxDate: isoDaysAgo(0),
      maxDays,
      invalidRangeError: t("calendar.live_range_invalid"),
      tooLongError: t("calendar.live_range_too_long", { max: maxDays }),
    });
    if (!picked) return;

    setBbox(b);
    setLiveFromDate(picked.from);
    setLiveToDate(picked.to);
    await handleFetchLiveFirms(b, geom ?? null, targetAoi, picked.from, picked.to);
  };

  const handleOpenCustomFetch = async () => {
    if (fetchingLive) return;
    const nums = parseBboxNumbers(applied.bbox);
    if (!hasExplicitRegion || !nums) {
      notifyToast({ icon: "info", title: t("calendar.world_explorer_title") });
      return;
    }
    const dlon = nums[2] - nums[0];
    const dlat = nums[3] - nums[1];
    if (dlon > MAX_LIVE_BBOX_SPAN_DEG || dlat > MAX_LIVE_BBOX_SPAN_DEG || dlon * dlat > MAX_LIVE_BBOX_AREA_DEG2) {
      await notifyAlert({
        icon: "warning",
        title: t("calendar.live_guard_title"),
        text: t("calendar.live_bbox_too_large", { span: MAX_LIVE_BBOX_SPAN_DEG, area: MAX_LIVE_BBOX_AREA_DEG2 }),
      });
      return;
    }
    const picked = await promptLiveDateRange({
      title: t("calendar.live_prompt_title"),
      subtitle: t("calendar.live_prompt_subtitle", {
        dlon: dlon.toFixed(1),
        dlat: dlat.toFixed(1),
        area: (dlon * dlat).toFixed(1),
        max: MAX_LIVE_DAYS,
      }),
      fromLabel: t("calendar.from_label"),
      toLabel: t("calendar.to_label"),
      confirmText: t("calendar.live_prompt_confirm"),
      cancelText: t("common.cancel"),
      initialFrom: liveFromDate,
      initialTo: liveToDate,
      maxDate: isoDaysAgo(0),
      maxDays: MAX_LIVE_DAYS,
      invalidRangeError: t("calendar.live_range_invalid"),
      tooLongError: t("calendar.live_range_too_long", { max: MAX_LIVE_DAYS }),
    });
    if (picked) {
      setLiveFromDate(picked.from);
      setLiveToDate(picked.to);
      await handleFetchLiveFirms(applied.bbox, applied.geometry, undefined, picked.from, picked.to);
    }
  };

  const handleExtendRange = async (direction: "left" | "right") => {
    if (fetchingLive) return;
    const nums = parseBboxNumbers(applied.bbox);
    if (!hasExplicitRegion || !nums) {
      notifyToast({ icon: "info", title: t("calendar.world_explorer_title") });
      return;
    }
    const todayIso = isoDaysAgo(0);
    const curFrom = applied.from_date || availableDays[0] || liveFromDate;
    const curTo = applied.to_date || availableDays[availableDays.length - 1] || liveToDate;
    const maxTotal = applied.data !== "raw" ? MAX_HYBRID_DAYS : MAX_LIVE_DAYS;
    const currentSpan = Math.max(1, diffDaysInclusive(curFrom, curTo));
    const remainingBudget = Math.max(0, maxTotal - currentSpan);

    let maxAdd = remainingBudget;
    if (direction === "right") {
      if (curTo >= todayIso) {
        notifyToast({ icon: "info", title: t("calendar.extend_already_today") });
        return;
      }
      const daysUntilToday = Math.max(0, diffDaysInclusive(curTo, todayIso) - 1);
      maxAdd = Math.min(remainingBudget, daysUntilToday);
    }

    if (maxAdd <= 0) {
      notifyToast({ icon: "info", title: t("calendar.extend_budget_exhausted", { maxTotal }) });
      return;
    }

    const addDays = await promptExtendDays({
      title: direction === "left" ? t("calendar.extend_prompt_title_left") : t("calendar.extend_prompt_title_right"),
      subtitle: t("calendar.extend_prompt_subtitle", {
        from: curFrom,
        to: curTo,
        span: currentSpan,
        maxAdd,
        maxTotal,
      }),
      daysLabel: t("calendar.extend_days_label"),
      maxAdd,
      defaultDays: Math.min(5, maxAdd),
      confirmText: t("calendar.live_prompt_confirm"),
      cancelText: t("common.cancel"),
      invalidError: t("calendar.extend_days_invalid", { maxAdd }),
    });
    if (!addDays) return;

    const nextFrom = direction === "left" ? shiftIsoDate(curFrom, -addDays) : curFrom;
    const nextTo = direction === "right" ? shiftIsoDate(curTo, addDays) : curTo;
    setLiveFromDate(nextFrom);
    setLiveToDate(nextTo);
    await handleFetchLiveFirms(applied.bbox, applied.geometry, undefined, nextFrom, nextTo);
  };

  const handleMissingPeriodClick = async (period: string) => {
    if (fetchingLive) return;
    if (!hasExplicitRegion || !parseBboxNumbers(applied.bbox)) {
      notifyToast({ icon: "info", title: t("calendar.world_explorer_title") });
      return;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
      const curFrom = applied.from_date || availableDays[0] || liveFromDate;
      const curTo = applied.to_date || availableDays[availableDays.length - 1] || liveToDate;
      if (period < curFrom) {
        await handleExtendRange("left");
        return;
      }
      if (period > curTo) {
        await handleExtendRange("right");
        return;
      }
    }
    const todayIso = isoDaysAgo(0);
    let fetchFrom = period;
    let fetchTo = period;
    if (/^\d{4}-\d{2}$/.test(period)) {
      const [yStr, mStr] = period.split("-");
      const y = Number(yStr);
      const m = Number(mStr);
      fetchFrom = `${period}-01`;
      const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      fetchTo = monthEnd > todayIso ? todayIso : monthEnd;
    }
    if (fetchFrom > todayIso) {
      await notifyAlert({
        icon: "warning",
        title: t("calendar.live_guard_title"),
        text: t("calendar.missing_period_future", { period }),
      });
      return;
    }
    const ans = await notifyAlert({
      icon: "question",
      title: t("calendar.missing_period_title", { period }),
      text: t("calendar.missing_period_ask", { from: fetchFrom, to: fetchTo }),
      showCancelButton: true,
      confirmButtonText: t("calendar.live_prompt_confirm"),
      cancelButtonText: t("common.cancel"),
    });
    if (ans.isConfirmed) {
      setLiveFromDate(fetchFrom);
      setLiveToDate(fetchTo);
      await handleFetchLiveFirms(applied.bbox, applied.geometry, undefined, fetchFrom, fetchTo);
    }
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

  // Empty-filter recovery: return cleanly to the center of the world map
  // instead of forcing Vietnam.
  const clearRestrictiveFilters = () => {
    setHasExplicitRegion(false);
    setAoi("vietnam");
    const defBbox = AOI_BBOX.vietnam ?? "";
    setBbox(defBbox);
    setActiveZone(null);
    setEmptyFilter(null);
    setRangePreset("all");
    setMapPeriod("all");
    setFromDate("");
    setToDate("");
    setApplied((prev) => ({
      ...prev,
      aoi: "vietnam",
      bbox: defBbox,
      geometry: null,
      from_date: null,
      to_date: null,
      dataset: undefined,
    }));
    const next = new URLSearchParams(search);
    next.delete("aoi");
    next.delete("bbox");
    next.delete("geometry");
    next.delete("from");
    next.delete("to");
    next.delete("dataset");
    next.delete("ym");
    if (next.toString() !== search.toString()) {
      setSearch(next, { replace: true });
    }
  };

  // SweetAlert2 notifications: keep UI free of space-hogging inline banners.
  useEffect(() => {
    if (!liveFetchError) return;
    notifyToast({ icon: "error", title: liveFetchError });
    setLiveFetchError(null);
  }, [liveFetchError]);

  useEffect(() => {
    if (!exportErr) return;
    notifyToast({ icon: "error", title: exportErr });
  }, [exportErr]);

  useEffect(() => {
    if (!saveError) return;
    notifyToast({ icon: "error", title: saveError });
    setSaveError(null);
  }, [saveError]);

  useEffect(() => {
    if (!mapError) return;
    notifyToast({ icon: "error", title: `${t("calendar.map_cells_error")}: ${mapError}` });
  }, [mapError, t]);

  const lastStatForcedKey = useRef<string | null>(null);
  useEffect(() => {
    const showStatForced = statForced && applied.aoi !== "custom" && !applied.dataset?.startsWith("live:");
    if (!showStatForced) {
      lastStatForcedKey.current = null;
      return;
    }
    const key = `${applied.aoi}|${requestedMethod}|${servingMethod}`;
    if (lastStatForcedKey.current === key) return;
    lastStatForcedKey.current = key;
    notifyToast({
      icon: "info",
      title: t("calendar.stat_forced_badge", { requested: requestedMethod, serving: servingMethod }),
      timer: 5000,
    });
  }, [statForced, applied.aoi, applied.dataset, requestedMethod, servingMethod, t]);

  const lastZeroFireDataset = useRef<string | null>(null);
  useEffect(() => {
    const isZero = Boolean((data as { live_zero_fires?: boolean } | null)?.live_zero_fires);
    if (!isZero) {
      lastZeroFireDataset.current = null;
      return;
    }
    const key = applied.dataset ?? "live";
    if (lastZeroFireDataset.current === key) return;
    lastZeroFireDataset.current = key;
    notifyToast({
      icon: "info",
      title: t("calendar.live_zero_fires_title"),
      text: t("calendar.live_zero_fires_body"),
      timer: 6500,
    });
  }, [data, applied.dataset, t]);

  useEffect(() => {
    if (!modelConflict) return;
    let active = true;
    void notifyAlert({
      icon: "warning",
      title: t("calendar.conflict_409_title"),
      text: modelConflict.message,
      showCancelButton: true,
      confirmButtonText: t("calendar.conflict_409_retry"),
      cancelButtonText: t("common.close"),
    }).then((res) => {
      if (!active) return;
      if (res.isConfirmed) {
        retryConflictWithStat();
      } else {
        setModelConflict(null);
      }
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelConflict]);

  // A filtered 404 (or an explicitly empty successful response) is not a
  // missing NASA feed. Keep the map available and expose local recovery
  // actions without forcing a blocking alert dialog.
  const emptyFilterBanner = emptyFilter ? (
    <div
      data-testid="empty-filter-banner"
      role="status"
      className="pointer-events-auto rounded-xl border border-amber-500/40 bg-[#0B1220]/95 p-4 text-sm shadow-2xl backdrop-blur-md"
    >
      <h2 className="font-bold text-amber-200">{t("calendar.empty_filter_title")}</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-200">
        {t("calendar.empty_filter_body")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={clearRestrictiveFilters}
          className="rounded-lg border border-amber-400/50 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/25"
        >
          {t("calendar.clear_filter")}
        </button>
        {parseBboxNumbers(applied.bbox) && (
          <button
            type="button"
            onClick={() => {
              setEmptyFilter(null);
              void handleFetchLiveFirms();
            }}
            className="rounded-lg border border-cyan-500/50 bg-cyan-900 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-800"
          >
            {t("calendar.fetch_live_btn")}
          </button>
        )}
      </div>
    </div>
  ) : null;

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
            onSelect={(b, geom) => selectWorldBbox(b, geom)}
          />
          {emptyFilterBanner && (
            <div className="pointer-events-none absolute inset-x-3 top-3 z-[1400] sm:right-auto sm:w-[min(420px,calc(100%-24px))]">
              {emptyFilterBanner}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (!hasExplicitRegion && !loadingData && !fetchingLive) {
    return (
      <div className="relative flex-1 min-h-0 flex flex-col h-full w-full bg-[#060B13] text-slate-100 overflow-hidden">
        <div className="shrink-0 mx-3 mt-2 rounded-xl border border-slate-800 bg-[#0B1220]/95 px-4 py-3 text-xs space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight">{t("calendar.title")}</h1>
              <p className="text-slate-400 mt-0.5">{t("calendar.world_explorer_hint")}</p>
            </div>
            <div data-tour="calendar-world-presets" className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-400 font-medium mr-1">{t("calendar.guide_presets_label")}</span>
              {(
                [
                  { id: "vietnam", label: "Vietnam (Central Highlands)", bbox: LIVE_FOCUS_BBOX.vietnam },
                  { id: "amazon", label: "Amazon (Mato Grosso)", bbox: LIVE_FOCUS_BBOX.amazon },
                  { id: "australia", label: "Australia (SE Forests)", bbox: LIVE_FOCUS_BBOX.australia },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => selectWorldBbox(preset.bbox)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:border-cyan-500/50 hover:text-cyan-200 transition"
                >
                  {preset.label}
                </button>
              ))}
              <span className="text-slate-500 mx-1">|</span>
              <span className="text-slate-400 font-medium mr-1">{t("calendar.global_live_label")}</span>
              {(
                [
                  { id: "california", key: "calendar.region_california", bbox: "-123.5,36.5,-117.5,41.5" },
                  { id: "mediterranean", key: "calendar.region_mediterranean", bbox: "21.0,36.5,29.5,41.5" },
                  { id: "indonesia", key: "calendar.region_indonesia", bbox: "109.5,-3.5,116.5,2.0" },
                  { id: "central_africa", key: "calendar.region_central_africa", bbox: "16.0,-7.0,24.0,0.0" },
                ] as const
              ).map((reg) => (
                <button
                  key={reg.id}
                  type="button"
                  onClick={() => selectWorldBbox(reg.bbox)}
                  className="rounded-lg border border-orange-500/30 bg-orange-950/30 px-2.5 py-1 text-xs font-semibold text-orange-200 hover:border-orange-400 hover:bg-orange-900/40 transition"
                >
                  {t(reg.key)}
                </button>
              ))}
            </div>
          </div>
          <div data-tour="calendar-world-guide" className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1 border-t border-slate-800/80">
            <div className="rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2">
              <div className="font-semibold text-cyan-300">{t("calendar.guide_step1_title")}</div>
              <p className="text-slate-400 mt-0.5 leading-relaxed">{t("calendar.guide_step1_desc")}</p>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2">
              <div className="font-semibold text-orange-300">{t("calendar.guide_step2_title")}</div>
              <p className="text-slate-400 mt-0.5 leading-relaxed">{t("calendar.guide_step2_desc")}</p>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2">
              <div className="font-semibold text-emerald-300">{t("calendar.guide_step3_title")}</div>
              <p className="text-slate-400 mt-0.5 leading-relaxed">{t("calendar.guide_step3_desc")}</p>
            </div>
          </div>
        </div>
        <div className="relative flex-1 min-h-0 m-3 rounded-2xl overflow-hidden border border-slate-800">
          <AoiMap
            center={WORLD_CENTER}
            zoom={2}
            bbox={null}
            geometry={null}
            hasCustomFilter={false}
            cells={[]}
            preview={null}
            fullBleed={true}
            height="100%"
            hideToolbar={false}
            hideLegend={false}
            onClearBbox={clearRestrictiveFilters}
            onSelect={(b, geom) => selectWorldBbox(b, geom)}
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
          liveScan={fetchingLive}
          label={
            fetchingLive
              ? t("calendar.loading_live_scan")
              : applied.data === "raw"
              ? t("calendar.loading_raw")
              : t("calendar.loading_sample")
          }
          hint={
            fetchingLive
              ? t("calendar.loading_live_scan_hint", { days: Math.max(1, liveSpanDays) })
              : applied.data === "raw"
              ? t("calendar.loading_raw_hint")
              : t("calendar.loading_sample_hint")
          }
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
      {(showLoadingOverlay || fetchingLive) && (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <BackendProgressCard
            aoi={applied.aoi}
            data={applied.data}
            liveScan={fetchingLive}
            label={
              fetchingLive
                ? t("calendar.loading_live_scan")
                : applied.data === "raw"
                ? t("calendar.loading_raw")
                : t("calendar.loading_sample")
            }
            hint={
              fetchingLive
                ? t("calendar.loading_live_scan_hint", { days: Math.max(1, liveSpanDays) })
                : applied.data === "raw"
                ? t("calendar.loading_raw_hint")
                : t("calendar.loading_sample_hint")
            }
            unit={t("calendar.loading_elapsed")}
          />
        </div>
      )}
      {emptyFilterBanner && (
        <div className="pointer-events-none absolute inset-x-3 top-16 z-[1400] sm:right-auto sm:w-[min(420px,calc(100%-24px))]">
          {emptyFilterBanner}
        </div>
      )}
      {/* 1. TOP HEADER & TELEMETRY STRIP */}
      <header className="relative z-[1300] border-b border-slate-800 bg-[#0B1220]/95 backdrop-blur-md px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-1.5 shrink-0">
        <div className="flex min-w-0 items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-cyan-400 shrink-0" />
            <h1 className="whitespace-nowrap text-xs sm:text-sm font-bold text-white tracking-tight">
              {t("calendar.title")}
            </h1>
          </div>

          {/* Mode Badge & Playwright Token */}
          {applied.dataset?.startsWith("live:") ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-orange-500/40 bg-orange-950/40 px-2 py-0.5 text-xs font-mono font-bold text-orange-300">
              <Radio className="h-3 w-3 text-orange-400" />
              {t("calendar.badge_nasa_live")}
            </span>
          ) : applied.dataset ? (
            <span className="rounded-md border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-xs font-mono font-bold text-amber-300">
              {t("calendar.badge_user_upload")}
            </span>
          ) : isSynthetic ? (
            <span className="rounded-md border border-sky-500/40 bg-sky-950/40 px-2 py-0.5 text-xs font-mono font-bold text-sky-300">
              {t("calendar.badge_synthetic_demo")}
            </span>
          ) : (
            <span className="rounded-md border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 text-xs font-mono font-bold text-emerald-300">
              {t("calendar.badge_nasa_observed")}
            </span>
          )}

          {/* Period Selector (hidden when <= 1 month) */}
          {periods.length > 1 && (
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
          )}

          {/* macOS-style Taskbar Dropdown Menu */}
          <div className="relative" ref={actionsMenuRef} data-tour="calendar-actions">
            <button
              type="button"
              onClick={() => setActionsOpen((v) => !v)}
              aria-expanded={actionsOpen}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition min-h-[30px]"
            >
              {fetchingLive ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-400" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
              )}
              <span>{t("calendar.actions_menu")}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform", actionsOpen && "rotate-180")} />
            </button>

            {actionsOpen && (
              <div className="absolute left-0 top-full mt-1.5 z-[1600] w-72 rounded-xl border border-slate-700/80 bg-[#0F172A]/95 backdrop-blur-xl shadow-2xl p-2 text-xs text-slate-200 space-y-2">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {t("calendar.live_days_label")}
                    </span>
                    <span className={cn(
                      "font-mono text-[10px] font-semibold",
                      liveSpanDays < 1 || liveSpanDays > MAX_LIVE_DAYS ? "text-rose-400" : "text-cyan-300",
                    )}>
                      {liveSpanDays > 0 ? `${liveSpanDays}/${MAX_LIVE_DAYS}d` : "--"}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1" role="group" aria-label={t("calendar.live_days_label")}>
                    {[1, 3, 5, 14, 30].map((d) => {
                      const activePreset = liveToDate === isoDaysAgo(0) && liveSpanDays === d;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => {
                            setLiveFromDate(isoDaysAgo(d - 1));
                            setLiveToDate(isoDaysAgo(0));
                          }}
                          className={cn(
                            "rounded-lg py-1 font-mono text-[11px] font-semibold border transition",
                            activePreset
                              ? "border-orange-500/60 bg-orange-500/25 text-orange-200"
                              : "border-slate-700/70 bg-slate-900/80 text-slate-400 hover:text-white",
                          )}
                        >
                          {d}d
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <label className="flex flex-col gap-0.5">
                      <span className="px-0.5 text-[10px] text-slate-400">{t("calendar.from_label")}</span>
                      <input
                        type="date"
                        value={liveFromDate}
                        max={liveToDate || isoDaysAgo(0)}
                        onChange={(e) => setLiveFromDate(e.target.value)}
                        className="rounded-lg border border-slate-700/70 bg-slate-900/90 px-1.5 py-1 font-mono text-[11px] text-slate-100 focus:border-cyan-500 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="px-0.5 text-[10px] text-slate-400">{t("calendar.to_label")}</span>
                      <input
                        type="date"
                        value={liveToDate}
                        min={liveFromDate || undefined}
                        max={isoDaysAgo(0)}
                        onChange={(e) => setLiveToDate(e.target.value)}
                        className="rounded-lg border border-slate-700/70 bg-slate-900/90 px-1.5 py-1 font-mono text-[11px] text-slate-100 focus:border-cyan-500 focus:outline-none"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={fetchingLive || !parseBboxNumbers(applied.bbox)}
                    onClick={() => { setActionsOpen(false); void handleFetchLiveFirms(); }}
                    className="w-full flex items-center justify-center gap-2 rounded-lg border border-orange-500/40 bg-orange-500/15 px-3 py-2 text-orange-200 hover:bg-orange-500/25 transition disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                  >
                    {fetchingLive ? <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-400" /> : <Radio className="h-3.5 w-3.5 text-orange-400" />}
                    <span>{fetchingLive ? t("calendar.fetch_live_loading") : `${t("calendar.fetch_live_btn")} (${liveSpanDays > 0 ? `${liveSpanDays}d` : "--"})`}</span>
                  </button>
                </div>

                <div className="border-t border-slate-800 pt-1.5 space-y-1.5">
                  <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {t("calendar.date_range")}
                  </div>
                  <div className="grid grid-cols-4 gap-1" role="group" aria-label={t("calendar.date_range")}>
                    {(["all", "1m", "12m", "custom"] as RangePreset[]).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => applyRangePreset(preset)}
                        className={cn(
                          "rounded-lg py-1 px-1 text-[11px] font-semibold border transition truncate",
                          rangePreset === preset
                            ? "border-cyan-500/60 bg-cyan-500/20 text-cyan-200"
                            : "border-slate-700/70 bg-slate-900/80 text-slate-400 hover:text-white",
                        )}
                      >
                        {preset === "all" ? "All" : preset === "1m" ? "1m" : preset === "12m" ? "12m" : "Custom"}
                      </button>
                    ))}
                  </div>
                  {rangePreset === "custom" && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="date"
                        value={fromDate}
                        onChange={(e) => setCustomRange(e.target.value, toDate)}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[11px] text-slate-200"
                        aria-label={t("calendar.from_date")}
                      />
                      <input
                        type="date"
                        value={toDate}
                        onChange={(e) => setCustomRange(fromDate, e.target.value)}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[11px] text-slate-200"
                        aria-label={t("calendar.to_date")}
                      />
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-800 pt-1.5 space-y-1">
                  <button
                    type="button"
                    disabled={!hasCustomRegion}
                    onClick={() => { setActionsOpen(false); setShowSaveDialog((v) => !v); }}
                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-800/90 text-emerald-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="font-medium">{t("calendar.save_aoi_btn")}</span>
                  </button>
                  {mode === "research" && (
                    <>
                      <button
                        type="button"
                        disabled={exporting !== null}
                        onClick={() => { setActionsOpen(false); handleExport("cells"); }}
                        className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-800/90 text-slate-200 transition disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5 text-cyan-400" />
                        <span>{exporting === "cells" ? "…" : t("calendar.export_csv")}</span>
                      </button>
                      <button
                        type="button"
                        disabled={exporting !== null}
                        onClick={() => { setActionsOpen(false); handleExport("detections"); }}
                        className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-800/90 text-slate-200 transition disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5 text-slate-400" />
                        <span>{exporting === "detections" ? "…" : t("calendar.export_detections")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActionsOpen(false); window.print(); }}
                        className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-800/90 text-purple-300 transition"
                      >
                        <Printer className="h-3.5 w-3.5 text-purple-400" />
                        <span>{t("calendar.export_print")}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div
            data-testid="loaded-data-status"
            className="hidden md:flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1 whitespace-nowrap text-[11px] text-slate-300 font-mono"
          >
            {summary?.period?.from && (
              <>
                <span className="text-slate-400">{summary.period.from} → {summary.period.to}</span>
                <span className="text-slate-600">|</span>
              </>
            )}
            <span className="text-cyan-300 font-semibold">{compact(totalObserved)} {t("calendar.sensor_detections")}</span>
            <span className="text-slate-600">•</span>
            <span className="text-emerald-300">{mapCells.length} cells</span>
          </div>
        </div>

        {/* View Mode Tabs (Map / Matrix / Scenarios) */}
        <div data-tour="calendar-tabs" className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 p-0.5 text-xs shrink-0 whitespace-nowrap">
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

          {mode === "research" && (
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
          )}
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-tour="calendar-ai-btn"
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

          {mode === "research" && (
          <Link
            to={{ pathname: "/xray", search: search.toString() }}
            className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:text-white transition min-h-[30px]"
          >
            <ScanEye className="h-3.5 w-3.5 text-cyan-400" />
            <span>{t("calendar.xray")}</span>
          </Link>
          )}
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
        </div>
      )}

      {/* P1-02: Research mode reveals provenance/coverage detail; Explore keeps
          the same page without model plumbing. */}
      {mode === "research" && summary && (
        <details className="shrink-0 border-b border-slate-800 bg-[#08101c] px-3 py-1 font-mono text-[11px] text-slate-400">
          <summary className="cursor-pointer select-none text-[11px] font-sans font-medium text-slate-400 hover:text-slate-200 transition">
            {t("calendar.provenance_toggle")}
          </summary>
          <div className="mt-1.5 pb-1 flex flex-wrap gap-x-4 gap-y-1">
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
        </details>
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
          availablePeriods={periods}
          availableDays={availableDays}
          activeDays={activeDays}
          mapPeriod={mapPeriod}
          onSelectPeriod={setMapPeriod}
          onMissingPeriodClick={handleMissingPeriodClick}
          onExtendRange={handleExtendRange}
          canExtendLeft={canExtendLeft}
          canExtendRight={canExtendRight}
          onCustomFetchClick={handleOpenCustomFetch}
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
          daynight={applied.daynight ?? "all"}
          onSelectDaynight={(val) => setApplied((prev) => ({ ...prev, daynight: val }))}
          minFrp={applied.min_frp ?? 0}
          onSelectMinFrp={(val) => setApplied((prev) => ({ ...prev, min_frp: val }))}
          onResetFilters={() =>
            setApplied((prev) => ({
              ...prev,
              source_type: "all",
              qa_min: "all",
              platform_set: "all",
              daynight: "all",
              min_frp: 0,
            }))
          }
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
          onSelectBbox={(b, geom) => selectWorldBbox(b, geom)}
          onClearBbox={clearRestrictiveFilters}
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
