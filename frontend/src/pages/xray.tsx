import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ScanEye, SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { ErrorState, Loading } from "@/components/states";
import { GlobalContextBar } from "@/components/GlobalContextBar";
import { XraySidebar } from "@/components/xray/XraySidebar";
import { XrayTimelineView } from "@/components/xray/XrayTimelineView";
import { XrayTransitionIllusionView } from "@/components/xray/XrayTransitionIllusionView";
import { XrayBacktestLeaderboard } from "@/components/xray/XrayBacktestLeaderboard";

type XrayTab = "trajectory" | "transition" | "backtest";

export function XrayPage() {
  const { t } = useLang();
  const [sp, setSp] = useSearchParams();
  const aoi = sp.get("aoi") || "vietnam";
  const data = sp.get("data") || "raw";
  const [viewTab, setViewTab] = useState<XrayTab>("trajectory");

  const [xr, setXr] = useState<Awaited<ReturnType<typeof api.xray>> | null>(null);
  const [bt, setBt] = useState<Awaited<ReturnType<typeof api.backtest>> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      api.xray(aoi, data).catch((err) => {
        if (active) setError(err);
        return null;
      }),
      api.backtest(aoi, data).catch(() => null),
    ]).then(([xrayData, backtestData]) => {
      if (!active) return;
      if (xrayData) setXr(xrayData);
      if (backtestData) setBt(backtestData);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [aoi, data, reloadNonce]);

  const handleSetAoi = (newAoi: string) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set("aoi", newAoi);
      next.set("data", data);
      return next;
    });
  };

  const handleSetData = (newData: string) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set("aoi", aoi);
      next.set("data", newData);
      return next;
    });
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full space-y-6 pb-24 animate-fade-up">
      {/* 1. Top Banner & Control Deck */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-[#111C2E] p-4 sm:p-5 shadow-sm">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/60 shadow-inner">
              <ScanEye className="h-5 w-5 text-cyan-400" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              {t("xray.title")}
            </h1>
            <span
              title={xr?.data_source ?? data.toUpperCase()}
              aria-label={xr?.data_source ?? data.toUpperCase()}
              className="shrink-0 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-sans font-semibold leading-4 text-cyan-300"
            >
              {(xr?.data_source ?? data).toLowerCase().includes("synthetic") || data === "sample"
                ? t("common.synthetic_feed")
                : t("common.observed_feed")}
            </span>
          </div>
          <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
            {t("xray.desc")}
          </p>
        </div>

        {/* Global tab navigation pills */}
        <div className="flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/90 p-1 text-xs">
          <button
            type="button"
            onClick={() => setViewTab("trajectory")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
              viewTab === "trajectory"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>{t("xray.tab_trajectory")}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewTab("transition")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
              viewTab === "transition"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <span>{t("xray.tab_transition")}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewTab("backtest")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
              viewTab === "backtest"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <span>{t("xray.tab_backtest")}</span>
          </button>
        </div>
      </div>

      {/* 2. Global Context Bar */}
      <GlobalContextBar />

      {/* 3. Main Cockpit Grid */}
      {error && !xr ? (
        <ErrorState error={error} onRetry={() => setReloadNonce((n) => n + 1)} />
      ) : !xr ? (
        <Loading label={t("xray.loading")} aoi={aoi} data={data} />
      ) : (
        <div className="space-y-4">
          {Boolean(error) && <ErrorState error={error} onRetry={() => setReloadNonce((n) => n + 1)} />}
          {loading && (
            <div className="flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-3 py-1.5 text-xs text-cyan-200">
              <div className="h-3 w-3 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
              <span>{t("xray.loading")}</span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4 items-start">
          {/* Left Control Sidebar */}
          <div className="lg:col-span-1">
            <XraySidebar
              aoi={aoi}
              setAoi={handleSetAoi}
              data={data}
              setData={handleSetData}
              dataSrcLabel={xr.data_source}
              units={xr.units}
              stanTrained={xr.stan_trained}
              htsTrained={xr.hts_trained}
              totalMonths={xr.months.length}
              viewTab={viewTab}
              setViewTab={setViewTab}
            />
          </div>

          {/* Right Main Dissection Canvas */}
          <div className="lg:col-span-3">
            {viewTab === "trajectory" && (
              <XrayTimelineView months={xr.months} units={xr.units} />
            )}

            {viewTab === "transition" && (
              <XrayTransitionIllusionView months={xr.months} />
            )}

            {viewTab === "backtest" && (
              <XrayBacktestLeaderboard
                metrics={xr.backtest_metrics ?? null}
                backtest={bt}
              />
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
