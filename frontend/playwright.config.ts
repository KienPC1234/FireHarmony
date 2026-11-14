import { defineConfig, devices } from "@playwright/test";

const API_PORT = 8000;
// P1-04: python comes from PYBIN (CI venv) or falls back to the repo .venv layout.
const PYBIN = process.env.PYBIN ?? "../.venv/bin/python";
const E2E_API_CMD =
  process.env.E2E_SERVER_CMD ??
  `cd ../backend && ${PYBIN} -m uvicorn app.main:app --port ${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Limit resource contention in shared CI where full browser suites and a
  // single Python API process run together (desktop + mobile projects).
  workers: 2,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: E2E_API_CMD,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npm run preview -- --port 5173 --strictPort",
      url: "http://127.0.0.1:5173/",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});
