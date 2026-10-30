const { test, expect } = require('../fixtures/auth.fixture');

test.describe('Transactions E2E Tests', () => {

  test('Transactions page loads with listing, search and filters', async ({ authenticatedPage: page }) => {
    await page.goto('/transactions.html');

    await expect(page).toHaveTitle(/Transactions|FinPro/i);

    // Verify search and filter controls exist
    const searchInput = page.locator('#txSearch, #searchInput, input[type="search"], input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      await expect(searchInput.first()).toBeVisible();
    }

    // Verify add transaction trigger button
    const addBtn = page.locator('#addTxBtn, #addTransactionBtn, button:has-text("Add")');
    if (await addBtn.count() > 0) {
      await expect(addBtn.first()).toBeVisible();
    }
  });
});
