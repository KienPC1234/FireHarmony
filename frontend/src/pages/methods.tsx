import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BookOpen,
  BrainCircuit,
  ExternalLink,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Upload,
} from "lucide-react";
import { api, describeError, type BacktestResponse } from "@/lib/api";
import { notifyToast } from "@/lib/notify";
import { parseCsv } from "@/lib/csv";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ModelArchitectureDiagram } from "@/components/methods/ModelArchitectureDiagram";
import { Latex } from "@/components/common/Latex";

const METHOD_SPECS = [
  {
    id: "b0_raw_modis",
    name: { vi: "B0: Raw MODIS (Chưa hiệu chỉnh)", en: "B0: Raw MODIS (Unadjusted Baseline)" },
    category: { vi: "Baseline đối chứng", en: "Unadjusted Baseline" },
    formula: "\\hat{y} = x_{modis}",
    input: { vi: "Số điểm nóng MODIS C6.1 thô theo ngày", en: "Daily raw MODIS C6.1 hotspot counts" },
    target: { vi: "Cộng dồn trực tiếp", en: "Direct additive aggregation" },
    assumptions: {
      vi: "Giả định MODIS và VIIRS có xác suất phát hiện như nhau (sai lệch khoa học).",
      en: "Assumes MODIS and VIIRS share identical detection probabilities (physically invalid).",
    },
    abstains: { vi: "Không bao giờ từ chối.", en: "Never abstains." },
    failures: {
      vi: "Đếm thiếu 3x - 4x so với VIIRS 375m; tạo bước nhảy giả năm 2012.",
      en: "Undercounts 3x - 4x relative to VIIRS 375m; produces an artificial 2012 step jump.",
    },
  },
  {
    id: "b1_global_ratio",
    name: { vi: "B1: Hệ số nhân cố định (Global Ratio)", en: "B1: Scalar Global Ratio" },
    category: { vi: "Tỷ lệ thực nghiệm tĩnh", en: "Empirical Multiplier" },
    formula: "\\hat{y} = x_{modis} \\cdot k_{global}",
    input: { vi: "Điểm nóng MODIS tổng tháng", en: "Monthly aggregated MODIS counts" },
    target: { vi: "Ước lượng tương đương VIIRS qua hệ số k đơn lẻ", en: "Scalar k VIIRS-equivalent activity estimate" },
    assumptions: {
      vi: "Giả định tỷ lệ hai cảm biến không đổi qua 12 tháng và các loại địa hình.",
      en: "Assumes constant sensor ratio across all 12 calendar months and landcover classes.",
    },
    abstains: { vi: "Từ chối nếu không có tháng quan trắc song song nào.", en: "Abstains if zero co-observed months exist." },
    failures: {
      vi: "Sai lệch lớn vào các tháng chuyển tiếp mùa mưa và đỉnh mùa khô.",
      en: "Large seasonal errors during monsoon transition and peak dry months.",
    },
  },
  {
    id: "b2_seasonal_ratio",
    name: { vi: "B2: Hệ số mùa 12 tháng (Triển khai chính)", en: "B2: Seasonal Ratio (Operational Baseline)" },
    category: { vi: "Chu kỳ thiên văn 12 tháng", en: "Empirical Monthly Harmonic" },
    formula: "\\hat{y} = x_{modis} \\cdot k_m^{B2}",
    input: { vi: "MODIS tháng + 12 hệ số k_m thực nghiệm theo từng tháng", en: "Monthly MODIS + 12 empirical seasonal k_m ratios" },
    target: { vi: "Chỉ số hoạt động tương đương VIIRS theo mùa", en: "Seasonally harmonized VIIRS-equivalent activity index" },
    assumptions: {
      vi: "Tỷ lệ cảm biến biến thiên tuần hoàn theo góc chiếu mặt trời và chu kỳ khí tượng theo tháng.",
      en: "Sensor sensitivity ratio varies cyclically with solar elevation and seasonal meteorology.",
    },
    abstains: { vi: "Từ chối nếu tháng đó có ít hơn 3 năm quan trắc song song.", en: "Abstains if target month has fewer than 3 co-observed years." },
    failures: {
      vi: "Không nắm bắt được dị thường hạn hán cực đoan lệch khỏi mô hình 12 tháng lịch sử.",
      en: "Fails to capture severe drought anomalies departing from historical 12-month norms.",
    },
  },
  {
    id: "hts_anchor_v1",
    name: { vi: "HTS: Neo mùa vụ theo ô 1° (candidate)", en: "HTS: 1° Tile-Seasonal Anchor (candidate)" },
    category: { vi: "Phân cấp không gian - tháng", en: "Spatial-Monthly Hierarchy" },
    formula: "\\hat{y} = \\sum_{tile} \\left( x_{tile} \\cdot \\left[ w k_{tile,m} + (1-w) k_{aoi,m}^{B2} \\right] \\right)",
    input: { vi: "Mỗi ô 1°: chuỗi MODIS tháng + tỷ lệ mùa của chính ô, co về B2", en: "Per 1° tile: MODIS months + tile seasonal ratio shrunk toward B2" },
    target: { vi: "Tổng VIIRS tương đương theo ô-tháng, cộng lên AOI", en: "VIIRS-equivalent per tile-month, summed to the AOI" },
    assumptions: {
      vi: "Sai lệch cảm biến có cấu trúc không gian; ô sparse được co về mùa vụ vùng (w=n/(n+3)).",
      en: "Sensor bias is spatially structured; sparse tiles shrink to the regional seasonal ratio (w=n/(n+3)).",
    },
    abstains: {
      vi: "Sample không có ô 1° → từ chối (409). Raw thiếu tháng → giữ giá trị thống kê.",
      en: "Sample has no 1° tiles → abstains (409). Missing raw months keep the statistical value.",
    },
    failures: {
      vi: "eval-v4: MAE 4.172,7 vs B2 4.462,6 (−6,5%), nhưng CI 95% vẫn chứa 0.",
      en: "eval-v4: MAE 4,172.7 vs B2 4,462.6 (−6.5%), but 95% CI still includes 0.",
    },
  },
  {
    id: "stan_safe_v1",
    name: { vi: "STAN: Spatial-Temporal Anchor Network (chủ lực, forecast-safe)", en: "STAN: Spatial-Temporal Anchor Network (main, forecast-safe)" },
    category: { vi: "Count likelihood + mùa + không gian", en: "Count Likelihood + Season + Space" },
    input: { vi: "Cửa sổ 12 tháng MODIS + days_modis + lân cận (MODIS cùng tháng, VIIRS tháng trước) + HTS anchor", en: "12-month MODIS window + days_modis + neighbours (same-month MODIS, previous-month VIIRS) + HTS anchor" },
    target: { vi: "Negative-binomial cho VIIRS count, mean = anchor × exp(δ)", en: "Negative-binomial for VIIRS count, mean = anchor × exp(δ)" },
    assumptions: {
      vi: "Đếm overdispersed; mùa điều biến đặc trưng (FiLM); cháy lan theo ô lân cận; exposure theo số ngày quan sát.",
      en: "Over-dispersed counts; season modulates features (FiLM); fire spreads across neighbours; exposure follows observed days.",
    },
    abstains: {
      vi: "Không dùng VIIRS cùng tháng của ô lân cận. Tháng thiếu cửa sổ 12 tháng dùng HTS fallback.",
      en: "Does not use same-month neighbour VIIRS. Months without a 12-month window fall back to HTS.",
    },
    failures: {
      vi: "Official 72 (eval-v4): MAE 3.899,5 vs B2 4.462,6 (−12,6%); tuy nhiên 95% CI [−1.184,4, +50,8] vẫn chứa 0 (statistically_established: false).",
      en: "Official 72 (eval-v4): MAE 3,899.5 vs B2 4,462.6 (−12.6%); however 95% CI [−1,184.4, +50.8] includes 0 (statistically_established: false).",
    },
  },
];

