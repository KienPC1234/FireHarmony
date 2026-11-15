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

export function applyCustomRegionParams(
  prev: URLSearchParams,
  payload: { dataset: string; bbox: string; geometry?: string | null; fromDate: string; toDate: string },
): URLSearchParams {
  const next = new URLSearchParams(prev);
  next.set("aoi", "custom");
  next.set("data", "raw");
  next.set("dataset", payload.dataset);
  next.set("bbox", payload.bbox);
  if (payload.geometry) next.set("geometry", payload.geometry);
  else next.delete("geometry");
  if (/^\d{4}-\d{2}-\d{2}$/.test(payload.fromDate)) next.set("from_date", payload.fromDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(payload.toDate)) {
    next.set("to_date", payload.toDate);
    next.set("ym", payload.toDate.slice(0, 7));
  }
  return next;
}

export function clearCustomRegionParams(prev: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(prev);
  next.delete("dataset");
  next.delete("bbox");
  next.delete("geometry");
  next.delete("from_date");
  next.delete("to_date");
  next.delete("from");
  next.delete("to");
  return next;
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
const MODE_STORAGE_KEY = "fireharmony.experience_mode";

function readStoredMode(): ExperienceMode {
  try {
    const v = window.localStorage.getItem(MODE_STORAGE_KEY);
    return v === "research" ? "research" : "explore";
  } catch {
    return "explore";
  }
}

function writeStoredMode(mode: ExperienceMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage errors in restricted browsing contexts.
  }
}

export function ResearchContextProvider({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const aoi = (searchParams.get("aoi") as AoiId) || "vietnam";
  const dataFeed = (searchParams.get("data") as DataFeedKind) || "raw";
  const urlMode = searchParams.get("mode");
  const mode: ExperienceMode =
    urlMode === "research" || urlMode === "explore" ? urlMode : readStoredMode();
  const yearMonth = searchParams.get("ym");
  // A shared URL is an explicit source-of-truth selection. If method is
  // omitted, choose a method supported by that feed, rather than silently
  // switching a synthetic demo request to a slow NASA raw request.
  const requestedMethod = searchParams.get("method") as CalibMethod | null;
  // The demo feed has no STAN or HTS tiles: never expose an incompatible
  // method, even for a manually edited or shared research URL.
  const unsupportedSampleMethod = dataFeed === "sample"
    && (requestedMethod === "stan" || requestedMethod === "hts_anchor");
  const method: CalibMethod = unsupportedSampleMethod
    ? "k_ratio"
    : requestedMethod || (dataFeed === "sample" ? "k_ratio" : "stan");

  // Keep the browser URL in sync with the effective method. Preserve AOI,
  // month and research mode, and avoid redirecting an intentional raw feed.
  React.useEffect(() => {
    if (urlMode === "research" || urlMode === "explore") {
      writeStoredMode(urlMode);
    }
  }, [urlMode]);

  React.useEffect(() => {
    if (!unsupportedSampleMethod) return;
    setSearchParams((prev) => {
      if (prev.get("data") !== "sample") return prev;
      const selected = prev.get("method");
      if (selected !== "stan" && selected !== "hts_anchor") return prev;
      const next = new URLSearchParams(prev);
      next.set("method", "k_ratio");
      return next;
    }, { replace: true });
  }, [unsupportedSampleMethod, setSearchParams]);

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
    setAoi: (nextAoi) =>
      updateParams(
        nextAoi === "custom"
          ? { aoi: nextAoi }
          : {
              aoi: nextAoi,
              dataset: null,
              bbox: null,
              geometry: null,
              from_date: null,
              to_date: null,
              from: null,
              to: null,
            },
      ),
    // One URL transition for feed+method: the sample feed has no STAN/HTS
    // tiles. Do not briefly expose an incompatible method or raw request.
    setDataFeed: (nextFeed) => updateParams({
      data: nextFeed, method: nextFeed === "sample" ? "k_ratio" : "stan",
    }),
    setMode: (nextMode) => {
      writeStoredMode(nextMode);
      updateParams({ mode: nextMode });
    },
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
