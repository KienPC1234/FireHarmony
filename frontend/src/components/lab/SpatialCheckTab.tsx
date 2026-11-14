import { AlertTriangle, Eye, MapPin, Radar } from "lucide-react";
import { SpatialResponse } from "@/lib/api";
import { num } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { MultiScaleHarmonizationIllustration } from "@/components/illustrations";
import { Kpi, Section } from "./LabWidgets";

interface SpatialCheckTabProps {
  spatialRes: SpatialResponse | null;
}

export function SpatialCheckTab({ spatialRes }: SpatialCheckTabProps) {
  const { lang } = useLang();
  const vi = lang === "vi";

  if (!spatialRes) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-slate-400 bg-slate-950/40">
        <Radar className="mx-auto mb-3 h-10 w-10 text-cyan-400 opacity-60 animate-pulse" />
        <p className="font-bold text-base text-slate-200">
          {vi ? "Chưa chạy kiểm tra đồng bộ không gian" : "Spatial Co-Observation Check Ready"}
        </p>
        <p className="mt-1.5 text-xs text-slate-400 max-w-md mx-auto">
          {vi
            ? "Chọn vùng và tháng ở thanh bên trái rồi bấm 'Đồng bộ không gian'."
            : "Select target AOI and Month on the left console, then click 'Run Spatial Check'."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Executive Scientific Verdict Card */}
      <div className="rounded-2xl border border-cyan-500/40 bg-gradient-to-r from-cyan-950/40 via-slate-900/90 to-blue-950/40 p-4 space-y-2 shadow-lg backdrop-blur">
        <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-2">
            <Radar className="h-4 w-4 text-cyan-400" />
            {vi ? "KẾT LUẬN ĐỒNG QUAN SÁT KHÔNG GIAN (SPATIAL CO-OBSERVATION VERDICT)" : "EXECUTIVE SPATIAL CO-OBSERVATION VERDICT"}
          </span>
          <span className="font-mono text-xs rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-0.5 text-cyan-200">
            Jaccard Top 10%: {spatialRes.top_decile_jaccard != null ? spatialRes.top_decile_jaccard.toFixed(3) : "-"}
          </span>
        </div>
        <p className="text-xs sm:text-sm text-slate-100 font-medium leading-relaxed">
          {vi
            ? `Hệ số tương quan Pearson ${spatialRes.pearson != null ? spatialRes.pearson.toFixed(3) : "-"} và Spearman ${spatialRes.spearman != null ? spatialRes.spearman.toFixed(3) : "-"}. Phân tích: Tại các trung tâm đám cháy lớn, hai thế hệ cảm biến MODIS và VIIRS ghi nhận mức độ đồng bộ cao. Tuy nhiên, ở các cụm cháy nhỏ biên giới, kích thước pixel 375m của VIIRS giúp bóc tách và định vị ranh giới chi tiết hơn 2.7 lần so với pixel 1km của MODIS.`
            : `Pearson correlation is ${spatialRes.pearson != null ? spatialRes.pearson.toFixed(3) : "-"} and Spearman rank is ${spatialRes.spearman != null ? spatialRes.spearman.toFixed(3) : "-"}. Analysis: MODIS and VIIRS strongly agree on high-intensity fire core locations. However, across diffuse perimeter boundaries, the 375m VIIRS resolution isolates fine-scale fire fronts that the 1km MODIS footprint averages out.`}
        </p>
      </div>

      <MultiScaleHarmonizationIllustration />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [vi ? "Tương quan Pearson" : "Pearson Correlation", spatialRes.pearson],
          [vi ? "Tương quan hạng Spearman" : "Spearman Rank Correlation", spatialRes.spearman],
          [vi ? "Trùng lặp Jaccard Top 10%" : "Top-Decile Jaccard Overlap", spatialRes.top_decile_jaccard],
        ].map(([label, value]) => {
          const v = typeof value === "number" ? value : null;
          const width = v == null ? 0 : Math.max(0, Math.min(1, Math.abs(v))) * 100;
          const negative = v != null && v < 0;
          return (
            <div key={String(label)} className="rounded-xl border border-border/70 bg-card/80 p-4 shadow-sm space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{String(label)}</p>
              <p className={`font-mono text-2xl font-black ${negative ? "text-rose-400" : "text-white"}`}>
                {v == null ? "-" : v.toFixed(3)}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full ${negative ? "bg-gradient-to-r from-rose-500 to-amber-500" : "bg-gradient-to-r from-cyan-500 to-orange-500"}`}
                  style={{ width: `${width}%` }}
                />
              </div>
              <p className="text-xs text-slate-400">
                {v == null
                  ? vi ? "Không đủ ô đồng quan sát" : "Not enough co-observed cells"
                  : negative
                    ? vi ? "Tương quan âm - thanh hiển thị |r|" : "Negative association - bar shows |r|"
                    : vi ? "Tương quan dương - chỉ tính các ô đồng quan sát" : "Positive association - co-observed cells only"}
              </p>
            </div>
          );
        })}
      </div>

      <Section
        title={vi ? "Phạm vi kiểm tra đồng thời" : "Spatial Co-Observation Metrics"}
        subtitle={
          vi
            ? `${spatialRes.coarse_cells} ô thô - ${spatialRes.co_observed_cells} ô đồng quan sát`
            : `${spatialRes.coarse_cells} coarse cells - ${spatialRes.co_observed_cells} co-observed`
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi icon={MapPin} label={vi ? "Tổng ô thô" : "Coarse Cells"} value={num(spatialRes.coarse_cells)} />
          <Kpi icon={Eye} label={vi ? "Cả 2 cùng thấy" : "Co-observed"} value={num(spatialRes.co_observed_cells)} tone="good" />
          <Kpi icon={AlertTriangle} label={vi ? "Chỉ MODIS thấy" : "MODIS-only Cells"} value={num(spatialRes.modis_only_coarse_cells)} tone="warn" />
        </div>
        <p className="mt-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 leading-relaxed">
          {spatialRes.claim}
        </p>
      </Section>
    </div>
  );
}
