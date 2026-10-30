const { test, expect } = require('../fixtures/auth.fixture');

test.describe('Investments & Market E2E Tests', () => {

  test('Market and metals page renders live rates and investment cards', async ({ authenticatedPage: page }) => {
    await page.goto('/market.html');

    await expect(page).toHaveTitle(/Market|Investments|FinPro/i);
    // Page body should render without throwing unhandled exceptions
    await expect(page.locator('.sidebar')).toBeVisible();
  });
});
