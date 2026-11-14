import { expect, test } from "@playwright/test";

// All Calendar responses in these navigation tests are explicitly UI-only.
// They are not NASA observations and must never be published as scientific data.
const emptyMonths = Array(12).fill(null);
const sampleCalendar = {
  data: "sample",
  data_source: "synthetic_ui_only_not_observed",
  method_id: "stat",
  daily_cells: 0,
  daily: [],
  ratios: {},
  calendar: {
    years: [2024], months: Array.from({ length: 12 }, (_, i) => i + 1),
    matrix: [emptyMonths], anomalies: [emptyMonths],
    row_totals: [0], col_medians: emptyMonths,
    coverage: [Array(12).fill(0)],
  },
  critical_periods: [],
  summary: {
    modis_detections: 0, viirs_detections: 0,
    sensor_detections_total: 0, harmonized_total: 0,
    paired_cells: 0, modis_only_cells: 0, viirs_only_cells: 0,
    estimated_cells: 0, estimated_index: null,
    n_daily_cells_total: 0, n_daily_cells_returned: 0,
    data_source: "synthetic_ui_only_not_observed", period: { from: null, to: null },
    source_scope: "synthetic_ui_only_not_observed", method: "stat",
    filter_hash: "ui-only", filters: {},
  },
};
const selection = {
  aoi: "amazon",
  data: "sample",
  mode: "research",
  ym: "2024-08",
  method: "k_ratio",
  qa_min: "nominal",
  platform_set: "all",
  source_type: "land",
  from: "2024-08-01",
  to: "2024-08-31",
};
function contextQuery() { return new URLSearchParams(selection).toString(); }
function expectContext(url: string, keys: Array<keyof typeof selection>) {
  const params = new URL(url).searchParams;
  for (const key of keys) expect(params.get(key), key + " missing from " + url).toBe(selection[key]);
}
async function sampleApi(page: import("@playwright/test").Page) {
  await page.route("**/api/firms/calendar?*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sampleCalendar) }));
  await page.route("**/api/firms/data-status*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ raw_count: 0, datasets: [] }) }));
}

test("Calendar direct X-Ray action keeps every research filter", async ({ page }) => {
  test.setTimeout(50000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sampleApi(page);
  await page.goto("/calendar?" + contextQuery(), { waitUntil: "domcontentloaded" });
  const xray = page.locator('[data-fh-page="calendar"] a[href^="/xray?"]').first();
  await expect(xray).toBeVisible({ timeout: 20000 });
  const href = await xray.getAttribute("href");
  expect(href).toBeTruthy();
  expectContext(new URL(href!, page.url()).href, [
    "aoi", "data", "mode", "ym", "method", "qa_min", "platform_set",
    "source_type", "from", "to",
  ]);
  await xray.click();
  await expect(page).toHaveURL(/\/xray\?/);
  expectContext(page.url(), ["aoi", "data", "mode", "ym", "method", "qa_min", "platform_set", "source_type", "from", "to"]);
});

test("Calendar month picker updates URL before navigating to Evidence", async ({ page }) => {
  test.setTimeout(50000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sampleApi(page);
  await page.goto("/calendar?" + contextQuery(), { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-fh-page="calendar"] h1')).toBeVisible();
  // Use the map's 12-month scrubber: unlike the header's capped daily-slice
  // selector, it offers all months from the returned calendar year.
  const months = page.locator('[data-ui-review="calendar-scrubber"] .grid-cols-12 button');
  await expect(months).toHaveCount(12);
  await months.nth(6).click(); // July (month 7)
  await expect(page).toHaveURL(/ym=2024-07/);
  const evidence = page.locator('[data-fh-rail] nav a[href^="/evidence?"]').first();
  await expect(evidence).toBeVisible();
  await evidence.click();
  await expect(page).toHaveURL(/\/evidence\?/);
  const params = new URL(page.url()).searchParams;
  expect(params.get("ym")).toBe("2024-07");
  expect(params.get("aoi")).toBe(selection.aoi);
  expect(params.get("mode")).toBe(selection.mode);
  expect(params.get("source_type")).toBe(selection.source_type);
});

test("Calendar links to Sensor Lab preserve year/month and research filters on mobile", async ({ page }) => {
  test.setTimeout(50000);
  await page.setViewportSize({ width: 390, height: 844 });
  await sampleApi(page);
  await page.goto("/calendar?" + contextQuery(), { waitUntil: "domcontentloaded" });
  const menu = page.getByRole("button", { name: "Toggle navigation menu" });
  await menu.click();
  const drawer = page.locator("[data-fh-sheet]");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: /Sensor Lab|Phòng thí nghiệm/i }).click();
  await expect(page).toHaveURL(/\/lab\?/);
  expectContext(page.url(), [
    "aoi", "data", "mode", "ym", "method", "qa_min", "platform_set", "source_type", "from", "to",
  ]);
});

test("raw Calendar API errors remain raw; no silent synthetic fallback", async ({ page }) => {
  test.setTimeout(45000);
  await page.route("**/api/firms/calendar?*", (req) =>
    req.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ error_code: "source_unavailable", message: "Observed source is unavailable" }) }));
  await page.goto("/calendar?aoi=vietnam&data=raw&mode=research&method=stan", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Observed source is unavailable|NASA.*unavailable|chưa khả dụng|không khả dụng|không sẵn/i).first())
    .toBeVisible({ timeout: 25000 });
  expect(new URL(page.url()).searchParams.get("data")).toBe("raw");
  await expect(page.locator("[data-fh-feed]")).toContainText(/NASA quan sát|NASA Observed/i);
});
