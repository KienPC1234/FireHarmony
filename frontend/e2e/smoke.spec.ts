import { expect, test } from "@playwright/test";

test("home loads with stats and i18n toggle", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByText("One fire calendar", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "VI", exact: true }).click();
  await expect(page.getByText("Một calendar cháy", { exact: false })).toBeVisible();
});

test("calendar matrix really renders 12 month columns and opens the inspector", async ({ page }) => {
  await page.goto("/calendar?aoi=amazon");
  await expect(page.getByText(/SYNTHETIC DEMO|MÔ PHỎNG TỔNG HỢP/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /Năm × tháng|Year × month|Ma trận|Matrix/ }).click();
  const matrix = page.locator("table").first();
  await expect(matrix).toBeVisible({ timeout: 30_000 });

  // year + 12 months + total = 14 header cells
  await expect(matrix.locator("thead th")).toHaveCount(14);
  const monthCells = matrix.getByRole("button", {
    name: /\d{4}-\d{2}: .*(detections|No data)/,
  });
  expect(await monthCells.count()).toBeGreaterThan(100);

  await monthCells.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Activity Index|Chỉ số hoạt động/).first()).toBeVisible();

  await page.keyboard.press("Escape");
});

test("navigation keeps aoi and data context", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop primary nav only");
  await page.goto("/calendar?aoi=amazon&data=sample");
  await page.getByRole("link", { name: /Evidence|Bằng chứng/ }).first().click();
  await expect(page).toHaveURL(/aoi=amazon/);
  await expect(page).toHaveURL(/data=sample/);
});

test("raw 404 is explained and never silently switches to synthetic", async ({ page }) => {
  let sampleRequested = false;
  await page.route("**/api/firms/calendar?*", async (route) => {
    const url = route.request().url();
    if (url.includes("data=raw")) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          detail: { error_code: "no_raw_data", message: "raw pull missing on this server" },
        }),
      });
      return;
    }
    if (url.includes("data=sample")) sampleRequested = true;
    await route.continue();
  });

  await page.goto("/calendar?data=raw&aoi=vietnam");
  await expect(page.getByText(/NASA raw data unavailable|Dữ liệu NASA raw không khả dụng/)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  expect(sampleRequested).toBe(false);

  await page.getByRole("button", { name: /Use synthetic demo|Dùng dữ liệu mô phỏng|Dữ liệu mô phỏng|Synthetic demo/i }).click();
  await expect(page.getByText(/SYNTHETIC DEMO|MÔ PHỎNG TỔNG HỢP/)).toBeVisible({ timeout: 30_000 });
  expect(sampleRequested).toBe(true);
});

test("nav deep links carry aoi + xray page loads backtest", async ({ page }) => {
  await page.goto("/xray?aoi=vietnam");
  await expect(page.getByRole("heading", { name: /x-ray/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("main").getByText(/VIIRS/i).first()).toBeVisible({ timeout: 30_000 });
});

test("lab simulator runs a sensor subset on sample data", async ({ page }) => {
  await page.goto("/lab?tab=simulator");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const selects = page.locator("select");
  await selects.nth(1).selectOption("sample");
  await page.getByRole("button", { name: /Run|Chạy/ }).click();
  await expect(page.getByText("all_sensors").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("modis_only").first()).toBeVisible();
});
