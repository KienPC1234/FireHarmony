import React from "react";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export function Kpi({
  label,
  value,
  hint,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad" | "accent";
  icon?: typeof Activity;
}) {
  const tones = {
    default: "border-border/70 bg-card/80 text-slate-100",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    bad: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    accent: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  };
  return (
    <div className={cn("rounded-xl border p-3.5 shadow-sm space-y-1 backdrop-blur", tones[tone])}>
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="h-3.5 w-3.5" />}
      </div>
      <p className="font-mono text-2xl font-black tabular-nums text-slate-100">{value}</p>
      {hint && <p className="text-xs text-slate-400 leading-tight">{hint}</p>}
    </div>
  );
}

export function Section({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("card-glow rounded-2xl border border-border/80 bg-card/80 p-5 shadow-card backdrop-blur", className)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-border/40 pb-2.5">
        <h2 className="text-sm font-bold text-white tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs font-mono text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
