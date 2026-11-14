import { expect, test } from "@playwright/test";

/**
 * UI-only fault injection: a synthetic sample response is replaced by an
 * explicitly unavailable observed feed. No NASA observations are fabricated.
 */
test("Evidence never displays cached sample metrics after observed feed fails", async ({ page }) => {
  let releaseRaw: () => void = () => undefined;
  const rawGate = new Promise<void>((resolve) => { releaseRaw = resolve; });
  await page.route("**/api/firms/blind-spots?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("data") === "raw") {
      await rawGate;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: { error_code: "raw_unavailable", message: "UI-only forced raw outage" } }),
      });
    }
    return route.continue();
  });

  await page.goto("/evidence?aoi=vietnam&data=sample&ym=2019-03&mode=research", {
    waitUntil: "domcontentloaded",
  });
  const matrix = page.locator("#evidence-matrix");
  await expect(matrix).toBeVisible({ timeout: 30_000 });
  await matrix.locator("tbody tr").first().getByRole("button").first().click();

  const rawFailure = page.waitForResponse((response) =>
    response.url().includes("/api/firms/blind-spots?")
      && new URL(response.url()).searchParams.get("data") === "raw"
      && response.status() === 503,
  );
  await page.getByRole("button", { name: /Synthetic Feed|Dữ liệu mẫu/ }).first().click();
  await expect(page).toHaveURL(/data=raw/);
  try {
    // The previous source is hidden immediately, even while the new API is
    // waiting. Nothing from the sample response may appear under a RAW badge.
    await expect(page.locator("#evidence-matrix")).toHaveCount(0);
    await expect(page.locator("#evidence-verdict")).toHaveCount(0);
  } finally {
    releaseRaw();
  }
  await rawFailure;
  await expect(page.locator("#evidence-verdict")).toHaveCount(0);

  // A failed raw request cannot keep showing the old sample matrix, numeric
  // statistics, or the day inspector under the new "RAW" provenance badge.
  await expect(page.locator("#evidence-matrix")).toHaveCount(0);

  // A deliberate switch back to sample recovers without a page refresh.
  await page.getByRole("button", { name: /NASA Observed|NASA quan sát/ }).first().click();
  await expect(page).toHaveURL(/data=sample/);
  await expect(matrix).toBeVisible({ timeout: 15_000 });
});


test("Custom AOI without an uploaded dataset does not invent daily observations", async ({ page }) => {
  await page.goto("/evidence?aoi=custom&data=raw&ym=2025-02&mode=research", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  // There are no valid sensor observations until the user supplies a dataset.
  // A 0/31 fabricated matrix would also be wrong for February (28 days).
  await expect(page.locator("#evidence-matrix")).toHaveCount(0);
  await expect(page.locator("#evidence-verdict")).toHaveCount(0);
});


test("Synthetic detections never turn unknown acquisition coverage into zero coverage", async ({ page }) => {
  // The deterministic sample has generated detections but no satellite
  // request ledger: requested fields and paired ratio are null, not false/0.
  await page.goto("/evidence?aoi=vietnam&data=sample&ym=2025-02&mode=research", {
    waitUntil: "domcontentloaded",
  });
  const verdict = page.locator("#evidence-verdict");
  const matrix = page.locator("#evidence-matrix");
  await expect(matrix).toBeVisible({ timeout: 25_000 });
  await expect(verdict).toContainText(/Insufficient Evidence|Chưa đủ bằng chứng/);
  // The legitimate 90% eligibility *threshold* may still be displayed.
  // What must disappear is an invented 0/28 measured paired-coverage rate.
  await expect(verdict).not.toContainText(/0\s*\/\s*28\s*(?:days|ngày)/);

  const requestCard = page.getByText(/Data Request Days|Số ngày yêu cầu dữ liệu/).locator("..");
  const pairCard = page.getByText(/Comparable Paired Days|Số ngày đối chiếu khả dụng/).locator("..");
  await expect(requestCard).toContainText(/Insufficient Evidence|Chưa đủ bằng chứng/);
  await expect(pairCard).toContainText(/Insufficient Evidence|Chưa đủ bằng chứng/);

  // February 7 is a sample day with no generated detections. "?" means
  // missing request-ledger knowledge; "-" incorrectly implies no request.
  const noDetectionModis = matrix.locator("tbody tr").first().getByRole("button").nth(6);
  await expect(noDetectionModis).toHaveText("?");
  await noDetectionModis.click();
  const inspector = page.getByTestId("evidence-day-inspector");
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText(/Insufficient Evidence|Chưa đủ bằng chứng/);
});
