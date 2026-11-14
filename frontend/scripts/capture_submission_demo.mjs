#!/usr/bin/env node
/**
 * Record an English-captioned, sub-30-second demo using the observed NASA
 * FIRMS pack from a local, verified FireHarmony server. Never uses mock APIs,
 * synthetic sample data, or public deployments. No video is uploaded.
 *
 * node frontend/scripts/capture_submission_demo.mjs \
 *   --base http://127.0.0.1:8098 --output /tmp/FireHarmony-NASA-29s.webm
 */
import { chromium } from "playwright";
import { mkdir, copyFile, mkdtemp, rename, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function flag(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  if (!process.argv[idx + 1]) throw new Error("Missing value for " + name);
  return process.argv[idx + 1];
}

const base = new URL(flag("--base", "http://127.0.0.1:8098"));
if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname)
    || base.pathname !== "/" || base.search || base.hash || base.username || base.password) {
  throw new Error("Demo capture requires a local loopback HTTP server, not a public origin");
}
const outfile = path.resolve(flag("--output", "/tmp/FireHarmony-NASA-29s.webm"));
if (!outfile.toLowerCase().endsWith(".webm")) throw new Error("Output must be a .webm file");

// WebM Segment Info Duration (EBML ID 0x4489). Default TimecodeScale is 1ms.
function webmDurationSeconds(buffer) {
  for (let i = 0; i < Math.min(buffer.length - 16, 8192); i++) {
    if (buffer[i] !== 0x44 || buffer[i + 1] !== 0x89) continue;
    const sizeMarker = buffer[i + 2];
    let width = 1;
    while (width <= 8 && !(sizeMarker & (0x80 >> (width - 1)))) width++;
    if (width > 8 || i + 2 + width >= buffer.length) continue;
    const mask = (1 << (8 - width)) - 1;
    let size = sizeMarker & mask;
    for (let j = 1; j < width; j++) size = size * 256 + buffer[i + 2 + j];
    const pos = i + 2 + width;
    if (pos + size > buffer.length) continue;
    const raw = size === 8 ? buffer.readDoubleBE(pos)
      : size === 4 ? buffer.readFloatBE(pos) : NaN;
    const seconds = raw / 1000;
    if (Number.isFinite(seconds) && seconds > 0 && seconds < 300) return seconds;
  }
  throw new Error("Cannot verify WebM duration from metadata; refuse submission labeling");
}

const calendarQuery = "aoi=vietnam&data=raw&method=stat&year=2025&month=1&mode=research";
const api = new URL("/api/firms/calendar?" + calendarQuery, base);
const probe = await fetch(api, { signal: AbortSignal.timeout(90_000) });
if (!probe.ok) throw new Error("Observed FIRMS probe HTTP " + probe.status);
const actual = await probe.json();
if (!/NASA FIRMS/i.test(String(actual.data_source || ""))
    || actual.aoi !== "vietnam" || actual.data !== "raw") {
  throw new Error("Refusing video: the source is not verified NASA FIRMS raw Vietnam data");
}
if (!actual.calendar || !Object.keys(actual.calendar).length) {
  throw new Error("Refusing video: real calendar content is missing");
}

