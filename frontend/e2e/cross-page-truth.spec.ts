import { expect, test } from "@playwright/test";

// All responses in this file are explicitly synthetic browser fixtures.
// They test UI truthfulness and URL synchronization, not NASA observations.
const study = "aoi=amazon&data=sample&mode=research&ym=2024-08&qa_min=nominal&platform_set=all";

test("Sensor Lab reads the selected study month and preserves filters when editing it", async ({ page }) => {
  test.setTimeout(50000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/firms/**", (r) =>
    r.fulfill({ status: 503, contentType: "application/json", body: '{"message":"UI-only simulated unavailable response"}' }));
  await page.goto("/lab?tab=simulator&" + study, { waitUntil: "domcontentloaded" });
  const year = page.locator("#lab-year-select");
  const month = page.locator("#lab-month-select");
  await expect(year).toHaveValue("2024");
  await expect(month).toHaveValue("8");
  await month.selectOption("7");
  await expect(page).toHaveURL(/ym=2024-07/);
  await year.selectOption("2023");
  await expect(page).toHaveURL(/ym=2023-07/);
  const url = new URL(page.url());
  for (const [k, v] of [
    ["aoi", "amazon"], ["data", "sample"], ["mode", "research"],
    ["qa_min", "nominal"], ["platform_set", "all"], ["tab", "simulator"],
  ]) expect(url.searchParams.get(k), k).toBe(v);
});

test("Sensor Lab refreshes the audited month when the URL month changes", async ({ page }) => {
  test.setTimeout(55000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests: string[] = [];
  await page.route("**/api/firms/blind-spots?*", async (r) => {
    const p = new URL(r.request().url()).searchParams;
    const ym = p.get("year") + "-" + String(p.get("month")).padStart(2, "0");
    requests.push(ym);
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      aoi: "amazon", data: "sample", ym, coverage_class: "insufficient",
      paired_coverage_ratio: null, status_counts: {}, days: [],
      note: "UI-only test fixture; no NASA observation",
    }) });
  });
  await page.goto("/lab?tab=blindspots&" + study, { waitUntil: "domcontentloaded" });
  await expect.poll(() => requests).toContain("2024-08");
  await expect(page.locator("#lab-results")).toContainText("2024-08");
  await page.locator("#lab-month-select").selectOption("7");
  await expect(page).toHaveURL(/ym=2024-07/);
  await expect.poll(() => requests).toContain("2024-07");
  await expect(page.locator("#lab-results")).toContainText("2024-07");
});

test("Investigator does not invent a ratio, coverage status, or normal Z during API failure", async ({ page }) => {
  test.setTimeout(50000);
  await page.route("**/api/firms/calendar?*", (r) =>
    r.fulfill({ status: 503, contentType: "application/json", body: '{"message":"UI-only unavailable"}' }));
  await page.route("**/api/firms/blind-spots?*", (r) =>
    r.fulfill({ status: 503, contentType: "application/json", body: '{"message":"UI-only unavailable"}' }));
  await page.goto("/investigator?" + study, { waitUntil: "domcontentloaded" });
  const telemetry = page.locator("#ai-telemetry");
  await expect(telemetry).toBeVisible();
  await expect(telemetry).toContainText(/Chưa đủ bằng chứng|Insufficient Evidence/);
  await expect(telemetry).not.toContainText("2.18x");
  await expect(telemetry).not.toContainText("Verified Archive");
  await expect(telemetry).not.toContainText("STANDARD ARCHIVE");
  await expect(telemetry).not.toContainText(/Bình thường.*Z|Normal.*Z/i);
});

test("Investigator preserves valid numeric zeros rather than treating them as missing", async ({ page }) => {
  test.setTimeout(50000);
  await page.route("**/api/firms/calendar?*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      calendar: { years: [2024], months: [8], anomalies: [[0]] },
      ratios: { "8": 0 }, data_source: "synthetic_ui_only_not_observed",
    }) }));
  await page.route("**/api/firms/blind-spots?*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      aoi: "amazon", data: "sample", ym: "2024-08", paired_coverage_ratio: 0,
      coverage_class: "insufficient", status_counts: { both: 0 }, days: [],
      note: "UI-only test fixture",
    }) }));
  await page.goto("/investigator?" + study, { waitUntil: "domcontentloaded" });
  const telemetry = page.locator("#ai-telemetry");
  await expect(telemetry).toContainText("0.00x");
  await expect(telemetry).toContainText("0 days");
  await expect(telemetry).toContainText("INSUFFICIENT");
  await expect(telemetry).not.toContainText("2.18x");
});

test("Sensor Lab exposes historic MODIS-era years without changing the selected study period", async ({ page }) => {
  test.setTimeout(40000);
  await page.route("**/api/firms/**", (r) =>
    r.fulfill({ status: 503, contentType: "application/json", body: '{"message":"UI-only unavailable"}' }));
  await page.goto("/lab?tab=blindspots&aoi=amazon&data=sample&ym=2005-07&mode=research", { waitUntil: "domcontentloaded" });
  const year = page.locator("#lab-year-select");
  const month = page.locator("#lab-month-select");
  await expect(year).toHaveValue("2005");
  await expect(year.locator('option[value="2001"]')).toHaveCount(1);
  await expect(year.locator('option[value="2005"]')).toHaveCount(1);
  await expect(month).toHaveValue("7");
  await expect(page).toHaveURL(/ym=2005-07/);
});
