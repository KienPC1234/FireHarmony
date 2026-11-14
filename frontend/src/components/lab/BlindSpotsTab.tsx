import { Activity, AlertTriangle, CircleSlash, Eye, ShieldCheck } from "lucide-react";
import { BlindSpotResponse } from "@/lib/api";
import { cn, pct } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { Kpi, Section } from "./LabWidgets";

interface BlindSpotsTabProps {
  spots: BlindSpotResponse | null;
}

export function BlindSpotsTab({ spots }: BlindSpotsTabProps) {
  const { t } = useLang();

  if (!spots) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-slate-400 bg-slate-950/40">
        <Eye className="mx-auto mb-3 h-10 w-10 text-cyan-400 opacity-60 animate-pulse" />
        <p className="font-bold text-base text-slate-200">
          {t("lab.blind_empty_title")}
        </p>
        <p className="mt-1.5 text-xs text-slate-400 max-w-md mx-auto">
          {t("lab.blind_empty_hint")}
        </p>
      </div>
    );
  }

  const detectedDays = spots.days.filter((d) => d.status === "detected").length;
  const emptyDays = spots.days.filter((d) => d.status === "requested_no_hotspot_record").length;
  const unknownDays = spots.days.filter(
    (d) => d.status === "not_requested" || d.status === "unknown_coverage",
  ).length;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Executive Scientific Verdict Card */}
      <div className="rounded-2xl border border-cyan-500/40 bg-gradient-to-r from-cyan-950/40 via-slate-900/90 to-blue-950/40 p-4 space-y-2 shadow-lg backdrop-blur">
        <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cyan-400" />
            {t("lab.blind_verdict_title")}
          </span>
          <span className="font-mono text-xs rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-0.5 text-cyan-200">
            {spots.ym} · {spots.coverage_class.toUpperCase()}
          </span>
        </div>
        <p className="text-xs sm:text-sm text-slate-100 font-medium leading-relaxed">
          {t("lab.blind_verdict_body", {
            ym: spots.ym,
            coverage: pct(spots.paired_coverage_ratio, 1),
            detected: detectedDays,
            unknown: unknownDays,
          })}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={ShieldCheck}
          label={t("lab.blind_kpi_paired")}
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
          label={t("lab.blind_kpi_detected")}
          value={String(detectedDays)}
          hint={t("lab.blind_hint_detected")}
          tone="good"
        />
        <Kpi
          icon={CircleSlash}
          label={t("lab.blind_kpi_empty")}
          value={String(emptyDays)}
          hint={t("lab.blind_hint_empty")}
          tone="warn"
        />
        <Kpi
          icon={AlertTriangle}
          label={t("lab.blind_kpi_unknown")}
          value={String(unknownDays)}
          hint={t("lab.blind_hint_unknown")}
          tone="bad"
        />
      </div>

      <Section
        title={t("lab.blind_heatmap_title")}
        subtitle={t("lab.blind_heatmap_sub")}
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
                        : "requested_no_hotspot_record";
                    const cls =
                      status === "detected"
                        ? "bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.6)]"
                        : status === "requested_no_hotspot_record"
                        ? "bg-sky-600/40"
                        : status === "not_requested"
                        ? "bg-slate-800"
                        : "bg-amber-600/30";
                    return (
                      <div
                        key={d.day}
                        title={`${d.date} · ${sensor} · Status: ${status} · ${det} detections`}
                        className={cn(
                          "h-8 rounded-[4px] transition-[transform,background-color,box-shadow] duration-150 hover:scale-110 hover:ring-2 hover:ring-cyan-400 cursor-pointer",
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
            <i className="h-3 w-3 rounded bg-orange-500" /> {t("lab.blind_legend_detected")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-3 w-3 rounded bg-sky-600/40" /> {t("lab.blind_legend_requested")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-3 w-3 rounded bg-slate-800" /> {t("lab.blind_legend_unrequested")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-3 w-3 rounded bg-amber-600/30" /> {t("lab.blind_legend_unknown")}
          </span>
        </div>
      </Section>
    </div>
  );
}
