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
  // UI-only test fixture: July/August have valid zero-valued cells. An
  // August-only date range would intentionally place the timeline in daily
  // mode and cannot be used to test switching to July.
  const servedMonths = [...emptyMonths];
  servedMonths[6] = 0;
  servedMonths[7] = 0;
  await page.route("**/api/firms/calendar?*", (r) =>
    r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        ...sampleCalendar,
        calendar: { ...sampleCalendar.calendar, matrix: [servedMonths] },
      }),
    }));
  const periodQuery = new URLSearchParams(selection);
  periodQuery.delete("from");
  periodQuery.delete("to");
  await page.goto("/calendar?" + periodQuery.toString(), { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-fh-page="calendar"] h1')).toBeVisible();
  // The month row is intentionally collapsed to leave map space.
  // Expand it through the accessible control before selecting a month.
  const timeline = page.locator('[data-ui-review="calendar-scrubber"]');
  await expect(timeline).toBeVisible();
  await timeline.getByRole("button", { name: "Toggle timeline details" }).click();
  const months = timeline.locator(".grid button");
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

test("Calendar month selector uses full matrix, not capped daily preview", async ({ page }) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const knownCells = [...emptyMonths];
  knownCells[6] = 0; // July is an observed zero in the UI-only fixture.
  const response = {
    ...sampleCalendar,
    daily: [], // A capped detail page can legitimately contain no daily rows.
    calendar: {
      ...sampleCalendar.calendar,
      matrix: [knownCells],
    },
  };
  await page.route("**/api/firms/calendar?*", (req) =>
    req.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) }));
  await page.goto("/calendar?" + contextQuery(), { waitUntil: "domcontentloaded" });
  const selector = page.locator('[data-fh-page="calendar"] header select[aria-label]').first();
  await expect(selector).toBeVisible();
  // The URL-selected August remains shown even though the matrix has no data.
  await expect(selector).toHaveValue("2024-08");
  await expect(selector.locator('option[value="2024-08"]')).toHaveCount(1);
  // July is a legitimate zero-count month in the full calendar matrix.
  await expect(selector.locator('option[value="2024-07"]')).toHaveCount(1);
  // Missing coverage is null, not zero; do not promote June to observed.
  await expect(selector.locator('option[value="2024-06"]')).toHaveCount(0);
});

test("Calendar switches to synthetic sample only after an explicit user action", async ({ page }) => {
  test.setTimeout(50000);
  await page.route("**/api/firms/calendar?*", (r) => {
    const feed = new URL(r.request().url()).searchParams.get("data");
    return feed === "raw"
      ? r.fulfill({ status: 503, contentType: "application/json",
          body: '{"message":"Observed source unavailable (UI-only failure fixture)"}' })
      : r.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify(sampleCalendar) });
  });
  await page.goto("/calendar?aoi=vietnam&data=raw&mode=research&method=stan", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/NASA raw|Observed source unavailable/i).first()).toBeVisible({ timeout: 25000 });
  expect(new URL(page.url()).searchParams.get("data")).toBe("raw");
  await page.getByRole("button", { name: /Dữ liệu mẫu|Synthetic Feed/i }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("data")).toBe("sample");
  await expect.poll(() => new URL(page.url()).searchParams.get("method")).toBe("k_ratio");
  await expect(page.locator("[data-fh-feed]")).toContainText(/Dữ liệu mẫu|Synthetic Feed/i);
});
