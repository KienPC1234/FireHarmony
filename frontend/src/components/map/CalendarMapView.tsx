import { useLang } from "@/lib/i18n";
import type { CalibMethod } from "@/lib/researchContext";
import { AoiMap } from "@/components/AoiMap";
import { MapTimeScrubber } from "@/components/calendar/MapTimeScrubber";
import {
  CalendarDock,
  type CustomAoiProbe,
  type DockTab,
  type SavedCustomAoi,
  type ActiveMonth as DockActiveMonth,
} from "@/components/calendar/CalendarDock";
import type { HotspotCell, HotspotCluster } from "./clusterZones";
import { AOI_CENTER, DEFAULT_AOI_CENTER, WORLD_CENTER } from "@/hooks/useCalendarData";

/**
 * CLAIM-017: satellite GIS workstation view (AoiMap + temporal scrubber +
 * dock mount), extracted from `pages/calendar.tsx`. The AOI-center/zoom rule
 * lives here: explicit region → preset center (hard zoom 6 fallback),
 * otherwise the world-center view. Canvas caps stay inside `AoiMap`.
 */
export function CalendarMapView({
  aoi,
  appliedAoi,
  appliedBbox,
  appliedGeometry,
  hasCustomFilter,
  hasExplicitRegion,
  cells,
  preview,
  activeZone,
  onSelectZone,
  mapError: _mapError,
  calendarYears,
  scrubberYears,
  availablePeriods = [],
  availableDays = [],
  activeDays = [],
  mapPeriod,
  onSelectPeriod,
  loadingData,
  loadingMapCells,
  dockOpen,
  onToggleDock,
  dockTab,
  onDockTabChange,
  onSelectAoi,
  dataFeed,
  onSelectDataFeed,
  method,
  onSelectMethod,
  sourceType,
  onSelectSourceType,
  qaMin,
  onSelectQaMin,
  platformSet,
  onSelectPlatformSet,
  totalDetections,
  totalHarmonized,
  anomalyCount,
  dockActiveMonth,
  onShowMonthOnMap,
  onOpenMatrix,
  customAois,
  aoiProbes,
  onApplyCustomAoi,
  onDeleteCustomAoi,
  modisRange,
  viirsRange,
  appliedDataset,
  onSelectBbox,
  onClearBbox,
  onMissingPeriodClick,
  onExtendRange,
  canExtendLeft = true,
  canExtendRight = true,
  onCustomFetchClick,
  daynight = "all",
  onSelectDaynight,
  minFrp = 0,
  onSelectMinFrp,
  onResetFilters,
}: {
  aoi: string;
  appliedAoi: string;
  appliedBbox: string | null;
  appliedDataset?: string;
  appliedGeometry: string | null;
  hasCustomFilter: boolean;
  hasExplicitRegion: boolean;
  cells: HotspotCell[];
  preview: { returned: number; total: number; preview: boolean; level?: string } | null;
  activeZone: HotspotCluster | null;
  onSelectZone: (z: HotspotCluster | null) => void;
  mapError: string | null;
  calendarYears: number[];
  scrubberYears: number[];
  availablePeriods?: string[];
  availableDays?: string[];
  activeDays?: string[];
  mapPeriod: string;
  onSelectPeriod: (p: string) => void;
  loadingData: boolean;
  loadingMapCells: boolean;
  dockOpen: boolean;
  onToggleDock: () => void;
  dockTab: DockTab;
  onDockTabChange: (tab: DockTab) => void;
  onSelectAoi: (aoi: string) => void;
  dataFeed: string;
  onSelectDataFeed: (feed: "raw" | "sample") => void;
  method: CalibMethod;
  onSelectMethod: (method: CalibMethod) => void;
  sourceType: "all" | "land" | "vegetation";
  onSelectSourceType: (val: "all" | "land" | "vegetation") => void;
  qaMin: string;
  onSelectQaMin: (val: string) => void;
  platformSet: string;
  onSelectPlatformSet: (val: string) => void;
  daynight?: "all" | "D" | "N";
  onSelectDaynight?: (val: "all" | "D" | "N") => void;
  minFrp?: number;
  onSelectMinFrp?: (val: number) => void;
  onResetFilters?: () => void;
  canExtendLeft?: boolean;
  canExtendRight?: boolean;
  totalDetections: number;
  totalHarmonized: number;
  anomalyCount: number;
  dockActiveMonth: DockActiveMonth | null;
  onShowMonthOnMap: (ym: string) => void;
  onOpenMatrix: () => void;
  customAois: SavedCustomAoi[];
  aoiProbes: Record<string, CustomAoiProbe>;
  onApplyCustomAoi: (aoi: SavedCustomAoi) => void;
  onDeleteCustomAoi: (id: string) => void;
  modisRange: string | null;
  viirsRange: string | null;
  onSelectBbox: (b: string, geom?: string | null) => void;
  onClearBbox: () => void;
  onMissingPeriodClick?: (period: string) => void;
  onExtendRange?: (direction: "left" | "right") => void;
  onCustomFetchClick?: () => void;
}) {
  const { t } = useLang();

  const customCenter = (() => {
    if (!hasCustomFilter || !appliedBbox) return null;
    const parts = appliedBbox.split(",").map((p) => Number(p.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
    return [(parts[1] + parts[3]) / 2, (parts[0] + parts[2]) / 2] as [number, number];
  })();

  return (
    <div className="relative isolate flex-1 min-h-0 min-w-0 w-full h-full flex items-stretch overflow-hidden">
      {/* Main Map Canvas: retain width when the mobile inspector is open. */}
      <div className="relative flex-1 min-w-0 min-h-0 h-full self-stretch flex flex-col overflow-hidden">
        <AoiMap
          center={customCenter ?? (hasExplicitRegion ? (AOI_CENTER[aoi]?.c ?? DEFAULT_AOI_CENTER) : WORLD_CENTER)}
          zoom={customCenter ? 7 : (hasExplicitRegion ? (AOI_CENTER[aoi]?.z ?? 6) : 2)}
          bbox={appliedBbox}
          geometry={appliedGeometry}
          hasCustomFilter={hasCustomFilter}
          cells={cells}
          preview={preview}
          fullBleed={true}
          height="100%"
          hideToolbar={false}
          hideLegend={false}
          activeZoneId={activeZone?.id}
          onSelectZone={(z) => onSelectZone(z)}
          onClearBbox={onClearBbox}
          onSelect={(b, geom) => onSelectBbox(b, geom)}
        />

        {/* Interactive Temporal Scrubber & Playback Bar */}
        {(hasExplicitRegion || (calendarYears.length > 0 && (availablePeriods.length > 1 || availableDays.length > 1))) && (
          <MapTimeScrubber
            currentPeriod={mapPeriod}
            onSelectPeriod={(p) => onSelectPeriod(p)}
            availableYears={scrubberYears.length > 0 ? scrubberYears : calendarYears}
            availablePeriods={availablePeriods}
            availableDays={availableDays}
            activeDays={activeDays}
            isLoading={loadingData || loadingMapCells}
            onMissingPeriodClick={onMissingPeriodClick}
            onExtendRange={onExtendRange}
            canExtendLeft={canExtendLeft}
            canExtendRight={canExtendRight}
            onCustomFetchClick={onCustomFetchClick}
          />
        )}
      </div>

      {dockOpen && (
        <button type="button" onClick={onToggleDock}
          aria-label={t("common.close_menu")}
          className="absolute inset-0 z-[1200] bg-black/55 lg:hidden" />
      )}
      {/* Desktop dock / mobile overlay inspector */}
      <CalendarDock
        open={dockOpen}
        onToggle={onToggleDock}
        tab={dockTab}
        onTabChange={onDockTabChange}
        aoi={appliedAoi}
        onSelectAoi={onSelectAoi}
        data={dataFeed}
        onSelectDataFeed={onSelectDataFeed}
        method={method}
        onSelectMethod={onSelectMethod}
        sourceType={sourceType}
        onSelectSourceType={(val) => onSelectSourceType(val)}
        qaMin={qaMin}
        onSelectQaMin={(val) => onSelectQaMin(val)}
        platformSet={platformSet}
        onSelectPlatformSet={(val) => onSelectPlatformSet(val)}
        daynight={daynight}
        onSelectDaynight={onSelectDaynight}
        minFrp={minFrp}
        onSelectMinFrp={onSelectMinFrp}
        onResetFilters={onResetFilters}
        totalDetections={totalDetections}
        totalHarmonized={totalHarmonized}
        anomalyCount={anomalyCount}
        activeMonth={dockActiveMonth}
        onShowMonthOnMap={onShowMonthOnMap}
        onOpenMatrix={onOpenMatrix}
        customAois={customAois}
        aoiProbes={aoiProbes}
        onApplyCustomAoi={onApplyCustomAoi}
        onDeleteCustomAoi={onDeleteCustomAoi}
        modisRange={modisRange}
        viirsRange={viirsRange}
        dataset={appliedDataset}
        bbox={appliedBbox}
      />
    </div>
  );
}
