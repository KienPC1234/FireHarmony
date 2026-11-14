import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

interface ConstellationProps {
  activeSensors: string[];
  className?: string;
}

export function ConstellationOrbitIllustration({ activeSensors, className }: ConstellationProps) {
  const { t } = useLang();

  const hasModis = activeSensors.includes("MODIS");
  const hasSnpp = activeSensors.includes("SNPP");
  const hasNoaa20 = activeSensors.includes("NOAA-20");
  const hasNoaa21 = activeSensors.includes("NOAA-21");

  return (
    <div className={cn("rounded-2xl border border-border/80 bg-slate-950/80 p-5 shadow-card backdrop-blur space-y-3", className)}>
      {/* Visual Header with Separate Orbit Legend Badges */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
            {t("illustrations.orbit_title")}
          </h3>
          <p className="text-xs text-slate-400">
            {t("illustrations.orbit_desc")}
          </p>
        </div>

        {/* Orbit Legend Pills - Placed outside the canvas to eliminate text collisions */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-950/40 px-2.5 py-1 text-sky-300">
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            {t("illustrations.orbit_pill_viirs")}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-950/40 px-2.5 py-1 text-amber-300">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            {t("illustrations.orbit_pill_modis")}
          </span>
        </div>
      </div>

      {/* Spacious 960x360 SVG Canvas - Zero overlapping text, clean vertical tracks */}
      <svg viewBox="0 0 960 360" className="w-full h-auto select-none" role="img" aria-label="Constellation Orbit Architecture">
        <defs>
          <radialGradient id="earthAtmosphere" cx="50%" cy="100%" r="85%">
            <stop offset="0%" stopColor="#0284c7" stopOpacity="0.35" />
            <stop offset="45%" stopColor="#0369a1" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#020617" stopOpacity="0" />
          </radialGradient>

          <linearGradient id="beamModisV2" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.7" />
            <stop offset="60%" stopColor="#f59e0b" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
          </linearGradient>

          <linearGradient id="beamSnppV2" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.75" />
            <stop offset="60%" stopColor="#f97316" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0.02" />
          </linearGradient>

          <linearGradient id="beamNoaa20V2" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.7" />
            <stop offset="60%" stopColor="#0ea5e9" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.02" />
          </linearGradient>

          <linearGradient id="beamNoaa21V2" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.7" />
            <stop offset="60%" stopColor="#8b5cf6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Coordinate Space Subtle Grid */}
        <g stroke="#1e293b" strokeWidth="0.5" strokeDasharray="3 3">
          <line x1="40" y1="30" x2="920" y2="30" />
          <line x1="40" y1="85" x2="920" y2="85" />
          <line x1="40" y1="165" x2="920" y2="165" />
          <line x1="40" y1="245" x2="920" y2="245" />
        </g>

        {/* Orbit Path 1: 824 km (VIIRS Constellation Orbit) - Starts at x=190 after left label */}
        <path
          d="M 190 85 Q 520 50 920 85"
          fill="none"
          stroke="#38bdf8"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          strokeOpacity="0.45"
        />

        {/* Orbit Path 2: 705 km (MODIS Orbit) - Starts at x=190 after left label */}
        <path
          d="M 190 165 Q 520 130 920 165"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="1.5"
          strokeDasharray="5 5"
          strokeOpacity="0.45"
        />

        {/* Left Orbital Track Pinned Labels (x=30 to x=175) - Zero collision guaranteed */}
        <g transform="translate(30, 72)">
          <rect x="0" y="0" width="145" height="26" rx="6" fill="#070c18" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.5" />
          <text x="72" y="17" textAnchor="middle" fill="#38bdf8" fontSize="11" fontFamily="monospace" fontWeight="bold">
            824 km : VIIRS
          </text>
        </g>

        <g transform="translate(30, 152)">
          <rect x="0" y="0" width="145" height="26" rx="6" fill="#070c18" stroke="#f59e0b" strokeWidth="1" strokeOpacity="0.5" />
          <text x="72" y="17" textAnchor="middle" fill="#f59e0b" fontSize="11" fontFamily="monospace" fontWeight="bold">
            705 km : MODIS
          </text>
        </g>

        {/* Earth Horizon Curvature */}
        <path
          d="M 20 320 Q 480 260 940 320"
          fill="none"
          stroke="#0284c7"
          strokeWidth="2.5"
          strokeOpacity="0.8"
        />
        <path
          d="M 20 320 Q 480 260 940 320 L 940 360 L 20 360 Z"
          fill="url(#earthAtmosphere)"
        />

        {/* Ground Surface Reference Line */}
        <text x="480" y="342" textAnchor="middle" fill="#94a3b8" fontSize="12" fontFamily="monospace">
          {t("illustrations.ground_surface")}
        </text>

        {/* SATELLITE 1: MODIS (Terra & Aqua) - x = 250, y = 145 */}
        <g transform="translate(250, 145)">
          {/* Swath Beam */}
          {hasModis && (
            <polygon points="-8,10 8,10 85,160 -85,160" fill="url(#beamModisV2)" />
          )}

          {/* Opaque Satellite Shield to prevent lines slicing through text */}
          <rect
            x="-60"
            y="-30"
            width="120"
            height="60"
            rx="8"
            fill="#070c18"
            stroke={hasModis ? "#f59e0b" : "#334155"}
            strokeWidth="1"
            strokeOpacity="0.7"
          />

          {/* Satellite Title ABOVE */}
          <text x="0" y="-14" textAnchor="middle" fill={hasModis ? "#f59e0b" : "#64748b"} fontSize="13" fontWeight="bold">
            MODIS
          </text>

          {/* Body Box */}
          <rect x="-16" y="-8" width="32" height="16" rx="3" fill="#0f172a" stroke={hasModis ? "#f59e0b" : "#475569"} strokeWidth="1.5" />
          <line x1="-36" y1="0" x2="-16" y2="0" stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="16" y1="0" x2="36" y2="0" stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="0" cy="0" r="3.5" fill={hasModis ? "#fbbf24" : "#475569"} />

          {/* Spec Label BELOW */}
          <text x="0" y="20" textAnchor="middle" fill="#cbd5e1" fontSize="11" fontFamily="monospace">
            {hasModis ? "1000m thermal" : "BYPASSED"}
          </text>
        </g>

        {/* SATELLITE 2: Suomi NPP (VIIRS Baseline) - x = 460, y = 65 */}
        <g transform="translate(460, 65)">
          {hasSnpp && (
            <polygon points="-7,10 7,10 55,240 -55,240" fill="url(#beamSnppV2)" />
          )}

          <rect
            x="-60"
            y="-30"
            width="120"
            height="60"
            rx="8"
            fill="#070c18"
            stroke={hasSnpp ? "#f97316" : "#334155"}
            strokeWidth="1"
            strokeOpacity="0.7"
          />

          <text x="0" y="-14" textAnchor="middle" fill={hasSnpp ? "#f97316" : "#64748b"} fontSize="13" fontWeight="bold">
            Suomi NPP
          </text>

          <rect x="-16" y="-8" width="32" height="16" rx="3" fill="#0f172a" stroke={hasSnpp ? "#f97316" : "#475569"} strokeWidth="1.5" />
          <line x1="-36" y1="0" x2="-16" y2="0" stroke="#f97316" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="16" y1="0" x2="36" y2="0" stroke="#f97316" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="0" cy="0" r="3.5" fill={hasSnpp ? "#fb923c" : "#475569"} />

          <text x="0" y="20" textAnchor="middle" fill="#cbd5e1" fontSize="11" fontFamily="monospace">
            {hasSnpp ? "375m active" : "BYPASSED"}
          </text>
        </g>

        {/* SATELLITE 3: NOAA-20 (JPSS-1) - x = 680, y = 65 */}
        <g transform="translate(680, 65)">
          {hasNoaa20 && (
            <polygon points="-7,10 7,10 55,240 -55,240" fill="url(#beamNoaa20V2)" />
          )}

          <rect
            x="-60"
            y="-30"
            width="120"
            height="60"
            rx="8"
            fill="#070c18"
            stroke={hasNoaa20 ? "#38bdf8" : "#334155"}
            strokeWidth="1"
            strokeOpacity="0.7"
          />

          <text x="0" y="-14" textAnchor="middle" fill={hasNoaa20 ? "#38bdf8" : "#64748b"} fontSize="13" fontWeight="bold">
            NOAA-20
          </text>

          <rect x="-16" y="-8" width="32" height="16" rx="3" fill="#0f172a" stroke={hasNoaa20 ? "#38bdf8" : "#475569"} strokeWidth="1.5" />
          <line x1="-36" y1="0" x2="-16" y2="0" stroke="#38bdf8" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="16" y1="0" x2="36" y2="0" stroke="#38bdf8" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="0" cy="0" r="3.5" fill={hasNoaa20 ? "#38bdf8" : "#475569"} />

          <text x="0" y="20" textAnchor="middle" fill="#cbd5e1" fontSize="11" fontFamily="monospace">
            {hasNoaa20 ? "Tandem 50min" : "BYPASSED"}
          </text>
        </g>

        {/* SATELLITE 4: NOAA-21 (JPSS-2) - x = 860, y = 70 */}
        <g transform="translate(860, 70)">
          {hasNoaa21 && (
            <polygon points="-7,10 7,10 55,235 -55,235" fill="url(#beamNoaa21V2)" />
          )}

          <rect
            x="-60"
            y="-30"
            width="120"
            height="60"
            rx="8"
            fill="#070c18"
            stroke={hasNoaa21 ? "#a855f7" : "#334155"}
            strokeWidth="1"
            strokeOpacity="0.7"
          />

          <text x="0" y="-14" textAnchor="middle" fill={hasNoaa21 ? "#a855f7" : "#64748b"} fontSize="13" fontWeight="bold">
            NOAA-21
          </text>

          <rect x="-16" y="-8" width="32" height="16" rx="3" fill="#0f172a" stroke={hasNoaa21 ? "#a855f7" : "#475569"} strokeWidth="1.5" />
          <line x1="-36" y1="0" x2="-16" y2="0" stroke="#a855f7" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="16" y1="0" x2="36" y2="0" stroke="#a855f7" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="0" cy="0" r="3.5" fill={hasNoaa21 ? "#c084fc" : "#475569"} />

          <text x="0" y="20" textAnchor="middle" fill="#cbd5e1" fontSize="11" fontFamily="monospace">
            {hasNoaa21 ? "Interleaved" : "BYPASSED"}
          </text>
        </g>

        {/* Ground Swath Footprints */}
        <g transform="translate(0, 305)" fontSize="11" fontFamily="monospace" fontWeight="600" textAnchor="middle">
          {hasModis && <text x="250" fill="#f59e0b">MODIS 1km Swath</text>}
          {hasSnpp && <text x="460" fill="#f97316">SNPP 375m Swath</text>}
          {hasNoaa20 && <text x="680" fill="#38bdf8">NOAA-20 Swath</text>}
          {hasNoaa21 && <text x="860" fill="#a855f7">NOAA-21 Swath</text>}
        </g>
      </svg>
    </div>
  );
}

export function MultiScaleHarmonizationIllustration({ className }: { className?: string }) {
  const { t } = useLang();

  return (
    <div className={cn("rounded-2xl border border-border/80 bg-slate-950/80 p-5 shadow-card backdrop-blur", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3 mb-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-orange-400" />
          {t("illustrations.multiscale_title")}
        </h3>
        <span className="font-mono text-xs text-cyan-400">{t("illustrations.multiscale_ratio")}</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 items-center">
        <svg viewBox="0 0 320 200" className="w-full h-auto select-none" role="img" aria-label="Pixel Grid Comparison">
          {/* MODIS Coarse Cell */}
          <rect x="20" y="20" width="120" height="120" rx="4" fill="#0f172a" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 4" />
          <text x="80" y="16" textAnchor="middle" fill="#f59e0b" fontSize="11" fontWeight="bold">
            {t("illustrations.modis_cell")}
          </text>
          <circle cx="80" cy="80" r="18" fill="#f59e0b" fillOpacity="0.8" />
          <text x="80" y="84" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="bold">FRP</text>
          <text x="80" y="156" textAnchor="middle" fill="#94a3b8" fontSize="10">
            {t("illustrations.coarse_threshold")}
          </text>

          {/* Arrow */}
          <line x1="150" y1="80" x2="175" y2="80" stroke="#38bdf8" strokeWidth="2" />
          <polygon points="175,76 182,80 175,84" fill="#38bdf8" />
          <text x="165" y="70" textAnchor="middle" fill="#38bdf8" fontSize="11" fontWeight="bold">1/k</text>

          {/* VIIRS Fine Sub-Cells */}
          <g transform="translate(190, 20)">
            <text x="60" y="-4" textAnchor="middle" fill="#f97316" fontSize="11" fontWeight="bold">
              {t("illustrations.viirs_grid")}
            </text>
            {[0, 1, 2].map((r) =>
              [0, 1, 2].map((c) => {
                const isFire = (r === 1 && c === 1) || (r === 0 && c === 2) || (r === 2 && c === 0);
                return (
                  <rect
                    key={`${r}-${c}`}
                    x={c * 40}
                    y={r * 40}
                    width="38"
                    height="38"
                    rx="3"
                    fill={isFire ? "#f97316" : "#0f172a"}
                    fillOpacity={isFire ? 0.85 : 0.4}
                    stroke="#f97316"
                    strokeWidth="1.5"
                    strokeDasharray={isFire ? undefined : "2 2"}
                  />
                );
              }),
            )}
            <text x="60" y="136" textAnchor="middle" fill="#94a3b8" fontSize="11">
              {t("illustrations.sub_fires_resolved")}
            </text>
          </g>
        </svg>

        <div className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
          <p>
            <strong className="text-white">{t("illustrations.why_no_merge")}</strong>{" "}
            {t("illustrations.why_no_merge_body")}
          </p>
          <p>
            <strong className="text-white">{t("illustrations.mechanism")}</strong>{" "}
            {t("illustrations.mechanism_body")}
          </p>
        </div>
      </div>
    </div>
  );
}

export function ReasoningPipelineIllustration({ className }: { className?: string }) {
  const { t } = useLang();

  const steps = [
    {
      num: "01",
      title: t("illustrations.step1_title"),
      desc: t("illustrations.step1_desc"),
    },
    {
      num: "02",
      title: t("illustrations.step2_title"),
      desc: t("illustrations.step2_desc"),
    },
    {
      num: "03",
      title: t("illustrations.step3_title"),
      desc: t("illustrations.step3_desc"),
    },
    {
      num: "04",
      title: t("illustrations.step4_title"),
      desc: t("illustrations.step4_desc"),
    },
    {
      num: "05",
      title: t("illustrations.step5_title"),
      desc: t("illustrations.step5_desc"),
    },
  ];

  return (
    <div className={cn("rounded-2xl border border-border/80 bg-slate-950/80 p-5 shadow-card backdrop-blur space-y-3", className)}>
      <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-cyan-400" />
          {t("illustrations.reasoning_title")}
        </h3>
        <span className="font-mono text-xs text-cyan-400">
          {t("illustrations.deterministic_path")}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 pt-1">
        {steps.map((s) => (
          <div key={s.num} className="rounded-xl border border-border/60 bg-slate-900/60 p-3 space-y-1.5">
            <span className="font-mono text-xs font-bold text-cyan-400">{s.num}</span>
            <p className="text-xs font-bold text-slate-100">{s.title}</p>
            <p className="text-xs text-slate-400 leading-tight">{s.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
