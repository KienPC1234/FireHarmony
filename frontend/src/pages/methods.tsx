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
    id: "sf_lite_v1",
    name: { vi: "SensorFormer: kiến trúc phục vụ duy nhất", en: "SensorFormer: Single Served Architecture" },
    category: { vi: "Neo mùa vụ + phần dư có cổng", en: "Seasonal Anchor + Gated Residual" },
    formula: "\\hat{y} = x_{modis} \\cdot k_m^{B2} \\cdot \\exp(\\Delta \\hat{r} \\cdot \\text{Gate})",
    input: { vi: "Cửa sổ 12 tháng MODIS (log), pha tháng, tỷ lệ ban ngày/Terra, embedding vùng", en: "12-month MODIS window (log), month phase, day/Terra fractions, AOI embedding" },
    target: { vi: "Phần dư trên neo B2: log(VIIRS/MODIS) − b2_log[tháng]", en: "Residual on the B2 anchor: log(VIIRS/MODIS) − b2_log[month]" },
    assumptions: {
      vi: "Sai lệch cảm biến có cấu trúc theo vùng và mùa; phần dư chỉ được bật khi vượt gate ≥2% và CI < 0.",
      en: "Sensor bias is structured by region and season; the residual is enabled only if it clears the >=2% gate with CI < 0.",
    },
    abstains: {
      vi: "Gate đóng trên holdout 2024–2025 → tự động phục vụ neo mùa vụ (anchor-only).",
      en: "Gate is closed on the 2024–2025 holdout → serves the seasonal anchor (anchor-only).",
    },
    failures: {
      vi: "MAE 2.458 cao hơn neo 2.387; attention không chứng minh được lợi ích ở quy mô 231 cửa sổ.",
      en: "MAE 2,458 is worse than the 2,387 anchor; attention does not earn its place at 231 windows.",
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
      vi: "MAE 2.230,7 vs B2 2.386,9 (−6,5%), cả 3 vùng giảm, nhưng CI [−362, +44] còn chứa 0.",
      en: "MAE 2,230.7 vs B2 2,386.9 (−6.5%), all 3 AOIs improve, but CI [−362, +44] still includes 0.",
    },
  },
  {
    id: "spatial_hgb_v1",
    name: { vi: "Spatial HGB: hồi quy phần dư theo ô lân cận (retrospective)", en: "Spatial HGB: Neighbour-Tile Residual (retrospective)" },
    category: { vi: "Học có giám sát + bối cảnh không gian", en: "Supervised + Spatial Context" },
    input: { vi: "HTS anchor + MODIS ô + VIIRS cùng tháng của 8 ô lân cận", en: "HTS anchor + tile MODIS + same-month VIIRS of 8 neighbouring tiles" },
    target: { vi: "Phần dư log-ratio trên HTS, cộng ô-tháng lên AOI", en: "Log-ratio residual on HTS, summed from tiles to the AOI" },
    assumptions: {
      vi: "Cháy lan giữa các ô lân cận; VIIRS cùng tháng của ô bên cạnh đã được quan trắc khi tái dựng lịch sử.",
      en: "Fire spreads across neighbouring tiles; same-month VIIRS in adjacent tiles is already observed when reconstructing history.",
    },
    abstains: {
      vi: "Không dùng cho dự báo hay tháng thiếu VIIRS lân cận; biến thể forecast-safe không thắng HTS.",
      en: "Not for forecasting or months without neighbouring VIIRS; the forecast-safe variant does not beat HTS.",
    },
    failures: {
      vi: "MAE 1.313 vs B2 2.387 (−45%), cả 3 vùng và spatial holdout đều thắng; nhưng đây là nội suy không gian, không phải calibrate MODIS→VIIRS thuần.",
      en: "MAE 1,313 vs B2 2,387 (−45%), wins all regions and the spatial holdout; but this is spatial imputation, not pure MODIS→VIIRS calibration.",
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
      vi: "Official 72: MAE 2.128,7 vs B2 2.386,9 (−10,8%), CI [−534,8, −19,1]; thắng HTS ở cả 3 vùng nhưng CI so với HTS còn chứa 0. LOO: Việt Nam/Amazon thua HTS, Australia gần hoà.",
      en: "Official 72: MAE 2,128.7 vs B2 2,386.9 (−10.8%), CI [−534.8, −19.1]; beats HTS in all 3 regions but the HTS CI includes 0. LOO: Vietnam/Amazon lose to HTS, Australia is a near-tie.",
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
    label: { vi: "B2: Hệ số mùa 12 tháng (Triển khai chính)", en: "B2: Seasonal Ratio (Operational)" },
    tag: { vi: "Neo vận hành", en: "Operational Anchor" },
    tagClass: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 font-bold",
  },
  {
    id: "hts_anchor_v1",
    label: { vi: "HTS: neo mùa vụ theo ô 1° (candidate)", en: "HTS: 1° tile-seasonal anchor (candidate)" },
    tag: { vi: "Candidate · CI chứa 0", en: "Candidate · CI includes 0" },
    tagClass: "bg-amber-500/15 border-amber-500/30 text-amber-300",
  },
  {
    id: "stan_safe_v1",
    label: { vi: "STAN: mạng không-thời gian theo count (forecast-safe)", en: "STAN: spatial-temporal count network (forecast-safe)" },
    tag: { vi: "Chủ lực · vượt B2", en: "Main model · beats B2" },
    tagClass: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
  },
  {
    id: "spatial_hgb_v1",
    label: { vi: "Spatial HGB: ô lân cận (retrospective)", en: "Spatial HGB: neighbour tiles (retrospective)" },
    tag: { vi: "Retrospective · cần VIIRS lân cận", en: "Retrospective · needs neighbour VIIRS" },
    tagClass: "bg-purple-500/15 border-purple-500/30 text-purple-300",
  },
  {
    id: "sf_lite_v1",
    label: { vi: "SensorFormer: neo + phần dư (gate đóng)", en: "SensorFormer: anchor + residual (gate OFF)" },
    tag: { vi: "Kiến trúc phục vụ", en: "Served Architecture" },
    tagClass: "bg-sky-500/15 border-sky-500/30 text-sky-300",
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
    <div className="px-4 sm:px-6 lg:px-8 py-8 space-y-8 max-w-6xl mx-auto w-full pb-24">
      {/* 1. Header */}
      <div className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 shadow-sm space-y-3">
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

      {/* 3. Section Switcher Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveSection(s.id)}
            aria-pressed={activeSection === s.id}
            className={cn(
              "rounded-xl px-4 py-2 text-xs font-semibold transition min-h-[40px]",
              activeSection === s.id
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                : "bg-[#111C2E] text-slate-400 hover:text-white border border-slate-800"
            )}
          >
            {s.title}
          </button>
        ))}
      </div>

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
                    ? "SensorFormer không dự đoán trực tiếp số vụ cháy từ con số không nhằm triệt tiêu hiện tượng hallucination và tránh giá trị âm. Mạng chỉ dự báo phần dư độ lệch so với hệ số mùa chuẩn B2:"
                    : "SensorFormer avoids predicting raw fire counts from scratch to prevent hallucination and non-physical negative counts. It strictly predicts multiplicative log-ratio residuals against baseline B2:"}
                </p>
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-cyan-300 overflow-x-auto">
                  <div className="text-[11px] space-y-2 font-mono">
                    <Latex math="\Delta \hat{r} = \log\left(\frac{y_{\text{viirs}}}{x_{\text{modis}}}\right) - \log\left(k_m^{\text{B2}}\right)" block />
                    <Latex math="\hat{y} = x_{\text{modis}} \cdot k_m^{\text{B2}} \cdot \exp(\Delta \hat{r} \cdot \text{Gate})" block />
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-cyan-950/30 border border-cyan-800/40 p-2.5 text-[11px] text-cyan-200 leading-snug">
                {vi
                  ? "Bảo toàn quy luật vật lý: Khi Gate = 0, mô hình thoái biến chính xác về neo B2, triệt tiêu hoàn toàn rủi ro ngoại suy sai lệch."
                  : "Physical preservation: When Gate = 0, the model gracefully degrades to B2, eliminating catastrophic extrapolation risk."}
              </div>
            </div>

            {/* Card 2: Tensor Shape Pipeline & Attention */}
            <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-5 shadow-sm space-y-3.5 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider">
                  <Layers className="h-4 w-4" />
                  <span>{vi ? "Luồng Tensor & Phân vị Monotone" : "Tensor Flow & Quantile Head"}</span>
                </div>
                <h3 className="text-sm font-bold text-white">
                  {vi ? "Kích thước Tensor qua từng lớp" : "Tensor Dimensions Across Layers"}
                </h3>
                <div className="space-y-2 text-xs font-mono text-slate-300">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-slate-400 font-sans">{vi ? "1. Đầu vào (Cửa sổ 12T):" : "1. Input Window (12M):"}</span>
                    <span className="text-white font-bold">[B, 12, 1]</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-slate-400 font-sans">{vi ? "2. Ghép đặc trưng phụ:" : "2. Feature Concatenation:"}</span>
                    <span className="text-white font-bold">[B, 12, 4]</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-slate-400 font-sans">{vi ? "3. Embedding không gian:" : "3. Spatial Embedding:"}</span>
                    <span className="text-white font-bold">[B, 12, 64]</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-slate-400 font-sans">{vi ? "4. Multi-Head Attention:" : "4. Multi-Head Attention:"}</span>
                    <span className="text-cyan-300 font-bold">[B, 12, 64] (4 heads)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-sans">{vi ? "5. Phân vị không giao cắt:" : "5. Quantiles Head:"}</span>
                    <span className="text-emerald-300 font-bold">[B, 3] (P10, P50, P90)</span>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-indigo-300 overflow-x-auto text-[11px]">
                  <Latex math="\mathcal{L} = \sum_{q} \max(q u, (q-1) u) + \lambda \sum \max(0, \Delta q_{\text{cross}})" block />
                </div>
              </div>
              <div className="rounded-lg bg-indigo-950/30 border border-indigo-800/40 p-2.5 text-[11px] text-indigo-200 leading-snug">
                {vi
                  ? "Cơ chế Attention phát hiện tương quan trễ theo mùa mà không bị triệt tiêu gradient như mô hình RNN/LSTM truyền thống."
                  : "Self-attention captures non-local seasonal lag correlations without recurrent gradient vanishing typical of LSTM/RNNs."}
              </div>
            </div>

            {/* Card 3: Circuit Breaker Statistical Gate */}
            <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-5 shadow-sm space-y-3.5 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
                  <ShieldCheck className="h-4 w-4" />
                  <span>{vi ? "Cổng An toàn Thống kê" : "Statistical Circuit Breaker"}</span>
                </div>
                <h3 className="text-sm font-bold text-white">
                  {vi ? "Tiêu chí kích hoạt Gate & Holdout 2024-2025" : "Gate Activation Criteria & Holdout Bench"}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {vi
                    ? "SensorFormer chỉ được phép can thiệp nếu cải thiện ít nhất 2% MAE so với B2 và khoảng tin cậy 95% Bootstrap không chứa 0:"
                    : "SensorFormer is only enabled if it beats baseline B2 by at least 2% MAE and the 95% bootstrap CI strictly excludes zero:"}
                </p>
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 space-y-2 text-xs font-mono">
                  <div className="flex justify-between items-center text-slate-300 border-b border-slate-800 pb-1">
                    <span>B2 Baseline MAE:</span>
                    <span className="font-bold text-emerald-400">2,386.9</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300 border-b border-slate-800 pb-1">
                    <span>SensorFormer MAE:</span>
                    <span className="font-bold text-sky-400">2,458.5 (+3.0%)</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300">
                    <span>HTS Candidate MAE:</span>
                    <span className="font-bold text-amber-400">2,230.7 (-6.5%)</span>
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/40 p-2.5 text-[11px] text-emerald-200 leading-snug">
                {vi
                  ? "Kết luận: SensorFormer không vượt qua gate (Gate = 0), hệ thống phục vụ an toàn bằng neo B2. HTS tiếp tục là ứng viên do CI [-362, +44] còn cắt 0."
                  : "Verdict: SensorFormer failed gate threshold (Gate = 0), safely serving B2. HTS remains candidate as CI [-362, +44] crosses zero."}
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

            <div className="overflow-x-auto">
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
                  ? "Bản ZIP sạch không kèm 820 MB raw NASA; bảng này chạy trên dữ liệu mẫu tất định. Chạy make data + rebuild_subset để bật raw."
                  : "The clean ZIP omits the 820 MB raw NASA pull; this table runs on the deterministic sample. Run make data + rebuild_subset to enable raw."}
              </p>
            )}
          </div>

          <div className="overflow-x-auto">
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
                    const m = row.id === "sf_lite_v1"
                      ? bench.sf_lite?.headline
                      : row.id === "hts_anchor_v1"
                      ? bench.hts?.headline
                      : row.id === "spatial_hgb_v1"
                      ? bench.spatial?.headline
                      : row.id === "stan_safe_v1"
                      ? bench.stan?.official?.headline
                      : bench.headline?.metrics[row.id];
                    if (!m) return null;
                    const tag = row.id === "hgb_b2res_v4" && !bench.hgb_residual_enabled
                      ? { vi: "Gate OFF · dùng B2", en: "Gate OFF · serves B2" }
                      : row.id === "sf_lite_v1"
                      ? (bench.sf_lite?.deployed
                        ? { vi: "Gate PASS", en: "Gate PASS" }
                        : { vi: "Gate OFF · không phục vụ", en: "Gate OFF · not served" })
                      : row.id === "hts_anchor_v1"
                      ? { vi: "Candidate · chưa vượt gate", en: "Candidate · gate not passed" }
                      : row.id === "spatial_hgb_v1"
                      ? { vi: "Retrospective · không dùng để dự báo", en: "Retrospective · not a forecast" }
                      : row.id === "stan_safe_v1"
                      ? { vi: "Chủ lực · forecast-safe", en: "Main · forecast-safe" }
                      : row.tag;
                    const tone = (row.id === "sf_lite_v1" && !bench.sf_lite?.deployed)
                      || row.id === "hts_anchor_v1"
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
                {vi ? "STAN — mô hình chủ lực (forecast-safe)" : "STAN — main model (forecast-safe)"}
              </p>
              <p>
                {vi
                  ? `Đang phục vụ chính (raw; trước 2024 dùng HTS fallback). Official 72 tháng: MAE ${Math.round(bench.stan.official.metrics.mae).toLocaleString()} so với B2 ${Math.round(bench.stan.official.b2_metrics.mae).toLocaleString()} (giảm ${(100 - 100 * bench.stan.official.metrics.mae / bench.stan.official.b2_metrics.mae).toFixed(1)}%), CI [${Math.round(bench.stan.official.comparisons?.stan_vs_b2?.ci95?.[0] ?? 0).toLocaleString()}, ${Math.round(bench.stan.official.comparisons?.stan_vs_b2?.ci95?.[1] ?? 0).toLocaleString()}]. Việt Nam ${Math.round(bench.stan.official.per_aoi?.vietnam?.stan?.mae ?? 0).toLocaleString()}, Amazon ${Math.round(bench.stan.official.per_aoi?.amazon?.stan?.mae ?? 0).toLocaleString()}, Australia ${Math.round(bench.stan.official.per_aoi?.australia?.stan?.mae ?? 0).toLocaleString()}.`
                  : `Served as the main model (raw; HTS fallback before 2024). Official 72 months: MAE ${Math.round(bench.stan.official.metrics.mae).toLocaleString()} vs B2 ${Math.round(bench.stan.official.b2_metrics.mae).toLocaleString()} (−${(100 - 100 * bench.stan.official.metrics.mae / bench.stan.official.b2_metrics.mae).toFixed(1)}%), CI [${Math.round(bench.stan.official.comparisons?.stan_vs_b2?.ci95?.[0] ?? 0).toLocaleString()}, ${Math.round(bench.stan.official.comparisons?.stan_vs_b2?.ci95?.[1] ?? 0).toLocaleString()}]. Vietnam ${Math.round(bench.stan.official.per_aoi?.vietnam?.stan?.mae ?? 0).toLocaleString()}, Amazon ${Math.round(bench.stan.official.per_aoi?.amazon?.stan?.mae ?? 0).toLocaleString()}, Australia ${Math.round(bench.stan.official.per_aoi?.australia?.stan?.mae ?? 0).toLocaleString()}.`}
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
                {vi ? "Spatial HGB — tái dựng không gian (không phải dự báo)" : "Spatial HGB — spatial reconstruction (not a forecast)"}
              </p>
              <p>
                {vi
                  ? `72 tháng: MAE ${Math.round(bench.spatial.headline.mae).toLocaleString()} so với B2 ${Math.round(bench.spatial.b2_headline.mae).toLocaleString()} (giảm ${(100 - 100 * bench.spatial.headline.mae / bench.spatial.b2_headline.mae).toFixed(1)}%). Spatial holdout (${bench.spatial.spatial_holdout?.held_tiles ?? 0} ô chưa thấy): ${Math.round(bench.spatial.spatial_holdout?.spatial_mae ?? 0).toLocaleString()} vs HTS ${Math.round(bench.spatial.spatial_holdout?.hts_mae ?? 0).toLocaleString()}.`
                  : `72 months: MAE ${Math.round(bench.spatial.headline.mae).toLocaleString()} vs B2 ${Math.round(bench.spatial.b2_headline.mae).toLocaleString()} (−${(100 - 100 * bench.spatial.headline.mae / bench.spatial.b2_headline.mae).toFixed(1)}%). Spatial holdout (${bench.spatial.spatial_holdout?.held_tiles ?? 0} unseen tiles): ${Math.round(bench.spatial.spatial_holdout?.spatial_mae ?? 0).toLocaleString()} vs HTS ${Math.round(bench.spatial.spatial_holdout?.hts_mae ?? 0).toLocaleString()}.`}
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
                {vi ? "HTS — ứng viên tốt nhất (chưa vượt gate 95%)" : "HTS — strongest candidate (95% gate not passed)"}
              </p>
              <p>
                {vi
                  ? `Holdout 72 tháng: MAE ${Math.round(bench.hts.hts_mae).toLocaleString()} so với B2 ${Math.round(bench.hts.b2_mae).toLocaleString()} (giảm ${(bench.hts.mean_gain_vs_b2 * 100).toFixed(1)}%). Việt Nam ${Math.round(bench.hts.per_aoi?.vietnam?.mae ?? 0).toLocaleString()}, Amazon ${Math.round(bench.hts.per_aoi?.amazon?.mae ?? 0).toLocaleString()}, Australia ${Math.round(bench.hts.per_aoi?.australia?.mae ?? 0).toLocaleString()}. CI 95% [${Math.round(bench.hts.comparisons?.hts_vs_b2?.ci95?.[0] ?? 0).toLocaleString()}, +${Math.round(bench.hts.comparisons?.hts_vs_b2?.ci95?.[1] ?? 0).toLocaleString()}], P(better)=${((bench.hts.comparisons?.hts_vs_b2?.prob_a_better ?? 0) * 100).toFixed(0)}%.`
                  : `72-month holdout: MAE ${Math.round(bench.hts.hts_mae).toLocaleString()} vs B2 ${Math.round(bench.hts.b2_mae).toLocaleString()} (−${(bench.hts.mean_gain_vs_b2 * 100).toFixed(1)}% MAE). Vietnam ${Math.round(bench.hts.per_aoi?.vietnam?.mae ?? 0).toLocaleString()}, Amazon ${Math.round(bench.hts.per_aoi?.amazon?.mae ?? 0).toLocaleString()}, Australia ${Math.round(bench.hts.per_aoi?.australia?.mae ?? 0).toLocaleString()}. 95% CI [${Math.round(bench.hts.comparisons?.hts_vs_b2?.ci95?.[0] ?? 0).toLocaleString()}, +${Math.round(bench.hts.comparisons?.hts_vs_b2?.ci95?.[1] ?? 0).toLocaleString()}], P(better)=${((bench.hts.comparisons?.hts_vs_b2?.prob_a_better ?? 0) * 100).toFixed(0)}%.`}
              </p>
              <p className="text-slate-400">
                {vi
                  ? "Raw-only: chọn method=hts trong Calendar khi dùng NASA raw. Sample trả 409 vì không có ô 1°. Không tự thay B2; badge candidate là bắt buộc."
                  : "Raw-only: choose method=hts in Calendar with NASA raw. Sample returns 409 (no 1° tiles). It never replaces B2 automatically; the candidate badge is required."}
              </p>
            </div>
          )}

          {bench?.sf_lite && (
            <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-4 text-xs text-slate-300 leading-relaxed font-sans space-y-1">
              <p className="font-bold text-sky-300">
                {vi ? "SensorFormer Lite: kết quả thí nghiệm" : "SensorFormer Lite: experimental result"}
              </p>
              <p>
                {vi
                  ? `SensorFormer (neo + phần dư): MAE ${Math.round(bench.sf_lite.metrics.mae).toLocaleString()} so với neo ${Math.round(bench.sf_lite.b2_mae ?? 0).toLocaleString()}; mean gain ${((bench.sf_lite.mean_gain_vs_b2 ?? 0) * 100).toFixed(1)}%. `
                  : `SensorFormer (anchor + residual): MAE ${Math.round(bench.sf_lite.metrics.mae).toLocaleString()} vs anchor ${Math.round(bench.sf_lite.b2_mae ?? 0).toLocaleString()}; mean gain ${((bench.sf_lite.mean_gain_vs_b2 ?? 0) * 100).toFixed(1)}%. `}
                {bench.sf_lite.deployed
                  ? (vi ? "Gate mở: phần dư được phép phục vụ." : "Gate open: the residual may be served.")
                  : (vi ? "Gate đóng: chỉ phục vụ neo mùa vụ, phần dư không bật." : "Gate closed: only the seasonal anchor is served; the residual is off.")}
              </p>
              <p className="text-slate-400">
                {vi
                  ? `Khoảng 10–90%: coverage thực nghiệm ${(100 * (bench.sf_lite.coverage80 ?? 0)).toFixed(1)}% (mục tiêu 80%), độ rộng trung bình ${Math.round(bench.sf_lite.mean_interval_width ?? 0).toLocaleString()}, trung vị ${Math.round(bench.sf_lite.median_interval_width ?? 0).toLocaleString()}. Ablation: no_gate MAE ${Math.round(bench.sf_lite.ablation?.no_gate?.mae ?? 0).toLocaleString()}, no_attn MAE ${Math.round(bench.sf_lite.ablation?.no_attn?.mae ?? 0).toLocaleString()}.`
                  : `10–90% band: empirical coverage ${(100 * (bench.sf_lite.coverage80 ?? 0)).toFixed(1)}% (target 80%), mean width ${Math.round(bench.sf_lite.mean_interval_width ?? 0).toLocaleString()}, median ${Math.round(bench.sf_lite.median_interval_width ?? 0).toLocaleString()}. Ablation: no_gate MAE ${Math.round(bench.sf_lite.ablation?.no_gate?.mae ?? 0).toLocaleString()}, no_attn MAE ${Math.round(bench.sf_lite.ablation?.no_attn?.mae ?? 0).toLocaleString()}.`}
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
            <pre className="p-3 rounded-lg bg-slate-950 text-slate-300 overflow-x-auto border border-slate-800">
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
