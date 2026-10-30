// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * FinPro — Automated Playwright & Visual Regression Configuration
 * Supports E2E, accessibility audits (axe-core), responsive matrices, and visual diffs.
 */
module.exports = defineConfig({
  testDir: './tests',
  timeout: 45000,
  expect: {
    timeout: 10000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
      animations: 'disabled',
    },
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker avoids test tenant collisions on shared database
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/test-results.json' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:5001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    bypassCSP: true,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: 'node node-backend/src/server.js',
    url: 'http://127.0.0.1:5001/api/v1/health',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
