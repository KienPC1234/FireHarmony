import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ScanEye, SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { ErrorState, Loading } from "@/components/states";
import { XraySidebar } from "@/components/xray/XraySidebar";
import { XrayTimelineView } from "@/components/xray/XrayTimelineView";
import { XrayTransitionIllusionView } from "@/components/xray/XrayTransitionIllusionView";
import { XrayBacktestLeaderboard } from "@/components/xray/XrayBacktestLeaderboard";

type XrayTab = "trajectory" | "transition" | "backtest";

export function XrayPage() {
  const { lang } = useLang();
  const vi = lang === "vi";
  const [sp, setSp] = useSearchParams();
  const aoi = sp.get("aoi") || "vietnam";
  const data = sp.get("data") || "sample";
  const [viewTab, setViewTab] = useState<XrayTab>("trajectory");

  const [xr, setXr] = useState<Awaited<ReturnType<typeof api.xray>> | null>(null);
  const [bt, setBt] = useState<Awaited<ReturnType<typeof api.backtest>> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

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
  }, [aoi, data]);

  const handleSetAoi = (newAoi: string) => {
    setSp({ aoi: newAoi, data });
  };

  const handleSetData = (newData: string) => {
    setSp({ aoi, data: newData });
  };

  return (
    <div className="animate-fade-up space-y-5 pb-12">
      {/* Top Banner & Control Deck */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/80 bg-slate-950/80 p-4 shadow-card backdrop-blur">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/60 shadow-inner">
              <ScanEye className="h-5 w-5 text-cyan-400" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              {vi ? "Chụp X-Ray sai lệch cảm biến & Bóc tách đa thập kỷ" : "Sensor Bias X-Ray & Multi-Decadal Dissection"}
            </h1>
            <span className="font-mono text-xs font-semibold uppercase px-2.5 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
              {xr?.data_source ?? data.toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {vi
              ? `MODIS 1km so với VIIRS 375m tham chiếu: kiểm chứng độ trệch sensor, loại bỏ bước nhảy giả 2012 và backtest holdout độc lập.`
              : `MODIS 1km vs VIIRS 375m reference: audit footprint bias, resolve the 2012 step-jump illusion, and test holdout accuracy.`}
          </p>
        </div>

        {/* Global tab navigation pills */}
        <div className="flex items-center rounded-xl border border-border/60 bg-slate-900/80 p-1 text-xs">
          <button
            type="button"
            onClick={() => setViewTab("trajectory")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
              viewTab === "trajectory"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm"
                : "text-muted-foreground hover:text-slate-200"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>{vi ? "Quỹ đạo & Độ lệch" : "Trajectory Audit"}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewTab("transition")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
              viewTab === "transition"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm"
                : "text-muted-foreground hover:text-slate-200"
            }`}
          >
            <span>{vi ? "Ảo ảnh bước nhảy 2012" : "2012 Sensor Illusion"}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewTab("backtest")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
              viewTab === "backtest"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm"
                : "text-muted-foreground hover:text-slate-200"
            }`}
          >
            <span>{vi ? "Bảng đấu Model (Holdout)" : "Model Leaderboard"}</span>
          </button>
        </div>
      </div>

      {/* Main Cockpit Grid */}
      {error ? (
        <ErrorState error={error} />
      ) : loading || !xr ? (
        <Loading label={vi ? "Đang giải phẫu tín hiệu sensor..." : "Analyzing sensor discrepancies..."} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          {/* Left Control Sidebar */}
          <div className="lg:col-span-1">
            <XraySidebar
              aoi={aoi}
              setAoi={handleSetAoi}
              data={data}
              setData={handleSetData}
              dataSrcLabel={xr.data_source}
              units={xr.units}
              mlTrained={xr.ml_trained}
              tsTrained={xr.ts_trained}
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
      )}
    </div>
  );
}
