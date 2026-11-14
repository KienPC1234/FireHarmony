import type { ComponentType } from "react";

/** Small SVG illustrations: no image assets, no network, print-safe. */

export function PixelFigure() {
  // One 1 km MODIS pixel vs the ~7 VIIRS 375 m pixels inside it.
  const cells: Array<[number, number, boolean]> = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) cells.push([i, j, (i * 3 + j) % 3 !== 2]);
  return (
    <svg viewBox="0 0 340 150" role="img" aria-label="So sánh pixel MODIS 1km và VIIRS 375m" className="h-auto w-full">
      <text x="8" y="16" fontSize="12" fill="#cbd5e1" fontWeight="600">MODIS · 1 pixel = 1 km</text>
      <rect x="8" y="24" width="120" height="120" rx="6" fill="#ea580c" opacity="0.25" stroke="#ea580c" strokeWidth="2" />
      <circle cx="68" cy="84" r="16" fill="#ea580c" opacity="0.85" />
      <text x="180" y="16" fontSize="12" fill="#cbd5e1" fontWeight="600">VIIRS · 9 pixel = 375 m</text>
      {cells.map(([i, j, fire], k) => (
        <g key={k}>
          <rect x={180 + i * 40} y={24 + j * 40} width="38" height="38" rx="4"
            fill={fire ? "#ea580c" : "transparent"} opacity={fire ? 0.85 : 1}
            stroke="#ea580c" strokeWidth="1.5" strokeDasharray={fire ? undefined : "3 3"} />
        </g>
      ))}
      <text x="180" y="158" fontSize="11" fill="#94a3b8">VIIRS thấy đám cháy nhỏ mà MODIS bỏ sót</text>
    </svg>
  );
}

export function AnomalyFigure() {
  // 12-month climatology: flat medians, one red spike at month 2.
  const med = [60, 62, 58, 40, 20, 12, 10, 11, 13, 22, 45, 58];
  const spike = 2;
  const max = 200;
  const W = 340;
  const bw = W / 12;
  return (
    <svg viewBox={`0 0 ${W} 170`} role="img" aria-label="Minh hoạ anomaly z" className="h-auto w-full">
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={W} y1={150 - f * 140} y2={150 - f * 140} stroke="#334155" strokeOpacity="0.6" />
      ))}
      {med.map((v, i) => {
        const val = i === spike ? 180 : v;
        const h = (val / max) * 140;
        return (
          <g key={i}>
            <rect x={i * bw + 4} y={150 - h} width={bw - 8} height={h} rx="3"
              fill={i === spike ? "#dc2626" : "#0284c7"} opacity={i === spike ? 0.95 : 0.7} />
            {i === spike && <text x={i * bw + bw / 2} y={150 - h - 6} fontSize="11" textAnchor="middle" fill="#ef4444" fontWeight="bold">z = 23.7</text>}
          </g>
        );
      })}
      <text x="4" y="166" fontSize="11" fill="#94a3b8">Tháng 2-2019 vượt xa median cùng tháng lịch sử</text>
    </svg>
  );
}

export function PipelineFigure({ steps }: { steps: Array<{ icon: ComponentType<{ className?: string }>; title: string; desc: string }> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <div key={s.title} className="card-glow relative rounded-xl border border-border/70 bg-card/80 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-950/40 text-cyan-400">
                <Icon className="h-4 w-4" />
              </span>
              <span className="font-mono text-xs font-bold text-slate-500">0{i + 1}</span>
            </div>
            <p className="text-xs font-bold text-slate-200">{s.title}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
          </div>
        );
      })}
    </div>
  );
}
