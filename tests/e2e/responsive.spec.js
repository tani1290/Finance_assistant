const { test, expect } = require('@playwright/test');
const { viewports } = require('../fixtures/test-data');

test.describe('Responsive Layout Matrix Tests', () => {

  for (const [key, vp] of Object.entries(viewports)) {
    test(`Homepage does not have horizontal overflow on ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');

      // Wait for layout to settle
      await page.waitForLoadState('domcontentloaded');

      // Check for horizontal overflow
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });

      expect(hasOverflow).toBe(false);

      // Verify hero title is visible and readable
      await expect(page.locator('.hero h1')).toBeVisible();

      // Verify CTA button is clickable
      const ctaBtn = page.locator('.btn-hero-lg').first();
      await expect(ctaBtn).toBeVisible();
    });

    test(`Login page fits cleanly without horizontal overflow on ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/login.html');

      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });

      expect(hasOverflow).toBe(false);
      await expect(page.locator('#loginBtn')).toBeVisible();
      await expect(page.locator('#googleBtnContainer')).toBeVisible();
    });

    test(`Signup page fits cleanly without horizontal overflow on ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/signup.html');

      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });

      expect(hasOverflow).toBe(false);
      await expect(page.locator('#submitBtn')).toBeVisible();
      await expect(page.locator('#googleBtnContainer')).toBeVisible();
    });
  }
});
