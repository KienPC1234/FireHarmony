import { Trophy } from "lucide-react";
import { cn, num } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

interface XrayBacktestLeaderboardProps {
  metrics: Record<string, Record<string, number>> | null;
  backtest: {
    train_years: number[];
    test_years: number[];
    months: Array<{
      year: number;
      month: number;
      modis: number;
      viirs_ref: number;
      stan_pred: number | null;
      hts_pred: number | null;
      b2_pred: number;
    }>;
  } | null;
}

const fmtYears = (years: number[]) => {
  if (!years.length) return "-";
  const sorted = [...years].sort((a, b) => a - b);
  const contiguous = sorted.every((y, i) => i === 0 || y === sorted[i - 1] + 1);
  return contiguous ? `${sorted[0]}-${sorted[sorted.length - 1]}` : sorted.join(", ");
};

const MODEL_SPECS = [
  {
    id: "b0_raw_modis",
    name: { vi: "B0: Raw MODIS (Chưa hiệu chỉnh)", en: "B0: Raw MODIS (Unadjusted)" },
    desc: {
      vi: "Đếm điểm nóng MODIS thô. Bỏ qua hoàn toàn sự khác biệt diện tích điểm ảnh 375m.",
      en: "Baseline unadjusted MODIS count. Fails to account for 375m sensor footprint.",
    },
    badge: { vi: "Baseline thô", en: "Baseline (No Scaling)" },
    tone: "bad",
  },
  {
    id: "b1_global_ratio",
    name: { vi: "B1: Hệ số nhân cố định (Global Ratio)", en: "B1: Scalar Global Ratio" },
    desc: {
      vi: "Một hệ số nhân tỷ lệ k duy nhất cho toàn bộ các tháng và mùa trong năm.",
      en: "Single scalar multiplier k across all months and seasons.",
    },
    badge: { vi: "Hệ số đơn lẻ", en: "Scalar Multiplier" },
    tone: "warn",
  },
  {
    id: "b2_seasonal_ratio",
    name: { vi: "B2: Hệ số mùa (Chu kỳ thiên văn 12 tháng)", en: "B2: Seasonal Ratio (Astronomical Cycle)" },
    desc: {
      vi: "12 hệ số thực nghiệm k_m riêng biệt theo từng tháng để nắm bắt góc chiếu và thời tiết.",
      en: "12 individual monthly ratios k_m accounting for solar elevation and seasonal weather.",
    },
    badge: { vi: "Neo vận hành", en: "Operational Anchor" },
    tone: "good",
  },
  {
    id: "stan_safe_v1",
    name: { vi: "STAN: mạng không-thời gian theo count", en: "STAN: Spatial-Temporal Count Network" },
    desc: {
      vi: "Dilated TCN + FiLM theo mùa + target-month cross-attention + negative-binomial, có bối cảnh ô lân cận nhưng không dùng VIIRS cùng tháng của ô bên cạnh.",
      en: "Dilated TCN + seasonal FiLM + target-month cross-attention + negative-binomial, with neighbour context but no same-month neighbour VIIRS.",
    },
    badge: { vi: "Chủ lực · forecast-safe", en: "Main · forecast-safe" },
    tone: "good",
  },
  {
    id: "hts_anchor_v1",
    name: { vi: "HTS: neo mùa vụ theo ô 1°", en: "HTS: 1° Tile-Seasonal Anchor" },
    desc: {
      vi: "Mỗi ô 1° có tỷ lệ mùa riêng, co về B2; tổng ô-tháng tạo chỉ số AOI. Cải thiện cả 3 vùng nhưng CI còn chứa 0.",
      en: "Per-1° tile seasonal ratio shrunk toward B2; summing tile-months gives the AOI index. Improves all three regions but the CI still includes 0.",
    },
    badge: { vi: "Candidate · CI chứa 0", en: "Candidate · CI includes 0" },
    tone: "warn",
  },
] as const;

