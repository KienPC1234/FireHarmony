import { expect, test } from "@playwright/test";

const research = "aoi=vietnam&data=sample&mode=research";

test("Methods phone section navigation exposes every section without clipped labels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("firms-lang", "vi");
    localStorage.setItem("fh_tour_prefs_v1", JSON.stringify({ globalOptOut: true, pages: {} }));
  });
  await page.goto("/methods?" + research, { waitUntil: "domcontentloaded" });
  const menu = page.getByTestId("methods-mobile-section-nav");
  await expect(menu).toBeVisible({ timeout: 5000 });
  await menu.locator("summary").click();
  await expect(menu).toHaveAttribute("open", "");
  const buttons = menu.getByRole("button");
  await expect(buttons).toHaveCount(5);
  for (const button of await buttons.all()) {
    const r = await button.boundingBox();
    expect(r).not.toBeNull();
    expect(r!.x).toBeGreaterThanOrEqual(0);
    expect(r!.x + r!.width).toBeLessThanOrEqual(320);
  }
  await buttons.last().click();
  await expect(page).toHaveURL(/sec=reproduce/);
  await expect(menu).not.toHaveAttribute("open", "");
});

test("Guide and Investigator phone navigation reveals all anchors on demand", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("firms-lang", "vi");
    localStorage.setItem("fh_tour_prefs_v1", JSON.stringify({ globalOptOut: true, pages: {} }));
  });
  for (const [route, expected] of [["guide", 4], ["investigator", 3]] as const) {
    await page.goto("/" + route + "?" + research, { waitUntil: "domcontentloaded" });
    const menu = page.getByTestId("section-quicknav-mobile");
    await expect(menu).toBeVisible({ timeout: 5000 });
    await menu.locator("summary").click();
    const links = menu.getByRole("link");
    await expect(links).toHaveCount(expected);
    for (const link of await links.all()) {
      const r = await link.boundingBox();
      expect(r).not.toBeNull();
      expect(r!.x + r!.width).toBeLessThanOrEqual(320);
    }
    await links.last().click();
    await expect(menu).not.toHaveAttribute("open", "");
  }
});

test("Investigator prompt cards are all readable without horizontal swipe at 320 and 390", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("firms-lang", "vi");
    localStorage.setItem("fh_tour_prefs_v1", JSON.stringify({ globalOptOut: true, pages: {} }));
  });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/investigator?" + research, { waitUntil: "domcontentloaded" });
    const preset = page.getByTestId("investigator-preset-grid");
    await expect(preset).toBeVisible({ timeout: 5000 });
    await expect(preset.getByRole("button")).toHaveCount(6);
    const container = await preset.boundingBox();
    expect(container).not.toBeNull();
    const buttons = preset.getByRole("button");
    for (const button of await buttons.all()) {
      const r = await button.boundingBox();
      expect(r).not.toBeNull();
      expect(r!.x).toBeGreaterThanOrEqual(container!.x - 2);
      expect(r!.x + r!.width).toBeLessThanOrEqual(container!.x + container!.width + 2);
    }
    expect(await preset.evaluate(el => el.scrollWidth <= el.clientWidth + 2)).toBe(true);
  }
});
