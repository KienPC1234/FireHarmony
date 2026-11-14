import { expect, test, type Page } from "@playwright/test";

// CLAIM-031: deterministic, UI-only fixtures. These zeros are not NASA
// observations and must not be used as scientific evidence.
const noMonths = Array(12).fill(null);
const calendarFixture = {
  data_source: "synthetic_ui_fixture_not_observed",
  method_id: "stat",
  ratios: {},
  daily: [],
  calendar: {
    years: [2024],
    months: Array.from({ length: 12 }, (_, index) => index + 1),
    matrix: [noMonths],
    anomalies: [noMonths],
    row_totals: [0],
    col_medians: noMonths,
    coverage: [Array(12).fill(0)],
  },
  critical_periods: [],
  summary: {
    data_source: "synthetic_ui_fixture_not_observed",
    modis_detections: 0,
    viirs_detections: 0,
    harmonized_total: 0,
    estimated_index: null,
    paired_cells: 0,
    period: { from: null, to: null },
  },
};
type RequestFields = { feed: string | null; method: string | null };

async function mockCalendar(page: Page): Promise<RequestFields[]> {
  const requests: RequestFields[] = [];
  await page.route("**/api/firms/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/calendar")) {
      requests.push({
        feed: url.searchParams.get("data"),
        method: url.searchParams.get("method"),
      });
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(calendarFixture),
      });
    }
    if (url.pathname.endsWith("/data-status")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ raw_count: 0, datasets: [] }),
      });
    }
    return route.fulfill({
      status: 503, contentType: "application/json",
      body: '{"message":"UI-only unavailable endpoint"}',
    });
  });
  return requests;
}

function params(page: Page) {
  return new URL(page.url()).searchParams;
}

test("sample without method never switches to raw on initial render", async ({ page }) => {
  test.setTimeout(45000);
  const requests = await mockCalendar(page);
  await page.goto("/calendar?aoi=vietnam&data=sample&ym=2024-08", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-fh-feed]")).toContainText(/Dữ liệu mẫu|Synthetic Feed/);
  await page.waitForTimeout(1000);
  expect(params(page).get("data")).toBe("sample");
  expect(params(page).get("method")).not.toBe("stan");
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((req) => req.feed === "sample" && req.method === "stat"), JSON.stringify(requests)).toBe(true);
});

for (const invalidMethod of ["stan", "hts_anchor"]) {
  test("explicit sample stays sample despite incompatible " + invalidMethod, async ({ page }) => {
    test.setTimeout(45000);
    const requests = await mockCalendar(page);
    await page.goto(
      "/calendar?aoi=amazon&data=sample&method=" + invalidMethod + "&ym=2024-08&mode=research",
      { waitUntil: "domcontentloaded" },
    );
    await expect.poll(() => params(page).get("method")).toBe("k_ratio");
    expect(params(page).get("data")).toBe("sample");
    expect(params(page).get("ym")).toBe("2024-08");
    expect(params(page).get("mode")).toBe("research");
    await page.waitForTimeout(650);
    expect(requests.every((req) => req.feed === "sample" && req.method === "stat"), JSON.stringify(requests)).toBe(true);
  });
}

test("explicit raw/STAN stays raw with no synthetic fallback", async ({ page }) => {
  test.setTimeout(45000);
  const requests = await mockCalendar(page);
  await page.goto("/calendar?aoi=vietnam&data=raw&method=stan&ym=2024-08", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-fh-feed]")).toContainText(/NASA quan sát|NASA Observed/);
  await page.waitForTimeout(700);
  expect(params(page).get("data")).toBe("raw");
  expect(params(page).get("method")).toBe("stan");
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((req) => req.feed === "raw" && req.method === "stan"), JSON.stringify(requests)).toBe(true);
});

test("a deliberate feed toggle preserves study context and compatible method", async ({ page }) => {
  test.setTimeout(45000);
  const requests = await mockCalendar(page);
  await page.goto(
    "/calendar?aoi=amazon&data=sample&ym=2024-08&mode=research&qa_min=nominal",
    { waitUntil: "domcontentloaded" },
  );
  // The mobile source selector lives inside the collapsible map inspector;
  // desktop shows that inspector by default. Exercise the actual user path.
  const inspector = page.getByRole("complementary", { name: "Fire activity inspector" });
  await expect(inspector).toBeVisible({ timeout: 15_000 });
  const openInspector = inspector.getByRole("button", { name: /Overview|Tổng quan/i });
  // The closed mobile dock exposes a button; the open dock exposes a tab.
  // Do not mistake a loading state for a closed dock.
  if (await openInspector.count()) await openInspector.click();
  const rawFeed = inspector.getByRole("button", { name: /NASA Raw|NASA quan sát/i });
  await expect(rawFeed).toBeVisible({ timeout: 15_000 });
  await rawFeed.click();
  await expect.poll(() => params(page).get("data")).toBe("raw");
  await expect.poll(() => params(page).get("method")).toBe("stan");
  expect(params(page).get("ym")).toBe("2024-08");
  expect(params(page).get("mode")).toBe("research");
  expect(params(page).get("qa_min")).toBe("nominal");
  await expect(page.locator("[data-fh-feed]")).toContainText(/NASA quan sát|NASA Observed/);
  await expect.poll(
    () => requests.some((req) => req.feed === "raw" && req.method === "stan"),
    { timeout: 15_000 },
  ).toBe(true);
});


test("explicit month with zero detections is not silently widened to all time", async ({ page }) => {
  test.setTimeout(45000);
  const requests = await mockCalendar(page);
  await page.goto(
    "/calendar?aoi=vietnam&data=sample&ym=2024-08&mode=research",
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.locator("[data-fh-feed]")).toContainText(/Dữ liệu mẫu|Synthetic Feed/);
  await page.waitForTimeout(1100);
  expect(params(page).get("ym")).toBe("2024-08");
  expect(params(page).get("data")).toBe("sample");
  expect(params(page).get("mode")).toBe("research");
  expect(requests.every((req) => req.feed === "sample"), JSON.stringify(requests)).toBe(true);
});
