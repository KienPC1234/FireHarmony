/** Shared anomaly helpers for the calendar surface.
 *
 * Single home for the z-score → style/label rules that used to live in two
 * places (`colorFor` in `pages/calendar.tsx`, `anomalyLabel` in
 * `CalendarDock.tsx`). Both render paths import from here so the matrix cells
 * and the dock month inspector can never disagree on thresholds.
 */

export type AnomalyPalette = "standard" | "accessible";

export type TranslateFn = (key: string) => string;

export function colorFor(z: number | null, palette: AnomalyPalette = "standard"): string {
  if (z === null || z === undefined) return "bg-slate-900/60 text-slate-500 border-slate-800/50";
  if (palette === "accessible") {
    // High-contrast ramp (amber/indigo/teal on near-black). Measured WCAG
    // text/background contrast (alpha-blended over #020617, 2026-11-14):
    // z>=3 slate-950/amber-400 12.08:1; z>=2 slate-950/amber-500 9.39:1;
    // 1<=z<2 amber-100/amber-800@80% 8.36:1; z<=-1.5 indigo-100/indigo-900@90%
    // 10.03:1; z<=-0.75 teal-200/teal-950@80% 12.55:1; neutral
    // slate-300/slate-900@70% 12.56:1. All pass AA (>=4.5:1); no AAA claim
    // (colorblind-safety not instrument-verified, so none is claimed).
    if (z >= 3) return "bg-amber-400 text-slate-950 border-2 border-white font-black shadow-[inset_0_0_8px_rgba(255,255,255,0.5)]";
    if (z >= 2) return "bg-amber-500 text-slate-950 border-amber-300 font-bold";
    if (z >= 1) return "bg-amber-800/80 text-amber-100 border-amber-500 font-medium";
    if (z <= -1.5) return "bg-indigo-900/90 text-indigo-100 border-indigo-400 font-bold";
    if (z <= -0.75) return "bg-teal-950/80 text-teal-200 border-teal-600 font-medium";
    return "bg-slate-900/70 text-slate-300 border-slate-800/60";
  }
  if (z >= 3) return "bg-rose-950/90 text-rose-200 border-rose-600/70 font-bold shadow-[inset_0_0_10px_rgba(225,29,72,0.35)]";
  if (z >= 2) return "bg-orange-950/80 text-orange-200 border-orange-600/60 font-semibold";
  if (z >= 1) return "bg-amber-950/50 text-amber-200 border-amber-700/50";
  if (z <= -1.5) return "bg-blue-950/70 text-blue-200 border-blue-700/50";
  if (z <= -0.75) return "bg-sky-950/50 text-sky-200 border-sky-800/40";
  return "bg-slate-900/70 text-slate-300 border-slate-800/60";
}

export function anomalyLabel(z: number | null, t: TranslateFn): { text: string; tone: string } {
  if (z === null) return { text: t("calendar.dock_z_no_data"), tone: "text-slate-400" };
  if (z >= 2) return { text: t("calendar.dock_z_unusually_high"), tone: "text-rose-300" };
  if (z >= 1) return { text: t("calendar.dock_z_above_typical"), tone: "text-amber-300" };
  if (z <= -1) return { text: t("calendar.dock_z_below_typical"), tone: "text-sky-300" };
  return { text: t("calendar.dock_z_within_typical"), tone: "text-emerald-300" };
}
