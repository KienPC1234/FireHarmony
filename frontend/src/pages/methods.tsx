import { useEffect, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Terminal,
  Upload,
} from "lucide-react";
import { api, describeError, ApiError, type BacktestResponse } from "@/lib/api";
import { parseCsv } from "@/lib/csv";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const METHOD_SPECS = [
  {
    id: "b0_raw_modis",
    name: { vi: "B0: Raw MODIS (Chưa hiệu chỉnh)", en: "B0: Raw MODIS (Unadjusted Baseline)" },
    category: { vi: "Baseline đối chứng", en: "Unadjusted Baseline" },
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
    id: "hgb_b2res_v4",
    name: { vi: "ML: Cây quyết định Histogram Gradient Boosting", en: "ML: Residual Histogram Gradient Boosting" },
    category: { vi: "Mô hình cây phần dư", en: "Stacked Residual Machine Learning" },
    input: { vi: "Neo mùa B2 + chuỗi 3 tháng trượt MODIS + chỉ số tháng", en: "B2 seasonal anchor + 3-month trailing MODIS + month index" },
    target: { vi: "Học phần dư trên nền B2: log(VIIRS) - log(B2)", en: "Residual learning over B2 anchor: log(VIIRS) - log(B2)" },
    assumptions: {
      vi: "Tương tác phi tuyến của phần dư có thể học được mà không bị overfit năm cực đoan.",
      en: "Non-linear residual interactions can be learned without overfitting extreme years.",
    },
    abstains: { vi: "Từ chối và tự động quay về B2 nếu MAE kiểm thử tệ hơn B2.", en: "Gated: abstains and defaults to B2 if test MAE is worse than B2." },
    failures: {
      vi: "Kém hơn B2 ở các tháng ít cháy do phương sai mẫu nhỏ làm bất ổn cây quyết định.",
      en: "Underperforms B2 in low-fire months due to small sample variance destabilizing trees.",
    },
  },
  {
    id: "ts_logratio_pool_v2",
    name: { vi: "TS: Transformer chú ý chuỗi thời gian", en: "TS: Pooled Temporal Transformer" },
    category: { vi: "Mạng chú ý học sâu", en: "Deep Temporal Attention Network" },
    input: { vi: "Chuỗi 12 tháng trượt của log-MODIS + embedding không gian AOI", en: "12-month trailing log-MODIS + spatial AOI embeddings" },
    target: { vi: "Mục tiêu log-ratio: log(VIIRS / MODIS)", en: "Log-ratio target: log(VIIRS / MODIS)" },
    assumptions: {
      vi: "Cơ chế chú ý qua lịch sử nhiều tháng nắm bắt được tích lũy khô hạn.",
      en: "Multi-month temporal attention captures compounding antecedent drought signals.",
    },
    abstains: { vi: "Từ chối nếu có ít hơn 12 tháng liên tục trong luồng dữ liệu.", en: "Abstains if fewer than 12 contiguous months exist in stream." },
    failures: {
      vi: "Nhạy cảm với các đợt bùng phát đơn lẻ không có dấu hiệu báo trước trong chuỗi.",
      en: "Vulnerable to sudden flash-fire outbreaks lacking antecedent trajectory signals.",
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
    id: "hgb_b2res_v4",
    label: { vi: "ML Cây phần dư HGBoost (ml_b2res_v4)", en: "ML: Residual Decision Tree (ml_b2res_v4)" },
    tag: { vi: "Gated ML", en: "Gated ML" },
    tagClass: "bg-cyan-500/15 border-cyan-500/30 text-cyan-300",
  },
  {
    id: "ts_logratio_pool_v2",
    label: { vi: "Transformer chuỗi thời gian (ts_logratio_pool_v2)", en: "TS: Pooled Transformer (ts_logratio_pool_v2)" },
    tag: { vi: "Đối chiếu sâu", en: "Deep Attention" },
    tagClass: "bg-purple-500/15 border-purple-500/30 text-purple-300",
  },
  {
    id: "sf_lite_v1",
    label: { vi: "SensorFormer Lite (sf_lite_v1, thí nghiệm)", en: "SensorFormer Lite (sf_lite_v1, experimental)" },
    tag: { vi: "Thí nghiệm", en: "Experimental" },
    tagClass: "bg-sky-500/15 border-sky-500/30 text-sky-300",
  },
];

export function MethodsPage() {
  const { lang } = useLang();
  const vi = lang === "vi";

  const [activeSection, setActiveSection] = useState<string>("sources");
  const [file, setFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<string>("");
  const [uploadLoading, setUploadLoading] = useState(false);
  const [bench, setBench] = useState<BacktestResponse | null>(null);
  const [benchErr, setBenchErr] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .backtest("vietnam", "raw")
      .then((r) => {
        if (alive) setBench(r);
      })
      .catch((e) => {
        if (alive) setBenchErr(describeError(e));
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
    <div className="space-y-8 pb-16 max-w-5xl mx-auto">
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

      {/* SECTION 2: HARMONIZATION STEPS */}
      {activeSection === "steps" && (
        <section className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 shadow-sm space-y-4">
          <div className="space-y-1 border-b border-slate-800 pb-3">
            <h2 className="text-base font-bold text-white">
              {vi ? "Quy trình & Mô hình hiệu chỉnh" : "Harmonization Steps & Model Specifications"}
            </h2>
            <p className="text-xs text-slate-400">
              {vi ? "Các thông số toán học, giả định và điều kiện từ chối của từng phương pháp." : "Mathematical parameters, assumptions, and abstention conditions."}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase text-xs">
                  <th className="py-2.5 pr-4">{vi ? "Mô hình & Phương pháp" : "Model & Method"}</th>
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
                    <td className="py-3 pr-4 text-slate-300">{vi ? spec.target.vi : spec.target.en}</td>
                    <td className="py-3 pr-4 font-sans text-xs text-slate-300 max-w-xs">{vi ? spec.assumptions.vi : spec.assumptions.en}</td>
                    <td className="py-3 pr-4 font-sans text-xs text-slate-300 max-w-xs">{vi ? spec.abstains.vi : spec.abstains.en}</td>
                    <td className="py-3 text-right font-sans text-xs text-amber-300 max-w-xs">{vi ? spec.failures.vi : spec.failures.en}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                      : bench.headline?.metrics[row.id];
                    if (!m) return null;
                    const tag = row.id === "hgb_b2res_v4" && !bench.hgb_residual_enabled
                      ? { vi: "Gate OFF · dùng B2", en: "Gate OFF · serves B2" }
                      : row.id === "sf_lite_v1"
                      ? (bench.sf_lite?.deployed
                        ? { vi: "Gate PASS", en: "Gate PASS" }
                        : { vi: "Gate OFF · không phục vụ", en: "Gate OFF · not served" })
                      : row.tag;
                    const tone = row.id === "sf_lite_v1" && !bench.sf_lite?.deployed
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

          {bench?.sf_lite && (
            <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-4 text-xs text-slate-300 leading-relaxed font-sans space-y-1">
              <p className="font-bold text-sky-300">
                {vi ? "SensorFormer Lite — kết quả thí nghiệm" : "SensorFormer Lite — experimental result"}
              </p>
              <p>
                {vi
                  ? `MAE ${Math.round(bench.sf_lite.metrics.mae).toLocaleString()} so với B2 ${Math.round(bench.sf_lite.b2_mae ?? 0).toLocaleString()}; mean gain ${((bench.sf_lite.mean_gain_vs_b2 ?? 0) * 100).toFixed(1)}%. `
                  : `MAE ${Math.round(bench.sf_lite.metrics.mae).toLocaleString()} vs B2 ${Math.round(bench.sf_lite.b2_mae ?? 0).toLocaleString()}; mean gain ${((bench.sf_lite.mean_gain_vs_b2 ?? 0) * 100).toFixed(1)}%. `}
                {bench.sf_lite.deployed
                  ? (vi ? "Mô hình vượt gate và được phép phục vụ." : "It passed the gate and may be served.")
                  : (vi ? "Không vượt gate nên KHÔNG được phục vụ; B2 vẫn là mặc định." : "It did not pass the gate, so it is NOT served; B2 remains the default.")}
              </p>
              <p className="text-slate-400">
                {vi
                  ? `Khoảng 10–90%: coverage thực nghiệm ${(100 * (bench.sf_lite.coverage80 ?? 0)).toFixed(1)}% (mục tiêu 80%), độ rộng trung vị ${Math.round(bench.sf_lite.median_interval_width ?? 0).toLocaleString()}. Ablation: no_gate MAE ${Math.round(bench.sf_lite.ablation?.no_gate?.mae ?? 0).toLocaleString()}, no_attn MAE ${Math.round(bench.sf_lite.ablation?.no_attn?.mae ?? 0).toLocaleString()}.`
                  : `10–90% band: empirical coverage ${(100 * (bench.sf_lite.coverage80 ?? 0)).toFixed(1)}% (target 80%), median width ${Math.round(bench.sf_lite.median_interval_width ?? 0).toLocaleString()}. Ablation: no_gate MAE ${Math.round(bench.sf_lite.ablation?.no_gate?.mae ?? 0).toLocaleString()}, no_attn MAE ${Math.round(bench.sf_lite.ablation?.no_attn?.mae ?? 0).toLocaleString()}.`}
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
