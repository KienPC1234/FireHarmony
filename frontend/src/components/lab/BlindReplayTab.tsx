import { useState, useMemo } from "react";
import {
  EyeOff,
  HelpCircle,
  Lock,
  RefreshCw,
  Unlock,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn, num } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

interface BlindReplayTabProps {
  aoi: string;
  data: string;
  backtest: {
    train_years: number[];
    test_years: number[];
    months: Array<{
      year: number;
      month: number;
      modis: number;
      viirs_ref: number;
      ml_pred: number;
      ts_pred: number | null;
      b2_pred: number;
    }>;
  } | null;
  loading?: boolean;
}

export function BlindReplayTab({ aoi, data, backtest, loading }: BlindReplayTabProps) {
  const { lang } = useLang();
  const vi = lang === "vi";

  const [revealed, setRevealed] = useState(false);
  const [showFailuresOnly, setShowFailuresOnly] = useState(false);
  const [selectedModel, setSelectedModel] = useState<"ml" | "ts">("ml");

  const months = useMemo(() => backtest?.months ?? [], [backtest]);

  // Transform data for chart based on revealed state
  const chartData = useMemo(() => {
    return months.map((m) => {
      const pred = selectedModel === "ts" && m.ts_pred !== null ? m.ts_pred : m.ml_pred;
      // B2 anchor comes from the persisted evaluation row, never a hardcoded multiplier.
      const b2_anchor = m.b2_pred;
      const residual = Math.round(pred - m.viirs_ref);
      const absErrModel = Math.abs(pred - m.viirs_ref);
      const absErrB2 = Math.abs(b2_anchor - m.viirs_ref);
      const isFailure = absErrModel > absErrB2;

      return {
        period: `${m.year}-${String(m.month).padStart(2, "0")}`,
        year: m.year,
        month: m.month,
        modis: m.modis,
        predicted: Math.round(pred),
        b2_anchor: Math.round(b2_anchor),
        viirs: revealed ? m.viirs_ref : null,
        residual,
        isFailure,
      };
    });
  }, [months, revealed, selectedModel]);

  const displayedMonths = useMemo(() => {
    if (!showFailuresOnly) return chartData;
    return chartData.filter((m) => m.isFailure);
  }, [chartData, showFailuresOnly]);

  const failureCount = useMemo(() => {
    return chartData.filter((m) => m.isFailure).length;
  }, [chartData]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
        <RefreshCw className="h-6 w-6 animate-spin text-cyan-400" />
        <span className="text-xs font-mono">Loading frozen holdout replay dataset...</span>
      </div>
    );
  }

  if (!backtest || months.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/10 p-8 text-center space-y-3">
        <HelpCircle className="h-8 w-8 text-amber-400 mx-auto" />
        <h3 className="text-base font-bold text-white">Holdout Replay Unavailable</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          No reproducible holdout evaluation registered for {aoi.toUpperCase()} ({data}). Switch to sample data or run training benchmark first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Protocol Header Card */}
      <div className="rounded-2xl border border-cyan-500/30 bg-slate-950/85 p-5 shadow-card backdrop-blur space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/50 pb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-300">
                {vi ? "Nghị định thư P0: Tái tạo cảm biến giấu kín" : "P0 Protocol: Blind Sensor Replay"}
              </span>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-xs font-mono text-cyan-300">
                {vi ? "Tập giấu kín" : "Frozen Holdout"} ({backtest.test_years.join(", ")})
              </span>
            </div>
            <p className="text-xs text-slate-300">
              {vi
                ? "Dữ liệu VIIRS bị khóa hoàn toàn trong giai đoạn kiểm thử. Mô hình chỉ được cung cấp dữ liệu thô MODIS để phục hồi tín hiệu tham chiếu, sau đó mở khóa để đối soát."
                : "VIIRS observations are strictly locked during test. The model receives only raw MODIS input to reconstruct the reference signal, then unlocks to audit accuracy."}
            </p>
          </div>

          {/* Reveal Toggle CTA */}
          <button
            type="button"
            onClick={() => setRevealed(!revealed)}
            className={cn(
              "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition shadow-lg shrink-0",
              revealed
                ? "bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700"
                : "bg-orange-600 text-white hover:bg-orange-500 shadow-orange-950/50 animate-pulse",
            )}
          >
            {revealed ? (
              <>
                <EyeOff className="h-4 w-4" />
                <span>{vi ? "Giấu lại VIIRS tham chiếu" : "Re-hide VIIRS Ground Truth"}</span>
              </>
            ) : (
              <>
                <Unlock className="h-4 w-4 text-amber-300" />
                <span>{vi ? "Mở khóa VIIRS thực tế (Reveal)" : "Reveal Reference VIIRS"}</span>
              </>
            )}
          </button>
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          <div className="rounded-lg border border-border/60 bg-slate-900/80 px-2.5 py-1 text-slate-300">
            <span className="text-muted-foreground mr-1.5">{vi ? "Giai đoạn huấn luyện:" : "Train Window:"}</span>
            <span className="text-cyan-300 font-semibold">{backtest.train_years.join(", ")}</span>
          </div>
          <div className="rounded-lg border border-border/60 bg-slate-900/80 px-2.5 py-1 text-slate-300">
            <span className="text-muted-foreground mr-1.5">{vi ? "Năm kiểm nghiệm:" : "Test Window:"}</span>
            <span className="text-emerald-300 font-semibold">{backtest.test_years.join(", ")}</span>
          </div>
          <div className="rounded-lg border border-border/60 bg-slate-900/80 px-2.5 py-1 text-slate-300">
            <span className="text-muted-foreground mr-1.5">{vi ? "Số tháng đánh giá:" : "Evaluated Months:"}</span>
            <span className="text-white font-semibold">{months.length} {vi ? "tháng" : "months"}</span>
          </div>
          <div className="rounded-lg border border-border/60 bg-slate-900/80 px-2.5 py-1 text-slate-300">
            <span className="text-muted-foreground mr-1.5">{vi ? "Trạng thái:" : "Status:"}</span>
            <span className={revealed ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
              {revealed
                ? vi
                  ? "ĐÃ MỞ KHÓA (Hiện sai số đầy đủ)"
                  : "REVEALED (Full Residuals Active)"
                : vi
                ? "GIẤU KÍN (Giai đoạn dự đoán)"
                : "BLINDFOLDED (Prediction Phase)"}
            </span>
          </div>
        </div>
      </div>

      {/* Main Chart Canvas */}
      <div className="rounded-2xl border border-border/80 bg-slate-950/85 p-5 shadow-card backdrop-blur space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">
              {revealed
                ? vi
                  ? "Tín hiệu tái cấu trúc vs VIIRS đối chứng thực tế"
                  : "Reconstructed Signal vs Actual Reference VIIRS"
                : vi
                ? "Giai đoạn dự đoán mù: Đầu vào MODIS -> Tương đương VIIRS ước tính"
                : "Blind Prediction Phase: MODIS Input -> Estimated VIIRS Equivalent"}
            </h3>
            <p className="text-xs text-slate-400">
              {revealed
                ? vi
                  ? "Kiểm toán sai số khái quát hóa độc lập, không rò rỉ dữ liệu"
                  : "Auditing generalization residuals without data leakage"
                : vi
                ? "Dữ liệu VIIRS đối chứng bị giấu kín cho đến khi bạn bấm Mở khóa"
                : "Reference VIIRS is hidden until you click Reveal"}
            </p>
          </div>

          {/* Model Switcher & Failure Toggle */}
          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center rounded-lg border border-border/60 bg-slate-900/80 p-0.5 font-mono text-xs">
              <button
                type="button"
                onClick={() => setSelectedModel("ml")}
                className={cn(
                  "rounded-md px-2.5 py-1 font-semibold transition",
                  selectedModel === "ml"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    : "text-slate-400 hover:text-white",
                )}
              >
                HGB Residual
              </button>
              <button
                type="button"
                onClick={() => setSelectedModel("ts")}
                className={cn(
                  "rounded-md px-2.5 py-1 font-semibold transition",
                  selectedModel === "ts"
                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                    : "text-slate-400 hover:text-white",
                )}
              >
                TS Transformer
              </button>
            </div>

            {revealed && (
              <button
                type="button"
                onClick={() => setShowFailuresOnly(!showFailuresOnly)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-semibold border transition flex items-center gap-1.5",
                  showFailuresOnly
                    ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                    : "border-border/60 bg-slate-900 text-slate-300 hover:bg-slate-800",
                )}
              >
                <span>{vi ? "Chỉ xem ca thua baseline" : "Show Failures"}</span>
                <span className="font-mono text-xs rounded-full bg-rose-500/20 px-1.5 py-0.2 text-rose-300">
                  {failureCount}
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="h-80 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="period" stroke="#64748b" tick={{ fontSize: 11, fill: "#94a3b8" }} angle={-35} textAnchor="end" />
              <YAxis stroke="#64748b" tick={{ fontSize: 11, fill: "#94a3b8" }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#020617",
                  borderColor: "#334155",
                  borderRadius: "0.75rem",
                  fontSize: "12px",
                  fontFamily: "monospace",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }} />
              <Line
                type="monotone"
                dataKey="modis"
                name={vi ? "MODIS thô (Đầu vào)" : "MODIS Raw (Input)"}
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="b2_anchor"
                name={vi ? "Đường cơ sở mùa vụ B2" : "B2 Seasonal Baseline"}
                stroke="#eab308"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="predicted"
                name={
                  vi
                    ? `Dự đoán ${selectedModel === "ml" ? "HGB Residual" : "Transformer"}`
                    : `${selectedModel === "ml" ? "HGB Residual" : "Transformer"} Prediction`
                }
                stroke="#a855f7"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#a855f7" }}
              />
              {revealed && (
                <Line
                  type="monotone"
                  dataKey="viirs"
                  name={vi ? "VIIRS thực tế (Ground Truth)" : "VIIRS Actual (Revealed Ground Truth)"}
                  stroke="#14b8a6"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#14b8a6" }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Hidden Reference Overlay Notification */}
        {!revealed && (
          <div className="flex items-center justify-between rounded-xl border border-dashed border-amber-500/40 bg-amber-950/20 p-3.5 text-xs">
            <div className="flex items-center gap-2 text-amber-200">
              <Lock className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                {vi
                  ? "Dữ liệu đếm VIIRS thực tế hiện đang bị ẩn để kiểm chứng độ trung thực của dự đoán mà không có thiên kiến nhìn trước."
                  : "VIIRS actual counts are currently withheld to verify prediction fidelity without lookahead bias."}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="font-bold text-amber-300 hover:underline shrink-0 font-mono"
            >
              {vi ? "Mở khóa ngay →" : "Reveal Now →"}
            </button>
          </div>
        )}
      </div>

      {/* Disclosed Error Ledger Table */}
      <div className="rounded-2xl border border-border/80 bg-slate-950/85 p-5 shadow-card backdrop-blur space-y-3">
        <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">
              {vi ? "Bảng chi tiết kiểm chứng từng tháng (Holdout Ledger)" : "Holdout Period Monthly Audit Ledger"}
            </h3>
            <p className="text-xs text-slate-400">
              {showFailuresOnly
                ? vi
                  ? `Chỉ hiển thị ${displayedMonths.length} tháng mà sai số mô hình vượt quá đường cơ sở mùa vụ B2`
                  : `Showing only ${displayedMonths.length} months where model error exceeded B2 seasonal baseline`
                : vi
                ? `Hồ sơ minh bạch đầy đủ trên toàn bộ ${displayedMonths.length} tháng kiểm thử`
                : `Complete transparent record across all ${displayedMonths.length} test months`}
            </p>
          </div>
          <span className="font-mono text-xs text-cyan-400 font-semibold">
            {displayedMonths.length} {vi ? "tháng" : "Months"}
          </span>
        </div>

        <div className="max-h-72 overflow-y-auto overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="sticky top-0 bg-slate-950 border-b border-border/60 text-xs uppercase text-slate-400">
              <tr>
                <th className="p-2">{vi ? "Thời gian" : "Period"}</th>
                <th className="p-2 text-right">{vi ? "MODIS đầu vào" : "MODIS Input"}</th>
                <th className="p-2 text-right">{vi ? "Mốc B2" : "B2 Anchor"}</th>
                <th className="p-2 text-right">{vi ? "Mô hình dự đoán" : "Model Prediction"}</th>
                <th className="p-2 text-right">{vi ? "VIIRS thực tế" : "VIIRS Actual"}</th>
                <th className="p-2 text-right">{vi ? "Sai số dư" : "Residual"}</th>
                <th className="p-2 text-center">{vi ? "Trạng thái" : "Status"}</th>
              </tr>
            </thead>
            <tbody className="divide-y border-border/30">
              {displayedMonths.map((m, idx) => {
                return (
                  <tr key={idx} className="hover:bg-white/5 transition-colors">
                    <td className="p-2 font-bold text-slate-200">{m.period}</td>
                    <td className="p-2 text-right text-blue-400 font-semibold">{num(m.modis)}</td>
                    <td className="p-2 text-right text-amber-300">{num(m.b2_anchor)}</td>
                    <td className="p-2 text-right text-purple-300 font-semibold">{num(m.predicted)}</td>
                    <td className="p-2 text-right text-teal-300 font-bold">
                      {revealed && m.viirs !== null ? num(m.viirs) : vi ? "ĐÃ KHÓA" : "LOCKED"}
                    </td>
                    <td className="p-2 text-right text-slate-300">
                      {revealed && m.viirs !== null ? `${m.residual > 0 ? "+" : ""}${m.residual}` : "-"}
                    </td>
                    <td className="p-2 text-center">
                      {!revealed ? (
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                          {vi ? "Giấu kín" : "Blind"}
                        </span>
                      ) : m.isFailure ? (
                        <span className="rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-400">
                          {vi ? "Thua B2" : "Model Lost"}
                        </span>
                      ) : (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-400">
                          {vi ? "Thắng B2" : "Model Beat Baseline"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
