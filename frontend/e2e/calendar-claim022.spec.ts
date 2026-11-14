import { expect, test } from "@playwright/test";

// CLAIM-022 docs/UX locks. All responses here are explicitly synthetic
// browser fixtures (UI-only): they test request budget, URL month retention
// and the empty-filter state, never NASA observations.

const emptyMonths: null[] = Array(12).fill(null);

function calendarFixture(years: number[]) {
  const matrix = years.map((y) =>
    emptyMonths.map((_, i) => (y === 2026 && i === 10 ? 5 : null)),
  );
  return {
    data: "sample",
    data_source: "synthetic_ui_only_not_observed",
    method_id: "stat",
    effective_method: "stat",
    daily_cells: 0,
    daily: [],
    ratios: {},
    calendar: {
      years,
      months: Array.from({ length: 12 }, (_, i) => i + 1),
      matrix,
      anomalies: years.map(() => [...emptyMonths]),
      row_totals: years.map((y) => (y === 2026 ? 5 : 0)),
      col_medians: [...emptyMonths],
      coverage: years.map(() => Array(12).fill(0)),
    },
    critical_periods: [],
    summary: {
      modis_detections: 0,
      viirs_detections: 0,
      sensor_detections_total: 0,
      harmonized_total: 0,
      paired_cells: 0,
      modis_only_cells: 0,
      viirs_only_cells: 0,
      estimated_cells: 0,
      estimated_index: null,
      n_daily_cells_total: 0,
      n_daily_cells_returned: 0,
      data_source: "synthetic_ui_only_not_observed",
      period: { from: null, to: null },
      source_scope: "synthetic_ui_only_not_observed",
      method: "stat",
      filter_hash: "ui-only",
      filters: {},
    },
  };
}

async function mockQuietCalendar(
  page: import("@playwright/test").Page,
  years: number[],
) {
  await page.route("**/api/firms/calendar?*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(calendarFixture(years)),
    }),
  );
  await page.route("**/api/firms/data-status*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ raw_count: 0, datasets: [] }),
    }),
  );
}

test("Calendar fires exactly one /calendar request when params are sufficient", async ({
  page,
}) => {
  test.setTimeout(50000);
  const urls: string[] = [];
  await page.route("**/api/firms/calendar?*", async (r) => {
    urls.push(r.request().url());
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(calendarFixture([2024])),
    });
  });
  await page.route("**/api/firms/data-status*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ raw_count: 0, datasets: [] }),
    }),
  );
  await page.goto(
    "/calendar?aoi=vietnam&data=sample&method=k_ratio&mode=research",
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.locator('[data-fh-page="calendar"] h1')).toBeVisible({
    timeout: 20000,
  });
  await page.waitForLoadState("networkidle");
  expect(urls).toHaveLength(1);
});

test("Calendar keeps ?ym=2026-11 on 2026 instead of resetting it", async ({
  page,
}) => {
  test.setTimeout(50000);
  await mockQuietCalendar(page, [2026]);
  await page.goto(
    "/calendar?aoi=vietnam&data=sample&method=k_ratio&mode=research&ym=2026-11",
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.locator('[data-fh-page="calendar"] h1')).toBeVisible({
    timeout: 20000,
  });
  await page.waitForLoadState("networkidle");
  // The month is retained in the URL (not dropped to "all") ...
  await expect(page).toHaveURL(/ym=2026-11/);
  // ... and the map timeline displays the retained observation month.
  // The header's period select intentionally disappears when only one
  // period exists; the year selector and timeline label remain accessible.
  const timeline = page.locator('[data-ui-review="calendar-scrubber"]');
  await expect(timeline.getByRole("combobox", { name: "Target Year" }))
    .toHaveValue("2026");
  await expect(timeline.getByText("2026-11")).toBeVisible();
});

test("Calendar empty polygon shows the inline empty state, not raw-unavailable", async ({
  page,
}) => {
  test.setTimeout(50000);
  const ocean = JSON.stringify({
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  });
  await page.route("**/api/firms/calendar?*", (r) =>
    r.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        detail: {
          error_code: "no_raw_data",
          message: "No raw FIRMS rows available for aoi=vietnam.",
          aoi: "vietnam",
        },
      }),
    }),
  );
  await page.goto(
    `/calendar?aoi=vietnam&data=raw&method=stan&mode=research&geometry=${encodeURIComponent(ocean)}`,
    { waitUntil: "domcontentloaded" },
  );
  // Inline empty-filter state with a Clear action; the map stays mounted.
  // NOTE: the map toolbar also has clear-region buttons, so scope both
  // assertions to the empty-filter banner, not to page-global text.
  const banner = page.getByTestId("empty-filter-banner");
  await expect(
    banner.getByText(/No rows match this filter|Bộ lọc không khớp dòng nào/i),
  ).toBeVisible({ timeout: 25000 });
  await expect(
    banner.getByRole("button", { name: /Clear filter|Xóa vùng lọc/i }),
  ).toBeVisible();
  // Must not be confused with the full-page raw-unavailable panel.
  await expect(
    page.getByText(
      /NASA raw data unavailable|Dữ liệu NASA raw không khả dụng/i,
    ),
  ).toHaveCount(0);
});
