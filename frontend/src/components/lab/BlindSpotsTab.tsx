import { Activity, AlertTriangle, CircleSlash, Eye, ShieldCheck } from "lucide-react";
import { BlindSpotResponse } from "@/lib/api";
import { cn, pct } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { Kpi, Section } from "./LabWidgets";

interface BlindSpotsTabProps {
  spots: BlindSpotResponse | null;
}

export function BlindSpotsTab({ spots }: BlindSpotsTabProps) {
  const { lang } = useLang();
  const vi = lang === "vi";

  if (!spots) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-slate-400 bg-slate-950/40">
        <Eye className="mx-auto mb-3 h-10 w-10 text-cyan-400 opacity-60 animate-pulse" />
        <p className="font-bold text-base text-slate-200">
          {vi ? "Chưa có dữ liệu điểm mù quan trắc" : "Sensor Blind Spots Audit Ready"}
        </p>
        <p className="mt-1.5 text-xs text-slate-400 max-w-md mx-auto">
          {vi
            ? "Chọn năm và tháng ở bảng điều khiển bên trái rồi bấm 'Quét điểm mù quan trắc'."
            : "Select Year and Month on the left console and click 'Scan Blind Spots' to audit daily coverage."}
        </p>
      </div>
    );
  }

  const detectedDays = spots.days.filter((d) => d.status === "detected").length;
  const emptyDays = spots.days.filter((d) => d.status === "observed_empty").length;
  const unknownDays = spots.days.filter(
    (d) => d.status === "not_requested" || d.status === "unknown_coverage",
  ).length;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={ShieldCheck}
          label={vi ? "Độ phủ ghép đôi" : "Paired Coverage"}
          value={pct(spots.paired_coverage_ratio, 1)}
          hint={`${spots.ym} · Class: ${spots.coverage_class}`}
          tone={
            spots.coverage_class === "complete"
              ? "good"
              : spots.coverage_class === "usable"
              ? "warn"
              : "bad"
          }
        />
        <Kpi
          icon={Activity}
          label={vi ? "Ngày có detection" : "Days with Detection"}
          value={String(detectedDays)}
          hint={vi ? "Ít nhất 1 cảm biến ghi nhận" : "Detected by ≥1 sensor"}
          tone="good"
        />
        <Kpi
          icon={CircleSlash}
          label={vi ? "Đã yêu cầu, không detection" : "Requested, No Detection"}
          value={String(emptyDays)}
          hint={vi ? "Không phải bằng chứng trời quang / không cháy" : "Not proof of clear sky or no fire"}
          tone="warn"
        />
        <Kpi
          icon={AlertTriangle}
          label={vi ? "Không yêu cầu / Không rõ" : "Unknown / Unrequested"}
          value={String(unknownDays)}
          hint={vi ? "Không được vẽ thành 0" : "Never treated as zero"}
          tone="bad"
        />
      </div>

      <Section
        title={vi ? "Bản đồ nhiệt Ngày × Cảm biến" : "Daily Sensor Observation Heatmap"}
        subtitle={vi ? "Mỗi ô là 1 ngày quan trắc; hover để xem chi tiết" : "Each tile represents one day of observations"}
      >
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[720px]">
            {(["MODIS", "VIIRS"] as const).map((sensor) => (
              <div key={sensor} className="mb-2.5 flex items-center gap-2">
                <span className="w-14 shrink-0 text-right font-mono text-xs font-bold text-slate-300">
                  {sensor}
                </span>
                <div
                  className="grid flex-1 gap-1"
                  style={{ gridTemplateColumns: `repeat(${spots.days.length}, minmax(0, 1fr))` }}
                >
                  {spots.days.map((d) => {
                    const requested = sensor === "MODIS" ? d.modis_requested : d.viirs_requested;
                    const det = sensor === "MODIS" ? d.modis_detections : d.viirs_detections;
                    const status =
                      requested === null
                        ? "unknown"
                        : !requested
                        ? "not_requested"
                        : det > 0
                        ? "detected"
                        : "observed_empty";
                    const cls =
                      status === "detected"
                        ? "bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.6)]"
                        : status === "observed_empty"
                        ? "bg-sky-600/40"
                        : status === "not_requested"
                        ? "bg-slate-800"
                        : "bg-amber-600/30";
                    return (
                      <div
                        key={d.day}
                        title={`${d.date} · ${sensor} · Status: ${status} · ${det} detections`}
                        className={cn(
                          "h-8 rounded-[4px] transition-all hover:scale-110 hover:ring-2 hover:ring-cyan-400 cursor-pointer",
                          cls,
                        )}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="ml-16 flex justify-between font-mono text-xs text-slate-400 pt-1">
              <span>Day 1</span>
              <span>Day {spots.days.length}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-300 border-t border-border/40 pt-2.5">
          <span className="inline-flex items-center gap-1.5">
            <i className="h-3 w-3 rounded bg-orange-500" /> {vi ? "Có detection" : "Detections logged"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-3 w-3 rounded bg-sky-600/40" /> {vi ? "Đã yêu cầu, không có detection" : "Requested, no detection"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-3 w-3 rounded bg-slate-800" /> {vi ? "Không yêu cầu" : "Not requested"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-3 w-3 rounded bg-amber-600/30" /> {vi ? "Không rõ (Unknown)" : "Unknown coverage"}
          </span>
        </div>
      </Section>
    </div>
  );
}
