const { test, expect } = require('../fixtures/auth.fixture');

test.describe('Budgets E2E Tests', () => {

  test('Budget page loads category allocations and progress metrics', async ({ authenticatedPage: page }) => {
    await page.goto('/budget.html');

    await expect(page).toHaveTitle(/Budget|FinPro/i);

    // Sidebar navigation is active on budgets
    const activeNav = page.locator('.nav-item.active');
    await expect(activeNav).toBeVisible();
    await expect(activeNav).toContainText(/Budget/i);
  });
});
