import { useEffect, useState } from "react";
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
import { api, describeError, ApiError, type BacktestResponse } from "@/lib/api";
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
      vi: "MAE 4.154,4 vs B2 4.411,8 (−5,8%), cả 3 vùng giảm, nhưng CI [−777,1, +266,2] còn chứa 0.",
      en: "MAE 4,154.4 vs B2 4,411.8 (−5.8%), all 3 AOIs improve, but CI [−777.1, +266.2] still includes 0.",
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
      vi: "Official 72: MAE 3.765,8 vs B2 4.411,8 (−14,6%, win 95,8%), thắng HTS ở cả 3 vùng; tuy nhiên CI [−1.452,9, +81,8] vẫn chứa 0 (chưa đạt ngưỡng thống kê tuyệt đối).",
      en: "Official 72: MAE 3,765.8 vs B2 4,411.8 (−14.6%, 95.8% win), beats HTS in all 3 regions; however 95% CI [−1,452.9, +81.8] includes 0 (not statistically established alone).",
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
    tag: { vi: "Chủ lực vận hành · MAE -14,6%", en: "Primary Operational · MAE -14.6%" },
    tagClass: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 font-bold",
  },
];

export function MethodsPage() {
  const { lang } = useLang();
  const vi = lang === "vi";

  const [activeSection, setActiveSection] = useState<string>("steps");
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
      setUploadResult(
        vi
          ? `Đã phân tích ${records.length} dòng. Hợp lệ: ${v.clean}, Loại bỏ: ${v.rejected}. Ô ngày đã chuẩn hóa: ${h.daily_cells}.`
          : `Parsed ${records.length} rows. Clean: ${v.clean}, Rejected: ${v.rejected}. Harmonized daily cells: ${h.daily_cells}.`
      );
    } catch (e) {
      if (e instanceof ApiError) {
        setUploadResult(`API Error: ${e.message}`);
      } else {
        setUploadResult(describeError(e));
      }
    } finally {
      setUploadLoading(false);
    }
  }

  const sections = [
    { id: "sources", title: vi ? "1. Nguồn dữ liệu vệ tinh" : "1. Primary Satellite Data Sources" },
    { id: "steps", title: vi ? "2. Quy trình & Mô hình hiệu chỉnh" : "2. Harmonization Steps & Models" },
    { id: "benchmark", title: vi ? "3. Bảng đối sánh Holdout độc lập" : "3. Holdout Benchmark Matrix" },
    { id: "limits", title: vi ? "4. Ranh giới khoa học & Giới hạn" : "4. Scientific Boundaries & Limits" },
    { id: "reproduce", title: vi ? "5. Tái lập & Nhập dữ liệu CSV" : "5. Reproduce & CSV Ingestion" },
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
          {vi ? "Phương pháp, Mô hình & Toàn vẹn Dữ liệu" : "Methods, Models & Data Integrity"}
        </h1>
        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl">
          {vi
            ? "Tài liệu kỹ thuật toàn diện về chuỗi xử lý dữ liệu, công thức hiệu chuẩn thực nghiệm, ma trận kiểm chứng holdout độc lập và các ranh giới vận hành."
            : "Complete documentation of data ingestion pipelines, empirical harmonization formulation, holdout validation benchmarks, and operational boundaries."}
        </p>
      </div>

      {/* 2. Executive Summary (90-second Briefing) */}
      <section className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
          <Sparkles className="h-4 w-4" />
          <span>{vi ? "Tóm tắt 90 giây cho chuyên gia & ban giám khảo" : "90-Second Executive Summary"}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs text-slate-300">
          <div className="space-y-1 rounded-xl bg-slate-900/60 p-3 border border-slate-800">
            <span className="font-bold text-white block">{vi ? "Vấn đề:" : "The Problem:"}</span>
            <p className="text-slate-400 leading-relaxed">
              {vi ? "MODIS 1 km và VIIRS 375m có độ nhạy khác nhau; ghép trực tiếp tạo bước nhảy giả 3x - 4x vào năm 2012." : "MODIS 1 km and VIIRS 375m differ in sensitivity; direct concatenation causes an artificial 3x-4x jump in 2012."}
            </p>
          </div>
          <div className="space-y-1 rounded-xl bg-slate-900/60 p-3 border border-slate-800">
            <span className="font-bold text-white block">{vi ? "Giải pháp:" : "The Solution:"}</span>
            <p className="text-slate-400 leading-relaxed">
              {vi ? "Chuẩn hóa theo tỷ lệ thực nghiệm 12 tháng B2; đưa thang đo MODIS về mức tương đương VIIRS." : "Calibrates using empirical 12-month k-ratios (B2); scales historical MODIS to VIIRS equivalent."}
            </p>
          </div>
          <div className="space-y-1 rounded-xl bg-slate-900/60 p-3 border border-slate-800">
            <span className="font-bold text-white block">{vi ? "Kiểm chứng:" : "Verification:"}</span>
            <p className="text-slate-400 leading-relaxed">
              {vi ? "Đánh giá trên tập holdout đóng băng theo thời gian (time-travel split), không rò rỉ dữ liệu tương lai." : "Evaluated on frozen time-travel holdout sets without future data leakage."}
            </p>
          </div>
          <div className="space-y-1 rounded-xl bg-slate-900/60 p-3 border border-slate-800">
            <span className="font-bold text-white block">{vi ? "Ranh giới:" : "Boundaries:"}</span>
            <p className="text-slate-400 leading-relaxed">
              {vi ? "Điểm nóng không phải là số vụ cháy; không có dữ liệu không được quy về 0 đám cháy." : "Hotspots are thermal detections, not fire counts; missing observations are not coerced to zero."}
            </p>
          </div>
        </div>
      </section>

      {/* 3. Section Switcher: one accessible, horizontally scrollable row on small screens. */}
      <nav aria-label={vi ? "Mục lục phương pháp" : "Methods sections"}
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

      {/* SECTION 1: DATA SOURCES */}
      {activeSection === "sources" && (
        <section className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 shadow-sm space-y-4">
          <div className="space-y-1 border-b border-slate-800 pb-3">
            <h2 className="text-base font-bold text-white">
              {vi ? "Nguồn dữ liệu vệ tinh sơ cấp" : "Primary Satellite Data Sources"}
            </h2>
            <p className="text-xs text-slate-400">
              {vi ? "Toàn bộ dữ liệu điểm nhiệt được lấy từ hệ thống NASA FIRMS EOSDIS." : "All thermal observations originate from NASA EOSDIS FIRMS."}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 text-xs font-mono">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-blue-400">MODIS Collection 6.1</span>
                <span className="text-slate-400">2000 - Hiện tại</span>
              </div>
              <p className="font-sans text-xs text-slate-300 leading-relaxed">
                Vệ tinh: Terra (bay qua lúc 10:30 sáng) và Aqua (13:30 chiều). Độ phân giải: pixel nhiệt 1 km (khoảng 100 ha). Sử dụng thuật toán chuẩn MODIS C6.1.
              </p>
              <a
                href="https://earthdata.nasa.gov/data/tools/firms"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:underline pt-1"
              >
                <span>Tài liệu kỹ thuật NASA FIRMS MODIS</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-teal-400">VIIRS 375 m Active Fire</span>
                <span className="text-slate-400">2012 - Hiện tại</span>
              </div>
              <p className="font-sans text-xs text-slate-300 leading-relaxed">
                Vệ tinh: Suomi NPP (13:30 chiều) và NOAA-20/21 (chùm JPSS). Độ phân giải: dải ảnh I-band 375 m (khoảng 14 ha). Phát hiện các đám cháy nhỏ hơn MODIS tới 7 lần diện tích.
              </p>
              <a
                href="https://earthdata.nasa.gov/data/tools/firms"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-teal-400 hover:underline pt-1"
              >
                <span>Tài liệu kỹ thuật NASA FIRMS VIIRS</span>
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

          {/* Deep-Dive Architectural & Mathematical Formulation Cards */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Card 1: Objective & Formulation */}
            <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-5 shadow-sm space-y-3.5 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                  <BrainCircuit className="h-4 w-4" />
                  <span>{vi ? "Mục tiêu & Dự báo phần dư" : "Residual Log-Ratio Objective"}</span>
                </div>
                <h3 className="text-sm font-bold text-white">
                  {vi ? "Dự báo phần dư Log-Ratio thay vì điểm nhiệt thô" : "Log-Ratio Residuals vs Raw Hotspot Counts"}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {vi
                    ? "STAN không dự đoán trực tiếp số vụ cháy từ con số không nhằm triệt tiêu hiện tượng hallucination và tránh giá trị âm. Mạng dự báo phần dư nhân tính theo phân phối Negative Binomial 2 trên neo HTS:"
                    : "STAN avoids predicting raw fire counts from scratch to prevent hallucination and non-physical negative counts. It predicts bounded log-ratio residuals anchored on HTS with an NB2 count likelihood:"}
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
                {vi
                  ? "Bảo toàn quy luật vật lý: Phần dư bị chặn và co về neo HTS ở ô ít dữ liệu, tránh ngoại suy cực đoan."
                  : "Physical preservation: Residuals are bounded and anchored to HTS on sparse tiles, preventing extreme extrapolation."}
              </div>
            </div>

            {/* Card 2: Tensor Shape Pipeline & Dilated TCN + FiLM */}
            <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-5 shadow-sm space-y-3.5 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider">
                  <Layers className="h-4 w-4" />
                  <span>{vi ? "Luồng Tensor & Dilated TCN + FiLM" : "Tensor Flow & Dilated TCN + FiLM"}</span>
                </div>
                <h3 className="text-sm font-bold text-white">
                  {vi ? "Kích thước Tensor qua từng lớp" : "Tensor Dimensions Across Layers"}
                </h3>
                <div className="space-y-2 text-xs font-mono text-slate-300">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-slate-400 font-sans">{vi ? "1. Cửa sổ 12T + lân cận:" : "1. 12M Window + Neighbours:"}</span>
                    <span className="text-white font-bold">[B, 12, C_in]</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-slate-400 font-sans">{vi ? "2. Dilated TCN (causal):" : "2. Dilated TCN (causal):"}</span>
                    <span className="text-white font-bold">[B, 12, 64]</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-slate-400 font-sans">{vi ? "3. Điều chế FiLM theo AOI/mùa:" : "3. FiLM AOI/Season Conditioning:"}</span>
                    <span className="text-cyan-300 font-bold">gamma * h + beta</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-sans">{vi ? "4. Đầu ra NB2 & Phân vị:" : "4. NB2 & Interval Output:"}</span>
                    <span className="text-emerald-300 font-bold">(mu, alpha) → [P10, P50, P90]</span>
                  </div>
                </div>
                <div tabIndex={0}
                  className="rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-indigo-300 overflow-x-auto text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
                  <Latex math="\mathcal{L}_{\text{NB2}} = -\log \Gamma(y + r) + \log \Gamma(r) - r\log p - y\log(1-p)" block />
                </div>
              </div>
              <div className="rounded-lg bg-indigo-950/30 border border-indigo-800/40 p-2.5 text-[11px] text-indigo-200 leading-snug">
                {vi
                  ? "TCN giãn nở bắt chuỗi mùa 12 tháng mà không rò rỉ tương lai; tầng FiLM điều chỉnh đặc trưng theo từng vùng AOI."
                  : "Causal dilated TCN captures 12-month seasonality without future leakage; FiLM layers condition features per AOI."}
              </div>
            </div>

            {/* Card 3: Circuit Breaker Statistical Gate */}
            <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-5 shadow-sm space-y-3.5 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
                  <ShieldCheck className="h-4 w-4" />
                  <span>{vi ? "Cổng Kiểm định Holdout 2024-2025" : "2024-2025 Holdout Verification"}</span>
                </div>
                <h3 className="text-sm font-bold text-white">
                  {vi ? "So sánh STAN, HTS & B2 (Raw Full)" : "STAN, HTS & B2 Benchmark (Raw Full)"}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {vi
                    ? "STAN chỉ được dùng khi là forecast-safe (không dùng VIIRS cùng tháng ở ô lân cận) và cải thiện trên dữ liệu thực tế:"
                    : "STAN is strictly forecast-safe (no same-month neighbour VIIRS) and evaluated on the full holdout across 3 AOIs:"}
                </p>
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 space-y-2 text-xs font-mono">
                  <div className="flex justify-between items-center text-slate-300 border-b border-slate-800 pb-1">
                    <span>B2 Baseline MAE:</span>
                    <span className="font-bold text-slate-200">4,411.8</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300 border-b border-slate-800 pb-1">
                    <span>HTS Candidate MAE:</span>
                    <span className="font-bold text-amber-400">4,154.4 (-5.8%)</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300">
                    <span>STAN Operational MAE:</span>
                    <span className="font-bold text-emerald-400">3,765.8 (-14.6%)</span>
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/40 p-2.5 text-[11px] text-emerald-200 leading-snug">
                {vi
                  ? "Kết luận: STAN thắng 95,8% số tháng (MAE -14,6%), nhưng 95% CI [-1.452,9; +81,8] vẫn chứa 0 nên luôn công bố kèm cờ trung thực."
                  : "Verdict: STAN wins 95.8% of months (-14.6% MAE), while 95% CI [-1,452.9, +81.8] still includes 0 and is surfaced transparently."}
              </div>
            </div>
          </div>

          {/* Mathematical Specifications Table */}
          <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-6 shadow-sm space-y-4">
            <div className="space-y-1 border-b border-slate-800 pb-3">
              <h2 className="text-base font-bold text-white">
                {vi ? "Đặc tả toán học & Tiêu chí vận hành từng mô hình" : "Mathematical Specifications & Operating Criteria"}
              </h2>
              <p className="text-xs text-slate-400">
                {vi ? "Các thông số, giả định vật lý và điều kiện từ chối (abstention) của từng phương pháp trong đường ống." : "Parameters, physical assumptions, and abstention criteria for each pipeline candidate."}
              </p>
            </div>

            <div tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
              <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase text-xs">
                  <th className="py-2.5 pr-4">{vi ? "Mô hình & Phương pháp" : "Model & Method"}</th>
                  <th className="py-2.5 pr-4">{vi ? "Công thức toán học" : "Mathematical Formula"}</th>
                  <th className="py-2.5 pr-4">{vi ? "Biến mục tiêu" : "Target Variable"}</th>
                  <th className="py-2.5 pr-4">{vi ? "Giả định khoa học" : "Scientific Assumptions"}</th>
                  <th className="py-2.5 pr-4">{vi ? "Điều kiện từ chối" : "Abstention Conditions"}</th>
                  <th className="py-2.5 text-right">{vi ? "Rủi ro sai lệch" : "Failure Modes"}</th>
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
              {vi ? "Ma trận kiểm chứng Holdout độc lập" : "Independent Holdout Benchmark Matrix"}
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {bench?.headline ? (
                <>
                  {vi
                    ? `Mỗi khu vực chỉ huấn luyện trên các năm trước thời kỳ holdout, loại bỏ hoàn toàn việc rò rỉ dữ liệu tương lai. Đánh giá trên ${bench.n_eval_intersection ?? 0} tháng-khu vực.`
                    : `Each AOI trains strictly on years prior to the holdout period, eliminating future data leakage. Scored on ${bench.n_eval_intersection ?? 0} AOI-months.`}
                </>
              ) : (
                vi ? "Đang nạp dữ liệu kiểm thử trực tiếp từ hệ thống API..." : "Loading benchmark data from API..."
              )}
            </p>
            {benchData === "sample" && (
              <p className="text-xs text-amber-300/90 leading-relaxed font-mono">
                {vi
                  ? "Bản ZIP sạch không kèm 1.4 GB raw NASA; bảng này chạy trên dữ liệu mẫu tất định. Chạy make data + rebuild_subset để bật raw."
                  : "The clean ZIP omits the 1.4 GB raw NASA pull; this table runs on the deterministic sample. Run make data + rebuild_subset to enable raw."}
              </p>
            )}
          </div>

          <div tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase text-xs">
                  <th className="py-2.5">{vi ? "Kiến trúc mô hình" : "Model Pipeline"}</th>
                  <th className="py-2.5 text-right">Holdout MAE</th>
                  <th className="py-2.5 text-right">Holdout WAPE</th>
                  <th className="py-2.5 text-right">{vi ? "Độ lệch Bias" : "Mean Bias"}</th>
                  <th className="py-2.5 text-center">{vi ? "Trạng thái" : "Status"}</th>
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
                      {benchErr ? `Lỗi nạp benchmark: ${benchErr}` : "Đang tải dữ liệu kiểm thử..."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {bench?.stan?.official && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-xs text-slate-300 leading-relaxed font-sans space-y-1">
              <p className="font-bold text-emerald-300">
                {vi ? "STAN - mô hình chủ lực (forecast-safe)" : "STAN - main model (forecast-safe)"}
              </p>
              <p>
                {vi
                  ? `Đang phục vụ chính (raw; trước 2024 dùng HTS fallback). Official 72 tháng: MAE ${Math.round(bench.stan.official.metrics.mae).toLocaleString()} so với B2 ${Math.round(bench.stan.official.b2_metrics.mae).toLocaleString()} (giảm ${(100 - 100 * bench.stan.official.metrics.mae / bench.stan.official.b2_metrics.mae).toFixed(1)}%), CI [${Math.round(bench.stan.official.comparisons?.stan_vs_b2?.ci95?.[0] ?? 0).toLocaleString()}, ${Math.round(bench.stan.official.comparisons?.stan_vs_b2?.ci95?.[1] ?? 0).toLocaleString()}]. Việt Nam ${Math.round(bench.stan.official.per_aoi?.vietnam?.stan?.mae ?? 0).toLocaleString()}, Amazon ${Math.round(bench.stan.official.per_aoi?.amazon?.stan?.mae ?? 0).toLocaleString()}, Australia ${Math.round(bench.stan.official.per_aoi?.australia?.stan?.mae ?? 0).toLocaleString()}.`
                  : `Served as the main model (raw; HTS fallback before 2024). Official 72 months: MAE ${Math.round(bench.stan.official.metrics.mae).toLocaleString()} vs B2 ${Math.round(bench.stan.official.b2_metrics.mae).toLocaleString()} (-${(100 - 100 * bench.stan.official.metrics.mae / bench.stan.official.b2_metrics.mae).toFixed(1)}%), CI [${Math.round(bench.stan.official.comparisons?.stan_vs_b2?.ci95?.[0] ?? 0).toLocaleString()}, ${Math.round(bench.stan.official.comparisons?.stan_vs_b2?.ci95?.[1] ?? 0).toLocaleString()}]. Vietnam ${Math.round(bench.stan.official.per_aoi?.vietnam?.stan?.mae ?? 0).toLocaleString()}, Amazon ${Math.round(bench.stan.official.per_aoi?.amazon?.stan?.mae ?? 0).toLocaleString()}, Australia ${Math.round(bench.stan.official.per_aoi?.australia?.stan?.mae ?? 0).toLocaleString()}.`}
              </p>
              <p className="text-slate-400">
                {vi
                  ? `Thiết kế: dilated TCN 1/2/4 + FiLM theo mùa + target-month cross-attention + negative-binomial; ${bench.stan.params.toLocaleString()} tham số. Không dùng VIIRS cùng tháng của ô lân cận. Ablation: bỏ FiLM tệ hơn ~13%; Poisson gần tương đương; d=96 tốt hơn d=64/32. LOO: Việt Nam/Amazon thua HTS, Australia gần hoà.`
                  : `Design: dilated TCN 1/2/4 + seasonal FiLM + target-month cross-attention + negative-binomial; ${bench.stan.params.toLocaleString()} params. It does not use same-month neighbour VIIRS. Ablation: removing FiLM is ~13% worse; Poisson is close; d=96 beats d=64/32. LOO: Vietnam/Amazon lose to HTS; Australia is a near-tie.`}
              </p>
            </div>
          )}

          {bench?.spatial && (
            <div className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-4 text-xs text-slate-300 leading-relaxed font-sans space-y-1">
              <p className="font-bold text-purple-300">
                {vi ? "Spatial HGB - tái dựng không gian (không phải dự báo)" : "Spatial HGB - spatial reconstruction (not a forecast)"}
              </p>
              <p>
                {vi
                  ? `72 tháng: MAE ${Math.round(bench.spatial.headline.mae).toLocaleString()} so với B2 ${Math.round(bench.spatial.b2_headline.mae).toLocaleString()} (giảm ${(100 - 100 * bench.spatial.headline.mae / bench.spatial.b2_headline.mae).toFixed(1)}%). Spatial holdout (${bench.spatial.spatial_holdout?.held_tiles ?? 0} ô chưa thấy): ${Math.round(bench.spatial.spatial_holdout?.spatial_mae ?? 0).toLocaleString()} vs HTS ${Math.round(bench.spatial.spatial_holdout?.hts_mae ?? 0).toLocaleString()}.`
                  : `72 months: MAE ${Math.round(bench.spatial.headline.mae).toLocaleString()} vs B2 ${Math.round(bench.spatial.b2_headline.mae).toLocaleString()} (-${(100 - 100 * bench.spatial.headline.mae / bench.spatial.b2_headline.mae).toFixed(1)}%). Spatial holdout (${bench.spatial.spatial_holdout?.held_tiles ?? 0} unseen tiles): ${Math.round(bench.spatial.spatial_holdout?.spatial_mae ?? 0).toLocaleString()} vs HTS ${Math.round(bench.spatial.spatial_holdout?.hts_mae ?? 0).toLocaleString()}.`}
              </p>
              <p className="text-slate-400">
                {vi
                  ? `Lợi ích đến từ VIIRS cùng tháng của ô lân cận. Biến thể forecast-safe (chỉ VIIRS tháng trước + MODIS cùng tháng) đạt ${Math.round(bench.spatial.safe_headline.mae).toLocaleString()}, không thắng HTS ${Math.round(bench.spatial.hts_headline.mae).toLocaleString()}. Vì vậy mô hình chỉ dùng cho tái dựng/gap-fill, không dùng để tuyên bố dự báo.`
                  : `The gain comes from same-month VIIRS in neighbouring tiles. The forecast-safe variant (previous-month VIIRS + same-month MODIS only) scores ${Math.round(bench.spatial.safe_headline.mae).toLocaleString()}, not beating HTS ${Math.round(bench.spatial.hts_headline.mae).toLocaleString()}. It is therefore a reconstruction/gap-fill model, not a forecasting claim.`}
              </p>
            </div>
          )}

          {bench?.hts && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-xs text-slate-300 leading-relaxed font-sans space-y-1">
              <p className="font-bold text-amber-300">
                {vi ? "HTS - ứng viên tốt nhất (chưa vượt gate 95%)" : "HTS - strongest candidate (95% gate not passed)"}
              </p>
              <p>
                {vi
                  ? `Holdout 72 tháng: MAE ${Math.round(bench.hts.hts_mae).toLocaleString()} so với B2 ${Math.round(bench.hts.b2_mae).toLocaleString()} (giảm ${(bench.hts.mean_gain_vs_b2 * 100).toFixed(1)}%). Việt Nam ${Math.round(bench.hts.per_aoi?.vietnam?.mae ?? 0).toLocaleString()}, Amazon ${Math.round(bench.hts.per_aoi?.amazon?.mae ?? 0).toLocaleString()}, Australia ${Math.round(bench.hts.per_aoi?.australia?.mae ?? 0).toLocaleString()}. CI 95% [${Math.round(bench.hts.comparisons?.hts_vs_b2?.ci95?.[0] ?? 0).toLocaleString()}, +${Math.round(bench.hts.comparisons?.hts_vs_b2?.ci95?.[1] ?? 0).toLocaleString()}], P(better)=${((bench.hts.comparisons?.hts_vs_b2?.prob_a_better ?? 0) * 100).toFixed(0)}%.`
                  : `72-month holdout: MAE ${Math.round(bench.hts.hts_mae).toLocaleString()} vs B2 ${Math.round(bench.hts.b2_mae).toLocaleString()} (-${(bench.hts.mean_gain_vs_b2 * 100).toFixed(1)}% MAE). Vietnam ${Math.round(bench.hts.per_aoi?.vietnam?.mae ?? 0).toLocaleString()}, Amazon ${Math.round(bench.hts.per_aoi?.amazon?.mae ?? 0).toLocaleString()}, Australia ${Math.round(bench.hts.per_aoi?.australia?.mae ?? 0).toLocaleString()}. 95% CI [${Math.round(bench.hts.comparisons?.hts_vs_b2?.ci95?.[0] ?? 0).toLocaleString()}, +${Math.round(bench.hts.comparisons?.hts_vs_b2?.ci95?.[1] ?? 0).toLocaleString()}], P(better)=${((bench.hts.comparisons?.hts_vs_b2?.prob_a_better ?? 0) * 100).toFixed(0)}%.`}
              </p>
              <p className="text-slate-400">
                {vi
                  ? "Raw-only: chọn method=hts trong Calendar khi dùng NASA raw. Sample trả 409 vì không có ô 1°. Không tự thay B2; badge candidate là bắt buộc."
                  : "Raw-only: choose method=hts in Calendar with NASA raw. Sample returns 409 (no 1° tiles). It never replaces B2 automatically; the candidate badge is required."}
              </p>
            </div>
          )}
        </section>
      )}

      {/* SECTION 4: SCIENTIFIC LIMITS */}
      {activeSection === "limits" && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-950/10 p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300 border-b border-amber-500/20 pb-3">
            <ShieldAlert className="h-5 w-5" />
            <span>{vi ? "Ranh giới khoa học & Giới hạn sản phẩm" : "Scientific Boundaries & Operational Limits"}</span>
          </div>

          <div className="space-y-4 text-xs text-slate-300 leading-relaxed font-sans">
            <div className="space-y-1">
              <strong className="text-white text-sm block">1. Điểm nóng không tương đương số vụ cháy thực tế (Hotspots != Fire Incidents)</strong>
              <p className="text-slate-400">
                Điểm nóng là các lượt phát hiện nhiệt độ cao từ cảm biến khi vệ tinh bay qua. Một đám cháy quy mô lớn có thể tạo ra hàng chục điểm nóng cùng lúc. Ngược lại, đám cháy ngún dưới tán rừng hoặc cháy quy mô nhỏ có thể bị bỏ sót.
              </p>
            </div>

            <div className="space-y-1">
              <strong className="text-white text-sm block">2. Thiếu dữ liệu không đồng nghĩa với không có cháy (Missing != Absence of Fire)</strong>
              <p className="text-slate-400">
                Tình trạng mây dày hoặc lệch quỹ đạo khiến cảm biến không thể quét mặt đất. Hệ thống đánh dấu đây là ô thiếu dữ liệu ("No data") thay vì tự động điền số 0 gây hiểu lầm là đã dập tắt cháy.
              </p>
            </div>

            <div className="space-y-1">
              <strong className="text-white text-sm block">3. Không phục vụ điều phối cứu hỏa khẩn cấp (Not Operational Dispatch)</strong>
              <p className="text-slate-400">
                Sản phẩm được thiết kế phục vụ nghiên cứu xu hướng đa thập kỷ và phân tích khoa học Trái Đất. Không sử dụng sản phẩm này cho mục đích cảnh báo tức thời hoặc điều xe chữa cháy tác chiến.
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
              {vi ? "Tái lập kết quả & Nhập tệp CSV tùy chỉnh" : "Reproduction Guide & Custom CSV Ingestion"}
            </h2>
            <p className="text-xs text-slate-400">
              {vi ? "Hướng dẫn chạy mã nguồn mở và công cụ tải tệp FIRMS kiểm thử tại chỗ." : "Instructions for open-source reproduction and local CSV parsing tool."}
            </p>
          </div>

          {/* CSV Upload Tool */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
              <Upload className="h-4 w-4" />
              <span>{vi ? "Công cụ kiểm tra tệp FIRMS CSV của bạn" : "Custom FIRMS CSV Parser"}</span>
            </div>
            <p className="text-xs text-slate-300">
              {vi
                ? "Tải tệp CSV từ NASA FIRMS Area API và nạp tại đây để kiểm tra tính tương thích và chạy quy trình hiệu chuẩn tại chỗ (tối đa 5.000 dòng)."
                : "Upload a CSV downloaded from the NASA FIRMS Area API to validate schema and test harmonization locally (up to 5,000 rows)."}
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
                {uploadLoading ? (vi ? "Đang xử lý..." : "Processing...") : (vi ? "Xử lý tệp" : "Run Ingestion")}
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
              <span>{vi ? "Tái lập môi trường qua Terminal" : "CLI Reproduction Commands"}</span>
            </div>
            <pre tabIndex={0} className="p-3 rounded-lg bg-slate-950 text-slate-300 overflow-x-auto border border-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
{`# 1. Clone repository và cài đặt môi trường
git clone https://github.com/nasa-spaceapps/fireharmony.git
cd fireharmony

# 2. Cài đặt phụ thuộc backend và chạy server
cd backend && pip install -r requirements.txt
python -m uvicorn app.main:app --port 8000

# 3. Chạy frontend
cd ../frontend && npm install
npm run build && npm run preview`}
            </pre>
          </div>
        </section>
      )}
    </div>
  );
}
