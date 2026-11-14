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

const AOI_CENTER: Record<string, { c: [number, number]; z: number }> = {
  vietnam: { c: [13, 106.5], z: 6 },
  amazon: { c: [-4, -60], z: 4 },
  australia: { c: [-26, 133], z: 4 },
};

// P2-12: named view fallbacks instead of inline literals, so the AOI-center
// rule has one home and the map never depends on a fresh array identity.
const DEFAULT_AOI_CENTER: [number, number] = [13, 106.5];
const WORLD_CENTER: [number, number] = [15, 20];

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
  mapError,
  calendarYears,
  scrubberYears,
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
  onSelectBbox,
  onClearBbox,
}: {
  aoi: string;
  appliedAoi: string;
  appliedBbox: string | null;
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
}) {
  const { t } = useLang();

  return (
    <div className="relative isolate flex-1 min-h-0 min-w-0 w-full h-full flex items-stretch overflow-hidden">
      {/* Main Map Canvas: retain width when the mobile inspector is open. */}
      <div className="relative flex-1 min-w-0 min-h-0 h-full self-stretch flex flex-col overflow-hidden">
        <AoiMap
          center={hasExplicitRegion ? (AOI_CENTER[aoi]?.c ?? DEFAULT_AOI_CENTER) : WORLD_CENTER}
          zoom={hasExplicitRegion ? (AOI_CENTER[aoi]?.z ?? 6) : 2}
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
        {mapError && (
          <div className="absolute left-3 top-14 z-[800] rounded-lg border border-rose-500/40 bg-rose-950/90 px-3 py-2 text-xs text-rose-200">
            {t("calendar.map_cells_error")}: {mapError}
          </div>
        )}
        {calendarYears.length > 0 && (
          <MapTimeScrubber
            currentPeriod={mapPeriod}
            onSelectPeriod={(p) => onSelectPeriod(p)}
            availableYears={scrubberYears.length > 0 ? scrubberYears : calendarYears}
            isLoading={loadingData || loadingMapCells}
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
      />
    </div>
  );
}
