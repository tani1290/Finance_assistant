const { test, expect } = require('@playwright/test');

/**
 * The welcome overlay is decorative: it must appear on a first/direct visit,
 * disappear on its own, never repeat on internal navigation, and never render
 * at all for a signed-in visitor.
 */
test.describe('Homepage Welcome Overlay', () => {

  test('shows on a first visit, holds for about two seconds, then fades out', async ({ page }) => {
    await page.goto('/');

    const overlay = page.locator('#welcomeOverlay');
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toHaveClass(/is-visible/);

    // Still on screen well into the hold, so it is not dismissed instantly.
    await page.waitForTimeout(800);
    await expect(overlay).toBeVisible();

    // The script removes the node once the fade finishes.
    await expect(overlay).toHaveCount(0, { timeout: 5000 });

    const seen = await page.evaluate(() => sessionStorage.getItem('jf_welcome_seen'));
    expect(seen).toBe('1');
  });

  test('does not repeat when navigating back to the homepage in the same session', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#welcomeOverlay')).toHaveCount(0, { timeout: 6000 });

    await page.goto('/login.html');
    await page.goto('/');

    // Internal navigation is a fresh document load but not a reload, so the
    // session flag keeps the overlay away. The markup stays in the document —
    // CSS keeps it hidden until html.welcome-pending opts in.
    await expect(page.locator('#welcomeOverlay')).toBeHidden();
    await expect(page.locator('html')).not.toHaveClass(/welcome-pending/);
    await expect(page.locator('.hero h1')).toBeVisible();
  });

  test('is skipped entirely for a signed-in visitor', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('jf_access_token', 'test-token');
    });

    await page.goto('/');

    // The early redirect sends authenticated visitors straight to the app.
    await expect(page).toHaveURL(/dashboard\.html/);
    await expect(page.locator('#welcomeOverlay')).toHaveCount(0);
  });

  test('respects prefers-reduced-motion and still dismisses itself', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const overlay = page.locator('#welcomeOverlay');
    await expect(overlay).toHaveClass(/is-visible/);
    await expect(overlay).toHaveCount(0, { timeout: 4000 });
  });
});
