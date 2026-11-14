import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Database,
  FileUp,
  Radio,
  Scale,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { ErrorState } from "@/components/states";

export function HomePage() {
  const { lang } = useLang();
  const vi = lang === "vi";

  const [dataStats, setDataStats] = useState<{
    raw_count: number;
    datasets: Array<{ aoi: string; sample_rows: number; sample_bytes: number }>;
  } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [interactiveMode, setInteractiveMode] = useState<"naive" | "harmonized">("naive");

  useEffect(() => {
    api.dataStatus().then(setDataStats).catch(setError);
  }, []);

  if (error) return <ErrorState error={error} />;

  const hasRawData = (dataStats?.raw_count ?? 0) > 0;

  return (
    <div className="space-y-12 pb-16">
      {/* 1. Hero Console */}
      <section className="relative overflow-hidden rounded-2xl border border-slate-800 bg-[#111C2E] p-6 sm:p-10 shadow-sm">
        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-300">
            <Radio className="h-3.5 w-3.5 text-cyan-400" />
            <span>NASA Space Apps Challenge 2026 · Earth Science</span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
            {vi
              ? "Một calendar cháy duy nhất cho hai thế hệ vệ tinh."
              : "One fire calendar for two satellite generations."}
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
            {vi
              ? "MODIS và VIIRS ghi nhận điểm nóng với năng lực quan trắc khác nhau. Khám phá chuỗi dữ liệu 25 năm, so sánh sai khác cảm biến và kiểm chứng tính toàn vẹn của bằng chứng quan sát."
              : "MODIS and VIIRS detect hotspots with different optical capabilities. Explore 25 years of history, inspect sensor discrepancies, and verify observation integrity."}
          </p>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              to={hasRawData ? "/calendar?data=raw&aoi=vietnam" : "/calendar?data=sample&aoi=vietnam"}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-orange-500 transition active:scale-95 min-h-[44px]"
            >
              <span>{vi ? "Khám phá dữ liệu" : "Explore Data"}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>

            <Link
              to="/lab?tab=replay"
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/40 px-5 py-3 text-sm font-semibold text-cyan-200 hover:bg-cyan-900/50 transition min-h-[44px]"
            >
              <span>{vi ? "Thử kiểm chứng cảm biến" : "Test Sensor Validation"}</span>
            </Link>

            <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs font-mono text-slate-300 min-h-[44px]">
              <Database className="h-4 w-4 text-cyan-400" />
              <span>
                {hasRawData
                  ? `NASA Observed (${dataStats?.raw_count} files indexed)`
                  : "Synthetic Feed (Offline verified sample)"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Interactive Footprint Illustration */}
      <section className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1 max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
              <ShieldAlert className="h-4 w-4" />
              <span>{vi ? "Vấn đề cốt lõi" : "The Core Problem"}</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              {vi
                ? "Sự thay đổi cảm biến không nhất thiết là sự thay đổi của đám cháy."
                : "A change in the sensor is not necessarily a change in fire activity."}
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              {vi
                ? "MODIS (pixel 1 km) và VIIRS (pixel 375 m) có năng lực phát hiện khác nhau. Việc cộng dồn trực tiếp hai thế hệ cảm biến có thể làm lệch chuỗi nếu ghép trực tiếp mà không chuẩn hóa."
                : "MODIS (1 km pixel) and VIIRS (375 m pixel) differ in spatial resolution. A direct merge distorts the time series without proper calibration."}
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
              {vi ? "Cộng gộp thô (Naive)" : "Naive Direct Merge"}
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
              {vi ? "Chuỗi hiệu chuẩn" : "Calibrated Signal"}
            </button>
          </div>
        </div>

        {/* Footprint Comparison Grid */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Spatial Footprint Comparison */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs uppercase tracking-wider text-slate-300">
                {vi ? "So sánh kích thước pixel hình học" : "Geometric Pixel Footprint Comparison"}
              </span>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-mono text-amber-300">
                DEMONSTRATION
              </span>
            </div>

            <div className="flex items-center justify-around py-4">
              {/* MODIS 1km Box */}
              <div className="flex flex-col items-center gap-2">
                <div className="relative flex h-28 w-28 items-center justify-center rounded-lg border-2 border-dashed border-blue-500 bg-blue-500/10">
                  <span className="font-mono text-xs font-bold text-blue-300">1 km x 1 km</span>
                </div>
                <div className="text-center font-mono text-xs">
                  <div className="font-bold text-blue-400">MODIS (Terra/Aqua)</div>
                  <div className="text-slate-400">100 ha / pixel</div>
                </div>
              </div>

              {/* Difference Arrow */}
              <div className="flex flex-col items-center text-slate-400 font-mono text-xs gap-1">
                <span>7x diện tích</span>
                <ArrowRight className="h-4 w-4 text-cyan-400" />
                <span>độ nhạy cao hơn</span>
              </div>

              {/* VIIRS 375m Box */}
              <div className="flex flex-col items-center gap-2">
                <div className="grid grid-cols-2 gap-1.5 h-28 w-28 items-center justify-center p-2 rounded-lg border border-teal-500/40 bg-teal-950/20">
                  <div className="flex h-10 w-10 items-center justify-center rounded border border-teal-400 bg-teal-500/20 font-mono text-xs text-teal-300 font-bold">
                    375m
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded border border-teal-400/50 bg-teal-500/10 font-mono text-xs text-teal-300">
                    375m
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded border border-teal-400/50 bg-teal-500/10 font-mono text-xs text-teal-300">
                    375m
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded border border-teal-400/50 bg-teal-500/10 font-mono text-xs text-teal-300">
                    375m
                  </div>
                </div>
                <div className="text-center font-mono text-xs">
                  <div className="font-bold text-teal-400">VIIRS (S-NPP / NOAA)</div>
                  <div className="text-slate-400">14 ha / pixel</div>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed border-t border-slate-800 pt-3">
              {vi
                ? "Ghi chú: Sơ đồ minh họa độ phân giải hình học của cảm biến, không phải kết quả đếm điểm nóng thực tế. VIIRS phát hiện được các điểm nhiệt diện tích nhỏ hơn MODIS."
                : "Note: Geometric pixel resolution demonstration only, not hotspot detection counts. VIIRS identifies smaller fire thermal points than MODIS."}
            </p>
          </div>

          {/* Interactive Multi-Decadal Signal */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs uppercase tracking-wider text-slate-300">
                {vi ? "Ảnh hưởng lên chuỗi lịch sử" : "Historical Time Series Impact"}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-mono border ${
                  interactiveMode === "naive"
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                }`}
              >
                {interactiveMode === "naive"
                  ? (vi ? "BƯỚC NHẢY CẢM BIẾN" : "SENSOR STEP ARTIFACT")
                  : (vi ? "CHUỖI HIỆU CHUẨN" : "CALIBRATED RECORD")}
              </span>
            </div>

            {/* Illustrative bars */}
            <div className="space-y-3 py-2 font-mono text-xs">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">2002 - 2011 (MODIS Era):</span>
                  <span className="font-bold text-blue-300">
                    {interactiveMode === "naive" ? (vi ? "Chỉ tính MODIS" : "MODIS counts only") : (vi ? "Thang chuẩn hóa" : "Calibrated scale")}
                  </span>
                </div>
                <div className="h-3.5 w-full rounded bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-500"
                    style={{ width: interactiveMode === "naive" ? "35%" : "85%" }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">2012 - 2025 (VIIRS Era):</span>
                  <span className="font-bold text-teal-300">
                    {interactiveMode === "naive" ? (vi ? "Cộng thô MODIS + VIIRS" : "Unadjusted sum") : (vi ? "Thang đo đồng nhất" : "Unified baseline")}
                  </span>
                </div>
                <div className="h-3.5 w-full rounded bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-teal-500 transition-all duration-500"
                    style={{ width: "90%" }}
                  />
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
                  <strong>{vi ? "Biến động giả:" : "Artificial Artifact:"}</strong>{" "}
                  {vi
                    ? "Khác biệt cảm biến có thể làm lệch chuỗi nếu ghép trực tiếp. Bước nhảy xuất hiện năm 2012 do bổ sung dữ liệu VIIRS chứ không phải đám cháy tăng đột biến."
                    : "Direct concatenation creates an artificial step-change in 2012 when VIIRS launched, confusing sensor changes with environmental trends."}
                </span>
              ) : (
                <span>
                  <strong>{vi ? "Chỉ số hiệu chuẩn:" : "Calibrated Index:"}</strong>{" "}
                  {vi
                    ? "Chuẩn hóa theo tỷ lệ thực nghiệm giữa hai cảm biến giúp bảo toàn khả năng so sánh liên năm một cách nhất quán."
                    : "Empirical ratio calibration adjusts the historical scale to restore consistent comparability across satellite generations."}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 3. Explore a Question (3 Action Cards) */}
      <section className="space-y-4">
        <div className="space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
            {vi ? "Khám phá theo tác vụ" : "Explore a Question"}
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {vi ? "Ba câu hỏi khoa học bạn có thể kiểm chứng ngay" : "Three Questions You Can Investigate"}
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Link
            to="/calendar?aoi=vietnam"
            className="group rounded-2xl border border-slate-800 bg-[#111C2E] p-5 shadow-sm hover:border-cyan-500/40 transition min-h-[160px] flex flex-col justify-between"
          >
            <div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/40 text-cyan-300 mb-4 group-hover:scale-105 transition-transform">
                <CalendarDays className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-white text-base mb-1.5 flex items-center justify-between">
                <span>{vi ? "Khi nào điểm nóng bất thường?" : "When Are Hotspots Anomalous?"}</span>
                <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-cyan-400 transition" />
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {vi
                  ? "Xem ma trận 25 năm x 12 tháng với chỉ số robust z-score, phát hiện tháng cháy cao bất thường độc lập với thời điểm phóng vệ tinh."
                  : "Inspect the 25-year matrix with robust z-scores to isolate truly unusual fire months free from sensor timing bias."}
              </p>
            </div>
            <span className="text-xs font-semibold text-cyan-400 pt-3 flex items-center gap-1">
              {vi ? "Mở Fire Calendar" : "Open Fire Calendar"} &rarr;
            </span>
          </Link>

          <Link
            to="/lab?tab=xray"
            className="group rounded-2xl border border-slate-800 bg-[#111C2E] p-5 shadow-sm hover:border-amber-500/40 transition min-h-[160px] flex flex-col justify-between"
          >
            <div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-950/40 text-amber-300 mb-4 group-hover:scale-105 transition-transform">
                <Scale className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-white text-base mb-1.5 flex items-center justify-between">
                <span>{vi ? "Hai cảm biến khác nhau thế nào?" : "How Do Sensors Differ?"}</span>
                <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-amber-400 transition" />
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {vi
                  ? "Phân tích Sensor X-Ray, chạy Blind Sensor Replay trên tập holdout đóng băng và thử nghiệm các cấu hình vệ tinh."
                  : "Explore Sensor X-Ray, run Blind Sensor Replay across frozen holdouts, and test satellite observation choices."}
              </p>
            </div>
            <span className="text-xs font-semibold text-amber-400 pt-3 flex items-center gap-1">
              {vi ? "Mở Sensor Lab" : "Open Sensor Lab"} &rarr;
            </span>
          </Link>

          <Link
            to="/evidence?aoi=vietnam"
            className="group rounded-2xl border border-slate-800 bg-[#111C2E] p-5 shadow-sm hover:border-emerald-500/40 transition min-h-[160px] flex flex-col justify-between"
          >
            <div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-950/40 text-emerald-300 mb-4 group-hover:scale-105 transition-transform">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-white text-base mb-1.5 flex items-center justify-between">
                <span>{vi ? "Tôi có thể tin kết luận này không?" : "Can We Trust This Conclusion?"}</span>
                <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-emerald-400 transition" />
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {vi
                  ? "Kiểm tra sổ bằng chứng Evidence Ledger để xem ma trận ngày quan trắc, tỷ lệ dữ liệu khả dụng và cảnh báo khi thiếu thông tin."
                  : "Inspect the Evidence Ledger matrix to check daily observation availability, coverage criteria, and missing-data flags."}
              </p>
            </div>
            <span className="text-xs font-semibold text-emerald-400 pt-3 flex items-center gap-1">
              {vi ? "Mở Evidence Ledger" : "Open Evidence Ledger"} &rarr;
            </span>
          </Link>
        </div>
      </section>

      {/* 4. How the Analysis Works (3 Concise Steps) */}
      <section className="space-y-4">
        <div className="space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
            {vi ? "Quy trình phân tích" : "How It Works"}
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {vi ? "Ba bước xử lý khoa học" : "Three Processing Stages"}
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-3 font-mono text-xs">
          <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 space-y-2">
            <div className="text-cyan-400 font-bold text-sm">
              01. {vi ? "THU THẬP & CHUẨN HÓA" : "COLLECT & STANDARDIZE"}
            </div>
            <p className="font-sans text-xs text-slate-300 leading-relaxed">
              {vi
                ? "Đồng bộ dữ liệu MODIS C6.1 và VIIRS 375m về cùng một lược đồ kiểm soát chất lượng QA và phân loại điểm nhiệt trên đất liền."
                : "Ingest and standardize MODIS C6.1 and VIIRS 375m records into a unified strict schema with QA quality control."}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 space-y-2">
            <div className="text-cyan-400 font-bold text-sm">
              02. {vi ? "ĐỐI CHIẾU & HIỆU CHỈNH" : "COMPARE & ADJUST"}
            </div>
            <p className="font-sans text-xs text-slate-300 leading-relaxed">
              {vi
                ? "Tính toán tỷ lệ thực nghiệm k trên các ngày có quan trắc song song; hiệu chỉnh thang đo thời kỳ MODIS về mức tương đương VIIRS."
                : "Compute empirical k-ratios from paired co-observation days; calibrate early MODIS counts to VIIRS equivalent scale."}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 space-y-2">
            <div className="text-cyan-400 font-bold text-sm">
              03. {vi ? "KIỂM CHỨNG BẰNG CHỨNG" : "VERIFY EVIDENCE"}
            </div>
            <p className="font-sans text-xs text-slate-300 leading-relaxed">
              {vi
                ? "Gắn nhãn rõ ràng từng ô dữ liệu quan trắc hay ước lượng; từ chối suy luận khi không đủ ngày dữ liệu đối chiếu hợp lệ."
                : "Tag every cell as observed or estimated; abstain from conclusions when comparable paired coverage is insufficient."}
            </p>
          </div>
        </div>
      </section>

      {/* 5. Calibrated Study Areas */}
      <section className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 sm:p-8 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              {vi ? "Ba khu vực nghiên cứu chuẩn hóa" : "Calibrated Study Areas"}
            </h2>
            <p className="text-xs text-slate-400">
              {vi
                ? "Dữ liệu được chuẩn bị sẵn cho ba hệ sinh thái và bối cảnh cháy khác biệt."
                : "Pre-calibrated datasets across three distinct fire ecosystems."}
            </p>
          </div>
          <span className="font-mono text-xs text-cyan-400">3 Calibrated AOIs</span>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Vietnam */}
          <div className="rounded-xl border border-cyan-500/30 bg-slate-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200">Việt Nam</span>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-mono text-emerald-300">
                Full Record
              </span>
            </div>
            <p className="text-xs text-slate-300">
              {vi
                ? "Tây Nguyên & Duyên hải Nam Trung Bộ. Mùa khô rõ rệt tháng 12 đến tháng 4."
                : "Central Highlands & Mekong agricultural burning with high seasonal contrast (Dec-Apr dry season)."}
            </p>
            <div className="space-y-1 font-mono text-xs text-slate-400 pt-1">
              <div>BBox: 104°E - 109°E, 10°N - 16°N</div>
            </div>
            <Link
              to="/calendar?aoi=vietnam"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/40 py-2.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/50 transition min-h-[40px]"
            >
              <span>{vi ? "Mở Calendar Việt Nam" : "Open Vietnam Calendar"}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Amazon */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200">Amazon</span>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-mono text-emerald-300">
                Peak 2019
              </span>
            </div>
            <p className="text-xs text-slate-300">
              {vi
                ? "Nam bồn địa Amazon và vùng chuyển tiếp Cerrado. Mùa khô tháng 7 đến tháng 10."
                : "Southern Basin / Cerrado deforestation and severe drought burning seasons (Jul-Oct peak)."}
            </p>
            <div className="space-y-1 font-mono text-xs text-slate-400 pt-1">
              <div>BBox: 70°W - 50°W, 12°S - 3°N</div>
            </div>
            <Link
              to="/calendar?aoi=amazon"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition min-h-[40px]"
            >
              <span>{vi ? "Mở Calendar Amazon" : "Open Amazon Calendar"}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Australia */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200">Australia</span>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-mono text-amber-300">
                Black Summer
              </span>
            </div>
            <p className="text-xs text-slate-300">
              {vi
                ? "Đông Nam nước Úc với đợt cháy thảm họa Black Summer 2019-2020."
                : "Southeast mega-fire territory with transparent partial-data disclosures."}
            </p>
            <div className="space-y-1 font-mono text-xs text-slate-400 pt-1">
              <div>BBox: 113°E - 153°E, 39°S - 12°S</div>
            </div>
            <Link
              to="/calendar?aoi=australia"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition min-h-[40px]"
            >
              <span>{vi ? "Mở Calendar Úc" : "Open Australia Calendar"}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* 6. Advanced Research Tools Section (CSV Import) */}
      <section className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <FileUp className="h-4 w-4 text-cyan-400" />
            <span>{vi ? "Công cụ nghiên cứu nâng cao" : "Advanced Research Tools"}</span>
          </div>
          <span className="text-xs text-slate-400">{vi ? "Tùy chọn tải dữ liệu" : "Data Import Options"}</span>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="space-y-1">
            <div className="font-bold text-white text-sm">
              {vi ? "Nhập tệp dữ liệu FIRMS của bạn" : "Import Custom FIRMS CSV"}
            </div>
            <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
              {vi
                ? "Bạn có file CSV tải từ NASA FIRMS Area API? Mở trang Phương pháp & Dữ liệu để tải lên và phân tích trực tiếp theo quy trình chuẩn."
                : "Download CSV from the NASA FIRMS Area API and upload it in Methods & Data for automated schema parsing and harmonization."}
            </p>
          </div>
          <Link
            to="/methods"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-xs font-semibold text-white transition shrink-0 min-h-[40px]"
          >
            <span>{vi ? "Đến mục Nhập CSV" : "Go to CSV Tools"}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* 7. Scientific Boundaries & Limits */}
      <section className="rounded-2xl border border-amber-500/30 bg-amber-950/10 p-6 sm:p-8 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
          <ShieldAlert className="h-4 w-4" />
          <span>{vi ? "Giới hạn khoa học & Điều chúng tôi không tuyên bố" : "Scientific Boundaries & What We Do Not Claim"}</span>
        </div>

        <div className="grid gap-4 md:grid-cols-3 text-xs text-slate-300 leading-relaxed">
          <div className="space-y-1.5">
            <div className="font-bold text-white">
              {vi ? "Lượt điểm nóng != Số vụ cháy thực" : "Hotspots != Fire Incidents"}
            </div>
            <p className="text-slate-400">
              {vi
                ? "Điểm nóng là các phát hiện nhiệt từ cảm biến vệ tinh, không phải số vụ cháy thực tế riêng lẻ. Một đám cháy lớn có thể tạo nhiều điểm nóng."
                : "Hotspots are satellite thermal detections, not confirmed individual fire incidents. Multiple detections can come from one large fire."}
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="font-bold text-white">
              {vi ? "Không có điểm nóng != Không có cháy" : "Missing != Absence of Fire"}
            </div>
            <p className="text-slate-400">
              {vi
                ? "Không phát hiện điểm nóng không đồng nghĩa với không có cháy. Mây mù dày hoặc góc quét có thể che khuất ngọn lửa. Dữ liệu thiếu không được quy về 0."
                : "Zero detections in a cell does not prove an absence of fire. Heavy cloud cover or orbital timing gaps can prevent detection."}
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="font-bold text-white">
              {vi ? "Số ước lượng != Số đo thực địa" : "Estimates != Ground Truth"}
            </div>
            <p className="text-slate-400">
              {vi
                ? "Chỉ số hoạt động đã hiệu chỉnh là ước lượng thống kê thực nghiệm phục vụ nghiên cứu xu hướng, không dùng cho điều phối cứu hỏa tác chiến."
                : "Sensor-adjusted activity indexes are empirical statistical estimates for historical trend analysis, not real-time firefighting dispatch telemetry."}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
