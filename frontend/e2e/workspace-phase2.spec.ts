import { expect, test } from "@playwright/test";

test("Sensor Lab mobile shows results first and provides accessible optional filters", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/lab?tab=xray&aoi=amazon&data=sample&mode=research");
  await expect(page.getByRole("heading", { name: "Sensor Lab" })).toBeVisible();
  const filterToggle = page.getByRole("button", { name: /Bộ lọc & điều khiển thử nghiệm|Experiment filters & controls/ });
  await expect(filterToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#lab-filters")).toBeHidden();
  await filterToggle.click();
  await expect(filterToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#lab-filters")).toBeVisible();
  await page.locator("#lab-filters").locator("select").first().selectOption("vietnam");
  const url = new URL(page.url());
  expect(url.searchParams.get("aoi")).toBe("vietnam");
  expect(url.searchParams.get("mode")).toBe("research");
  await page.goto("/lab?tab=simulator&aoi=vietnam&data=sample");
  await expect(page.locator("#lab-filters")).toBeVisible();
  await expect(page.locator("#lab-filters select")).toHaveCount(4);
});

test("Evidence mobile quick navigation reaches the observation matrix and preserves context", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/evidence?aoi=vietnam&data=sample&ym=2025-03&mode=research");
  const nav = page.getByRole("navigation", { name: /Đi đến|On this page/ });
  await expect(nav).toBeVisible({ timeout: 20000 });
  await nav.getByRole("link", { name: /Ma trận quan trắc|Observation matrix/ }).click();
  await expect(page.locator("#evidence-matrix")).toBeInViewport({ ratio: 0.01 });
  await expect(page.locator("#evidence-limits")).toHaveCount(1);
  const methods = page.getByRole("link", { name: /Phương pháp|Method/i }).first();
  await methods.click();
  await expect(page).toHaveURL(/\/methods\?/);
  expect(new URL(page.url()).searchParams.get("mode")).toBe("research");
});

test("AI Investigator has chat, questions and telemetry navigation on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/investigator?aoi=amazon&data=sample");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const nav = page.getByRole("navigation", { name: /AI Scientific Investigator/i });
  await expect(nav).toBeVisible();
  await expect(page.locator("#ai-questions")).toHaveCount(1);
  await nav.getByRole("link", { name: /Telemetry|Dữ liệu kiểm chứng/i }).last().click();
  await expect(page.locator("#ai-telemetry")).toBeInViewport({ ratio: 0.01 });
  await expect(page.locator("#ai-conversation")).toHaveAttribute("role", "log");
  await expect(page.locator("form input[aria-label]")).toBeVisible();
});

test("Methods shows compact horizontal research sections and tab switch is functional", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/methods?data=sample&aoi=vietnam");
  const nav = page.getByRole("navigation", { name: /Mục lục phương pháp|Methods sections/ });
  await expect(nav).toBeVisible();
  expect(await nav.getByRole("button").count()).toBe(5);
  await nav.getByRole("button").nth(3).click();
  await expect(nav.getByRole("button").nth(3)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("All phase-2 pages have no JavaScript crash at desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of ["/lab?data=sample", "/evidence?data=sample", "/investigator?data=sample", "/methods?data=sample"]) {
    const errs: string[] = [];
    page.on("pageerror", (err) => errs.push(err.message));
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 25000 });
    expect(errs, path).toEqual([]);
  }
});
