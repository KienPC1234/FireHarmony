import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { requestMethodFor, type AppliedFilters } from "./useCalendarData";

/**
 * CSV export via fetch→blob so a backend 502/timeout shows an inline
 * error instead of navigating the tab to a blank error page. Query params
 * are unchanged from the inlined version (max_cells/test_years already live
 * in `api.ts`, which this claim does not touch).
 */
export function useCalendarExport(opts: { applied: AppliedFilters }) {
  const { applied } = opts;

  const [exporting, setExporting] = useState<"cells" | "detections" | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const handleExport = async (kind: "cells" | "detections") => {
    if (exporting) return;
    setExporting(kind);
    setExportErr(null);
    try {
      const tag = `${applied.aoi}_${applied.from_date || "all"}_${applied.to_date || "all"}`;
      const { method: exportMethod, customBbox: effectiveBbox } = requestMethodFor(applied);
      if (kind === "cells") {
        const url = api.exportUrl(
          2000000, effectiveBbox, applied.aoi, applied.data,
          exportMethod,
          applied.dataset, applied.qa_min, applied.platform_set,
          applied.geometry || undefined,
          applied.from_date || undefined, applied.to_date || undefined,
          applied.source_type,
        );
        await api.downloadFile(url, `firms_cells_${tag}.csv`);
      } else {
        const url = api.exportDetectionsUrl(
          effectiveBbox, applied.aoi, applied.data,
          applied.dataset, applied.qa_min, applied.platform_set,
          applied.geometry || undefined,
          applied.from_date || undefined, applied.to_date || undefined,
          applied.source_type,
        );
        await api.downloadFile(url, `firms_detections_${tag}.csv`);
      }
    } catch (e) {
      setExportErr(describeError(e));
    } finally {
      setExporting(null);
    }
  };

  return { exporting, exportErr, handleExport };
}
