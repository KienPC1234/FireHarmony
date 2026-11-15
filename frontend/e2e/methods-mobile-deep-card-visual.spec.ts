import { expect, test } from "@playwright/test";

test("Methods holdout result cards remain fully readable at phone widths", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("firms-lang", "vi");
    localStorage.setItem("fh_tour_prefs_v1", JSON.stringify({ globalOptOut: true, pages: {} }));
  });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/methods?aoi=vietnam&data=sample&mode=research", { waitUntil: "domcontentloaded" });
    const label = page.getByText("STAN Operational MAE:", { exact: true });
    await expect(label).toBeVisible({ timeout: 20000 });
    const row = label.locator("..");
    const card = label.locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
    const grid = card.locator("..");
    const [cardBox, gridBox] = await Promise.all([card.boundingBox(), grid.boundingBox()]);
    expect(cardBox).not.toBeNull();
    expect(gridBox).not.toBeNull();
    expect(cardBox!.x).toBeGreaterThanOrEqual(0);
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(width - 8);
    expect(await grid.evaluate(el => el.scrollWidth <= el.clientWidth + 2)).toBe(true);
    const value = row.getByText("3,899.5 (-12.6%)", { exact: true });
    const valueBounds = await value.boundingBox();
    expect(valueBounds).not.toBeNull();
    expect(valueBounds!.x + valueBounds!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width - 8);
  }
});
