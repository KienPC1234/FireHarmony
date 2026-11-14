/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export type AoiId = "vietnam" | "amazon" | "australia" | "custom";
export type DataFeedKind = "sample" | "raw";
export type ExperienceMode = "explore" | "research";
export type CalibMethod = "k_ratio" | "hgb_anchor" | "sensorformer_lite" | "hts_anchor" | "stan";

export function backendMethod(method: CalibMethod): "stat" | "ml" | "ts" | "hts" | "stan" {
  if (method === "stan") return "stan";
  if (method === "hts_anchor") return "hts";
  if (method === "hgb_anchor") return "ml";
  // SensorFormer residual gate is OFF; it serves the seasonal anchor.
  return "stat";
}

export interface ResearchContextValue {
  aoi: AoiId;
  dataFeed: DataFeedKind;
  mode: ExperienceMode;
  yearMonth: string | null;
  method: CalibMethod;
  qaMin: string;
  setAoi: (aoi: AoiId) => void;
  setDataFeed: (feed: DataFeedKind) => void;
  setMode: (mode: ExperienceMode) => void;
  setYearMonth: (ym: string | null) => void;
  setMethod: (method: CalibMethod) => void;
  setQaMin: (qa: string) => void;
  updateParams: (updates: Record<string, string | null>) => void;
}

const ResearchContext = createContext<ResearchContextValue | null>(null);

export function ResearchContextProvider({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const aoi = (searchParams.get("aoi") as AoiId) || "vietnam";
  const dataFeed = (searchParams.get("data") as DataFeedKind) || "sample";
  const mode = (searchParams.get("mode") as ExperienceMode) || "explore";
  const yearMonth = searchParams.get("ym");
  const method = (searchParams.get("method") as CalibMethod)
    || (dataFeed === "raw" ? "stan" : "k_ratio");
  const qaMin = searchParams.get("qa") || "nominal";

  const updateParams = React.useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === undefined || val === "") {
        next.delete(key);
      } else {
        next.set(key, val);
      }
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const value = useMemo<ResearchContextValue>(() => ({
    aoi,
    dataFeed,
    mode,
    yearMonth,
    method,
    qaMin,
    setAoi: (nextAoi) => updateParams({ aoi: nextAoi }),
    setDataFeed: (nextFeed) => updateParams({ data: nextFeed }),
    setMode: (nextMode) => updateParams({ mode: nextMode }),
    setYearMonth: (nextYm) => updateParams({ ym: nextYm }),
    setMethod: (nextMethod) => updateParams({ method: nextMethod }),
    setQaMin: (nextQa) => updateParams({ qa: nextQa }),
    updateParams,
  }), [aoi, dataFeed, mode, yearMonth, method, qaMin, updateParams]);

  return <ResearchContext.Provider value={value}>{children}</ResearchContext.Provider>;
}

export function useResearchContext(): ResearchContextValue {
  const ctx = useContext(ResearchContext);
  if (!ctx) {
    throw new Error("useResearchContext must be used within a ResearchContextProvider");
  }
  return ctx;
}