export function XrayBacktestLeaderboard({ metrics, backtest }: XrayBacktestLeaderboardProps) {
  const { lang } = useLang();
  const vi = lang === "vi";

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Protocol Banner */}
      <div className="rounded-2xl border border-cyan-500/30 bg-slate-950/85 p-4 shadow-card backdrop-blur space-y-2">
        <div className="flex items-center justify-between border-b border-border/50 pb-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
            <Trophy className="h-4 w-4 text-cyan-400" />
            <span>{vi ? "Nghị định thư kiểm chứng Time-Travel Holdout" : "Time-Travel Holdout Protocol"}</span>
          </div>
          <span className="font-mono text-xs text-cyan-400">
            {vi ? "Kiểm thử giấu kín nghiêm ngặt" : "Strict Blindfolded Test"}
          </span>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          {backtest
            ? vi
              ? `Huấn luyện trên ${fmtYears(backtest.train_years)} (đồng thời cả MODIS & VIIRS). Kiểm thử trên ${fmtYears(backtest.test_years)} với VIIRS hoàn toàn bị giấu kín (blindfolded). Không tháng tương lai nào lọt vào tập huấn luyện.`
              : `Trained on ${fmtYears(backtest.train_years)} (both MODIS & VIIRS visible). Evaluated on ${fmtYears(backtest.test_years)} with VIIRS strictly blindfolded. No future month leaks into training.`
            : vi
              ? "Đang tải nghị định thư từ artifact đánh giá đã lưu…"
              : "Loading protocol from the persisted evaluation artifact…"}
        </p>

        {backtest && (
          <div className="flex flex-wrap items-center gap-3 pt-1 font-mono text-xs">
            <div className="rounded-lg border border-border/60 bg-slate-900/80 px-2.5 py-1 text-slate-300">
              <span className="text-muted-foreground mr-1.5">{vi ? "Huấn luyện:" : "Train:"}</span>
              <span className="text-cyan-300 font-semibold">{backtest.train_years.join(", ")}</span>
            </div>
            <div className="rounded-lg border border-border/60 bg-slate-900/80 px-2.5 py-1 text-slate-300">
              <span className="text-muted-foreground mr-1.5">{vi ? "Kiểm thử mù:" : "Holdout Test:"}</span>
              <span className="text-emerald-300 font-semibold">{backtest.test_years.join(", ")}</span>
            </div>
          </div>
        )}
      </div>

      {/* Leaderboard Table Card */}
      <div className="rounded-2xl border border-border/80 bg-slate-950/85 p-5 shadow-card backdrop-blur space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">
              {vi ? "Bảng so sánh hiệu năng các mô hình Harmonization" : "Harmonization Model Accuracy Matrix"}
            </h3>
            <p className="text-xs text-slate-400">
              {vi
                ? "Đánh giá theo MAE (Sai số tuyệt đối trung bình), WAPE (%) và Độ lệch dư (Bias)"
                : "Ranked across Mean Absolute Error (MAE), Weighted Absolute Percentage Error (WAPE), and Residual Bias"}
            </p>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {metrics
              ? vi
                ? `${Object.keys(metrics).length} mô hình đã đánh giá`
                : `${Object.keys(metrics).length} Models Evaluated`
              : vi
              ? "Đang đánh giá..."
              : "Evaluating..."}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-border/60 text-xs uppercase tracking-wider text-slate-400">
                <th className="py-2.5 font-semibold">{vi ? "Mô hình" : "Model Pipeline"}</th>
                <th className="py-2.5 text-right font-semibold">MAE</th>
                <th className="py-2.5 text-right font-semibold">WAPE</th>
                <th className="py-2.5 text-right font-semibold">{vi ? "Độ lệch" : "Mean Bias"}</th>
                <th className="py-2.5 text-center font-semibold">{vi ? "Kiến trúc" : "Architecture"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {MODEL_SPECS.map((spec) => {
                const met = metrics?.[spec.id];
                const mae = met?.mae;
                const wape = met?.wape;
                const bias = met?.bias;

                return (
                  <tr key={spec.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 pr-4">
                      <div className="font-sans font-bold text-slate-200">{vi ? spec.name.vi : spec.name.en}</div>
                      <div className="font-sans text-xs text-slate-400">{vi ? spec.desc.vi : spec.desc.en}</div>
                    </td>
                    <td className="py-3 text-right font-semibold text-slate-200">
                      {typeof mae === "number" ? num(Math.round(mae)) : "-"}
                    </td>
                    <td className="py-3 text-right">
                      {typeof wape === "number" ? (
                        <span
                          className={cn(
                            "font-bold",
                            wape < 0.25
                              ? "text-emerald-400"
                              : wape < 0.4
                              ? "text-amber-400"
                              : "text-rose-400",
                          )}
                        >
                          {(wape * 100).toFixed(1)}%
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="py-3 text-right text-slate-300">
                      {typeof bias === "number" ? `${bias > 0 ? "+" : ""}${bias.toFixed(1)}` : "-"}
                    </td>
                    <td className="py-3 text-center">
                      <span className="rounded-full border border-border/70 bg-slate-900 px-2.5 py-0.5 text-xs text-slate-300">
                        {vi ? spec.badge.vi : spec.badge.en}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Holdout Month Inspector */}
      {backtest && backtest.months && backtest.months.length > 0 && (
        <div className="rounded-2xl border border-border/80 bg-slate-950/85 p-5 shadow-card backdrop-blur space-y-3">
          <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                {vi ? "Chi tiết từng tháng kiểm nghiệm (Holdout Months)" : "Unseen Holdout Months Audit Ledger"}
              </h3>
              <p className="text-xs text-slate-400">
                {vi
                  ? "Dự đoán vs VIIRS thực tế trên các tháng giấu kín hoàn toàn trong quá trình huấn luyện"
                  : "Predicted vs Actual VIIRS where VIIRS was strictly blindfolded during test"}
              </p>
            </div>
            <span className="font-mono text-xs text-cyan-400 font-semibold">
              {backtest.months.length} {vi ? "tháng giấu kín" : "Holdout Months"}
            </span>
          </div>

          <div className="max-h-72 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="sticky top-0 bg-slate-950 border-b border-border/60 text-xs uppercase text-slate-400">
                <tr>
                  <th className="p-2">{vi ? "Thời gian" : "Period"}</th>
                  <th className="p-2 text-right">{vi ? "MODIS gốc" : "Raw MODIS"}</th>
                  <th className="p-2 text-right">{vi ? "VIIRS thực tế" : "Actual VIIRS"}</th>
                  <th className="p-2 text-right">{vi ? "Dự đoán STAN" : "STAN Prediction"}</th>
                  <th className="p-2 text-right">{vi ? "Sai số dư" : "Residual Error"}</th>
                  <th className="p-2 text-center">{vi ? "Mức phù hợp" : "Agreement"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {backtest.months.map((m, idx) => {
                  const pred = m.stan_pred ?? m.b2_pred;
                  const residual = pred - m.viirs_ref;
                  const pctDiff = m.viirs_ref > 0
                    ? Math.abs(residual) / m.viirs_ref
                    : 0;

                  return (
                    <tr key={idx} className="hover:bg-white/5 transition-colors">
                      <td className="p-2 font-bold text-slate-200">
                        {m.year}-{String(m.month).padStart(2, "0")}
                      </td>
                      <td className="p-2 text-right text-slate-400">{num(m.modis)}</td>
                      <td className="p-2 text-right font-semibold text-emerald-400">{num(m.viirs_ref)}</td>
                      <td className="p-2 text-right font-semibold text-cyan-300">{num(Math.round(pred))}</td>
                      <td className="p-2 text-right text-slate-300">
                        {residual > 0 ? "+" : ""}{residual.toFixed(1)}
                      </td>
                      <td className="p-2 text-center">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-bold uppercase",
                            pctDiff < 0.15
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              : pctDiff < 0.35
                              ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                              : "bg-rose-500/15 text-rose-400 border border-rose-500/30",
                          )}
                        >
                          {pctDiff < 0.15
                            ? vi ? "Cao (Đạt)" : "High (Pass)"
                            : pctDiff < 0.35
                            ? vi ? "Trung bình" : "Moderate"
                            : vi ? "Phân kỳ" : "Divergence"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
