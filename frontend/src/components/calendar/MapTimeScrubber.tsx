import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface MapTimeScrubberProps {
  currentPeriod: string;
  onSelectPeriod: (period: string) => void;
  availableYears: number[];
}

export function MapTimeScrubber({
  currentPeriod,
  onSelectPeriod,
  availableYears,
}: MapTimeScrubberProps) {
  const { t } = useLang();

  // Parse current year and month from period (e.g. "2024-03" or "all")
  const parsed = useMemo(() => {
    if (!currentPeriod || currentPeriod === "all") {
      const defaultY = availableYears[availableYears.length - 1] ?? 2025;
      return { year: defaultY, month: 3, isAll: true };
    }
    const [yStr, mStr] = currentPeriod.split("-");
    const y = parseInt(yStr ?? "2025", 10);
    const m = parseInt(mStr ?? "1", 10);
    return { year: isNaN(y) ? 2025 : y, month: isNaN(m) ? 1 : m, isAll: false };
  }, [currentPeriod, availableYears]);

  const [activeYear, setActiveYear] = useState<number>(parsed.year);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Sync year when currentPeriod changes externally
  useEffect(() => {
    if (!parsed.isAll) {
      setActiveYear(parsed.year);
    }
  }, [parsed]);

  // Animation player loop
  useEffect(() => {
    if (!isPlaying) return;

    const timer = setInterval(() => {
      const nextMonth = parsed.isAll ? 1 : (parsed.month % 12) + 1;
      let nextYear = activeYear;

      // If month rolled over from 12 to 1, advance year if possible
      if (!parsed.isAll && parsed.month === 12) {
        const yIndex = availableYears.indexOf(activeYear);
        if (yIndex >= 0 && yIndex < availableYears.length - 1) {
          nextYear = availableYears[yIndex + 1]!;
          setActiveYear(nextYear);
        } else {
          // Loop back to start
          nextYear = availableYears[0] ?? activeYear;
          setActiveYear(nextYear);
        }
      }

      onSelectPeriod(`${nextYear}-${String(nextMonth).padStart(2, "0")}`);
    }, 950);

    return () => clearInterval(timer);
  }, [isPlaying, parsed, activeYear, availableYears, onSelectPeriod]);

  const handlePrevYear = () => {
    const idx = availableYears.indexOf(activeYear);
    if (idx > 0) {
      const newY = availableYears[idx - 1]!;
      setActiveYear(newY);
      const m = parsed.isAll ? 3 : parsed.month;
      onSelectPeriod(`${newY}-${String(m).padStart(2, "0")}`);
    }
  };

  const handleNextYear = () => {
    const idx = availableYears.indexOf(activeYear);
    if (idx < availableYears.length - 1) {
      const newY = availableYears[idx + 1]!;
      setActiveYear(newY);
      const m = parsed.isAll ? 3 : parsed.month;
      onSelectPeriod(`${newY}-${String(m).padStart(2, "0")}`);
    }
  };

  const handleSelectMonth = (m: number) => {
    setIsPlaying(false);
    onSelectPeriod(`${activeYear}-${String(m).padStart(2, "0")}`);
  };

  const handleSelectAll = () => {
    setIsPlaying(false);
    onSelectPeriod("all");
  };

  return (
    <div data-ui-review="calendar-scrubber" className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[400] w-[min(94%,672px)] max-w-full">
      <div className="rounded-2xl border border-slate-800/90 bg-[#0B1220]/95 backdrop-blur-md p-2.5 shadow-2xl space-y-2 text-xs">
        {/* Controls row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Year selector with prev/next */}
          <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-800 rounded-xl px-1.5 py-1">
            <button
              type="button"
              onClick={handlePrevYear}
              disabled={availableYears.indexOf(activeYear) <= 0}
              aria-label="Previous Year"
              className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <select
              value={activeYear}
              onChange={(e) => {
                const y = Number(e.target.value);
                setActiveYear(y);
                const m = parsed.isAll ? 3 : parsed.month;
                onSelectPeriod(`${y}-${String(m).padStart(2, "0")}`);
              }}
              aria-label="Target Year"
              className="bg-transparent font-mono font-bold text-cyan-300 focus:outline-none cursor-pointer text-xs"
            >
              {availableYears.map((y) => (
                <option key={y} value={y} className="bg-slate-900 text-white">
                  {y}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleNextYear}
              disabled={availableYears.indexOf(activeYear) >= availableYears.length - 1}
              aria-label="Next Year"
              className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Current Period Label */}
          <div className="flex min-w-0 items-center gap-2 font-mono">
            <span className="text-slate-400 hidden sm:inline text-[11px]">
              {t("calendar.timeline_period")}
            </span>
            <span className="text-white font-bold bg-slate-800 px-2.5 py-0.5 rounded-md border border-slate-700">
              {parsed.isAll ? t("calendar.all_months") : `${activeYear}-${String(parsed.month).padStart(2, "0")}`}
            </span>
          </div>

          {/* Play/Pause & Reset All */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              title={isPlaying ? t("calendar.pause_playback") : t("calendar.play_playback")}
              className={cn(
                "flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-bold transition min-h-[30px]",
                isPlaying
                  ? "bg-amber-500 text-slate-950 font-extrabold shadow-amber-500/30"
                  : "bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm"
              )}
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{isPlaying ? t("calendar.pause") : t("calendar.play")}</span>
            </button>

            <button
              type="button"
              onClick={handleSelectAll}
              title={t("calendar.view_all_year")}
              className={cn(
                "rounded-xl px-2 py-1 text-[11px] font-semibold transition border min-h-[30px] flex items-center gap-1",
                parsed.isAll
                  ? "border-cyan-500/40 bg-cyan-950/40 text-cyan-300 font-bold"
                  : "border-slate-800 bg-slate-900/80 text-slate-400 hover:text-white"
              )}
            >
              <RotateCcw className="h-3 w-3" />
              <span>{t("calendar.all_year")}</span>
            </button>
          </div>
        </div>

        {/* 12 Months button row */}
        <div className="grid grid-cols-12 gap-1 pt-1 border-t border-slate-800/80">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const isSelected = !parsed.isAll && parsed.year === activeYear && parsed.month === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => handleSelectMonth(m)}
                className={cn(
                  "py-1 rounded-lg font-mono text-[11px] font-semibold transition min-h-[28px] flex items-center justify-center",
                  isSelected
                    ? "bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/30 scale-105 z-10"
                    : "bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800/80"
                )}
              >
                {t("calendar.month_abbr", { m })}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
