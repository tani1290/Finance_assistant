const { test, expect } = require('@playwright/test');

test.describe('Authentication Visual Regression Tests', () => {

  test('Login Page Card — Dark Mode Visual Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login.html');

    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'true');
      window.FinProTheme.apply(true);
    });
    await page.waitForTimeout(400);

    const card = page.locator('.card');
    await expect(card).toBeVisible();
    await expect(card).toHaveScreenshot('login-card-dark.png', {
      mask: [page.locator('#googleBtnContainer')],
    });
  });

  test('Login Page Card — Light Mode Visual Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login.html');

    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'false');
      window.FinProTheme.apply(false);
    });
    await page.waitForTimeout(400);

    const card = page.locator('.card');
    await expect(card).toBeVisible();
    await expect(card).toHaveScreenshot('login-card-light.png', {
      mask: [page.locator('#googleBtnContainer')],
    });
  });

  test('Signup Page Card — Dark Mode Visual Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/signup.html');

    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'true');
      window.FinProTheme.apply(true);
    });
    await page.waitForTimeout(400);

    const card = page.locator('.card');
    await expect(card).toBeVisible();
    await expect(card).toHaveScreenshot('signup-card-dark.png', {
      mask: [page.locator('#googleBtnContainer')],
    });
  });

  test('Signup Page Card — Light Mode Visual Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/signup.html');

    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'false');
      window.FinProTheme.apply(false);
    });
    await page.waitForTimeout(400);

    const card = page.locator('.card');
    await expect(card).toBeVisible();
    await expect(card).toHaveScreenshot('signup-card-light.png', {
      mask: [page.locator('#googleBtnContainer')],
    });
  });
});
