import { defineConfig, devices } from "@playwright/test";

const API_PORT = 8190;
const WEB_PORT = 5290;
const chrome = process.env.CHROME || "/usr/local/bin/google-chrome";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    launchOptions: { executablePath: chrome, args: ["--no-sandbox"] },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 } }, grep: /@responsive/ },
    { name: "mobile", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" }, grep: /@responsive/ },
  ],
  webServer: [
    {
      command: `rm -f /tmp/recompute-e2e.db && SEED_ON_START=true DATABASE_URL=sqlite:////tmp/recompute-e2e.db CORS_ORIGINS=http://127.0.0.1:${WEB_PORT} .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: "../backend",
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `RECOMPUTE_WEB_PORT=${WEB_PORT} RECOMPUTE_API_PROXY_TARGET=http://127.0.0.1:${API_PORT} npx vite`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
