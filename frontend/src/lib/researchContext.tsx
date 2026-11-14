/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export type AoiId = "vietnam" | "amazon" | "australia" | "custom";
export type DataFeedKind = "sample" | "raw";
export type ExperienceMode = "explore" | "research";
export type CalibMethod = "k_ratio" | "hts_anchor" | "stan";

export function backendMethod(method: CalibMethod): "stat" | "hts" | "stan" {
  if (method === "stan") return "stan";
  if (method === "hts_anchor") return "hts";
  return "stat";
}

export interface ResearchContextValue {
  aoi: AoiId;
  dataFeed: DataFeedKind;
  mode: ExperienceMode;
  yearMonth: string | null;
  method: CalibMethod;
  setAoi: (aoi: AoiId) => void;
  setDataFeed: (feed: DataFeedKind) => void;
  setMode: (mode: ExperienceMode) => void;
  setYearMonth: (ym: string | null) => void;
  setMethod: (method: CalibMethod) => void;
  updateParams: (updates: Record<string, string | null>) => void;
}

const ResearchContext = createContext<ResearchContextValue | null>(null);

export function ResearchContextProvider({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const aoi = (searchParams.get("aoi") as AoiId) || "vietnam";
  const dataFeed = (searchParams.get("data") as DataFeedKind) || "raw";
  const mode = (searchParams.get("mode") as ExperienceMode) || "explore";
  const yearMonth = searchParams.get("ym");
  const method = (searchParams.get("method") as CalibMethod) || "stan";

  // Functional update with a fixed identity: closing over `searchParams` would
  // recreate this callback (and every setX wrapper) on each URL sync, and any
  // effect listing those setters would refetch in a loop.
  const updateParams = React.useCallback((updates: Record<string, string | null>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, val] of Object.entries(updates)) {
        if (val === null || val === undefined || val === "") {
          next.delete(key);
        } else {
          next.set(key, val);
        }
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const value = useMemo<ResearchContextValue>(() => ({
    aoi,
    dataFeed,
    mode,
    yearMonth,
    method,
    setAoi: (nextAoi) => updateParams({ aoi: nextAoi }),
    setDataFeed: (nextFeed) => updateParams({ data: nextFeed }),
    setMode: (nextMode) => updateParams({ mode: nextMode }),
    setYearMonth: (nextYm) => updateParams({ ym: nextYm }),
    setMethod: (nextMethod) => updateParams({ method: nextMethod }),
    updateParams,
  }), [aoi, dataFeed, mode, yearMonth, method, updateParams]);

  return <ResearchContext.Provider value={value}>{children}</ResearchContext.Provider>;
}

export function useResearchContext(): ResearchContextValue {
  const ctx = useContext(ResearchContext);
  if (!ctx) {
    throw new Error("useResearchContext must be used within a ResearchContextProvider");
  }
  return ctx;
}
