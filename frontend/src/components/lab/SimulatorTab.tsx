import { Activity, BarChart3, Cpu, Layers, Sparkles, Zap } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { SimResponse } from "@/lib/api";
import { cn, compact, num } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { ConstellationOrbitIllustration, MultiScaleHarmonizationIllustration } from "@/components/illustrations";
import { Kpi, Section } from "./LabWidgets";

interface SimulatorTabProps {
  sim: SimResponse | null;
  sensors: string[];
  onSelectPreset?: (sensors: string[]) => void;
}

export function SimulatorTab({ sim, sensors, onSelectPreset }: SimulatorTabProps) {
  const { t } = useLang();

  const custom =
    sim?.simulations.find((s) => s.sensor_config === "custom") ??
    sim?.simulations.find((s) => s.sensor_config === "all_sensors");

  const simChart = (sim?.simulations ?? []).map((s) => ({
    name: s.sensor_config,
    total: s.year_total,
    delta: s.delta_vs_all ?? 0,
    selected:
      s.sensor_config === "custom" ||
      (!sim?.simulations.some((x) => x.sensor_config === "custom") &&
        s.sensor_config === "all_sensors"),
  }));

  const monthChart = custom
    ? Object.entries(custom.months).map(([m, v]) => ({
        month: `M${String(m).padStart(2, "0")}`,
        value: v ?? 0,
      }))
    : [];

  const isFullConstellation = sensors.length >= 4;
  const isModisOnly = sensors.length === 1 && sensors[0] === "MODIS";
  const isSnppOnly = sensors.length === 1 && sensors[0] === "SNPP";

  return (
    <div className="space-y-5 animate-fade-in">
      {/* 1. Quick Benchmark Scenario Presets for Judges */}
      {onSelectPreset && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 font-mono">
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              {t("lab.sim_presets_title")}
            </span>
            <span className="text-xs text-slate-400 font-mono hidden sm:inline">
              NASA Earth Science Lab
            </span>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => onSelectPreset(["MODIS", "SNPP", "NOAA-20", "NOAA-21"])}
              className={cn(
                "rounded-lg px-3 py-1.5 font-semibold transition flex items-center gap-1.5 min-h-[34px]",
                isFullConstellation
                  ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 shadow-sm"
                  : "border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700",
              )}
            >
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              <span>{t("lab.sim_preset_full")}</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectPreset(["MODIS"])}
              className={cn(
                "rounded-lg px-3 py-1.5 font-semibold transition flex items-center gap-1.5 min-h-[34px]",
                isModisOnly
                  ? "bg-amber-500/25 text-amber-300 border border-amber-500/40 shadow-sm"
                  : "border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700",
              )}
            >
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span>{t("lab.sim_preset_modis")}</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectPreset(["SNPP"])}
              className={cn(
                "rounded-lg px-3 py-1.5 font-semibold transition flex items-center gap-1.5 min-h-[34px]",
                isSnppOnly
                  ? "bg-orange-500/25 text-orange-300 border border-orange-500/40 shadow-sm"
                  : "border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700",
              )}
            >
              <span className="h-2 w-2 rounded-full bg-orange-400" />
              <span>{t("lab.sim_preset_snpp")}</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. Executive Mission Verdict for Judges */}
      {sim && custom && (
        <div className="rounded-2xl border border-cyan-500/40 bg-gradient-to-r from-cyan-950/40 via-slate-900/90 to-blue-950/40 p-4 space-y-2 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              {t("lab.sim_verdict_title")}
            </span>
            <span className="font-mono text-xs rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-0.5 text-cyan-200">
              NASA Space Apps 2026
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-100 font-medium leading-relaxed">
            {t("lab.sim_verdict_body", {
              config: custom.sensor_config,
              departure:
                custom.delta_vs_all != null && custom.delta_vs_all < 0
                  ? t("lab.sim_departure_loss", {
                      amount: compact(Math.abs(custom.delta_vs_all)),
                      pct: Math.round(
                        (Math.abs(custom.delta_vs_all) / (custom.year_total + Math.abs(custom.delta_vs_all || 1))) * 100,
                      ),
                    })
                  : t("lab.sim_departure_baseline"),
            })}
          </p>
        </div>
      )}

      {/* 3. Dynamic Orbital Constellation Swath Illustration */}
      <ConstellationOrbitIllustration activeSensors={sensors} />

      {sim && custom ? (
        <>
          {/* Telemetry KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              icon={Activity}
              label={t("lab.sim_kpi_total")}
              value={compact(custom.year_total)}
              hint={`${num(custom.n_cells)} cells · Year ${custom.year}`}
              tone="accent"
            />
            <Kpi
              icon={BarChart3}
              label={t("lab.sim_kpi_delta")}
              value={
                custom.delta_vs_all == null
                  ? "0 (Baseline)"
                  : `${custom.delta_vs_all > 0 ? "+" : ""}${compact(custom.delta_vs_all)}`
              }
              hint={
                custom.delta_vs_all == null || custom.delta_vs_all === 0
                  ? "Full constellation"
                  : "Impact from removed sensors"
              }
              tone={custom.delta_vs_all != null && custom.delta_vs_all < 0 ? "warn" : "good"}
            />
            <Kpi
              icon={Cpu}
              label={t("lab.sim_kpi_kmonths")}
              value={`${custom.k_measured_months}/${custom.months_total}`}
              hint={`Fallback ratio k=${custom.k_fallback}`}
              tone={custom.k_measured_months ? "good" : "warn"}
            />
            <Kpi
              icon={Layers}
              label={t("lab.sim_kpi_cells")}
              value={`${compact(custom.observed_cells)} / ${compact(custom.estimated_cells)}`}
              hint={custom.viirs_available ? "VIIRS feed active" : "MODIS-only estimates"}
              tone={custom.viirs_available ? "good" : "warn"}
            />
          </div>

          {sim?.platforms_present && !sim.platforms_present.some((p) => p.startsWith("NOAA")) && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 leading-relaxed">
              {t("lab.sim_platform_warn", { platforms: sim.platforms_present.join(", ") })}
            </p>
          )}

          {/* Dual Visual Charts */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Section
              title={t("lab.sim_compare_title")}
              subtitle={t("lab.sim_compare_sub")}
            >
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={simChart} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      interval={0}
                      angle={-15}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      tickFormatter={(v) => compact(v)}
                    />
                    <RTooltip
                      cursor={{ fill: "rgba(56, 189, 248, 0.08)" }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="rounded-lg border border-border/80 bg-slate-900/95 p-2.5 font-mono text-xs shadow-xl backdrop-blur">
                            <p className="font-bold text-white">{d.name}</p>
                            <p className="text-cyan-400 font-semibold">{num(d.total)} activity index</p>
                            {d.delta !== 0 && (
                              <p className={d.delta < 0 ? "text-rose-400" : "text-emerald-400"}>
                                Δ vs all: {d.delta > 0 ? "+" : ""}{compact(d.delta)}
                              </p>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                      {simChart.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.selected ? "#06b6d4" : "#1e293b"}
                          stroke={entry.selected ? "#38bdf8" : "#334155"}
                          strokeWidth={entry.selected ? 1.5 : 1}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>

            <Section
              title={t("lab.sim_monthly_title")}
              subtitle={t("lab.sim_monthly_sub")}
            >
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthChart} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="monthGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => compact(v)} />
                    <RTooltip
                      cursor={{ fill: "rgba(56, 189, 248, 0.08)" }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="rounded-lg border border-border/80 bg-slate-900/95 p-2 font-mono text-xs shadow-xl">
                            <p className="font-bold text-white">{d.month}</p>
                            <p className="text-cyan-400">{num(d.value)} activity index</p>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#06b6d4"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#monthGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Section>
          </div>

          {/* Configuration Matrix Table */}
          <Section
            title={t("lab.sim_matrix_title")}
            subtitle={t("lab.sim_matrix_sub")}
          >
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs text-left">
                <thead>
                  <tr className="border-b border-border/60 text-xs text-slate-400">
                    <th className="pb-2 font-semibold">{t("lab.sim_th_config")}</th>
                    <th className="pb-2 font-semibold text-right">{t("lab.sim_th_total")}</th>
                    <th className="pb-2 font-semibold text-right">{t("lab.sim_th_delta")}</th>
                    <th className="pb-2 font-semibold text-right">{t("lab.sim_th_observed")}</th>
                    <th className="pb-2 font-semibold text-right">{t("lab.sim_th_estimated")}</th>
                    <th className="pb-2 font-semibold text-center">{t("lab.sim_th_peak")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {sim.simulations.map((s) => {
                    const isSelected =
                      s.sensor_config === "custom" ||
                      (!sim.simulations.some((x) => x.sensor_config === "custom") &&
                        s.sensor_config === "all_sensors");

                    const entries = Object.entries(s.months);
                    const peak = entries.reduce((max, cur) => (cur[1] || 0) > (max[1] || 0) ? cur : max, entries[0]);

                    return (
                      <tr
                        key={s.sensor_config}
                        className={isSelected ? "bg-cyan-500/10 text-cyan-200 font-semibold" : "text-slate-300 hover:bg-white/5"}
                      >
                        <td className="py-2.5 flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${isSelected ? "bg-cyan-400" : "bg-slate-600"}`} />
                          <span>{s.sensor_config}</span>
                        </td>
                        <td className="py-2.5 text-right font-bold text-white">{num(s.year_total)}</td>
                        <td className="py-2.5 text-right">
                          {s.delta_vs_all == null
                            ? "-"
                            : s.delta_vs_all === 0
                            ? "0"
                            : `${s.delta_vs_all > 0 ? "+" : ""}${compact(s.delta_vs_all)}`}
                        </td>
                        <td className="py-2.5 text-right text-slate-400">{num(s.observed_cells)}</td>
                        <td className="py-2.5 text-right text-slate-400">{num(s.estimated_cells)}</td>
                        <td className="py-2.5 text-center text-slate-400">
                          {t("calendar.month_abbr", { m: String(peak?.[0] || 1).padStart(2, "0") })} ({compact(peak?.[1] || 0)})
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center text-slate-400">
          <p className="text-sm font-medium">
            {t("lab.sim_empty_hint")}
          </p>
        </div>
      )}

      {/* Multi-Scale Footprint Resolution Illustration */}
      <MultiScaleHarmonizationIllustration />
    </div>
  );
}
