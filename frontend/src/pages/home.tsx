import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Database,
  FileUp,
  Globe2,
  Layers,
  Radio,
  Scale,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { ErrorState } from "@/components/states";
import {
  ConstellationOrbitIllustration,
  MultiScaleHarmonizationIllustration,
} from "@/components/illustrations";

export function HomePage() {
  const { t } = useLang();

  const [dataStats, setDataStats] = useState<{
    raw_count: number;
    datasets: Array<{ aoi: string; sample_rows: number; sample_bytes: number; raw_ready?: boolean; dataset_ready?: boolean; date_range?: [string, string] | null }>;
  } | null>(null);
  const [sampleRange, setSampleRange] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [interactiveMode, setInteractiveMode] = useState<"naive" | "harmonized">("naive");

  useEffect(() => {
    let alive = true;
    api.dataStatus().then((st) => {
      if (!alive) return;
      setDataStats(st);
      // P2-08: the badge range comes from the data-status manifest
      // (`date_range` per AOI), never from a full raw /calendar scan and
      // never from a hardcoded "2001-2025". Only when no manifest range
      // exists do we fall back to the cheap sample calendar (<1s); the raw
      // feed is never scanned just for a badge.
      const ranges = (st.datasets ?? [])
        .filter((d) => (d.dataset_ready ?? d.raw_ready) && d.date_range?.[0] && d.date_range?.[1])
        .map((d) => d.date_range as [string, string]);
      if (ranges.length > 0) {
        const lo = ranges.map((r) => r[0]).sort()[0].slice(0, 4);
        const hi = ranges.map((r) => r[1]).sort().reverse()[0].slice(0, 4);
        setSampleRange(`${lo} - ${hi}`);
        return;
      }
      api.calendar(1, undefined, "vietnam", "sample", "stat")
        .then((d) => {
          if (!alive) return;
          const p = d.summary?.period;
          if (p?.from && p?.to) setSampleRange(`${p.from.slice(0, 4)} - ${p.to.slice(0, 4)}`);
          else setRangeError(true);
        })
        .catch(() => {
          if (alive) setRangeError(true);
        });
    }).catch((e) => {
      if (alive) setError(e);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (error && !dataStats) return <ErrorState error={error} onRetry={() => window.location.reload()} />;

  const readyCount = (dataStats?.datasets ?? []).filter((d) => d.dataset_ready ?? d.raw_ready).length;
  const hasRawData = readyCount > 0 || (dataStats?.raw_count ?? 0) > 0;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-7xl mx-auto w-full space-y-12 pb-24">
      {/* 1. Hero Console */}
      <section data-enter data-tour="home-hero" className="relative overflow-hidden rounded-2xl border border-slate-800 bg-[#111C2E] p-6 sm:p-10 shadow-sm">
        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-300">
            <Radio className="h-3.5 w-3.5 text-cyan-400" />
            <span>{t("home.kicker")}</span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
            {t("home.hero_title")}
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-[65ch]">
            {t("home.hero_desc")}
          </p>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              to={hasRawData ? "/calendar?data=raw" : "/calendar?data=sample"}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-orange-500 transition active:scale-95 min-h-[44px]"
            >
              <span>{t("home.cta_explore")}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>

            <Link
              to="/lab?tab=replay"
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/40 px-5 py-3 text-sm font-semibold text-cyan-200 hover:bg-cyan-900/50 transition min-h-[44px]"
            >
              <span>{t("home.cta_test_lab")}</span>
            </Link>

            <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs font-mono text-slate-300 min-h-[44px]">
              <Database className="h-4 w-4 text-cyan-400" />
              <span>
                {hasRawData
                  ? t("home.feed_observed", { count: dataStats?.raw_count ?? 0 })
                  : t("home.feed_synthetic")}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Scientific Telemetry KPI Ribbon */}
      <section data-tour="home-kpis" className="grid grid-cols-2 md:grid-cols-4 gap-4 tabular-nums">
        <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4.5 space-y-1">
          <div className="flex items-center gap-2 text-cyan-400 text-xs font-mono font-bold uppercase">
            <CalendarDays className="h-4 w-4" />
            <span>{rangeError ? t("common.no_data") : (sampleRange ?? t("common.loading"))}</span>
          </div>
          <div className="text-xl font-extrabold text-white">{t("home.kpi_years_label")}</div>
          <p className="text-xs text-slate-400 leading-snug">{t("home.kpi_years_sub")}</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4.5 space-y-1">
          <div className="flex items-center gap-2 text-orange-400 text-xs font-mono font-bold uppercase">
            <Globe2 className="h-4 w-4" />
            <span>{t("home.kpi_sample_aois", { count: readyCount })}</span>
          </div>
          <div className="text-xl font-extrabold text-white">{t("home.kpi_biomes_label")}</div>
          <p className="text-xs text-slate-400 leading-snug">{t("home.kpi_biomes_sub")}</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4.5 space-y-1">
          <div className="flex items-center gap-2 text-sky-400 text-xs font-mono font-bold uppercase">
            <Layers className="h-4 w-4" />
            <span>{t("home.kpi_modis_viirs")}</span>
          </div>
          <div className="text-xl font-extrabold text-white">{t("home.kpi_satellites_label")}</div>
          <p className="text-xs text-slate-400 leading-snug">{t("home.kpi_satellites_sub")}</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4.5 space-y-1">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono font-bold uppercase">
            <Sparkles className="h-4 w-4" />
            <span>{t("home.kpi_evidence")}</span>
          </div>
          <div className="text-xl font-extrabold text-white">{t("home.kpi_grounding_label")}</div>
          <p className="text-xs text-slate-400 leading-snug">{t("home.kpi_grounding_sub")}</p>
        </div>
      </section>

      {/* 3. Constellation Orbital Architecture Illustration */}
      <section data-tour="home-orbits" className="space-y-4">
        <div className="space-y-1.5">
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {t("home.orbit_section_title")}
          </h2>
          <p className="text-sm text-slate-300 max-w-[65ch]">
            {t("home.orbit_section_desc")}
          </p>
        </div>
        <ConstellationOrbitIllustration
          activeSensors={["MODIS", "SNPP", "NOAA-20", "NOAA-21"]}
        />
      </section>

      {/* 4. Spatial Resolution Footprint & Historical Calibration */}
      <section className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1.5 max-w-[65ch]">
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
              <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0" />
              <span>{t("home.core_problem_title")}</span>
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              {t("home.core_problem_desc")}
            </p>
          </div>

          {/* Interactive Switch */}
          <div className="flex items-center rounded-xl border border-slate-700 bg-slate-900 p-1 text-xs shrink-0 font-mono">
            <button
              type="button"
              onClick={() => setInteractiveMode("naive")}
              aria-pressed={interactiveMode === "naive"}
              className={`rounded-lg px-3 py-2 transition min-h-[36px] ${
                interactiveMode === "naive"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t("home.mode_naive")}
            </button>
            <button
              type="button"
              onClick={() => setInteractiveMode("harmonized")}
              aria-pressed={interactiveMode === "harmonized"}
              className={`rounded-lg px-3 py-2 transition min-h-[36px] ${
                interactiveMode === "harmonized"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t("home.mode_harmonized")}
            </button>
          </div>
        </div>

        {/* Multi-Scale Harmonization SVG + Time Series Impact Grid */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Spatial Grid Illustration: 7 cols */}
          <div className="lg:col-span-7">
            <MultiScaleHarmonizationIllustration />
          </div>

          {/* Interactive Multi-Decadal Signal: 5 cols */}
          <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold text-xs uppercase tracking-wider text-slate-300">
                  {t("home.ts_impact_title")}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-mono border ${
                    interactiveMode === "naive"
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  }`}
                >
                  {interactiveMode === "naive"
                    ? t("home.badge_step_artifact")
                    : t("home.badge_calibrated_record")}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400">
                {t("home.ts_impact_illustrative")}
              </p>

              {/* Dynamic Bars (GPU-accelerated scaleX transform under 300ms) */}
              <div className="space-y-3 py-2 font-mono text-xs tabular-nums">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">{t("home.modis_era_label")}</span>
                    <span className="font-bold text-blue-300">
                      {interactiveMode === "naive" ? t("home.modis_only") : t("home.modis_calibrated")}
                    </span>
                  </div>
                  <div className="h-3.5 w-full rounded bg-slate-800 overflow-hidden">
                    <div
                      className="h-full w-full origin-left bg-blue-500 transition-transform duration-200 ease-out-quint"
                      style={{ transform: interactiveMode === "naive" ? "scaleX(0.35)" : "scaleX(0.85)" }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">{t("home.viirs_era_label")}</span>
                    <span className="font-bold text-teal-300">
                      {interactiveMode === "naive" ? t("home.viirs_unadjusted") : t("home.viirs_unified")}
                    </span>
                  </div>
                  <div className="h-3.5 w-full rounded bg-slate-800 overflow-hidden">
                    <div
                      className="h-full w-full origin-left bg-teal-500 transition-transform duration-200 ease-out-quint"
                      style={{ transform: "scaleX(0.9)" }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`rounded-lg border p-3.5 text-xs leading-relaxed ${
                interactiveMode === "naive"
                  ? "border-rose-500/30 bg-rose-950/20 text-rose-200"
                  : "border-emerald-500/30 bg-emerald-950/20 text-emerald-200"
              }`}
            >
              {interactiveMode === "naive" ? (
                <span>
                  <strong>{t("home.artifact_bold")}</strong>{" "}
                  {t("home.artifact_desc")}
                </span>
              ) : (
                <span>
                  <strong>{t("home.calibrated_bold")}</strong>{" "}
                  {t("home.calibrated_desc")}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 5. Explore a Question (3 Action Cards) */}
      <section data-tour="home-cards" className="space-y-4">
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
          {t("home.explore_title")}
        </h2>

        <div className="grid gap-4 md:grid-cols-3">
          <Link
            data-fh-card-link
            to="/calendar"
            className="group rounded-2xl border border-slate-800 bg-[#111C2E] p-5 shadow-sm hover:border-cyan-500/40 min-h-[160px] flex flex-col justify-between"
          >
            <div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/40 text-cyan-300 mb-4 group-hover:scale-105 transition-transform duration-150">
                <CalendarDays className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-white text-base mb-1.5 flex items-center justify-between">
                <span>{t("home.q1_title")}</span>
                <ArrowRight data-fh-arrow className="h-4 w-4 text-slate-500 group-hover:text-cyan-400" />
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {t("home.q1_desc")}
              </p>
            </div>
            <span className="text-xs font-semibold text-cyan-400 pt-3 flex items-center gap-1">
              {t("home.q1_btn")} &rarr;
            </span>
          </Link>

          <Link
            data-fh-card-link
            to="/lab?tab=xray"
            className="group rounded-2xl border border-slate-800 bg-[#111C2E] p-5 shadow-sm hover:border-amber-500/40 min-h-[160px] flex flex-col justify-between"
          >
            <div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-950/40 text-amber-300 mb-4 group-hover:scale-105 transition-transform duration-150">
                <Scale className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-white text-base mb-1.5 flex items-center justify-between">
                <span>{t("home.q2_title")}</span>
                <ArrowRight data-fh-arrow className="h-4 w-4 text-slate-500 group-hover:text-amber-400" />
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {t("home.q2_desc")}
              </p>
            </div>
            <span className="text-xs font-semibold text-amber-400 pt-3 flex items-center gap-1">
              {t("home.q2_btn")} &rarr;
            </span>
          </Link>

          <Link
            data-fh-card-link
            to="/evidence?aoi=vietnam"
            className="group rounded-2xl border border-slate-800 bg-[#111C2E] p-5 shadow-sm hover:border-emerald-500/40 min-h-[160px] flex flex-col justify-between"
          >
            <div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-950/40 text-emerald-300 mb-4 group-hover:scale-105 transition-transform duration-150">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-white text-base mb-1.5 flex items-center justify-between">
                <span>{t("home.q3_title")}</span>
                <ArrowRight data-fh-arrow className="h-4 w-4 text-slate-500 group-hover:text-emerald-400" />
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {t("home.q3_desc")}
              </p>
            </div>
            <span className="text-xs font-semibold text-emerald-400 pt-3 flex items-center gap-1">
              {t("home.q3_btn")} &rarr;
            </span>
          </Link>
        </div>
      </section>

      {/* 6. Three-Stage Scientific Pipeline */}
      <section className="space-y-4">
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
          {t("home.three_steps_title")}
        </h2>

        <div className="grid gap-4 md:grid-cols-3 font-mono text-xs">
          <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4.5 space-y-2">
            <div className="text-cyan-400 font-bold text-sm">
              {t("home.step1_title")}
            </div>
            <p className="font-sans text-xs text-slate-300 leading-relaxed">
              {t("home.step1_desc")}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4.5 space-y-2">
            <div className="text-cyan-400 font-bold text-sm">
              {t("home.step2_title")}
            </div>
            <p className="font-sans text-xs text-slate-300 leading-relaxed">
              {t("home.step2_desc")}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4.5 space-y-2">
            <div className="text-cyan-400 font-bold text-sm">
              {t("home.step3_title")}
            </div>
            <p className="font-sans text-xs text-slate-300 leading-relaxed">
              {t("home.step3_desc")}
            </p>
          </div>
        </div>
      </section>

      {/* 7. Calibrated Study Areas */}
      <section className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 sm:p-8 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              {t("home.study_areas_title")}
            </h2>
            <p className="text-xs text-slate-400">
              {t("home.study_areas_sub")}
            </p>
          </div>
          <span className="font-mono text-xs text-cyan-400">{t("home.aoi_count_badge")}</span>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Vietnam */}
          <div className="rounded-xl border border-cyan-500/30 bg-slate-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200">{t("home.aoi_vn_name")}</span>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-mono text-emerald-300">
                {t("home.badge_full_record")}
              </span>
            </div>
            <p className="text-xs text-slate-300">
              {t("home.aoi_vn_desc")}
            </p>
            <div className="space-y-1 font-mono text-xs text-slate-400 pt-1">
              <div>{t("home.bbox_vn")}</div>
            </div>
            <Link
              to="/calendar"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/40 py-2.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/50 transition min-h-[40px]"
            >
              <span>{t("home.open_vn_cal")}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Amazon */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200">{t("home.aoi_amz_name")}</span>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-mono text-emerald-300">
                {t("home.badge_peak_2019")}
              </span>
            </div>
            <p className="text-xs text-slate-300">
              {t("home.aoi_amz_desc")}
            </p>
            <div className="space-y-1 font-mono text-xs text-slate-400 pt-1">
              <div>{t("home.bbox_amz")}</div>
            </div>
            <Link
              to="/calendar?aoi=amazon"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition min-h-[40px]"
            >
              <span>{t("home.open_amz_cal")}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Australia */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200">{t("home.aoi_aus_name")}</span>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-mono text-amber-300">
                {t("home.badge_black_summer")}
              </span>
            </div>
            <p className="text-xs text-slate-300">
              {t("home.aoi_aus_desc")}
            </p>
            <div className="space-y-1 font-mono text-xs text-slate-400 pt-1">
              <div>{t("home.bbox_aus")}</div>
            </div>
            <Link
              to="/calendar?aoi=australia"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition min-h-[40px]"
            >
              <span>{t("home.open_aus_cal")}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* 8. Advanced Research Tools Section (CSV Import) */}
      <section className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <FileUp className="h-4 w-4 text-cyan-400" />
            <span>{t("home.adv_tools_title")}</span>
          </div>
          <span className="text-xs text-slate-400">{t("home.data_import_sub")}</span>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="space-y-1">
            <div className="font-bold text-white text-sm">
              {t("home.import_csv_title")}
            </div>
            <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
              {t("home.import_csv_desc")}
            </p>
          </div>
          <Link
            to="/methods"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-xs font-semibold text-white transition shrink-0 min-h-[40px]"
          >
            <span>{t("home.go_csv_tools")}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* 9. Scientific Boundaries & Limits */}
      <section className="rounded-2xl border border-amber-500/30 bg-amber-950/10 p-6 sm:p-8 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
          <ShieldAlert className="h-4 w-4" />
          <span>{t("home.boundaries_title")}</span>
        </div>

        <div className="grid gap-4 md:grid-cols-3 text-xs text-slate-300 leading-relaxed">
          <div className="space-y-1.5">
            <div className="font-bold text-white">
              {t("home.bound1_title")}
            </div>
            <p className="text-slate-400">
              {t("home.bound1_desc")}
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="font-bold text-white">
              {t("home.bound2_title")}
            </div>
            <p className="text-slate-400">
              {t("home.bound2_desc")}
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="font-bold text-white">
              {t("home.bound3_title")}
            </div>
            <p className="text-slate-400">
              {t("home.bound3_desc")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