const scratch = await mkdtemp(path.join(tmpdir(), "fireharmony-29s-"));
let browser, context;
const evidence = [];
try {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    locale: "en-US",
    recordVideo: { dir: scratch, size: { width: 1280, height: 720 } },
  });
  await context.addInitScript(() => {
    localStorage.setItem("firms-lang", "en");
    localStorage.setItem("fh_tour_prefs_v1", JSON.stringify({ globalOptOut: true, pages: {} }));
  });
  const page = await context.newPage();
  const video = page.video();
  if (!video) throw new Error("Playwright video recording unavailable");
  const began = Date.now();
  const mark = async (title, subtitle) => {
    await page.evaluate(({ title, subtitle }) => {
      let el = document.getElementById("fh-short-demo-caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "fh-short-demo-caption";
        document.body.appendChild(el);
      }
      el.setAttribute("aria-label", "Video caption");
      Object.assign(el.style, {
        position: "fixed", zIndex: "2147483647", left: "22px", right: "22px",
        bottom: "17px", padding: "13px 22px", border: "1px solid rgba(125,211,252,.8)",
        borderRadius: "12px", background: "rgba(4,14,32,.95)",
        color: "#fff", font: "700 25px/1.35 Arial,sans-serif",
        boxShadow: "0 8px 40px rgba(0,0,0,.65)", textAlign: "left",
        pointerEvents: "none",
      });
      el.replaceChildren();
      const heading = document.createElement("div");
      heading.textContent = title;
      const note = document.createElement("div");
      note.style.cssText = "font: 500 13px/1.35 Arial,sans-serif;color:#a3dcec;margin-top:5px";
      note.textContent = subtitle;
      el.append(heading, note);
    }, { title, subtitle });
  };
  const provenance = "NASA FIRMS · Vietnam · verified 2024–2025 subset · detections ≠ individual fires";
  const holdUntil = async (seconds) => {
    const remaining = seconds * 1000 - (Date.now() - began);
    if (remaining < -1000) throw new Error("Capture overran its " + seconds + "s scene deadline");
    if (remaining > 0) await page.waitForTimeout(remaining);
  };
  const goto = async (route) => {
    await page.goto(new URL(route, base).toString(),
      { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 8_000 });
  };

  await goto("/calendar?" + calendarQuery);
  await mark("Different sensors. One activity timeline.", provenance);
  evidence.push({ scene: "calendar-map", at: (Date.now() - began) / 1000 });
  await holdUntil(5);

  await page.getByRole("button", { name: /Year × month|Năm × tháng|Matrix/i }).first().click();
  await page.locator("table").first().waitFor({ timeout: 8_000 });
  await page.locator("table").first().scrollIntoViewIfNeeded();
  await mark("Pick a region. Inspect every month.", provenance);
  evidence.push({ scene: "calendar-matrix", at: (Date.now() - began) / 1000 });
  await holdUntil(11);

  await goto("/evidence?aoi=vietnam&data=raw&method=stat&year=2025&month=1&mode=research");
  await mark("See coverage and uncertainty before interpreting peaks.", provenance);
  evidence.push({ scene: "evidence", at: (Date.now() - began) / 1000 });
  await holdUntil(18);

  await goto("/methods?aoi=vietnam&data=raw&mode=research");
  await mark("Model results are estimates, not fire forecasts.", provenance);
  evidence.push({ scene: "methods", at: (Date.now() - began) / 1000 });
  await holdUntil(25);

  await page.close();
  await context.close();
  context = null;
  const original = await video.path();
  const durationSeconds = webmDurationSeconds(await readFile(original));
  if (durationSeconds > 29.5) {
    throw new Error("Recorded " + durationSeconds.toFixed(3)
      + "s, exceeding the 29.5s safety threshold; no deliverable produced");
  }
  await mkdir(path.dirname(outfile), { recursive: true });
  const temporary = outfile + ".partial";
  await copyFile(original, temporary);
  await rename(temporary, outfile);
  const receipt = {
    title: "FireHarmony NASA Space Apps 2026 — real-FIRMS submission demo",
    source: actual.data_source, aoi: actual.aoi, data: actual.data,
    month: "2025-01", video_format: "webm", target_max_seconds: 30, measured_duration_seconds: durationSeconds,
    scenes: evidence, output: outfile, narration: "No audio; English on-screen captions",
    provenance: "24-month verified NASA FIRMS demo subset",
    caveat: "Video has not been uploaded or submitted to NASA; verify final duration before publication",
  };
  await writeFile(outfile + ".json", JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ video: outfile, receipt: outfile + ".json", scenes: evidence }, null, 2));
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  await rm(scratch, { recursive: true, force: true });
}
