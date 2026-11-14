import { expect, test } from "@playwright/test";

test("mobile Fire Calendar map remains usable when inspector toggles", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/calendar?aoi=vietnam&data=sample");
  await expect(page.getByText("SYNTHETIC DEMO")).toBeVisible({ timeout: 35_000 });
  const map = page.locator(".leaflet-container").first();
  await expect(map).toBeVisible({ timeout: 25_000 });
  const before = await map.boundingBox();
  expect(before?.width ?? 0).toBeGreaterThan(300);
  const inspector = page.locator("aside[aria-label='Fire activity inspector']");
  await inspector.getByRole("button").first().click();
  const after = await map.boundingBox();
  expect(after?.width ?? 0).toBeGreaterThan(300);
  await expect(inspector).toBeVisible();
  const dims = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dims.scroll).toBeLessThanOrEqual(dims.width + 2);
});

test("desktop mission rail preserves query context", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calendar?aoi=amazon&data=sample&mode=research");
  await expect(page.getByText("SYNTHETIC DEMO")).toBeVisible({ timeout: 35_000 });
  const rail = page.getByRole("navigation", { name: "Workspace navigation" });
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("link", { name: "X-Ray / Trends" })).toBeVisible();
  const map = await page.locator(".leaflet-container").first().boundingBox();
  expect(map?.width ?? 0).toBeGreaterThan(600);
  await rail.getByRole("link", { name: /Sensor Lab|Phòng thí nghiệm/ }).click();
  await expect(page).toHaveURL(/\/lab\?/);
  expect(new URL(page.url()).searchParams.get("aoi")).toBe("amazon");
  expect(new URL(page.url()).searchParams.get("data")).toBe("sample");
});

test("intermediate width uses top navigation and a readable calendar", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/calendar?aoi=amazon&data=sample");
  await expect(page.getByText("SYNTHETIC DEMO")).toBeVisible({ timeout: 35_000 });
  await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeHidden();
  const map = await page.locator(".leaflet-container").first().boundingBox();
  expect(map?.width ?? 0).toBeGreaterThan(650);
});
