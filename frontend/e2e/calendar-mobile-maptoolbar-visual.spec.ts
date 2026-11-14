import { expect, test } from "@playwright/test";

test("Calendar mobile map toolbar presents every control without edge clipping", async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/calendar?aoi=vietnam&data=sample&ym=2025-02&mode=research");
    const toolbar = page.getByTestId("calendar-map-toolbar");
    await expect(toolbar).toBeVisible({ timeout: 25000 });
    const area = await toolbar.boundingBox();
    expect(area).not.toBeNull();
    const controls = toolbar.locator("button");
    const count = await controls.count();
    expect(count).toBeGreaterThanOrEqual(5);
    for (let n=0; n<count; n++) {
      const rect = await controls.nth(n).boundingBox();
      if (!rect) continue;
      expect.soft(rect.x, "control "+n+" starts within toolbar").toBeGreaterThanOrEqual(area!.x - 2);
      expect.soft(rect.x+rect.width, "control "+n+" ends within toolbar").toBeLessThanOrEqual(area!.x+area!.width+2);
    }
  }
});
