import { expect, test } from "@playwright/test";

test("First-visit mobile tour prompt fits without obscuring the lower viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("firms-lang", "vi"));
  await page.goto("/evidence?aoi=vietnam&data=sample&ym=2025-02&mode=research");
  const dialog = page.getByRole("dialog", { name: /Xem hướng dẫn trang|Tour the/i });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  expect(bounds!.height).toBeLessThanOrEqual(136);
  await expect(dialog.getByRole("button", { name: /Không hỏi lại|Don't ask again/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Xem hướng dẫn|Start tour/i })).toBeVisible();
});
