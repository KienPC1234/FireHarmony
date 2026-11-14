import { expect, test } from "@playwright/test";

const pages = [
  "/?aoi=vietnam&data=sample",
  "/lab?tab=xray&aoi=vietnam&data=sample",
  "/evidence?aoi=vietnam&data=sample&ym=2025-03",
  "/investigator?aoi=vietnam&data=sample",
  "/methods?aoi=vietnam&data=sample",
];

test("desktop mission shell matches the visual design system across workspaces", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of pages) {
    const errors: string[] = [];
    const onError = (error: Error) => errors.push(error.message);
    page.on("pageerror", onError);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toBeVisible();
    const shell = page.locator('[data-fh-shell="mission"]');
    await expect(shell).toBeVisible();
    const header = page.locator("[data-fh-header]");
    const rail = page.locator("[data-fh-rail]");
    await expect(rail).toBeVisible();
    await expect(header).toBeVisible();
    const status = await page.evaluate(() => {
      const head = document.querySelector("[data-fh-header]");
      const sidebar = document.querySelector("[data-fh-rail]");
      const main = document.querySelector("[data-fh-main]");
      if (!head || !sidebar || !main) return null;
      const hr = head.getBoundingClientRect();
      const sr = sidebar.getBoundingClientRect();
      return {
        headerHeight: Math.round(hr.height),
        railWidth: Math.round(sr.width),
        page: main.getAttribute("data-fh-page"),
        background: getComputedStyle(main).backgroundImage,
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(status).toBeTruthy();
    expect(status?.headerHeight).toBe(66);
    expect(status?.railWidth).toBe(234);
    expect(status?.background).toContain("radial-gradient");
    expect(status?.scrollWidth).toBeLessThanOrEqual(status?.viewport ?? 0);
    expect(errors, path).toEqual([]);
    page.off("pageerror", onError);
  }
});

test("mobile keeps its navigation and full-width content without visual overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of pages) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.locator("[data-fh-rail]")).toBeHidden();
    const head = await page.locator("[data-fh-header]").boundingBox();
    expect(Math.round(head?.height ?? 0)).toBe(58);
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scroll, path).toBeLessThanOrEqual(dimensions.width + 2);
  }
  await page.getByRole("button", { name: "Toggle navigation menu" }).click();
  await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
});

test("Calendar GIS remains interactive after new shell styling", async ({ page }) => {
  test.setTimeout(85_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/calendar?aoi=vietnam&data=sample");
  const map = page.locator(".leaflet-container").first();
  await expect(map).toBeVisible({ timeout: 70_000 });
  const size = await map.boundingBox();
  expect(size?.width ?? 0).toBeGreaterThan(300);
  await expect(page.locator("[data-fh-main]")).toHaveAttribute("data-fh-page", "calendar");
});


test("desktop navigation can collapse and restore chart canvas width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab?tab=xray&aoi=vietnam&data=sample");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const rail = page.locator("[data-fh-rail]");
  const toggle = rail.locator(".fh-rail-toggle");
  const main = page.locator("[data-fh-main]");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const openRail = await rail.boundingBox();
  const openMain = await main.boundingBox();
  expect(Math.round(openRail?.width ?? 0)).toBe(234);
  await toggle.click();
  await expect(rail).toHaveAttribute("data-fh-collapsed", "true");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => Math.round((await rail.boundingBox())?.width ?? 0)).toBe(74);
  const narrowRail = await rail.boundingBox();
  const wideMain = await main.boundingBox();
  expect(Math.round(narrowRail?.width ?? 0)).toBe(74);
  expect((wideMain?.width ?? 0) - (openMain?.width ?? 0)).toBeGreaterThan(150);
  await expect(rail.getByRole("link", { name: "Sensor Lab" })).toHaveAttribute("aria-current", "page");
  await rail.getByRole("link", { name: /Fire Calendar/i }).click();
  await expect(page).toHaveURL(/\/calendar\?/);
  expect(new URL(page.url()).searchParams.get("aoi")).toBe("vietnam");
  await toggle.click();
  await expect(rail).toHaveAttribute("data-fh-collapsed", "false");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => Math.round((await rail.boundingBox())?.width ?? 0)).toBe(234);
});

test("data provenance is visible at laptop width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab?aoi=vietnam&data=sample");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const header = page.locator("[data-fh-header]");
  await expect(header.getByText(/Dữ liệu mẫu|Synthetic Feed/i)).toBeVisible();
  await expect(page.locator("[data-fh-main]")).toHaveAttribute("data-fh-page", "lab");
});

test("mobile keeps the menu without a visible desktop collapse control", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/evidence?aoi=vietnam&data=sample");
  await expect(page.locator("[data-fh-rail]")).toBeHidden();
  await expect(page.locator(".fh-rail-toggle")).toBeHidden();
  await page.getByRole("button", { name: "Toggle navigation menu" }).click();
  await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
  const dims = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dims.scroll).toBeLessThanOrEqual(dims.width + 2);
});

