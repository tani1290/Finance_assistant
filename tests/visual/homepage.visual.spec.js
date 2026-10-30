const { test, expect } = require('@playwright/test');

test.describe('Homepage Visual Regression Tests', () => {

  test('Homepage Hero & Showcase — Dark Mode Visual Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'true');
      window.FinProTheme.apply(true);
    });
    await page.waitForTimeout(400);

    // Capture showcase card
    const showcase = page.locator('.showcase-card');
    await expect(showcase).toBeVisible();
    await expect(showcase).toHaveScreenshot('homepage-showcase-dark.png');

    // Capture Final CTA
    const finalCta = page.locator('.final-cta');
    await expect(finalCta).toBeVisible();
    await expect(finalCta).toHaveScreenshot('homepage-final-cta-dark.png');
  });

  test('Homepage Hero & Showcase — Light Mode Visual Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'false');
      window.FinProTheme.apply(false);
    });
    await page.waitForTimeout(400);

    // Capture showcase card
    const showcase = page.locator('.showcase-card');
    await expect(showcase).toBeVisible();
    await expect(showcase).toHaveScreenshot('homepage-showcase-light.png');

    // Capture Final CTA
    const finalCta = page.locator('.final-cta');
    await expect(finalCta).toBeVisible();
    await expect(finalCta).toHaveScreenshot('homepage-final-cta-light.png');
  });
});
