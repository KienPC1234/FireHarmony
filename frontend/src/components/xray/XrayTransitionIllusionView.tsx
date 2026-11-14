import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, Flame, Scale } from "lucide-react";
import { cn, compact, num } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

interface XrayTransitionIllusionViewProps {
  months: Array<{
    year: number;
    month: number;
    modis_raw: number;
    viirs_ref: number;
    adjusted_stat: number;
  }>;
}

export function XrayTransitionIllusionView({ months }: XrayTransitionIllusionViewProps) {
  const { lang } = useLang();
  const vi = lang === "vi";
  const [showHarmonized, setShowHarmonized] = useState(true);

  // Synthesize multi-year timeline showing pre-2012 and post-2012
  const transitionData = useMemo(() => {
    // Group by year to get annual detection totals
    const byYear: Record<number, { modis: number; viirs: number; harmonized: number; count: number }> = {};
    for (const m of months) {
      if (!byYear[m.year]) {
        byYear[m.year] = { modis: 0, viirs: 0, harmonized: 0, count: 0 };
      }
      byYear[m.year].modis += m.modis_raw;
      byYear[m.year].viirs += m.viirs_ref;
      byYear[m.year].harmonized += m.adjusted_stat;
      byYear[m.year].count += 1;
    }

    return Object.entries(byYear).map(([yStr, val]) => {
      const year = Number(yStr);
      // Naive sum: If pre-2012, only MODIS existed. If post-2012, naive people sum MODIS + VIIRS or switch abruptly to VIIRS!
      const naiveRawSwitched = year < 2012 ? val.modis : val.viirs;
      const naiveRawSummed = year < 2012 ? val.modis : val.modis + val.viirs;

      return {
        year,
        yearLabel: String(year),
        modisOnly: Math.round(val.modis),
        viirsRef: Math.round(val.viirs),
        harmonizedContinuous: Math.round(val.harmonized),
        naiveRawSwitched,
        naiveRawSummed,
        stepJumpRatio: val.modis > 0 ? (val.viirs / val.modis).toFixed(1) : "3.7",
      };
    });
  }, [months]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Educational Banner */}
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 shadow-card backdrop-blur space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <span>{vi ? "Ảo giác bước nhảy cảm biến năm 2012" : "The 2012 Sensor Transition Artifact"}</span>
        </div>
        <p className="text-xs text-amber-100/90 leading-relaxed">
          {vi
            ? "Trước năm 2012, chỉ có MODIS (1km) hoạt động. Từ năm 2012, VIIRS (375m) ra đời với độ phân giải cao hơn ~3 lần. Nếu một hệ thống cộng dồn hoặc chuyển đổi thô mà không hiệu chuẩn, dữ liệu sẽ tạo ra một 'bước nhảy giả' gấp 3-4 lần vào năm 2012, khiến người dùng hiểu lầm là cháy rừng bùng nổ do biến đổi khí hậu."
            : "Before 2012, only MODIS (1 km) flew. In 2012, VIIRS (375 m) was launched with ~3x higher spatial sensitivity. If an analysis simply sums the records or abruptly switches to VIIRS, an artificial 3x-4x step-jump appears in 2012, masquerading as a catastrophic climate event."}
        </p>
      </div>

      {/* Interactive Demonstration Chart */}
      <div className="rounded-2xl border border-border/80 bg-slate-950/85 p-5 shadow-card backdrop-blur space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight">
              {vi ? "So sánh xu hướng: Dữ liệu thô vs Chuỗi đã chuẩn hóa" : "Trajectory Comparison: Naive Sensor Merge vs Harmonized Baseline"}
            </h2>
            <p className="text-xs text-slate-400">
              {vi
                ? "Bật/Tắt đường chuẩn hóa để thấy bước nhảy cảm biến bị triệt tiêu ra sao"
                : "Toggle the harmonized baseline to see how the artificial transition jump is neutralized"}
            </p>
          </div>

          {/* Interactive Toggle Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowHarmonized((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 border shadow-sm",
                showHarmonized
                  ? "border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                  : "border-border/60 bg-slate-900 text-slate-400 hover:text-white",
              )}
            >
              <Scale className="h-3.5 w-3.5" />
              <span>
                {showHarmonized
                  ? vi
                    ? "Ẩn chuỗi chuẩn hóa"
                    : "Hide Harmonized Line"
                  : vi
                  ? "Hiện chuỗi chuẩn hóa"
                  : "Show Harmonized Baseline"}
              </span>
            </button>
          </div>
        </div>

        {/* Chart View */}
        <div style={{ height: 340 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={transitionData} margin={{ top: 10, right: 15, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="harmFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="naiveFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="yearLabel" stroke="#94a3b8" fontSize={12} />
              <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => compact(v)} />
              <ReferenceLine
                x="2012"
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray="4 4"
                label={{
                  value: vi ? "2012: Phóng VIIRS" : "2012: VIIRS Launch",
                  fill: "#f59e0b",
                  fontSize: 12,
                  position: "insideTopLeft",
                }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="rounded-xl border border-border/80 bg-slate-900/95 p-3 font-mono text-xs shadow-2xl backdrop-blur space-y-1.5 min-w-[220px]">
                      <div className="font-bold text-white border-b border-border/40 pb-1 flex justify-between">
                        <span>{vi ? `Năm ${d.year}` : `Year ${d.year}`}</span>
                        <span className="text-amber-400">{vi ? `Nhảy vọt ~${d.stepJumpRatio}x` : `Jump ~${d.stepJumpRatio}x`}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>{vi ? "Chỉ MODIS đơn lẻ:" : "Raw MODIS Alone:"}</span>
                        <span className="text-slate-200">{num(d.modisOnly)}</span>
                      </div>
                      <div className="flex justify-between text-rose-400 font-semibold">
                        <span>{vi ? "Đếm ngây thơ (Ghép nối):" : "Naive Switched Count:"}</span>
                        <span>{num(d.naiveRawSwitched)}</span>
                      </div>
                      {showHarmonized && (
                        <div className="flex justify-between text-cyan-300 font-bold border-t border-border/30 pt-1">
                          <span>{vi ? "Chuỗi đã chuẩn hóa:" : "Harmonized Continuous:"}</span>
                          <span>{num(d.harmonizedContinuous)}</span>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
              <Area
                type="monotone"
                dataKey="naiveRawSwitched"
                stroke="#ef4444"
                strokeWidth={2}
                fill="url(#naiveFill)"
                name={
                  vi
                    ? "Phát hiện thô ngây thơ (Bước nhảy nhân tạo 3x)"
                    : "Naive Raw Detections (3x Artificial Step Jump)"
                }
              />
              {showHarmonized && (
                <Area
                  type="monotone"
                  dataKey="harmonizedContinuous"
                  stroke="#06b6d4"
                  strokeWidth={2.5}
                  fill="url(#harmFill)"
                  name={
                    vi
                      ? "Đường cơ sở Fire Calendar đã chuẩn hóa (Nhất quán 2001-Hiện tại)"
                      : "Harmonized Fire Calendar Baseline (Consistent 2001-Present)"
                  }
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Scientific Breakdown Grid */}
        <div className="grid gap-3 pt-2 sm:grid-cols-3 text-xs">
          <div className="rounded-xl border border-border/70 bg-slate-900/70 p-3.5 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-slate-200">
              <Flame className="h-4 w-4 text-orange-400" />
              <span>{vi ? "Pha loãng dấu vết không gian" : "Spatial Footprint Dilution"}</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {vi
                ? "Điểm ảnh MODIS (1 km x 1 km = 100 ha) lấy trung bình trên diện rộng, bỏ sót các đám cháy nông nghiệp nhỏ. VIIRS (375 m = 14 ha) nhỏ hơn gấp 7 lần về diện tích, phát hiện được các vụ cháy cường độ thấp."
                : "MODIS pixel (1 km x 1 km = 100 ha) averages over broad areas, missing small agricultural fires. VIIRS (375 m = 14 ha) has 7x smaller area, detecting low-intensity burning."}
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-slate-900/70 p-3.5 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-slate-200">
              <Scale className="h-4 w-4 text-cyan-400" />
              <span>{vi ? "Chuẩn hóa tiến (1/k)" : "Forward Harmonization (1/k)"}</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {vi
                ? "Chúng tôi nâng quy mô các lượt MODIS giai đoạn đầu về tương đương chuẩn VIIRS bằng tỷ lệ hoạt động thực nghiệm hàng tháng k, giúp các đám cháy trước năm 2012 có thể so sánh định lượng với dữ liệu sau 2012."
                : "We upscale early MODIS counts to VIIRS equivalent using empirical monthly activity ratios k, ensuring pre-2012 fires are quantitatively comparable to post-2012 records."}
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-slate-900/70 p-3.5 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-slate-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>{vi ? "Triệt tiêu xu thế khí hậu giả mạo" : "Zero Artificial Climate Trend"}</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {vi
                ? "Khi bước nhảy năm 2012 được loại bỏ, các xu hướng qua nhiều thập kỷ phản ánh đúng các sự kiện khí hậu thực tế (như mùa khô Amazon 2019 và Black Summer 2019-20 tại Australia)."
                : "With the 2012 step jump removed, multi-decadal trends reflect actual climate events (such as the 2019 Amazon dry season and 2019-20 Australian Black Summer)."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
