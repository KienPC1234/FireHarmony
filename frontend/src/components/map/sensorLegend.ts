/** Single shared sensor-legend key home.
 *
 * The `calendar.*` and `map.*` locale namespaces both define
 * `legend_viirs`/`legend_modis` with the same meaning. All in-scope code
 * funnels through these canonical `map.*` keys (rendered via `t()`), so no
 * new `calendar.legend_*` reference is introduced. The dead
 * `calendar.legend_*` locale entries are left untouched for the locales
 * owner to retire.
 */

export const SENSOR_LEGEND_KEYS = {
  viirs: "map.legend_viirs",
  modis: "map.legend_modis",
  cluster: "map.legend_cluster",
} as const;

export type SensorLegendKey = (typeof SENSOR_LEGEND_KEYS)[keyof typeof SENSOR_LEGEND_KEYS];
