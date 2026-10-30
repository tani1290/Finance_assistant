const { test, expect } = require('../fixtures/auth.fixture');

test.describe('Dashboard E2E Tests', () => {

  test('Authenticated user can view dashboard metrics, health score, and actions', async ({ authenticatedPage: page }) => {
    await page.goto('/dashboard.html');

    // Wait for dashboard to load
    await expect(page).toHaveTitle(/Dashboard|FinPro/i);
    await expect(page.locator('#welcomeMsg')).toBeVisible();

    // Verify key sections are present
    await expect(page.locator('#topbarThemeToggle')).toBeVisible();
    await expect(page.locator('#addMoneyBtn')).toBeVisible();
    await expect(page.locator('#marketTicker')).toBeVisible();

    // Verify health score ring is rendered
    await expect(page.locator('#healthRingFill')).toBeVisible();

    // Verify transactions card
    await expect(page.locator('#txList')).toBeVisible();
  });

  test('Add Money modal opens and closes correctly', async ({ authenticatedPage: page }) => {
    await page.goto('/dashboard.html');

    // Click Add Money
    const addMoneyBtn = page.locator('#addMoneyBtn');
    await expect(addMoneyBtn).toBeVisible();
    await addMoneyBtn.click();

    // Check modal opens
    const modal = page.locator('#addMoneyModal');
    await expect(modal).toHaveClass(/show|active/);

    // Close modal
    const closeBtn = page.locator('#closeModal, #addMoneyModal .modal-close');
    await closeBtn.first().click();
    await expect(modal).not.toHaveClass(/show/);
  });
});
