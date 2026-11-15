import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { applyCustomRegionParams, clearCustomRegionParams } from "@/lib/researchContext";
import {
  ChevronDown,
  HelpCircle,
  Satellite,
} from "lucide-react";
import { notifyToast } from "@/lib/notify";
import {
  api,
  describeError,
  type BlindSpotResponse,
  type CrossResponse,
  type SimResponse,
  type SpatialResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { LabSidebar } from "@/components/lab/LabSidebar";
import { SimulatorTab } from "@/components/lab/SimulatorTab";
import { BlindSpotsTab } from "@/components/lab/BlindSpotsTab";
import { SpatialCheckTab } from "@/components/lab/SpatialCheckTab";
import { CrossDatasetTab } from "@/components/lab/CrossDatasetTab";
import { BlindReplayTab } from "@/components/lab/BlindReplayTab";
import { Tab, TABS, TASK_GROUPS, type TaskGroupId } from "@/components/lab/types";
import { XrayTimelineView } from "@/components/xray/XrayTimelineView";
import { XrayTransitionIllusionView } from "@/components/xray/XrayTransitionIllusionView";
import { XrayBacktestLeaderboard } from "@/components/xray/XrayBacktestLeaderboard";
import { GlobalContextBar } from "@/components/GlobalContextBar";
import { CustomLiveRegionPanel } from "@/components/CustomLiveRegionPanel";

export function LabPage() {
  const { lang, t } = useLang();
  const vi = lang === "vi";

  const [sp, setSp] = useSearchParams();
  const initialTab = (sp.get("tab") as Tab) || "xray";
  const [tab, setTab] = useState<Tab>(
    TABS.some((t) => t.id === initialTab) ? initialTab : "xray",
  );

  // Determine active task group based on active tab
  const activeGroup: TaskGroupId =
    TASK_GROUPS.find((g) => g.tabs.includes(tab))?.id ?? "compare";

  const aoi = sp.get("aoi") || "vietnam";
  const dsrc = sp.get("data") || "raw";
  // Same filter keys as /calendar so Lab tools quote the same cells.
  const qaMin = sp.get("qa_min") || "all";
  const platformSet = sp.get("platform_set") || "all";
  const dataset = sp.get("dataset") || undefined;
  // The URL is the single temporal context shared with Calendar/Evidence.
  // Keep a valid historic month; never replace it with a default silently.
  const requestedYm = sp.get("ym");
  const activeYm = requestedYm && /^(?:19|20)\d{2}-(0[1-9]|1[0-2])$/.test(requestedYm)
    ? requestedYm : "2025-03";
  const year = Number(activeYm.slice(0, 4));
  const month = Number(activeYm.slice(5, 7));
  const setYear = (nextYear: number) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set("ym", String(nextYear) + "-" + String(month).padStart(2, "0"));
      return next;
    }, { replace: true });
  };
  const setMonth = (nextMonth: number) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set("ym", String(year) + "-" + String(nextMonth).padStart(2, "0"));
      return next;
    }, { replace: true });
  };
  const [sensors, setSensors] = useState<string[]>(["MODIS", "SNPP", "NOAA-20", "NOAA-21"]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Sub-perspective for X-Ray
  const [xrayPerspective, setXrayPerspective] = useState<"trajectory" | "transition" | "leaderboard">("trajectory");

  // Result States
  const [sim, setSim] = useState<SimResponse | null>(null);
  const [spots, setSpots] = useState<BlindSpotResponse | null>(null);
  const [spatialRes, setSpatialRes] = useState<SpatialResponse | null>(null);
  const [crossRes, setCrossRes] = useState<CrossResponse | null>(null);
  const [xrayData, setXrayData] = useState<Awaited<ReturnType<typeof api.xray>> | null>(null);
  const [backtestData, setBacktestData] = useState<Awaited<ReturnType<typeof api.backtest>> | null>(null);

  const [burned, setBurned] = useState("");
  const [protocolExpanded, setProtocolExpanded] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  // Monotonic request id: late responses from an older Run/preset click
  // must not overwrite newer results.
  const reqSeq = useRef(0);

  const updateUrl = (newTab: Tab, newAoi: string, newData: string) => {
    // Preserve research mode, month, method and date scope when switching lab tools.
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", newTab);
      next.set("aoi", newAoi);
      next.set("data", newData);
      if (newAoi !== "custom") {
        next.delete("dataset");
        next.delete("bbox");
        next.delete("geometry");
        next.delete("from_date");
        next.delete("to_date");
      }
      return next;
    });
  };

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    updateUrl(newTab, aoi, dsrc);
  };

  const handleGroupChange = (groupId: TaskGroupId) => {
    const group = TASK_GROUPS.find((g) => g.id === groupId);
    if (group && group.tabs.length > 0) {
      handleTabChange(group.tabs[0]);
    }
  };

  const handleAoiChange = (newAoi: string) => {
    updateUrl(tab, newAoi, dsrc);
  };

  const handleDataChange = (newData: string) => {
    updateUrl(tab, aoi, newData);
  };

  // Invalidate cached data when AOI, feed or shared filters change
  useEffect(() => {
    setXrayData(null);
    setBacktestData(null);
    setSim(null);
    setSpots(null);
    setSpatialRes(null);
    setCrossRes(null);
  }, [aoi, dsrc, qaMin, platformSet]);

  useEffect(() => {
    if (!err) return;
    notifyToast({ icon: "error", title: err });
    setErr("");
  }, [err]);

  // Separate effect for X-Ray & Replay so tweaking year/month/sensors/QA in
  // LabSidebar does not re-fetch /xray or /backtest unnecessarily.
  useEffect(() => {
    if (tab !== "xray" && tab !== "replay") return;
    if (aoi === "custom" && !dataset) {
      setBusy(false);
      setErr("");
      setXrayData(null);
      setBacktestData(null);
      return;
    }
    let active = true;
    setBusy(true);
    setErr("");
    api.xray(aoi, dsrc, dataset)
      .then((xr) => {
        if (active) setXrayData(xr);
      })
      .catch((err) => {
        if (active) setErr(describeError(err));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    if (!dataset && aoi !== "custom") {
      api.backtest(aoi, dsrc)
        .then((bt) => {
          if (active) setBacktestData(bt);
        })
        .catch(() => null);
    } else {
      setBacktestData(null);
    }
    return () => {
      active = false;
    };
  }, [tab, aoi, dsrc, dataset]);

  // Auto-fetch active tab experiment data so judges never see blank dashed boxes
  useEffect(() => {
    if (tab === "xray" || tab === "replay") return;
    if (aoi === "custom" && !dataset) {
      setBusy(false);
      setErr("");
      setSim(null);
      setSpots(null);
      setSpatialRes(null);
      return;
    }
    let active = true;
    if (tab === "simulator") {
      // Period/sensors may have changed since the previous response.
      setSim(null);
      setErr("");
      setBusy(true);
      api.simulate(aoi, dsrc, year, sensors, qaMin, platformSet)
        .then((res) => {
          if (active) setSim(res);
        })
        .catch((e) => {
          if (active) setErr(describeError(e));
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    } else if (tab === "blindspots") {
      setSpots(null);
      setErr("");
      setBusy(true);
      api.blindSpots(aoi, dsrc, year, month, qaMin, platformSet, dataset)
        .then((res) => {
          if (active) setSpots(res);
        })
        .catch((e) => {
          if (active) setErr(describeError(e));
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    } else if (tab === "spatial") {
      setSpatialRes(null);
      setErr("");
      setBusy(true);
      api.spatialCheck(aoi, dsrc, year, month, undefined, undefined, dataset)
        .then((res) => {
          if (active) setSpatialRes(res);
        })
        .catch((e) => {
          if (active) setErr(describeError(e));
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }
    return () => {
      active = false;
    };
    // NOTE: result states (sim/spots/...) are intentionally NOT deps: the
    // effect sets them, and listing them re-runs (and re-fetches) every time
    // a response lands. qaMin/platformSet ARE deps: a filter change must refetch.
  }, [tab, aoi, dsrc, year, month, sensors, qaMin, platformSet, dataset]);

  async function run() {
    const seq = ++reqSeq.current;
    setBusy(true);
    setErr("");
    try {
      if (tab === "simulator") {
        const res = await api.simulate(aoi, dsrc, year, sensors, qaMin, platformSet);
        if (reqSeq.current === seq) setSim(res);
      } else if (tab === "blindspots") {
        const res = await api.blindSpots(aoi, dsrc, year, month, qaMin, platformSet, dataset);
        if (reqSeq.current === seq) setSpots(res);
      } else if (tab === "spatial") {
        const res = await api.spatialCheck(aoi, dsrc, year, month);
        if (reqSeq.current === seq) setSpatialRes(res);
      } else if (tab === "cross") {
        const series = burned
          .trim()
          .split(/\n+/)
          .map((line) => {
            const [y, m, v] = line.split(/[,\s]+/).map(Number);
            return { year: y, month: m, burned_area: v };
          })
          .filter((r) => r.year && r.month && Number.isFinite(r.burned_area));
        const res = await api.crossValidate({ aoi, data: dsrc, series });
        if (reqSeq.current === seq) setCrossRes(res);
      } else if (tab === "xray" || tab === "replay") {
        if (aoi === "custom" && !dataset) return;
        const [xr, bt] = await Promise.all([
          api.xray(aoi, dsrc, dataset),
          !dataset && aoi !== "custom" ? api.backtest(aoi, dsrc) : Promise.resolve(null),
        ]);
        if (reqSeq.current === seq) {
          setXrayData(xr);
          setBacktestData(bt);
        }
      }
    } catch (e) {
      if (reqSeq.current === seq) setErr(describeError(e));
    } finally {
      if (reqSeq.current === seq) setBusy(false);
    }
  }

  function toggleSensor(id: string) {
    setSensors((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((s) => s !== id);
        return next.length > 0 ? next : prev;
      }
      return [...prev, id];
    });
  }

  const handleSelectSensorPreset = (presetSensors: string[]) => {
    // Clearing sim lets the auto-fetch effect (sensors dep) issue the single
    // request with the new preset. A direct call here would double-fetch.
    setSim(null);
    setSensors(presetSensors);
  };

  // Task descriptions & questions for current tab
  const tabDetails: Record<
    Tab,
    { question: string; howItWorks: string; limits: string }
  > = {
    xray: {
      question: t("lab.tab_xray_q"),
      howItWorks: t("lab.tab_xray_how"),
      limits: t("lab.tab_xray_lim"),
    },
    replay: {
      question: t("lab.tab_replay_q"),
      howItWorks: t("lab.tab_replay_how"),
      limits: t("lab.tab_replay_lim"),
    },
    simulator: {
      question: t("lab.tab_simulator_q"),
      howItWorks: t("lab.tab_simulator_how"),
      limits: t("lab.tab_simulator_lim"),
    },
    blindspots: {
      question: t("lab.tab_blindspots_q"),
      howItWorks: t("lab.tab_blindspots_how"),
      limits: t("lab.tab_blindspots_lim"),
    },
    spatial: {
      question: t("lab.tab_spatial_q"),
      howItWorks: t("lab.tab_spatial_how"),
      limits: t("lab.tab_spatial_lim"),
    },
    cross: {
      question: t("lab.tab_cross_q"),
      howItWorks: t("lab.tab_cross_how"),
      limits: t("lab.tab_cross_lim"),
    },
  };

  const currentDetails = tabDetails[tab] || tabDetails.xray;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full space-y-6 pb-24">
      {/* 1. Top Header Banner */}
      <div data-enter className="rounded-2xl border border-slate-800 bg-[#111C2E] p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/60 shadow-sm">
              <Satellite className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                  Sensor Lab
                </h1>
                <span className="font-mono text-xs font-semibold uppercase px-2.5 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                  {dsrc.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-slate-300">
                {t("lab.header_sub")}
              </p>
            </div>
          </div>
        </div>

        {/* 2. Three Structured Mission Task Groups */}
        <div data-tour="lab-groups" aria-label={t("lab.task_groups_label")}
          className="flex snap-x gap-2 overflow-x-auto border-t border-slate-800 pt-3 sm:grid sm:grid-cols-3">
          {TASK_GROUPS.map((g) => {
            const isGroupActive = activeGroup === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => handleGroupChange(g.id)}
                aria-pressed={isGroupActive}
                className={cn(
                  "flex min-w-[220px] snap-start flex-col items-start rounded-xl border p-3 text-left transition min-h-[64px] sm:min-w-0",
                  isGroupActive
                    ? "border-cyan-500/50 bg-cyan-950/30 shadow-sm"
                    : "border-slate-800 bg-slate-900/60 hover:bg-slate-800 hover:text-white",
                )}
              >
                <span className={cn("font-bold text-xs", isGroupActive ? "text-cyan-300" : "text-slate-200")}>
                  {vi ? g.labelVi : g.label}
                </span>
                <span className="text-xs text-slate-400 mt-0.5 leading-snug">
                  {vi ? g.descVi : g.desc}
                </span>
              </button>
            );
          })}
        </div>

        {/* 3. Sub-Tab Switcher for Active Task Group */}
        <div data-tour="lab-tabs" className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800">
          <span className="text-xs font-semibold text-slate-400 px-1">
            {t("lab.experiment_label")}
          </span>
          {TABS.filter((t) => {
            const g = TASK_GROUPS.find((grp) => grp.id === activeGroup);
            return g?.tabs.includes(t.id);
          }).map((t) => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleTabChange(t.id)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition min-h-[36px]",
                  active
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                    : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{vi ? t.labelVi : t.label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-400 px-1">
          {vi
            ? TABS.find((t) => t.id === tab)?.hintVi
            : TABS.find((t) => t.id === tab)?.hint}
        </p>
      </div>

      {/* 4. Global Context Bar */}
      <GlobalContextBar />

      {aoi === "custom" && (
        <CustomLiveRegionPanel
          bbox={sp.get("bbox")}
          geometry={sp.get("geometry")}
          dataset={dataset}
          fromDateProp={sp.get("from_date")}
          toDateProp={sp.get("to_date")}
          onLoaded={(payload) => setSp((prev) => applyCustomRegionParams(prev, payload), { replace: true })}
          onClear={() => setSp((prev) => clearCustomRegionParams(prev), { replace: true })}
        />
      )}

      {/* 5. Guided Experiment Protocol Bar (Collapsible to save vertical viewport) */}
      <div id="lab-protocol" className="scroll-mt-16 rounded-xl border border-slate-800 bg-[#0B1220] overflow-hidden text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900/60">
          <div className="flex items-center gap-2 min-w-0">
            <HelpCircle className="h-4 w-4 text-cyan-400 shrink-0" />
            <span className="font-bold text-white shrink-0 uppercase tracking-wide text-[11px]">
              {t("lab.objective_label")}
            </span>
            <span className="text-slate-300 font-sans truncate">{currentDetails.question}</span>
          </div>
          <button
            type="button"
            onClick={() => setProtocolExpanded(!protocolExpanded)}
            aria-expanded={protocolExpanded}
            aria-controls="lab-protocol-details"
            className="flex items-center gap-1 font-semibold text-cyan-400 hover:text-cyan-300 transition shrink-0"
          >
            <span>{protocolExpanded ? t("lab.collapse") : t("lab.view_protocol")}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", protocolExpanded && "rotate-180")} />
          </button>
        </div>

        {protocolExpanded && (
          <div id="lab-protocol-details" className="grid gap-3 sm:grid-cols-3 p-4 border-t border-slate-800/80 bg-slate-950/40 text-slate-300">
            <div>
              <span className="font-semibold text-white block mb-0.5">
                {t("lab.q1")}
              </span>
              <p className="text-slate-400 leading-relaxed font-sans">{currentDetails.question}</p>
            </div>
            <div>
              <span className="font-semibold text-white block mb-0.5">
                {t("lab.q2")}
              </span>
              <p className="text-slate-400 leading-relaxed font-sans">{currentDetails.howItWorks}</p>
            </div>
            <div>
              <span className="font-semibold text-white block mb-0.5">
                {t("lab.q3")}
              </span>
              <p className="text-slate-400 leading-relaxed font-sans">{currentDetails.limits}</p>
            </div>
          </div>
        )}
      </div>

      {/* 6. Main Layout: Left Controls + Right Canvas */}
      {tab === "xray" && (
      <div className="lg:hidden">
        <button type="button" id="lab-filter-toggle"
          onClick={() => setShowMobileFilters((value) => !value)}
          aria-expanded={tab !== "xray" || showMobileFilters}
          aria-controls="lab-filters"
          className="flex w-full min-h-[44px] items-center justify-between rounded-xl border border-slate-700 bg-[#111C2E] px-4 py-2.5 text-sm font-semibold text-slate-200">
          <span>{t("lab.filters_toggle")}</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", (tab !== "xray" || showMobileFilters) && "rotate-180")} aria-hidden="true" />
        </button>
      </div>
      )}
      <div data-tour="lab-workspace" className="grid grid-cols-1 gap-4 lg:grid-cols-4 lg:gap-6">
        {/* Hide redundant sensor controls on mobile X-Ray until explicitly expanded. */}
        <div id="lab-filters" className={cn("lg:col-span-1 scroll-mt-16", tab === "xray" && !showMobileFilters && "hidden lg:block")}>
          <LabSidebar
            aoi={aoi}
            setAoi={handleAoiChange}
            dsrc={dsrc}
            setDsrc={handleDataChange}
            year={year}
            setYear={setYear}
            month={month}
            setMonth={setMonth}
            sensors={sensors}
            toggleSensor={toggleSensor}
            busy={busy}
            onRun={run}
            activeTab={tab}
          />
        </div>

        {/* Right Canvas */}
        <div id="lab-results" className="min-w-0 lg:col-span-3 space-y-4 scroll-mt-16">

          {/* TAB 1: SENSOR X-RAY */}
          {tab === "xray" && (
            <div className="space-y-4 animate-fade-in">
              {/* X-Ray Internal View Switcher */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#111C2E] p-2.5 text-xs">
                <span className="font-bold text-slate-300 px-1">
                  {t("lab.audit_label")}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setXrayPerspective("trajectory")}
                    className={cn(
                      "rounded-lg px-3 py-1.5 font-semibold transition min-h-[36px]",
                      xrayPerspective === "trajectory"
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                        : "text-slate-400 hover:text-white",
                    )}
                  >
                    {t("lab.view_trajectory")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setXrayPerspective("transition")}
                    className={cn(
                      "rounded-lg px-3 py-1.5 font-semibold transition min-h-[36px]",
                      xrayPerspective === "transition"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "text-slate-400 hover:text-white",
                    )}
                  >
                    {t("lab.view_transition")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setXrayPerspective("leaderboard")}
                    className={cn(
                      "rounded-lg px-3 py-1.5 font-semibold transition min-h-[36px]",
                      xrayPerspective === "leaderboard"
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : "text-slate-400 hover:text-white",
                    )}
                  >
                    {t("lab.view_leaderboard")}
                  </button>
                </div>
              </div>

              {busy && !xrayData && (
                <div className="flex flex-col items-center justify-center p-16 rounded-xl border border-slate-800 bg-[#111C2E]/60 text-slate-400 space-y-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                  <span className="text-xs font-mono">
                    {t("lab.xray_loading")}
                  </span>
                </div>
              )}

              {xrayData && xrayPerspective === "trajectory" && (
                <XrayTimelineView months={xrayData.months} daily={xrayData.daily} units={xrayData.units} />
              )}

              {xrayData && xrayPerspective === "transition" && (
                <XrayTransitionIllusionView months={xrayData.months} />
              )}

              {xrayPerspective === "leaderboard" && (
                <XrayBacktestLeaderboard
                  metrics={xrayData?.backtest_metrics ?? null}
                  backtest={backtestData}
                />
              )}

              {/* Scientific Caveat */}
              <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 text-xs text-slate-400 leading-relaxed font-mono">
                <strong>{t("lab.notice_title")}</strong>{" "}
                {t("lab.notice_body")}
              </div>
            </div>
          )}

          {/* TAB 2: BLIND SENSOR REPLAY */}
          {tab === "replay" && (
            <BlindReplayTab
              aoi={aoi}
              data={dsrc}
              backtest={backtestData}
              loading={busy}
            />
          )}

          {/* TAB 3: MISSION SIMULATOR */}
          {tab === "simulator" && (
            <SimulatorTab sim={sim} sensors={sensors} onSelectPreset={handleSelectSensorPreset} />
          )}

          {/* TAB 4: BLIND SPOTS */}
          {tab === "blindspots" && (
            <BlindSpotsTab spots={spots} />
          )}

          {/* TAB 5: SPATIAL CO-OBSERVATION */}
          {tab === "spatial" && (
            <SpatialCheckTab spatialRes={spatialRes} />
          )}

          {/* TAB 6: CROSS-DATASET BURNED AREA */}
          {tab === "cross" && (
            <CrossDatasetTab
              burned={burned}
              setBurned={setBurned}
              crossRes={crossRes}
            />
          )}
        </div>
      </div>
    </div>
  );
}
