import { expect, test } from "@playwright/test";

test("Evidence AOI selector respects mobile card bounds at 390 and 320 pixels", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("firms-lang", "vi"));
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/evidence?aoi=vietnam&data=sample&ym=2025-02&mode=research");
    const select = page.locator("#evidence-area-select");
    await expect(select).toBeVisible({ timeout: 15_000 });
    const outer = await select.locator("..").boundingBox();
    const bounds = await select.boundingBox();
    expect(outer).not.toBeNull();
    expect(bounds).not.toBeNull();
    expect(outer!.x + outer!.width).toBeLessThanOrEqual(width - 8);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 16);
    await expect(select).toHaveValue("vietnam");
  }
});
