import { expect, test } from "@playwright/test";

test("home loads with stats and i18n toggle", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "EN" }).click();
  await expect(page.getByText("One fire calendar", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "VI" }).click();
  await expect(page.getByText("Một calendar cháy", { exact: false })).toBeVisible();
});

test("calendar renders matrix and deep link ?aoi=amazon", async ({ page }) => {
  await page.goto("/calendar?aoi=amazon");
  await expect(page.getByRole("heading", { name: /calendar/i })).toBeVisible();
  await expect(page.getByText("SYNTHETIC DEMO")).toBeVisible();
  await expect(page.locator("table").first()).toBeVisible({ timeout: 30_000 });
});

test("nav deep links carry aoi + xray page loads backtest", async ({ page }) => {
  await page.goto("/xray?aoi=vietnam");
  await expect(page.getByRole("heading", { name: /x-ray/i })).toBeVisible();
  await expect(page.getByText(/VIIRS/i).first()).toBeVisible({ timeout: 30_000 });
});