const BENCH_ROWS = [
  {
    id: "b0_raw_modis",
    label: { vi: "B0: Raw MODIS (Chưa hiệu chỉnh)", en: "B0: Raw MODIS (Unadjusted)" },
    tag: { vi: "Sai lệch nặng", en: "Severe Distortion" },
    tagClass: "bg-rose-500/15 border-rose-500/30 text-rose-300",
  },
  {
    id: "b1_global_ratio",
    label: { vi: "B1: Hệ số nhân cố định (Global Ratio)", en: "B1: Scalar Global Ratio" },
    tag: { vi: "Khớp thô", en: "Coarse Fit" },
    tagClass: "bg-amber-500/15 border-amber-500/30 text-amber-300",
  },
  {
    id: "b2_seasonal_ratio",
    label: { vi: "B2: Hệ số mùa 12 tháng (Baseline đối chứng)", en: "B2: Seasonal Ratio (Reference Baseline)" },
    tag: { vi: "Baseline đối chứng", en: "Reference Baseline" },
    tagClass: "bg-sky-500/15 border-sky-500/30 text-sky-300 font-bold",
  },
  {
    id: "hts_anchor_v1",
    label: { vi: "HTS: neo mùa vụ theo ô 1° (dự phòng)", en: "HTS: 1° tile-seasonal anchor (fallback)" },
    tag: { vi: "Dự phòng không gian", en: "Spatial Fallback" },
    tagClass: "bg-amber-500/15 border-amber-500/30 text-amber-300",
  },
  {
    id: "stan_safe_v1",
    label: { vi: "STAN: Mạng không-thời gian STAN (Chủ lực vận hành)", en: "STAN: Spatio-temporal network (Operational)" },
    tag: { vi: "Chủ lực vận hành · MAE -12,6%", en: "Primary Operational · MAE -12.6%" },
    tagClass: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 font-bold",
  },
];

