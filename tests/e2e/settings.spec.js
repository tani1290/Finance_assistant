const { test, expect } = require('../fixtures/auth.fixture');

test.describe('Settings & Profile E2E Tests', () => {

  test('User profile and account settings page loads securely', async ({ authenticatedPage: page }) => {
    await page.goto('/profile.html');

    await expect(page).toHaveTitle(/Profile|FinPro/i);
    await expect(page.locator('#profileFullName')).toBeVisible();

    // Verify fields are present
    await expect(page.locator('#inputFirstName')).toBeVisible();
    await expect(page.locator('#inputLastName')).toBeVisible();
    await expect(page.locator('#inputEmail')).toBeVisible();
    await expect(page.locator('#inputUsername')).toBeVisible();
  });
});
