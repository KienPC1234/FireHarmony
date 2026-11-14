# FireHarmony — 29-second NASA Space Apps submission demo

**Purpose:** A short, English-captioned video of the *real, locally verified NASA FIRMS demo pack*, not the application's synthetic sample feed. This is distinct from the optional three-minute technical walkthrough in [DEMO.md](DEMO.md).

**Selected challenge must be independently checked in the team's NASA Project Tab:** [Harmonization of MODIS and VIIRS Hot Spots](https://www.spaceappschallenge.org/2026/challenges/harmonization-of-modis-and-viirs-hot-spots/). *Flame in Freefall* is an unrelated microgravity experiment challenge.

## Timing and storyboard

| Time | Genuine app view | On-screen text |
|---|---|---|
| 0:00–0:05 | Research-mode Fire Calendar map, Vietnam, NASA FIRMS raw subset | **Different sensors. One activity timeline.** |
| 0:05–0:11 | Month × year heatmap of hotspot detections | **Pick a region. Inspect every month.** |
| 0:11–0:18 | Evidence view with source/provenance | **See coverage and uncertainty before interpreting peaks.** |
| 0:18–0:25 | Methods and limitations | **Model results are estimates, not a forecast of fires.** |

**Always-visible provenance:** "NASA FIRMS • Vietnam • verified 2024–2025 subset • hotspot detections ≠ individual fires."

**Optional voiceover (approximately 49 words, at a measured pace):**

> MODIS and VIIRS observe hotspots differently. FireHarmony brings NASA FIRMS records into a comparable calendar. Select a region and month, then inspect evidence before interpreting unusual activity. We distinguish observed detections, estimates and missing coverage. This tool supports transparent research. It does not predict individual fires.

The visible captions are English, so the demo is understandable with sound muted. **No narration is required.** Do not overlay invented metrics, claimed NASA endorsement, or unverified forecasts.

## Capture procedure

1. Start with an isolated checkout of an audited revision, not the dirty development working tree.
2. Verify and install the pack *inside that checkout*: \`python -m scripts.firms.demo_pack verify\`, then \`python -m scripts.firms.demo_pack install\`. Verify the checksum and confirm 362 CSV files/459,832 records.
3. Run FastAPI only on local loopback, e.g. \`python -m uvicorn app.main:app --host 127.0.0.1 --port 8098\`. Its static SPA and API must be served from the same checkout.
4. Run \`node frontend/scripts/capture_submission_demo.mjs --base http://127.0.0.1:8098 --output /tmp/FireHarmony-NASA-29s.webm\` with Playwright dependencies installed. It refuses non-loopback hosts or non-NASA raw responses and verifies that WebM metadata reports at most 29.5 seconds.
5. Inspect the video manually and validate its measured duration is at most 30 seconds. Confirm text, correct region/source label, and no modal obscuring the map. A generated file is **not** a published submission link.
6. Upload the verified short video to a publicly accessible platform, check it in a private browser window, and add it separately from the public project/repository URL in the NASA Project Tab before the deadline.

## Seven-slide fallback

If a valid short video cannot be completed, use **no more than seven slides, in English**, covering problem/sensor mismatch, NASA FIRMS source, harmonization approach, calendar/map, evidence/coverage, measured result with uncertainty and limitations, and impact/credits. Do not claim the long three-minute walkthrough as the required submission demo.

## Provenance and claims

- NASA data: FIRMS MODIS/VIIRS active-fire hotspots; subset 2024-01 to 2025-12, Vietnam; 362 verified CSVs, 459,832 records.
- The full 72-row served-series evaluation is a *historical backtest*, not a live fire forecast. Where the 95% confidence interval crosses zero, outperformance is not statistically established.
- Other scientific and AI/tool disclosures belong in the team's project page. The team must approve final credits and confirm the challenge on the actual NASA Project Tab.
- Rules: [NASA Space Apps 2026 homepage](https://www.spaceappschallenge.org/2026/) and [NASA Space Apps project-submission Q&A](https://github.com/nasa/spaceapps/discussions/1991). The 30-second/7-slide limits are documented in the 2026 organizers' guidance.
