import { expect, test } from "@playwright/test";

test("Sensor Lab task group cards stay readable at phone widths", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("firms-lang", "vi");
    localStorage.setItem("fh_tour_prefs_v1", JSON.stringify({ globalOptOut: true, pages: {} }));
  });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/lab?aoi=vietnam&data=sample&tab=simulator&mode=research", { waitUntil: "domcontentloaded" });
    const group = page.locator('[data-tour="lab-groups"]');
    await expect(group).toBeVisible({ timeout: 15000 });
    const cards = group.getByRole("button");
    await expect(cards).toHaveCount(3);
    const container = await group.boundingBox();
    expect(container).not.toBeNull();
    for (let i = 0; i < 3; i++) {
      const bounds = await cards.nth(i).boundingBox();
      expect(bounds).not.toBeNull();
      expect.soft(bounds!.x, "left edge card " + i).toBeGreaterThanOrEqual(container!.x - 2);
      expect.soft(bounds!.x + bounds!.width, "right edge card " + i).toBeLessThanOrEqual(container!.x + container!.width + 2);
    }
    expect(await group.evaluate(el => el.scrollWidth <= el.clientWidth + 2)).toBe(true);
    await cards.nth(2).click();
    await expect(cards.nth(2)).toHaveAttribute("aria-pressed", "true");
  }
});
