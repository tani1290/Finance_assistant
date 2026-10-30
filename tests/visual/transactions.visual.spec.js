const { test, expect } = require('../fixtures/auth.fixture');

test.describe('Transactions Visual Regression Tests', () => {

  test('Transactions Page — Dark Mode Visual Snapshot', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/transactions.html');

    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'true');
      if (window.FinProTheme?.apply) {
        window.FinProTheme.apply(true);
      } else {
        document.documentElement.classList.add('dark-mode');
        document.documentElement.classList.remove('light-mode');
      }
    });
    await page.waitForTimeout(600);

    const main = page.locator('.main-content');
    await expect(main).toBeVisible();
    await expect(main).toHaveScreenshot('transactions-main-dark.png', {
      mask: [page.locator('#txTableBody, .table-wrapper')],
    });
  });

  test('Transactions Page — Light Mode Visual Snapshot', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/transactions.html');

    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'false');
      if (window.FinProTheme?.apply) {
        window.FinProTheme.apply(false);
      } else {
        document.documentElement.classList.remove('dark-mode');
        document.documentElement.classList.add('light-mode');
      }
    });
    await page.waitForTimeout(600);

    const main = page.locator('.main-content');
    await expect(main).toBeVisible();
    await expect(main).toHaveScreenshot('transactions-main-light.png', {
      mask: [page.locator('#txTableBody, .table-wrapper')],
    });
  });
});