const VALID_SECTIONS = new Set(["sources", "steps", "benchmark", "limits", "reproduce"]);

export function MethodsPage() {
  const { lang, t } = useLang();
  const vi = lang === "vi";
  const [sp, setSp] = useSearchParams();

  const rawSec = sp.get("sec") || "steps";
  const activeSection = VALID_SECTIONS.has(rawSec) ? rawSec : "steps";
  const setActiveSection = (sec: string) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      if (sec === "steps") next.delete("sec");
      else next.set("sec", sec);
      return next;
    }, { replace: true });
  };
  const [file, setFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<string>("");
  const [uploadLoading, setUploadLoading] = useState(false);
  const [bench, setBench] = useState<BacktestResponse | null>(null);
  const [benchErr, setBenchErr] = useState("");
  const [benchData, setBenchData] = useState<"raw" | "sample">("raw");

  useEffect(() => {
    let alive = true;
    // The clean ZIP ships the frozen benchmark but not the 820 MB raw pull.
    // Ask the server what exists and fall back to the deterministic sample.
    api
      .dataStatus()
      .then((st) => ((st.raw_count ?? 0) > 0 ? "raw" : "sample") as "raw" | "sample")
      .catch(() => "sample" as const)
      .then((mode) => {
        if (!alive) return;
        setBenchData(mode);
        return api
          .backtest("vietnam", mode)
          .then((r) => {
            if (alive) setBench(r);
          })
          .catch((e) => {
            if (alive) setBenchErr(describeError(e));
          });
      });
    return () => {
      alive = false;
    };
  }, []);

  async function handleUpload() {
    if (!file) return;
    setUploadResult("");
    setUploadLoading(true);
    try {
      const text = await file.text();
      const records = parseCsv(text, 5000);
      const v = await api.validate(records);
      const h = await api.harmonize(records);
      const msg = t("methods.upload_result", {
        n: records.length,
        clean: v.clean,
        rejected: v.rejected,
        cells: h.daily_cells,
      });
      setUploadResult(msg);
      notifyToast({ icon: "success", title: msg });
    } catch (e) {
      const errMsg = describeError(e);
      setUploadResult(errMsg);
      notifyToast({ icon: "error", title: errMsg });
    } finally {
      setUploadLoading(false);
    }
  }

  const sections = [
    { id: "sources", title: t("methods.sec_sources") },
    { id: "steps", title: t("methods.sec_steps") },
    { id: "benchmark", title: t("methods.sec_benchmark") },
    { id: "limits", title: t("methods.sec_limits") },
    { id: "reproduce", title: t("methods.sec_reproduce") },
  ];

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 space-y-8 max-w-7xl mx-auto w-full pb-24">
      {/* 1. Header */}
      <div data-enter className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 shadow-sm space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-300">
          <BookOpen className="h-4 w-4" />
          <span>NASA Space Apps Challenge 2026 · Scientific Documentation</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          {t("methods.hero_title")}
        </h1>
        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl">
          {t("methods.hero_sub")}
        </p>
      </div>

      {/* 2. Executive Summary (90-second Briefing) */}
      <section data-tour="methods-header" className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
          <Sparkles className="h-4 w-4" />
          <span>{t("methods.exec_title")}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs text-slate-300">
          <div className="space-y-1 rounded-xl bg-slate-900/60 p-3 border border-slate-800">
            <span className="font-bold text-white block">{t("methods.exec_problem_l")}</span>
            <p className="text-slate-400 leading-relaxed">
              {t("methods.exec_problem_t")}
            </p>
          </div>
          <div className="space-y-1 rounded-xl bg-slate-900/60 p-3 border border-slate-800">
            <span className="font-bold text-white block">{t("methods.exec_solution_l")}</span>
            <p className="text-slate-400 leading-relaxed">
              {t("methods.exec_solution_t")}
            </p>
          </div>
          <div className="space-y-1 rounded-xl bg-slate-900/60 p-3 border border-slate-800">
            <span className="font-bold text-white block">{t("methods.exec_verify_l")}</span>
            <p className="text-slate-400 leading-relaxed">
              {t("methods.exec_verify_t")}
            </p>
          </div>
          <div className="space-y-1 rounded-xl bg-slate-900/60 p-3 border border-slate-800">
            <span className="font-bold text-white block">{t("methods.exec_bound_l")}</span>
            <p className="text-slate-400 leading-relaxed">
              {t("methods.exec_bound_t")}
            </p>
          </div>
        </div>
      </section>

      {/* 3. Section Switcher: one accessible, horizontally scrollable row on small screens. */}
      <nav data-tour="methods-nav" aria-label={t("methods.nav_label")}
        className="sticky top-0 z-20 rounded-xl border border-slate-800 bg-[#0B1220]/95 px-2 py-2 shadow-lg backdrop-blur-md">
      <div className="flex snap-x items-center gap-2 overflow-x-auto pb-0.5" role="group">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveSection(s.id)}
            aria-pressed={activeSection === s.id}
            className={cn(
              "shrink-0 snap-start whitespace-nowrap rounded-xl px-4 py-2 text-xs font-semibold transition min-h-[40px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400",
              activeSection === s.id
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                : "bg-[#111C2E] text-slate-400 hover:text-white border border-slate-800"
            )}
          >
            {s.title}
          </button>
        ))}
      </div>

      </nav>
      {/* 4. Content Panels */}
      <div data-tour="methods-body" className="space-y-6">

      {/* SECTION 1: DATA SOURCES */}
      {activeSection === "sources" && (
        <section className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 shadow-sm space-y-4">
          <div className="space-y-1 border-b border-slate-800 pb-3">
            <h2 className="text-base font-bold text-white">
              {t("methods.src_title")}
            </h2>
            <p className="text-xs text-slate-400">
              {t("methods.src_sub")}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 text-xs font-mono">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-blue-400">MODIS Collection 6.1</span>
                <span className="text-slate-400">{t("methods.src_modis_date")}</span>
              </div>
              <p className="font-sans text-xs text-slate-300 leading-relaxed">
                {t("methods.src_modis_desc")}
              </p>
              <a
                href="https://earthdata.nasa.gov/data/tools/firms"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:underline pt-1"
              >
                <span>{t("methods.src_modis_docs")}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-teal-400">VIIRS 375 m Active Fire</span>
                <span className="text-slate-400">{t("methods.src_viirs_date")}</span>
              </div>
              <p className="font-sans text-xs text-slate-300 leading-relaxed">
                {t("methods.src_viirs_desc")}
              </p>
              <a
                href="https://earthdata.nasa.gov/data/tools/firms"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-teal-400 hover:underline pt-1"
              >
                <span>{t("methods.src_viirs_docs")}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </section>
      )}

      {/* SECTION 2: HARMONIZATION STEPS & ARCHITECTURE DIAGRAM */}
      {activeSection === "steps" && (
        <section className="space-y-6">
          {/* Interactive Neural Network & Pipeline Architecture Diagram */}
          <ModelArchitectureDiagram />

          {/* Clear Summary Matrix: Models & Execution Scopes */}
          <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-5 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <h2 id="methods-scope-matrix-title" className="text-sm font-bold text-white">
                {vi
                  ? "Tổng hợp 3 tầng mô hình & phạm vi áp dụng"
                  : "Three-Tier Harmonization Matrix & Execution Scope"}
              </h2>
              <span className="font-mono text-[11px] text-cyan-300">
                {vi ? "Unknown-Day Safe · Không nội suy 0 giả" : "Unknown-Day Safe · No Zero Imputation"}
              </span>
            </div>
            <div
              role="region"
              aria-labelledby="methods-scope-matrix-title"
              tabIndex={0}
              className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
                    <th className="py-2 pr-3">{vi ? "Phương pháp" : "Method"}</th>
                    <th className="py-2 pr-3">{vi ? "Cơ chế chính" : "Core Mechanism"}</th>
                    <th className="py-2 pr-3">{vi ? "Phạm vi dữ liệu" : "Data Scope"}</th>
                    <th className="py-2">{vi ? "Đầu ra & Vai trò" : "Output & Role"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-slate-300">
                  <tr>
                    <td className="py-2.5 pr-3 font-mono font-bold text-cyan-300">B2 Seasonal Anchor (stat)</td>
                    <td className="py-2.5 pr-3">
                      {vi
                        ? "Tỷ lệ log theo tháng giữa VIIRS và MODIS trên giai đoạn đồng quan sát."
                        : "Monthly log-ratio calibration between VIIRS and MODIS during co-observation."}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px]">
                      {vi ? "Vùng chuẩn + Live FIRMS + CSV" : "Benchmark AOIs + Live FIRMS + CSV"}
                    </td>
                    <td className="py-2.5">
                      {vi
                        ? "Nhanh, minh bạch; chạy trực tiếp cho cả chuỗi ngày (daily X-Ray) lẫn tháng."
                        : "Fast, deterministic baseline; powers both daily X-Ray and monthly views."}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-3 font-mono font-bold text-amber-300">HTS (1° Tile Anchor)</td>
                    <td className="py-2.5 pr-3">
                      {vi
                        ? "Hệ số mùa riêng cho từng ô lưới 1° co về B2 (shrinkage) rồi cộng dồn theo vùng."
                        : "Per-1° spatial tile seasonal ratio shrunk toward B2, then aggregated."}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px]">
                      {vi ? "Vùng chuẩn (data=raw)" : "Benchmark AOIs (data=raw)"}
                    </td>
                    <td className="py-2.5">
                      {vi
                        ? "Giảm sai số không gian cục bộ; giữ làm phương pháp đối chiếu (candidate)."
                        : "Captures sub-regional spatial variance; retained as candidate baseline."}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-3 font-mono font-bold text-emerald-300">STAN Safe v1</td>
                    <td className="py-2.5 pr-3">
                      {vi
                        ? "Dilated TCN + FiLM theo mùa + Cross-Attention dự đoán phần dư NB2 trên nền HTS."
                        : "Dilated TCN + seasonal FiLM + Cross-Attention predicting NB2 residual over HTS."}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px]">
                      {vi ? "Vùng chuẩn (data=raw)" : "Benchmark AOIs (data=raw)"}
                    </td>
                    <td className="py-2.5">
                      {vi
                        ? "Mô hình chủ lực kèm khoảng bất định [P10, P50, P90] và cổng kiểm định forecast-safe."
                        : "Primary model with [P10, P50, P90] uncertainty bands and forecast-safe gate."}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Deep-Dive Architectural & Mathematical Formulation Cards */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Card 1: Objective & Formulation */}
            <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-5 shadow-sm space-y-3.5 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                  <BrainCircuit className="h-4 w-4" />
                  <span>{t("methods.card1_kicker")}</span>
                </div>
                <h3 className="text-sm font-bold text-white">
                  {t("methods.card1_title")}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {t("methods.card1_body")}
                </p>
                <div tabIndex={0}
                  className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-cyan-300 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
                  <div className="text-[11px] space-y-2 font-mono">
                    <Latex math="\mu_{i,t} = \hat{y}^{\text{HTS}}_{i,t} \cdot \exp(\Delta \hat{r}_{i,t})" block />
                    <Latex math="y_{i,t} \sim \text{NB2}(\mu_{i,t}, \alpha_{i,t})" block />
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-cyan-950/30 border border-cyan-800/40 p-2.5 text-[11px] text-cyan-200 leading-snug">
                {t("methods.card1_note")}
              </div>
            </div>

            {/* Card 2: Tensor Shape Pipeline & Dilated TCN + FiLM */}
            <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-5 shadow-sm space-y-3.5 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider">
                  <Layers className="h-4 w-4" />
                  <span>{t("methods.card2_kicker")}</span>
                </div>
                <h3 className="text-sm font-bold text-white">
                  {t("methods.card2_title")}
                </h3>
                <div className="space-y-2 text-xs font-mono text-slate-300">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-slate-400 font-sans">{t("methods.card2_r1")}</span>
                    <span className="text-white font-bold">[B, 12, C_in]</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-slate-400 font-sans">{t("methods.card2_r2")}</span>
                    <span className="text-white font-bold">[B, 12, 64]</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-slate-400 font-sans">{t("methods.card2_r3")}</span>
                    <span className="text-cyan-300 font-bold">gamma * h + beta</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-sans">{t("methods.card2_r4")}</span>
                    <span className="text-emerald-300 font-bold">(mu, alpha) → [P10, P50, P90]</span>
                  </div>
                </div>
                <div tabIndex={0}
                  className="rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-indigo-300 overflow-x-auto text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
                  <Latex math="\mathcal{L}_{\text{NB2}} = -\log \Gamma(y + r) + \log \Gamma(r) - r\log p - y\log(1-p)" block />
                </div>
              </div>
              <div className="rounded-lg bg-indigo-950/30 border border-indigo-800/40 p-2.5 text-[11px] text-indigo-200 leading-snug">
                {t("methods.card2_note")}
              </div>
            </div>

            {/* Card 3: Circuit Breaker Statistical Gate */}
            <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-5 shadow-sm space-y-3.5 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
                  <ShieldCheck className="h-4 w-4" />
                  <span>{t("methods.card3_kicker")}</span>
                </div>
                <h3 className="text-sm font-bold text-white">
                  {t("methods.card3_title")}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {t("methods.card3_body")}
                </p>
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 space-y-2 text-xs font-mono">
                  <div className="flex justify-between items-center text-slate-300 border-b border-slate-800 pb-1">
                    <span>B2 Baseline MAE:</span>
                    <span className="font-bold text-slate-200">4,462.6</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300 border-b border-slate-800 pb-1">
                    <span>HTS Candidate MAE:</span>
                    <span className="font-bold text-amber-400">4,172.7 (-6.5%)</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300">
                    <span>STAN Operational MAE:</span>
                    <span className="font-bold text-emerald-400">3,899.5 (-12.6%)</span>
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/40 p-2.5 text-[11px] text-emerald-200 leading-snug">
                {t("methods.card3_note")}
              </div>
            </div>
          </div>

          {/* Mathematical Specifications Table */}
          <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-6 shadow-sm space-y-4">
            <div className="space-y-1 border-b border-slate-800 pb-3">
              <h2 className="text-base font-bold text-white">
                {t("methods.spec_title")}
              </h2>
              <p className="text-xs text-slate-400">
                {t("methods.spec_sub")}
              </p>
            </div>

            <div tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
              <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase text-xs">
                  <th className="py-2.5 pr-4">{t("methods.th_model")}</th>
                  <th className="py-2.5 pr-4">{t("methods.th_formula")}</th>
                  <th className="py-2.5 pr-4">{t("methods.th_target")}</th>
                  <th className="py-2.5 pr-4">{t("methods.th_assump")}</th>
                  <th className="py-2.5 pr-4">{t("methods.th_abstain")}</th>
                  <th className="py-2.5 text-right">{t("methods.th_fail")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {METHOD_SPECS.map((spec) => (
                  <tr key={spec.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 pr-4">
                      <div className="font-sans font-bold text-white">{vi ? spec.name.vi : spec.name.en}</div>
                      <div className="text-xs text-cyan-400">{vi ? spec.category.vi : spec.category.en}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800/80 text-cyan-300 font-sans inline-block whitespace-nowrap">
                        <Latex math={spec.formula} />
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-slate-300">{vi ? spec.target.vi : spec.target.en}</td>
                    <td className="py-3 pr-4 font-sans text-xs text-slate-300 max-w-xs">{vi ? spec.assumptions.vi : spec.assumptions.en}</td>
                    <td className="py-3 pr-4 font-sans text-xs text-slate-300 max-w-xs">{vi ? spec.abstains.vi : spec.abstains.en}</td>
                    <td className="py-3 text-right font-sans text-xs text-amber-300 max-w-xs">{vi ? spec.failures.vi : spec.failures.en}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    )}

      {/* SECTION 3: BENCHMARK */}
      {activeSection === "benchmark" && (
        <section className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 shadow-sm space-y-4">
          <div className="space-y-1 border-b border-slate-800 pb-3">
            <h2 className="text-base font-bold text-white">
              {t("methods.bench_title")}
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {bench?.headline ? (
                <>{t("methods.bench_desc", { count: bench.n_eval_intersection ?? 0 })}</>
              ) : (
                t("methods.bench_loading")
              )}
            </p>
            {benchData === "sample" && (
              <p className="text-xs text-amber-300/90 leading-relaxed font-mono">
                {t("methods.bench_sample_note")}
              </p>
            )}
          </div>

          <div tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase text-xs">
                  <th className="py-2.5">{t("methods.bench_th_pipeline")}</th>
                  <th className="py-2.5 text-right">Holdout MAE</th>
                  <th className="py-2.5 text-right">Holdout WAPE</th>
                  <th className="py-2.5 text-right">{t("methods.bench_th_bias")}</th>
                  <th className="py-2.5 text-center">{t("methods.bench_th_status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {bench?.headline ? (
                  BENCH_ROWS.map((row) => {
                    const m = row.id === "hts_anchor_v1"
                      ? bench.hts?.headline
                      : row.id === "stan_safe_v1"
                      ? bench.stan?.official?.headline
                      : bench.headline?.metrics[row.id];
                    if (!m) return null;
                    const tag = row.id === "hts_anchor_v1"
                      ? { vi: "Candidate · chưa vượt gate", en: "Candidate · gate not passed" }
                      : row.id === "stan_safe_v1"
                      ? { vi: "Chủ lực · forecast-safe", en: "Main · forecast-safe" }
                      : row.tag;
                    const tone = row.id === "hts_anchor_v1"
                      ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
                      : row.tagClass;
                    return (
                      <tr key={row.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 font-sans font-semibold text-slate-200">{vi ? row.label.vi : row.label.en}</td>
                        <td className="py-3 text-right font-bold text-white">
                          {m.mae != null ? Math.round(m.mae).toLocaleString() : "-"}
                        </td>
                        <td className="py-3 text-right font-bold text-cyan-300">
                          {m.wape != null ? `${(m.wape * 100).toFixed(1)}%` : "-"}
                        </td>
                        <td className="py-3 text-right text-slate-300">
                          {m.bias != null ? `${m.bias >= 0 ? "+" : ""}${Math.round(m.bias).toLocaleString()}` : "-"}
                        </td>
                        <td className="py-3 text-center">
                          <span className={cn("px-2.5 py-0.5 rounded-full border text-xs", tone)}>
                            {vi ? tag.vi : tag.en}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-400">
                      {benchErr ? t("methods.bench_error", { error: benchErr }) : t("methods.bench_loading_row")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {bench?.stan?.official && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-xs text-slate-300 leading-relaxed font-sans space-y-1">
              <p className="font-bold text-emerald-300">
                {t("methods.bench_stan_title")}
              </p>
              <p>
                {t("methods.bench_stan_body", {
                  mae: Math.round(bench.stan.official.metrics.mae).toLocaleString(),
                  b2mae: Math.round(bench.stan.official.b2_metrics.mae).toLocaleString(),
                  pct: (100 - (100 * bench.stan.official.metrics.mae) / bench.stan.official.b2_metrics.mae).toFixed(1),
                  ci0: Math.round(bench.stan.official.comparisons?.stan_vs_b2?.ci95?.[0] ?? 0).toLocaleString(),
                  ci1: Math.round(bench.stan.official.comparisons?.stan_vs_b2?.ci95?.[1] ?? 0).toLocaleString(),
                  vn: Math.round(bench.stan.official.per_aoi?.vietnam?.stan?.mae ?? 0).toLocaleString(),
                  amz: Math.round(bench.stan.official.per_aoi?.amazon?.stan?.mae ?? 0).toLocaleString(),
                  aus: Math.round(bench.stan.official.per_aoi?.australia?.stan?.mae ?? 0).toLocaleString(),
                })}
              </p>
              <p className="text-slate-400">
                {t("methods.bench_stan_design", { params: bench.stan.params.toLocaleString() })}
              </p>
            </div>
          )}

          {bench?.spatial && (
            <div className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-4 text-xs text-slate-300 leading-relaxed font-sans space-y-1">
              <p className="font-bold text-purple-300">
                {t("methods.bench_spatial_title")}
              </p>
              <p>
                {t("methods.bench_spatial_body", {
                  months: 72,
                  mae: Math.round(bench.spatial.headline.mae).toLocaleString(),
                  b2mae: Math.round(bench.spatial.b2_headline.mae).toLocaleString(),
                  pct: (100 - (100 * bench.spatial.headline.mae) / bench.spatial.b2_headline.mae).toFixed(1),
                  tiles: bench.spatial.spatial_holdout?.held_tiles ?? 0,
                  smae: Math.round(bench.spatial.spatial_holdout?.spatial_mae ?? 0).toLocaleString(),
                  hmae: Math.round(bench.spatial.spatial_holdout?.hts_mae ?? 0).toLocaleString(),
                })}
              </p>
              <p className="text-slate-400">
                {t("methods.bench_spatial_note", {
                  safe: Math.round(bench.spatial.safe_headline.mae).toLocaleString(),
                  hts: Math.round(bench.spatial.hts_headline.mae).toLocaleString(),
                })}
              </p>
            </div>
          )}

          {bench?.hts && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-xs text-slate-300 leading-relaxed font-sans space-y-1">
              <p className="font-bold text-amber-300">
                {t("methods.bench_hts_title")}
              </p>
              <p>
                {t("methods.bench_hts_body", {
                  mae: Math.round(bench.hts.hts_mae).toLocaleString(),
                  b2mae: Math.round(bench.hts.b2_mae).toLocaleString(),
                  pct: ((bench.hts.mean_gain_vs_b2 ?? 0) * 100).toFixed(1),
                  vn: Math.round(bench.hts.per_aoi?.vietnam?.mae ?? 0).toLocaleString(),
                  amz: Math.round(bench.hts.per_aoi?.amazon?.mae ?? 0).toLocaleString(),
                  aus: Math.round(bench.hts.per_aoi?.australia?.mae ?? 0).toLocaleString(),
                  ci0: Math.round(bench.hts.comparisons?.hts_vs_b2?.ci95?.[0] ?? 0).toLocaleString(),
                  ci1: Math.round(bench.hts.comparisons?.hts_vs_b2?.ci95?.[1] ?? 0).toLocaleString(),
                  prob: (((bench.hts.comparisons?.hts_vs_b2?.prob_a_better ?? 0) as number) * 100).toFixed(0),
                })}
              </p>
              <p className="text-slate-400">
                {t("methods.bench_hts_note")}
              </p>
            </div>
          )}

          {/* CLAIM-034: custom/uploaded regions are stat-only and outside the
              3-AOI per_aoi benchmark above. Static truthful note, no fetch. */}
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 text-xs text-slate-300 leading-relaxed font-sans space-y-1">
            <p className="font-bold text-slate-100">
              {t("methods.bench_custom_title")}
            </p>
            <p className="text-slate-400">
              {t("methods.bench_custom_body")}
            </p>
          </div>
        </section>
      )}

      {/* SECTION 4: SCIENTIFIC LIMITS */}
      {activeSection === "limits" && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-950/10 p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300 border-b border-amber-500/20 pb-3">
            <ShieldAlert className="h-5 w-5" />
            <span>{t("methods.limits_title")}</span>
          </div>

          <div className="space-y-4 text-xs text-slate-300 leading-relaxed font-sans">
            <div className="space-y-1">
              <strong className="text-white text-sm block">
                {t("methods.limits_b1_title")}
              </strong>
              <p className="text-slate-400">
                {t("methods.limits_b1_desc")}
              </p>
            </div>

            <div className="space-y-1">
              <strong className="text-white text-sm block">
                {t("methods.limits_b2_title")}
              </strong>
              <p className="text-slate-400">
                {t("methods.limits_b2_desc")}
              </p>
            </div>

            <div className="space-y-1">
              <strong className="text-white text-sm block">
                {t("methods.limits_b3_title")}
              </strong>
              <p className="text-slate-400">
                {t("methods.limits_b3_desc")}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* SECTION 5: REPRODUCE & CSV IMPORT */}
      {activeSection === "reproduce" && (
        <section className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 shadow-sm space-y-5">
          <div className="space-y-1 border-b border-slate-800 pb-3">
            <h2 className="text-base font-bold text-white">
              {t("methods.repro_title")}
            </h2>
            <p className="text-xs text-slate-400">
              {t("methods.repro_sub")}
            </p>
          </div>

          {/* CSV Upload Tool */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
              <Upload className="h-4 w-4" />
              <span>{t("methods.csv_title")}</span>
            </div>
            <p className="text-xs text-slate-300">
              {t("methods.csv_desc")}
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-xs text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-cyan-300 hover:file:bg-slate-700 cursor-pointer"
              />
              <button
                type="button"
                onClick={handleUpload}
                disabled={!file || uploadLoading}
                className="rounded-xl bg-orange-600 hover:bg-orange-500 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition disabled:opacity-50 min-h-[40px]"
              >
                {uploadLoading ? t("methods.csv_processing") : t("methods.csv_run")}
              </button>
            </div>

            {uploadResult && (
              <div className="rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-300 border border-slate-800">
                {uploadResult}
              </div>
            )}
          </div>

          {/* Terminal Reproduction Guide */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 font-mono text-xs">
            <div className="flex items-center gap-2 text-slate-300 font-bold">
              <Terminal className="h-4 w-4 text-cyan-400" />
              <span>{t("methods.term_title")}</span>
            </div>
            <pre tabIndex={0} className="p-3 rounded-lg bg-slate-950 text-slate-300 overflow-x-auto border border-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
{t("methods.term_script")}
            </pre>
          </div>
        </section>
      )}
      </div>
    </div>
  );
}
