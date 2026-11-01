const { test, expect } = require('../fixtures/auth.fixture');

test.describe('Dashboard Visual Regression Tests', () => {

  // The topbar renders a time-of-day greeting and the current date, so the
  // snapshot would change every morning/afternoon and every day. Freezing the
  // page clock keeps the header deterministic without weakening the assertion.
  const FIXED_NOW = new Date('2026-11-01T09:00:00');

  test('Dashboard Header & Overview — Dark Mode Visual Snapshot', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard.html');

    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'true');
      window.FinProTheme.apply(true);
    });
    await page.waitForTimeout(600);

    const topbar = page.locator('.topbar');
    await expect(topbar).toBeVisible();
    await expect(topbar).toHaveScreenshot('dashboard-topbar-dark.png');
  });

  test('Dashboard Header & Overview — Light Mode Visual Snapshot', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard.html');

    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'false');
      window.FinProTheme.apply(false);
    });
    await page.waitForTimeout(600);

    const topbar = page.locator('.topbar');
    await expect(topbar).toBeVisible();
    await expect(topbar).toHaveScreenshot('dashboard-topbar-light.png');
  });
});
