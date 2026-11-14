import { expect, test } from "@playwright/test";

const views = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

for (const view of views) {
  test("Overview numbered fixes have inset and readable accents (" + view.name + ")", async ({ page }) => {
    test.setTimeout(85000);
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.goto("/?aoi=vietnam&data=sample", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toBeVisible();
    const metrics = page.locator('[data-fh-page="home"] section[class*="grid-cols-2"][class*="md:grid-cols-4"] > div');
    await expect(metrics).toHaveCount(4);
    const actual = await metrics.evaluateAll((nodes) => nodes.map((node) => ({
      inset: parseFloat(getComputedStyle(node).paddingLeft),
      height: Math.round(node.getBoundingClientRect().height),
      labelOverflow: node.scrollWidth > node.clientWidth + 2,
    })));
    expect(actual.every((x) => x.inset >= 18), JSON.stringify(actual)).toBe(true);
    expect(actual.every((x) => !x.labelOverflow), JSON.stringify(actual)).toBe(true);
    const bars = page.locator('[data-fh-page="home"] div[class*="space-y-3"][class*="font-mono"][class*="tabular-nums"]');
    await expect(bars).toBeVisible();
    const family = await bars.evaluate((e) => getComputedStyle(e).fontFamily.toLowerCase());
    expect(family).not.toMatch(/^ui-monospace|^monospace/);
    const footer = page.locator('footer [data-ui-review="overview-048"]');
    await expect(footer).toBeAttached();
  });

  test("Calendar toolbar and timeline legend do not collide (" + view.name + ")", async ({ page }) => {
    test.setTimeout(110000);
    await page.setViewportSize({ width: view.width, height: view.height });
    // Isolated UI-only fixture: the live FIRMS backend is busy training and
    // can exceed its 35-second timeout. No fixture values reach production.
    const zeros = Array.from({ length: 12 }, () => null);
    await page.route("**/api/firms/calendar?*", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: "sample", data_source: "synthetic_test_fixture_not_observed", method_id: "stat",
        daily_cells: 0, ratios: {},
        calendar: {
          years: [2025], months: Array.from({ length: 12 }, (_, n) => n + 1),
          matrix: [zeros], anomalies: [zeros], row_totals: [0], col_medians: zeros,
          coverage: [Array.from({ length: 12 }, () => 0)],
        },
        critical_periods: [], latest: null, forecast: null, daily: [],
        summary: {
          modis_detections: 0, viirs_detections: 0, sensor_detections_total: 0,
          harmonized_total: 0, paired_cells: 0, modis_only_cells: 0,
          viirs_only_cells: 0, estimated_cells: 0, estimated_index: null,
          n_daily_cells_total: 0, n_daily_cells_returned: 0,
          period: { from: null, to: null },
          source_scope: "synthetic_demo_not_observed",
          data_source: "synthetic_test_fixture_not_observed",
          method: "stat", filter_hash: "ui-only-fixture", filters: {},
          note: "UI-only fixture, no scientific claims",
        },
      }),
    }));
    await page.goto("/calendar?aoi=vietnam&data=sample&method=k_ratio", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 50000 });
    const header = page.locator('[data-fh-page="calendar"] > div > header');
    await expect(header).toBeVisible();
    const toolbar = await header.evaluate((e) => ({
      wrap: getComputedStyle(e).flexWrap,
      controlsOutside: [...e.querySelectorAll("select,button,a")].map((n) => {
        const a = n.getBoundingClientRect();
        const p = e.getBoundingClientRect();
        return { text: n.textContent?.trim().slice(0,65), left: Math.round(a.left), right: Math.round(a.right), parentLeft: Math.round(p.left), parentRight: Math.round(p.right), width: Math.round(a.width), visible: getComputedStyle(n).display !== "none" };
      }).filter((a) => a.visible && (a.width <= 0 || a.left < a.parentLeft-2 || a.right > a.parentRight+2)),
    }));
    expect(toolbar.wrap).toBe("wrap");
    expect(toolbar.controlsOutside,JSON.stringify(toolbar.controlsOutside)).toEqual([]);
    const scrubber = page.locator('[data-ui-review="calendar-scrubber"]');
    await expect(scrubber).toBeVisible({ timeout: 70000 });
    const legend = page.locator('[data-fh-page="calendar"] .pointer-events-none.absolute[class*="bottom-3"][class*="left-3"]').first();
    await expect(legend).toBeVisible();
    const collision = await page.evaluate(() => {
      const a = document.querySelector('[data-ui-review="calendar-scrubber"]')?.getBoundingClientRect();
      const b = document.querySelector('[data-fh-page="calendar"] .pointer-events-none.absolute[class*="bottom-3"][class*="left-3"]')?.getBoundingClientRect();
      if (!a || !b) return null;
      return {
        intersectionWidth: Math.max(0, Math.min(a.right,b.right)-Math.max(a.left,b.left)),
        intersectionHeight: Math.max(0, Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)),
        parent: window.innerWidth,
        legendBottom: Math.round(b.bottom),
        scrubberTop: Math.round(a.top),
      };
    });
    expect(collision).toBeTruthy();
    expect((collision?.intersectionWidth??0) * (collision?.intersectionHeight??0),JSON.stringify(collision)).toBe(0);
  });

  test("X-Ray coordinate and card labels stay inside panels (" + view.name + ")", async ({ page }) => {
    test.setTimeout(105000);
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.goto("/xray?aoi=vietnam&data=sample", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 30000 });
    const badge = page.locator('[data-fh-page="xray"] h1 + span');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/Dữ liệu mẫu|Synthetic Feed/i);
    const source = await badge.getAttribute("title");
    expect(source).toMatch(/synthetic|sample/i);
    const side = page.locator('[data-fh-page="xray"] aside').first();
    await expect(side).toBeVisible({ timeout: 65000 });
    const stats = await side.locator("button").filter({ hasText: "104°E" }).first().evaluate((b) => {
      const box=b.getBoundingClientRect();
      const c=[...b.querySelectorAll("span")].find((s)=>s.textContent?.includes("104°E"));
      if(!c) return null;
      const x=c.getBoundingClientRect();
      return {left:x.left,right:x.right,buttonLeft:box.left,buttonRight:box.right,coords:c.textContent};
    });
    expect(stats).toBeTruthy();
    expect(stats!.left).toBeGreaterThanOrEqual(stats!.buttonLeft+1);
    expect(stats!.right).toBeLessThanOrEqual(stats!.buttonRight-1);
    const units = page.locator('[data-ui-review="xray-units"]');
    await expect(units).toBeVisible();
    const unitSize = await units.evaluate((e) => ({scroll:e.scrollWidth,client:e.clientWidth}));
    expect(unitSize.scroll).toBeLessThanOrEqual(unitSize.client+2);
    const cards = page.locator('[data-ui-review="xray-metrics"] > div');
    await expect(cards).toHaveCount(4);
    const status = await cards.evaluateAll((els) => els.map((e)=>({
      width:e.clientWidth,scroll:e.scrollWidth,
    })));
    expect(status.every((x)=>x.scroll<=x.width+2),JSON.stringify(status)).toBe(true);
  });
}
