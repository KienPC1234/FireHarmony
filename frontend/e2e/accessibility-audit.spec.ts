import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// CLAIM-012: zero-valued Calendar API fixture is UI-only, not NASA observations.
const nullMonths = Array.from({ length: 12 }, () => null);
const calendarFixture = {
  data: "sample", data_source: "synthetic_ui_only_fixture_not_observed",
  method_id: "stat", daily_cells: 0, ratios: {},
  calendar: {
    years: [2025], months: Array.from({ length: 12 }, (_, i) => i + 1),
    matrix: [nullMonths], anomalies: [nullMonths], row_totals: [0],
    col_medians: nullMonths, coverage: [Array(12).fill(0)]
  },
  critical_periods: [], latest: null, forecast: null, daily: [],
  summary: {
    modis_detections: 0, viirs_detections: 0, sensor_detections_total: 0,
    harmonized_total: 0, paired_cells: 0, modis_only_cells: 0,
    viirs_only_cells: 0, estimated_cells: 0, estimated_index: null,
    n_daily_cells_total: 0, n_daily_cells_returned: 0,
    period: { from: null, to: null },
    source_scope: "synthetic_ui_only_fixture_not_observed",
    data_source: "synthetic_ui_only_fixture_not_observed",
    method: "stat", filter_hash: "ui_only", filters: {},
    note: "Accessibility fixture; not scientific evidence."
  }
};
const routes = [
  { path: "/", name: "overview" },
  { path: "/calendar", name: "calendar" },
  { path: "/xray", name: "xray" },
  { path: "/evidence", name: "evidence" },
  { path: "/methods", name: "methods" },
  { path: "/investigator", name: "investigator" },
  { path: "/lab", name: "lab" }
] as const;

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 }
]) {
  for (const route of routes) {
    test(route.name + " WCAG AA controls (" + viewport.name + ")", async ({ page }) => {
      test.setTimeout(70000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.route("**/api/firms/calendar?*", (req) => req.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(calendarFixture)
      }));
      await page.route("**/api/firms/data-status*", (req) => req.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ raw_count: 0, datasets: [] })
      }));
      const address = route.path === "/calendar"
        ? "/calendar?aoi=vietnam&data=sample&method=k_ratio"
        : route.path + "?aoi=vietnam&data=sample";
      await page.goto(address, { waitUntil: "domcontentloaded" });
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(350);
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const issues = violations.map((v) => ({
        id: v.id, impact: v.impact,
        targets: v.nodes.slice(0, 4).map((node) => ({ target: node.target, diagnostics: node.any.map((c) => c.data) }))
      }));
      expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
      expect(await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
      )).toBe(true);
    });
  }
}

test("evidence and laboratory filters have accessible names", async ({ page }) => {
  await page.goto("/evidence?aoi=vietnam&data=sample");
  await expect(page.locator("#evidence-area-select")).toHaveAccessibleName(/Vùng|Khu vực|Area/);
  await expect(page.locator("#evidence-month-input")).toHaveAccessibleName(/Tháng|Month/);
  await page.goto("/lab?aoi=vietnam&data=sample&tab=simulator");
  await expect(page.locator("#lab-year-select")).toHaveAccessibleName(/Năm|Year/);
  await expect(page.locator("#lab-month-select")).toHaveAccessibleName(/Tháng|Month/);
});

test("calendar icon-only scenarios tab has accessible name on phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/firms/calendar?*", (req) => req.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(calendarFixture)
  }));
  await page.goto("/calendar?aoi=vietnam&data=sample&method=k_ratio");
  // Scenarios belong to Research mode. Open the mobile menu to switch modes
  // instead of assuming research-only controls exist in Explore mode.
  await page.getByRole("button", { name: "Toggle navigation menu" }).click();
  await page.locator("[data-fh-sheet]").getByRole("button", { name: /Nghiên cứu|Research/i }).click();
  const tabs = page.locator('[data-fh-page="calendar"] header button[aria-pressed]');
  await expect(tabs).toHaveCount(3);
  const scenarios = tabs.last();
  await expect(scenarios).toHaveAccessibleName(/Kịch bản|Scenarios|Scenario/i);
  await scenarios.click();
  await expect(scenarios).toHaveAttribute("aria-pressed", "true");
});

test("calendar previous/next controls have usable hit areas", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/firms/calendar?*", (req) => req.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(calendarFixture)
  }));
  await page.goto("/calendar?aoi=vietnam&data=sample&method=k_ratio");
  const controls = page.locator('[data-ui-review="calendar-scrubber"] button[aria-label]');
  await expect(controls.first()).toBeVisible();
  for (const button of await controls.all()) {
    const name = await button.getAttribute("aria-label");
    if (!/Previous Year|Next Year/.test(name ?? "")) continue;
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(36);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(36);
  }
});

test("methods formula overflow can receive keyboard focus", async ({ page }) => {
  await page.goto("/methods?aoi=vietnam&data=sample");
  const equation = page.locator(".text-indigo-300.overflow-x-auto").first();
  await expect(equation).toHaveAttribute("tabindex", "0");
  await equation.focus();
  await expect(equation).toBeFocused();
});
