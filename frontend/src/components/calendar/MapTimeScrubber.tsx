import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Pause, Play, Radio, RotateCcw } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface MapTimeScrubberProps {
  currentPeriod: string;
  onSelectPeriod: (period: string) => void;
  availableYears: number[];
  availablePeriods?: string[];
  availableDays?: string[];
  activeDays?: string[];
  isLoading?: boolean;
  onMissingPeriodClick?: (period: string) => void;
  onExtendRange?: (direction: "left" | "right") => void;
  canExtendLeft?: boolean;
  canExtendRight?: boolean;
  onCustomFetchClick?: () => void;
}

export function MapTimeScrubber({
  currentPeriod,
  onSelectPeriod,
  availableYears,
  availablePeriods = [],
  availableDays = [],
  activeDays = [],
  isLoading = false,
  onMissingPeriodClick,
  onExtendRange,
  canExtendLeft = true,
  canExtendRight = true,
  onCustomFetchClick,
}: MapTimeScrubberProps) {
  const { t } = useLang();

  const validPeriodSet = useMemo(() => new Set(availablePeriods), [availablePeriods]);
  const sortedPeriods = useMemo(() => [...availablePeriods].sort(), [availablePeriods]);
  const sortedDays = useMemo(() => [...availableDays].sort(), [availableDays]);
  const activeDaySet = useMemo(() => new Set(activeDays), [activeDays]);
  const isDailyOnly = sortedPeriods.length <= 1 && sortedDays.length >= 1;
  const isDaySelected = /^\d{4}-\d{2}-\d{2}$/.test(currentPeriod);
  const [granularity, setGranularity] = useState<"month" | "day">(isDailyOnly || isDaySelected ? "day" : "month");

  useEffect(() => {
    if (isDailyOnly) {
      setGranularity("day");
    } else if (isDaySelected) {
      setGranularity("day");
    } else if (/^\d{4}-\d{2}$/.test(currentPeriod)) {
      setGranularity("month");
    }
  }, [isDailyOnly, isDaySelected, currentPeriod]);

  const useDailyMode = granularity === "day" && sortedDays.length > 1;

  // Parse current year and month from period (e.g. "2024-03" or "all")
  const parsed = useMemo(() => {
    const fallbackYear = availableYears[availableYears.length - 1] ?? new Date().getFullYear();
    if (!currentPeriod || currentPeriod === "all") {
      return { year: fallbackYear, month: 1, isAll: true };
    }
    const [yStr, mStr] = currentPeriod.split("-");
    const y = parseInt(yStr ?? String(fallbackYear), 10);
    const m = parseInt(mStr ?? "1", 10);
    return { year: isNaN(y) ? fallbackYear : y, month: isNaN(m) ? 1 : m, isAll: false };
  }, [currentPeriod, availableYears]);

  const [activeYear, setActiveYear] = useState<number>(parsed.year);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(false);

  // Sync year when currentPeriod changes externally
  useEffect(() => {
    if (!parsed.isAll) {
      setActiveYear(parsed.year);
    }
  }, [parsed]);

  const pickPeriodForYear = (y: number, preferredMonth: number): string => {
    const candidate = `${y}-${String(preferredMonth).padStart(2, "0")}`;
    if (validPeriodSet.size === 0 || validPeriodSet.has(candidate)) return candidate;
    const prefix = `${y}-`;
    const firstInYear = sortedPeriods.find((p) => p.startsWith(prefix));
    return firstInYear ?? candidate;
  };

  // Animation player loop: advance through availableDays (daily mode) or availablePeriods (monthly mode)
  useEffect(() => {
    if (!isPlaying || isLoading) return;

    const timer = setTimeout(() => {
      if (useDailyMode && sortedDays.length > 0) {
        const idx = isDaySelected ? sortedDays.indexOf(currentPeriod) : -1;
        const nextDay = sortedDays[(idx + 1) % sortedDays.length]!;
        onSelectPeriod(nextDay);
        return;
      }

      if (sortedPeriods.length > 0) {
        const idx = parsed.isAll ? -1 : sortedPeriods.indexOf(`${activeYear}-${String(parsed.month).padStart(2, "0")}`);
        const nextPeriod = sortedPeriods[(idx + 1) % sortedPeriods.length]!;
        const nextY = parseInt(nextPeriod.slice(0, 4), 10);
        if (!isNaN(nextY)) setActiveYear(nextY);
        onSelectPeriod(nextPeriod);
        return;
      }

      const nextMonth = parsed.isAll ? 1 : (parsed.month % 12) + 1;
      let nextYear = activeYear;
      if (!parsed.isAll && parsed.month === 12) {
        const yIndex = availableYears.indexOf(activeYear);
        nextYear = (yIndex >= 0 && yIndex < availableYears.length - 1)
          ? availableYears[yIndex + 1]!
          : (availableYears[0] ?? activeYear);
        setActiveYear(nextYear);
      }
      onSelectPeriod(`${nextYear}-${String(nextMonth).padStart(2, "0")}`);
    }, 850);

    return () => clearTimeout(timer);
  }, [isPlaying, isLoading, useDailyMode, sortedDays, isDaySelected, currentPeriod, parsed, activeYear, availableYears, sortedPeriods, onSelectPeriod]);

  const handlePrevYear = () => {
    const idx = availableYears.indexOf(activeYear);
    if (idx > 0) {
      const newY = availableYears[idx - 1]!;
      setActiveYear(newY);
      onSelectPeriod(pickPeriodForYear(newY, parsed.month));
    }
  };

  const handleNextYear = () => {
    const idx = availableYears.indexOf(activeYear);
    if (idx < availableYears.length - 1) {
      const newY = availableYears[idx + 1]!;
      setActiveYear(newY);
      onSelectPeriod(pickPeriodForYear(newY, parsed.month));
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

  const shiftIsoDay = (iso: string, delta: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  };

  const dayStripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dayStripRef.current || !isDaySelected) return;
    const activeBtn = dayStripRef.current.querySelector<HTMLButtonElement>(`[data-day-pill="${currentPeriod}"]`);
    activeBtn?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [currentPeriod, isDaySelected, expanded]);

  const currentDayIdx = isDaySelected ? sortedDays.indexOf(currentPeriod) : -1;
  const handlePrevDay = () => {
    if (sortedDays.length === 0) {
      if (canExtendLeft) onExtendRange?.("left");
      return;
    }
    setIsPlaying(false);
    if (currentDayIdx === 0 || sortedDays.length === 1) {
      if (onExtendRange && canExtendLeft) {
        onExtendRange("left");
        return;
      }
      if (onMissingPeriodClick && canExtendLeft) {
        onMissingPeriodClick(shiftIsoDay(sortedDays[0]!, -1));
        return;
      }
    }
    const nextIdx = currentDayIdx <= 0 ? sortedDays.length - 1 : currentDayIdx - 1;
    onSelectPeriod(sortedDays[nextIdx]!);
  };
  const handleNextDay = () => {
    if (sortedDays.length === 0) {
      if (canExtendRight) onExtendRange?.("right");
      return;
    }
    setIsPlaying(false);
    if (currentDayIdx === sortedDays.length - 1 || sortedDays.length === 1) {
      if (onExtendRange && canExtendRight) {
        onExtendRange("right");
        return;
      }
      if (onMissingPeriodClick && canExtendRight) {
        onMissingPeriodClick(shiftIsoDay(sortedDays[sortedDays.length - 1]!, 1));
        return;
      }
    }
    const nextIdx = currentDayIdx < 0 || currentDayIdx >= sortedDays.length - 1 ? 0 : currentDayIdx + 1;
    onSelectPeriod(sortedDays[nextIdx]!);
  };

  return (
    <div data-ui-review="calendar-scrubber" className="absolute bottom-6 sm:bottom-3 left-1/2 -translate-x-1/2 z-[400] w-[min(96%,660px)] max-w-full">
      <div className="rounded-xl border border-slate-800/90 bg-[#0B1220]/95 backdrop-blur-md p-2 shadow-2xl space-y-1.5 text-xs">
        {/* Controls row */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          {useDailyMode ? (
            <div className="flex items-center gap-0.5 bg-slate-900/90 border border-slate-800 rounded-lg px-1 py-0.5 shrink-0">
              <button
                type="button"
                onClick={handlePrevDay}
                aria-label="Previous Day"
                className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <select
                value={isDaySelected ? currentPeriod : "all"}
                onChange={(e) => {
                  const val = e.target.value;
                  setIsPlaying(false);
                  if (val === "__extend_left__") {
                    onExtendRange?.("left");
                    return;
                  }
                  if (val === "__extend_right__") {
                    onExtendRange?.("right");
                    return;
                  }
                  onSelectPeriod(val);
                }}
                aria-label="Target Day"
                className="bg-transparent font-mono font-bold text-cyan-300 focus:outline-none cursor-pointer text-xs px-1"
              >
                <option value="all" className="bg-slate-900 text-white">
                  {sortedDays.length}d
                </option>
                {onExtendRange && canExtendLeft && (
                  <option value="__extend_left__" className="bg-slate-900 text-orange-300">
                    {t("calendar.extend_left")}
                  </option>
                )}
                {sortedDays.map((d) => (
                  <option key={d} value={d} className="bg-slate-900 text-white">
                    {d}{activeDaySet.has(d) ? " *" : ""}
                  </option>
                ))}
                {onExtendRange && canExtendRight && (
                  <option value="__extend_right__" className="bg-slate-900 text-orange-300">
                    {t("calendar.extend_right")}
                  </option>
                )}
              </select>
              <button
                type="button"
                onClick={handleNextDay}
                aria-label="Next Day"
                className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-0.5 bg-slate-900/90 border border-slate-800 rounded-lg px-1 py-0.5 shrink-0">
              <button
                type="button"
                onClick={handlePrevYear}
                disabled={availableYears.indexOf(activeYear) <= 0}
                aria-label="Previous Year"
                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <select
                value={activeYear}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  setActiveYear(y);
                  onSelectPeriod(pickPeriodForYear(y, parsed.month));
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
                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Current Period Label */}
          <div className="flex shrink-0 items-center gap-1.5 font-mono">
            <span className="text-slate-400 hidden lg:inline text-xs whitespace-nowrap">
              {t("calendar.timeline_period")}
            </span>
            <span className="text-white font-bold bg-slate-800 px-2 py-0.5 rounded-md border border-slate-700 text-xs whitespace-nowrap">
              {parsed.isAll
                ? t("calendar.all_months")
                : useDailyMode
                  ? currentPeriod
                  : `${activeYear}-${String(parsed.month).padStart(2, "0")}`}
            </span>
          </div>

          {/* Play/Pause, Mode Switch & Reset All */}
          <div className="flex items-center gap-1 shrink-0">
            {sortedDays.length > 1 && sortedPeriods.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setGranularity((g) => (g === "day" ? "month" : "day"));
                }}
                className="rounded-lg border border-slate-800 bg-slate-900/80 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:text-white min-h-[28px]"
              >
                {useDailyMode ? t("calendar.by_month") : t("calendar.by_day")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              title={isPlaying ? t("calendar.pause_playback") : t("calendar.play_playback")}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold transition min-h-[28px]",
                isPlaying
                  ? "bg-amber-500 text-slate-950 font-extrabold shadow-amber-500/30"
                  : "bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm"
              )}
            >
              {isPlaying ? (
                isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              <span className="hidden sm:inline">{isPlaying ? t("calendar.pause") : t("calendar.play")}</span>
            </button>

            <button
              type="button"
              onClick={handleSelectAll}
              title={t("calendar.view_all_year")}
              className={cn(
                "rounded-lg px-2 py-1 text-[11px] font-semibold transition border min-h-[28px] flex items-center gap-1",
                parsed.isAll
                  ? "border-cyan-500/40 bg-cyan-950/40 text-cyan-300 font-bold"
                  : "border-slate-800 bg-slate-900/80 text-slate-400 hover:text-white"
              )}
            >
              <RotateCcw className="h-3 w-3" />
              <span>{t("calendar.all_year")}</span>
            </button>

            {onCustomFetchClick && (
              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  onCustomFetchClick();
                }}
                title={t("calendar.live_prompt_title")}
                className="rounded-lg border border-orange-500/40 bg-orange-500/15 px-2 py-1 text-[11px] font-semibold text-orange-200 hover:bg-orange-500/25 transition min-h-[28px] flex items-center gap-1"
              >
                <Radio className="h-3 w-3 text-orange-400" />
                <span className="hidden sm:inline">{t("calendar.timeline_fetch_btn")}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label="Toggle timeline details"
              className="rounded-lg border border-slate-800 bg-slate-900/80 p-1.5 text-slate-400 hover:text-white transition min-h-[28px] flex items-center justify-center"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
            </button>
          </div>
        </div>

        {/* Daily pills or 12 Months button row (collapsible so map stays unobstructed) */}
        {(expanded || isPlaying) && (
          useDailyMode ? (
            <div ref={dayStripRef} className="flex items-center gap-1 overflow-x-auto pt-1 border-t border-slate-800/80 pb-0.5">
              {onExtendRange && canExtendLeft && (
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    onExtendRange("left");
                  }}
                  className="px-2 py-1 rounded-lg font-mono text-[10px] font-semibold transition min-h-[28px] shrink-0 border border-dashed border-orange-500/40 bg-orange-950/20 text-orange-300 hover:bg-orange-900/40"
                >
                  {t("calendar.extend_left_short")}
                </button>
              )}
              {sortedDays.map((day) => {
                const isSelected = currentPeriod === day;
                const hasFires = activeDaySet.has(day);
                return (
                  <button
                    key={day}
                    type="button"
                    data-day-pill={day}
                    title={day}
                    onClick={() => {
                      setIsPlaying(false);
                      onSelectPeriod(day);
                    }}
                    className={cn(
                      "px-2 py-1 rounded-lg font-mono text-[11px] font-semibold transition min-h-[28px] shrink-0 flex items-center gap-1",
                      isSelected
                        ? "bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/30"
                        : hasFires
                          ? "bg-orange-950/50 text-orange-200 hover:bg-orange-900/60 border border-orange-500/40"
                          : "bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800/80"
                    )}
                  >
                    <span>{day.slice(5)}</span>
                    {hasFires && !isSelected && (
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                    )}
                  </button>
                );
              })}
              {onExtendRange && canExtendRight && (
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    onExtendRange("right");
                  }}
                  className="px-2 py-1 rounded-lg font-mono text-[10px] font-semibold transition min-h-[28px] shrink-0 border border-dashed border-orange-500/40 bg-orange-950/20 text-orange-300 hover:bg-orange-900/40"
                >
                  {t("calendar.extend_right_short")}
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-6 sm:grid-cols-12 gap-1 pt-1 border-t border-slate-800/80">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                const ymKey = `${activeYear}-${String(m).padStart(2, "0")}`;
                const isAvailable = validPeriodSet.size === 0 || validPeriodSet.has(ymKey);
                const isSelected = !parsed.isAll && parsed.year === activeYear && parsed.month === m;
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={!isAvailable && !onMissingPeriodClick}
                    onClick={() => {
                      if (!isAvailable && onMissingPeriodClick) {
                        setIsPlaying(false);
                        onMissingPeriodClick(ymKey);
                        return;
                      }
                      handleSelectMonth(m);
                    }}
                    className={cn(
                      "py-1 rounded-lg font-mono text-[11px] font-semibold transition min-h-[28px] flex items-center justify-center",
                      isSelected
                        ? "bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/30 scale-105 z-10"
                        : !isAvailable
                        ? onMissingPeriodClick
                          ? "bg-slate-950/50 text-slate-500 border border-dashed border-slate-700/70 hover:border-cyan-500/50 hover:text-cyan-200"
                          : "bg-slate-950/50 text-slate-600 border border-slate-800/40 opacity-35 cursor-not-allowed"
                        : "bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800/80"
                    )}
                  >
                    {t("calendar.month_abbr", { m })}
                  </button>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
