import { Cpu, Database, ShieldCheck } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { ReasoningPipelineIllustration } from "@/components/illustrations";

export function AskArchitectureView() {
  const { lang } = useLang();
  const vi = lang === "vi";

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Visual Pipeline Illustration */}
      <ReasoningPipelineIllustration />

      {/* Explanatory Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-2xl border border-border/80 bg-slate-950/80 p-4 shadow-card backdrop-blur space-y-2">
          <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-wider">
            <Database className="h-4 w-4" />
            <span>1. Raw Ingestion & QA</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            {vi
              ? "Lọc bỏ tọa độ dị thường, bản ghi lệch kỷ nguyên (anachronistic) và chuẩn hóa schema thống nhất giữa MODIS (1km) và VIIRS (375m)."
              : "Quarantines suspect coordinates, purges anachronistic records, and enforces unified schema across MODIS and VIIRS."}
          </p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-slate-950/80 p-4 shadow-card backdrop-blur space-y-2">
          <div className="flex items-center gap-2 text-orange-400 font-bold text-xs uppercase tracking-wider">
            <Cpu className="h-4 w-4" />
            <span>2. Cross-Sensor Calibrator</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            {vi
              ? "Tính toán tỷ lệ hoạt động k = MODIS / VIIRS trên tập giao thời (2012-nay), áp dụng mô hình HGB phần dư với điểm neo tỷ lệ theo mùa."
              : "Computes activity ratio k = MODIS / VIIRS over dense overlap periods, executing residual HGB with seasonal baseline anchor."}
          </p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-slate-950/80 p-4 shadow-card backdrop-blur space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
            <ShieldCheck className="h-4 w-4" />
            <span>3. Robust Z-Score & Grounding</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            {vi
              ? "Sử dụng Trung vị (Median) và Sai số tuyệt đối trung vị (MAD) để phát hiện dị thường |z| >= 2 mà không bị làm méo bởi các đợt cháy kỷ lục."
              : "Uses Median and Median Absolute Deviation (MAD) to detect anomalies |z| >= 2, immune to extreme fire outliers."}
          </p>
        </div>
      </div>
    </div>
  );
}
