import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { applyCustomRegionParams } from "@/lib/researchContext";
import {
  CalendarDays,
  CheckCircle2,
  Database,
  FileCheck2,
  FlaskConical,
  Globe,
  ShieldAlert,
} from "lucide-react";
import { api, describeError, type BlindSpotResponse } from "@/lib/api";
import { notifyToast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { ErrorState, Loading } from "@/components/states";
import { GlobalContextBar } from "@/components/GlobalContextBar";
import { CustomLiveRegionPanel } from "@/components/CustomLiveRegionPanel";
import { SectionQuickNav } from "@/components/common/SectionQuickNav";

const AOIS = [
  {
    id: "vietnam",
    name: { vi: "Việt Nam", en: "Vietnam" },
    desc: { vi: "Tây Nguyên & Duyên hải Nam Trung Bộ", en: "Central Highlands & South Central Coast" },
  },
  {
    id: "amazon",
    name: { vi: "Amazon", en: "Amazon" },
    desc: { vi: "Nam bồn địa Amazon / Cerrado", en: "Southern Amazon Basin / Cerrado" },
  },
  {
    id: "australia",
    name: { vi: "Úc (Australia)", en: "Australia" },
    desc: { vi: "Đông Nam Úc (Black Summer)", en: "Southeast Australia (Black Summer)" },
  },
];

export function EvidencePage() {
  const { t, lang } = useLang();
  const vi = lang === "vi";

  const [sp, setSp] = useSearchParams();
  const aoi = sp.get("aoi") || "vietnam";
  const data = sp.get("data") || "raw";
  const ymParam = sp.get("ym") || "2025-03";
  // Same filter keys as /calendar so the evidence card quotes the same cells.
  const qaMin = sp.get("qa_min") || "all";
  const platformSet = sp.get("platform_set") || "all";
  const dataset = sp.get("dataset") || undefined;

  const [yearStr, monthStr] = ymParam.split("-");
  // No year clamp: raw carries NRT months past 2025 and the calendar renders
  // them with partial/NRT coverage flags, so ?ym=2026-11 must stay 2026.
  const year = parseInt(yearStr, 10) || 2025;
  const month = parseInt(monthStr, 10) || 3;

  const [aoiOptions, setAoiOptions] = useState(AOIS);

  useEffect(() => {
    let alive = true;
    api.aois().then((res) => {
      if (!alive || !res.aois?.length) return;
      const presetIds = new Set(AOIS.map((p) => p.id));
      const extras = res.aois
        .filter((a) => !presetIds.has(a.id))
        .map((a) => ({
          id: a.id,
          name: { vi: a.label || a.id, en: a.label || a.id },
          desc: { vi: a.bbox || "Custom AOI", en: a.bbox || "Custom AOI" },
        }));
      if (extras.length > 0) setAoiOptions([...AOIS, ...extras]);
    }).catch(() => {
      // Keep preset fallback when offline or /aois is unavailable
    });
    return () => { alive = false; };
  }, []);

  const [reloadNonce, setReloadNonce] = useState(0);
  // A response is only valid for its exact AOI, feed, period, filters, and
  // retry attempt. Never render an earlier sample response under a RAW badge.
  const requestKey = JSON.stringify([
    aoi, data, year, month, qaMin, platformSet, dataset ?? null, reloadNonce,
  ]);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    spots: BlindSpotResponse | null;
    coverage: Record<string, unknown> | null;
    error: unknown;
    loading: boolean;
  } | null>(null);
  const current = snapshot?.key === requestKey ? snapshot : null;
  const spots = current?.spots ?? null;
  const coverage = current?.coverage ?? null;
  const error = current?.error ?? null;
  const loading = current?.loading ?? true;

  const [selectedDayState, setSelectedDay] = useState<{
    requestKey: string;
    day: number;
    modisReq: boolean | null;
    viirsReq: boolean | null;
    modisDetect: number;
    viirsDetect: number;
  } | null>(null);
  const selectedDay =
    selectedDayState?.requestKey === requestKey && spots ? selectedDayState : null;

  useEffect(() => {
    setSelectedDay(null);
  }, [requestKey]);

  useEffect(() => {
    let active = true;
    if (aoi === "custom" && !dataset) {
      setSnapshot({ key: requestKey, spots: null, coverage: null, error: null, loading: false });
      return () => { active = false; };
    }
    setSnapshot({ key: requestKey, spots: null, coverage: null, error: null, loading: true });

    Promise.allSettled([
      api.blindSpots(aoi, data, year, month, qaMin, platformSet, dataset),
      dataset ? Promise.resolve(null) : api.coverage(aoi, data),
    ]).then(([spotRes, covRes]) => {
      if (!active) return;
      const failure = spotRes.status === "rejected" ? spotRes.reason : null;
      if (failure) {
        notifyToast({ icon: "error", title: describeError(failure) });
      }
      setSnapshot({
        key: requestKey,
        spots: spotRes.status === "fulfilled" ? spotRes.value : null,
        coverage: covRes.status === "fulfilled" ? covRes.value as Record<string, unknown> | null : null,
        error: failure,
        loading: false,
      });
    });

    return () => {
      active = false;
    };
  }, [aoi, data, year, month, qaMin, platformSet, dataset, reloadNonce, requestKey]);

  const handleAoiChange = (newAoi: string) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set("aoi", newAoi);
      next.set("data", data);
      next.set("ym", String(year) + "-" + String(month).padStart(2, "0"));
      return next;
    });
  };

  const handleYmChange = (newYm: string) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set("aoi", aoi);
      next.set("data", data);
      next.set("ym", newYm);
      // qa_min/platform_set ride along untouched so the card stays
      // comparable with the calendar view it was opened from.
      return next;
    });
  };

  const days = spots?.days ?? [];
  const daysInMonth = days.length > 0 ? days.length : 31;

  // Determine eligibility criteria
  const pairedDays = days.filter((d) => d.modis_requested && d.viirs_requested).length;
  const daysWithDetections = days.filter(
    (d) => (d.modis_detections ?? 0) > 0 || (d.viirs_detections ?? 0) > 0
  ).length;
  const requestDays = days.filter((d) => d.modis_requested || d.viirs_requested).length;

  // Synthetic detections deliberately have null request flags; they do not
  // establish NASA file requests or actual sensor overpass coverage.
  const requestLedgerKnown = days.length > 0 && days.every(
    (d) => typeof d.modis_requested === "boolean" && typeof d.viirs_requested === "boolean",
  );
  const pairedRatio = spots?.paired_coverage_ratio;
  const coverageKnown = requestLedgerKnown && typeof pairedRatio === "number"
    && Number.isFinite(pairedRatio);
  const coverageRatio = coverageKnown ? pairedRatio : 0;
  // Month-ledger flags from /blind-spots: NRT pull and/or verified-partial
  // coverage for the requested period (e.g. 2026 NRT months in raw).
  const ledger = spots?.coverage ?? null;
  const threshold = spots?.eligibility_threshold ?? 0.9;
  const eligibility =
    !coverageKnown
      ? "UNKNOWN"
      : coverageRatio >= threshold
      ? "ELIGIBLE"
      : coverageRatio >= 0.3
      ? "PARTIAL"
      : "INSUFFICIENT";

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full space-y-6 pb-24">
      {/* 1. Header Bar */}
      <div data-enter className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-[#111C2E] p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/60 shadow-sm">
            <FileCheck2 className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                {t("evidence.title")}
              </h1>
              <span className="font-mono text-xs font-semibold uppercase px-2.5 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                {data.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-slate-300">
              {t("evidence.desc")}
            </p>
          </div>
        </div>

        {/* Action Links */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={"/calendar?" + sp.toString()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-200 transition min-h-[40px]"
          >
            <CalendarDays className="h-4 w-4 text-cyan-400" />
            <span>{t("evidence.view_calendar")}</span>
          </Link>
          <Link
            to={"/methods?" + sp.toString()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-200 transition min-h-[40px]"
          >
            <FlaskConical className="h-4 w-4 text-purple-400" />
            <span>{t("evidence.check_method")}</span>
          </Link>
        </div>
      </div>

      {/* 2. Global Context Bar */}
      <GlobalContextBar />
      {aoi === "custom" && (
        <CustomLiveRegionPanel
          bbox={sp.get("bbox")}
          geometry={sp.get("geometry")}
          dataset={dataset}
          fromDateProp={sp.get("from_date")}
          toDateProp={sp.get("to_date")}
          onLoaded={(payload) => setSp((prev) => applyCustomRegionParams(prev, payload), { replace: true })}
        />
      )}
      {!loading && spots && (
      <SectionQuickNav
        title={t("evidence.quick_nav_title")}
        items={[
          { id: "evidence-verdict", label: t("evidence.nav_verdict") },
          { id: "evidence-scope", label: t("evidence.nav_scope") },
          { id: "evidence-matrix", label: t("evidence.nav_matrix") },
          { id: "evidence-limits", label: t("evidence.nav_limits") },
        ]}
      />
      )}

      {/* P0-07/P1-13: request coverage is not dataset readiness. */}
      {coverage && coverage.request_coverage === true && coverage.dataset_ready === false && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          <p className="font-semibold">
            {t("evidence.ledger_title")}
          </p>
          <p className="text-xs text-amber-200/90">
            {t("evidence.ledger_desc")}
          </p>
        </div>
      )}

      {/* Only evaluate coverage once a real observation matrix exists. */}
      {spots && (
      <div id="evidence-verdict" className="scroll-mt-16 rounded-2xl border border-slate-800 bg-[#0B1220]/95 p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg border",
                eligibility === "ELIGIBLE"
                  ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                  : eligibility === "PARTIAL"
                  ? "border-amber-500/40 bg-amber-950/40 text-amber-300"
                  : "border-slate-700 bg-slate-900 text-slate-300",
              )}
            >
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t("evidence.audit_conclusion")}
                </span>
                <span
                  className={cn(
                    "px-2 py-0.5 rounded text-[11px] font-mono font-bold uppercase border",
                    eligibility === "ELIGIBLE"
                      ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                      : eligibility === "PARTIAL"
                      ? "border-amber-500/40 bg-amber-950/40 text-amber-300"
                      : "border-amber-500/30 bg-amber-950/20 text-amber-200",
                  )}
                >
                  {eligibility === "UNKNOWN"
                    ? t("common.unknown")
                    : eligibility === "ELIGIBLE"
                    ? t("evidence.eligible_title")
                    : eligibility === "PARTIAL"
                    ? t("evidence.partial_title")
                    : t("evidence.insufficient_title")}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-slate-400">{t("evidence.paired_coverage")}</span>
            <span className="font-bold text-white">
              {coverageKnown
                ? pairedDays + " / " + daysInMonth + " " + t("evidence.days_unit") + " (" + Math.round(coverageRatio * 100) + "%)"
                : t("common.unknown")}
            </span>
            <span className="text-slate-600 hidden sm:inline">|</span>
            <span className="text-slate-400 hidden sm:inline">{t("evidence.threshold")}</span>
            <span className="font-semibold text-cyan-300 hidden sm:inline">{(threshold * 100).toFixed(0)}%</span>
            {ledger?.nrt === true && (
              <span className="rounded-full border border-violet-500/40 bg-violet-950/40 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-violet-300">
                {t("evidence.nrt_badge")}
              </span>
            )}
            {ledger?.partial === true && (
              <span className="rounded-full border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-amber-300">
                {t("common.partial_coverage")}
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed font-sans">
          {eligibility === "UNKNOWN"
            ? data === "sample" ? t("common.synthetic_desc") : t("common.unknown")
            : eligibility === "ELIGIBLE"
            ? t("evidence.verdict_eligible", {
                pct: (coverageRatio * 100).toFixed(0),
                threshold: (threshold * 100).toFixed(0),
              })
            : t("evidence.verdict_below", {
                pct: (coverageRatio * 100).toFixed(0),
                threshold: (threshold * 100).toFixed(0),
              })}
        </p>
      </div>
      )}

      <div id="evidence-scope" className="scroll-mt-16" />
      {/* 4. Controls: Select Area & Month */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#111C2E] p-3.5 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* AOI Selector */}
          <div className="flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5">
            <Globe className="h-4 w-4 shrink-0 text-cyan-400" />
            <label htmlFor="evidence-area-select" className="shrink-0 text-slate-400 font-semibold">{t("evidence.area")}</label>
            <select
              id="evidence-area-select"
              value={aoi}
              onChange={(e) => handleAoiChange(e.target.value)}
              className="min-w-0 max-w-[56vw] truncate bg-transparent font-bold text-white focus:outline-none sm:max-w-[26rem]"
            >
              {aoiOptions.map((a) => (
                <option key={a.id} value={a.id} className="bg-slate-900">
                  {vi ? a.name.vi : a.name.en} ({vi ? a.desc.vi : a.desc.en})
                </option>
              ))}
            </select>
          </div>

          {/* Target Month */}
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5">
            <CalendarDays className="h-4 w-4 text-orange-400" />
            <label htmlFor="evidence-month-input" className="text-slate-400 font-semibold">{t("evidence.month")}</label>
            <input
              id="evidence-month-input"
              type="month"
              value={`${year}-${String(month).padStart(2, "0")}`}
              onChange={(e) => handleYmChange(e.target.value)}
              className="bg-transparent font-bold text-white focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Database className="h-4 w-4 text-amber-400" />
          <span>{t("evidence.data_source")}</span>
          <span className="font-mono text-white font-semibold">{data.toUpperCase()}</span>
        </div>
      </div>

      {aoi === "custom" && !dataset ? null : loading && !spots ? (
        <Loading label={t("evidence.auditing")} aoi={aoi} data={data} />
      ) : error && !spots ? (
        <ErrorState error={error} onRetry={() => setReloadNonce((n) => n + 1)} />
      ) : (
        <>
          {Boolean(error) && <ErrorState error={error} onRetry={() => setReloadNonce((n) => n + 1)} />}
          {loading && (
            <div className="flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-3 py-1.5 text-xs text-cyan-200">
              <div className="h-3 w-3 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
              <span>{t("evidence.auditing")}</span>
            </div>
          )}
          {/* 5. 3 Core Metric Cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 space-y-1">
              <span className="text-xs font-semibold text-slate-400 block">
                {t("evidence.request_days")}
              </span>
              <div className="text-2xl font-bold font-mono text-blue-400">
                {requestLedgerKnown ? requestDays + " / " + daysInMonth : t("common.unknown")}
              </div>
              <p className="text-xs text-slate-400">
                {t("evidence.request_days_hint")}
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 space-y-1">
              <span className="text-xs font-semibold text-slate-400 block">
                {t("evidence.detection_days")}
              </span>
              <div className="text-2xl font-bold font-mono text-teal-400">
                {daysWithDetections} / {daysInMonth}
              </div>
              <p className="text-xs text-slate-400">
                {t("evidence.detection_days_hint")}
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 space-y-1">
              <span className="text-xs font-semibold text-slate-400 block">
                {t("evidence.paired_days_label")}
              </span>
              <div
                className={cn(
                  "text-2xl font-bold font-mono",
                  eligibility === "ELIGIBLE"
                    ? "text-emerald-400"
                    : eligibility === "PARTIAL"
                    ? "text-amber-400"
                    : "text-rose-400"
                )}
              >
                {coverageKnown ? pairedDays + " / " + daysInMonth : t("common.unknown")}
              </div>
              <p className="text-xs text-slate-400">
                {t("evidence.paired_days_hint")}
              </p>
            </div>
          </div>

          {/* 6. Daily Observation Matrix (Source x Date: Days 01-31) */}
          <div id="evidence-matrix" className="scroll-mt-16 rounded-2xl border border-slate-800 bg-[#111C2E] p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white tracking-tight">
                  {t("evidence.matrix_heading")}
                </h3>
                <p className="text-xs text-slate-400">
                  {t("evidence.matrix_sub", {
                    month,
                    year,
                    ym: `${year}-${String(month).padStart(2, "0")}`,
                  })}
                </p>
              </div>

              {/* Status Legend */}
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded bg-emerald-500" />
                  <span className="text-slate-300">{t("evidence.co_observed")}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded bg-blue-500" />
                  <span className="text-slate-300">MODIS</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded bg-teal-500" />
                  <span className="text-slate-300">VIIRS</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded bg-slate-700" />
                  <span className="text-slate-400">{t("evidence.not_requested")}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded border border-slate-500 bg-slate-800" />
                  <span className="text-slate-300">? · {t("common.unknown")}</span>
                </div>
              </div>
            </div>

            {/* Matrix Table */}
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 pr-3 text-left font-semibold">{t("evidence.sensor_channel")}</th>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                      <th key={d} className="p-1 text-center min-w-[28px] font-medium">
                        {String(d).padStart(2, "0")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {/* MODIS Row */}
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-blue-400 whitespace-nowrap">
                      MODIS (Terra/Aqua)
                    </td>
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const dayData = days[i];
                      const active = dayData?.modis_requested;
                      const hasDetect = (dayData?.modis_detections ?? 0) > 0;
                      return (
                        <td key={i} className="p-1 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedDay({
                                requestKey,
                                day: i + 1,
                                modisReq: active ?? null,
                                viirsReq: days[i]?.viirs_requested ?? null,
                                modisDetect: dayData?.modis_detections ?? 0,
                                viirsDetect: days[i]?.viirs_detections ?? 0,
                              })
                            }
                            className={cn(
                              "h-7 w-full rounded flex items-center justify-center font-bold transition text-xs font-mono",
                              hasDetect
                                ? "bg-blue-500/25 text-blue-200 border border-blue-500/50 hover:bg-blue-500/40"
                                : active
                                ? "bg-slate-900 text-blue-400/80 border border-slate-800 hover:border-slate-700"
                                : "bg-slate-950/40 text-slate-700",
                            )}
                            title={t("evidence.cell_title", {
                              day: i + 1,
                              count: dayData ? dayData.modis_detections : 0,
                            })}
                          >
                            {hasDetect ? dayData?.modis_detections : active ? "R" : active == null ? "?" : "-"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>

                  {/* VIIRS S-NPP Row */}
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-teal-400 whitespace-nowrap">
                      VIIRS (Suomi NPP)
                    </td>
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const dayData = days[i];
                      const active = dayData?.viirs_requested;
                      const hasDetect = (dayData?.viirs_detections ?? 0) > 0;
                      return (
                        <td key={i} className="p-1 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedDay({
                                requestKey,
                                day: i + 1,
                                modisReq: days[i]?.modis_requested ?? null,
                                viirsReq: active ?? null,
                                modisDetect: days[i]?.modis_detections ?? 0,
                                viirsDetect: dayData?.viirs_detections ?? 0,
                              })
                            }
                            className={cn(
                              "h-7 w-full rounded flex items-center justify-center font-bold transition text-xs font-mono",
                              hasDetect
                                ? "bg-teal-500/25 text-teal-200 border border-teal-500/50 hover:bg-teal-500/40"
                                : active
                                ? "bg-slate-900 text-teal-400/80 border border-slate-800 hover:border-slate-700"
                                : "bg-slate-950/40 text-slate-700",
                            )}
                            title={t("evidence.cell_title", {
                              day: i + 1,
                              count: dayData ? dayData.viirs_detections : 0,
                            })}
                          >
                            {hasDetect ? dayData?.viirs_detections : active ? "R" : active == null ? "?" : "-"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>

                  {/* Paired Eligibility Row */}
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-slate-300 whitespace-nowrap">
                      {t("evidence.paired_status")}
                    </td>
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const dayData = days[i];
                      const paired = dayData?.modis_requested && dayData?.viirs_requested;
                      return (
                        <td key={i} className="p-1 text-center">
                          <div
                            className={cn(
                              "h-5 w-full rounded flex items-center justify-center text-[10px] font-mono font-bold",
                              paired
                                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                : "bg-slate-950/40 text-slate-700",
                            )}
                          >
                            {paired ? "OK" : "-"}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="pt-2 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 font-mono">
              <span><strong>R</strong> = {t("evidence.legend_requested")}</span>
              <span><strong>-</strong> = {t("evidence.legend_unrequested")}</span>
            </div>
          </div>

          {/* Day Detail Inspector Modal/Drawer if clicked */}
          {selectedDay && (
            <div data-testid="evidence-day-inspector" className="rounded-xl border border-cyan-500/40 bg-[#111C2E] p-4 text-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-white text-sm">
                  {t("evidence.day_audit_title", {
                    day: selectedDay.day,
                    month,
                    year,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  className="text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                <div className="rounded-lg bg-slate-900 p-2.5 border border-slate-800">
                  <span className="text-slate-400 text-xs block font-sans">{t("evidence.modis_requested_label")}</span>
                  <span className="text-blue-300 font-bold">
                    {selectedDay.modisReq == null ? t("common.unknown") : selectedDay.modisReq ? t("evidence.granule_yes") : t("evidence.granule_no")}
                  </span>
                </div>
                <div className="rounded-lg bg-slate-900 p-2.5 border border-slate-800">
                  <span className="text-slate-400 text-xs block font-sans">{t("evidence.modis_detections_label")}</span>
                  <span className="text-white font-bold">{selectedDay.modisDetect}</span>
                </div>
                <div className="rounded-lg bg-slate-900 p-2.5 border border-slate-800">
                  <span className="text-slate-400 text-xs block font-sans">{t("evidence.viirs_requested_label")}</span>
                  <span className="text-teal-300 font-bold">
                    {selectedDay.viirsReq == null ? t("common.unknown") : selectedDay.viirsReq ? t("evidence.granule_yes") : t("evidence.granule_no")}
                  </span>
                </div>
                <div className="rounded-lg bg-slate-900 p-2.5 border border-slate-800">
                  <span className="text-slate-400 text-xs block font-sans">{t("evidence.viirs_detections_label")}</span>
                  <span className="text-white font-bold">{selectedDay.viirsDetect}</span>
                </div>
              </div>
            </div>
          )}

          {/* 7. Crucial Scientific Disclaimers */}
          <div id="evidence-limits" className="scroll-mt-16 rounded-2xl border border-amber-500/30 bg-amber-950/10 p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
              <ShieldAlert className="h-4 w-4" />
              <span>{t("evidence.boundary_title")}</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {t("evidence.boundary_body")}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
