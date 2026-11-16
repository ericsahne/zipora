import { defineConfig, devices } from '@playwright/test';

// PW_CHROMIUM_PATH / PW_CHROMIUM_ARGS let environments that cannot download Playwright's browsers use another Chromium.
const launchOptions = {
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: process.env.PW_CHROMIUM_ARGS ? (JSON.parse(process.env.PW_CHROMIUM_ARGS) as string[]) : [],
};
const PORT = Number(process.env.E2E_PORT ?? 4173);

/**
 * ALL tests here run against a MOCKED GitHub (scripts/e2e-server.mjs): the real ZIPORA server code and the real browser UI,
 * with GitHub's OAuth and REST API replaced by an in-memory fake. They prove ZIPORA's behaviour, NOT that GitHub accepts it.
 * See docs/REAL_GITHUB_CHECKLIST.md for the manual test against real GitHub.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1, // the mock GitHub is shared state
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, screenshot: 'only-on-failure', trace: 'off' },
  webServer: { command: `node scripts/e2e-server.mjs ${PORT}`, url: `http://localhost:${PORT}/`, reuseExistingServer: !process.env.CI, timeout: 30_000 },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'android-chrome', use: { ...devices['Pixel 7'], launchOptions } },
  ],
});
