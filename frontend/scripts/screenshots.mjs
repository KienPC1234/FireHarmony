import { chromium } from "@playwright/test"

/**
 * Refresh the screenshots in docs/screenshots.
 *
 * They are the first thing a judge sees in the README, so they have to show
 * the current build. Run it with the server already serving on :8000:
 *
 *     cd frontend && node scripts/screenshots.mjs
 */

const BASE = process.env.SCREENSHOT_BASE ?? "http://127.0.0.1:8000"
const OUT = process.env.SCREENSHOT_DIR ?? "../docs/screenshots"

const SHOTS = [
  { name: "overview", path: "/" },
  { name: "findings", path: "/findings" },
  { name: "gaps", path: "/gaps" },
  { name: "landscape", path: "/landscape" },
  { name: "evaluation", path: "/evaluation" },
  { name: "flame-spread", path: "/flame-spread" },
  { name: "compare", path: "/compare" },
  { name: "hestia", path: "/hestia" },
  { name: "hestia-coverage", path: "/hestia?tab=coverage" },
  { name: "fire-risk", path: "/fire-risk" },
  { name: "ask", path: "/ask" },
  { name: "mission-brief", path: "/mission-brief" },
  { name: "explore", path: "/explore" },
]

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})
const page = await context.newPage()

for (const shot of SHOTS) {
  await page.goto(BASE + shot.path)
  // Give the data time to load and the charts time to animate in.
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: false })
  console.log("wrote", shot.name)
}

// The source page: the PDF page behind a measured value.
await page.goto(BASE + "/flame-spread")
await page.waitForTimeout(2500)
const sourceButton = page.getByRole("button", { name: /^View p/ }).first()
if (await sourceButton.count()) {
  await sourceButton.click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}/flame-spread-source.png` })
  console.log("wrote flame-spread-source")
} else {
  console.error("no source-page button found; flame-spread-source.png not written")
  process.exitCode = 1
}

await browser.close()
