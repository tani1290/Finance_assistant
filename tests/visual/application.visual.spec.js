const { test, expect } = require('../fixtures/auth.fixture');

test.describe('Application Settings & Profile Visual Regression Tests', () => {

  test('Profile & Account Page — Dark Mode Visual Snapshot', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/profile.html');

    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'true');
      window.FinProTheme.apply(true);
    });
    await page.waitForTimeout(600);

    const main = page.locator('.main-content');
    await expect(main).toBeVisible();
    await expect(main).toHaveScreenshot('profile-main-dark.png', {
      mask: [page.locator('#profileFullName, #profileEmail, #inputFirstName, #inputLastName, #inputEmail, #inputUsername')],
    });
  });

  test('Profile & Account Page — Light Mode Visual Snapshot', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/profile.html');

    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'false');
      window.FinProTheme.apply(false);
    });
    await page.waitForTimeout(600);

    const main = page.locator('.main-content');
    await expect(main).toBeVisible();
    await expect(main).toHaveScreenshot('profile-main-light.png', {
      mask: [page.locator('#profileFullName, #profileEmail, #inputFirstName, #inputLastName, #inputEmail, #inputUsername')],
    });
  });
});
