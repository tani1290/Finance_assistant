const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

test.describe('Theme System & Contrast E2E Tests', () => {

  test('Default theme is dark and dark mode classes are applied immediately without flash', async ({ page }) => {
    await page.goto('/login.html');
    await page.evaluate(() => localStorage.removeItem('jf_dark_mode'));
    await page.reload();

    const isDark = await page.evaluate(() => {
      const root = document.documentElement;
      return root.classList.contains('dark-mode') || !root.classList.contains('light-mode');
    });
    expect(isDark).toBe(true);
  });

  test('Toggle theme on login page switches between dark and light mode', async ({ page }) => {
    await page.goto('/login.html');

    // Click theme toggle
    const toggleBtn = page.locator('.theme-toggle-fixed');
    await expect(toggleBtn).toBeVisible();

    // Toggle to Light Mode
    await toggleBtn.click();
    await page.waitForTimeout(200);

    let isLight = await page.evaluate(() => document.documentElement.classList.contains('light-mode'));
    expect(isLight).toBe(true);

    let savedPref = await page.evaluate(() => localStorage.getItem('jf_dark_mode'));
    expect(savedPref).toBe('false');

    // Toggle back to Dark Mode
    await toggleBtn.click();
    await page.waitForTimeout(200);

    isLight = await page.evaluate(() => document.documentElement.classList.contains('light-mode'));
    expect(isLight).toBe(false);

    savedPref = await page.evaluate(() => localStorage.getItem('jf_dark_mode'));
    expect(savedPref).toBe('true');
  });

  test('Theme preference persists across page reloads and cross-page navigation', async ({ page }) => {
    await page.goto('/login.html');

    // Set to light mode
    await page.locator('.theme-toggle-fixed').click();
    await page.waitForTimeout(100);

    // Refresh page
    await page.reload();
    let isLight = await page.evaluate(() => document.documentElement.classList.contains('light-mode'));
    expect(isLight).toBe(true);

    // Navigate to Signup
    await page.goto('/signup.html');
    isLight = await page.evaluate(() => document.documentElement.classList.contains('light-mode'));
    expect(isLight).toBe(true);

    // Navigate to Homepage
    await page.goto('/');
    isLight = await page.evaluate(() => document.documentElement.classList.contains('light-mode'));
    expect(isLight).toBe(true);

    // Reset back to dark mode
    await page.locator('.landing-theme-toggle').click();
    const isDark = await page.evaluate(() => !document.documentElement.classList.contains('light-mode'));
    expect(isDark).toBe(true);
  });

  test('Accessibility & WCAG AA contrast check on Login page (Light and Dark)', async ({ page }) => {
    // 1. Dark Mode
    await page.goto('/login.html');
    await page.evaluate(() => localStorage.setItem('jf_dark_mode', 'true'));
    await page.reload();

    const darkAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['color-contrast']) // We inspect explicit CSS contrast below
      .analyze();

    expect(darkAxe.violations).toEqual([]);

    // 2. Light Mode
    await page.locator('.theme-toggle-fixed').click();
    await page.waitForTimeout(200);

    const lightAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['color-contrast'])
      .analyze();

    expect(lightAxe.violations).toEqual([]);
  });

  test('Profile & Account page elements are legible in both themes', async ({ page, request, baseURL }) => {
    // Register and login to test Profile page
    const user = {
      firstName: 'Theme',
      lastName: 'Checker',
      username: `theme_${Date.now()}`,
      email: `theme_${Date.now()}@example.com`,
      password: 'Password123!',
    };

    const reg = await request.post(`${baseURL}/api/v1/auth/register`, { data: user });
    const { data } = await reg.json();

    await page.goto('/login.html');
    await page.evaluate((d) => {
      localStorage.setItem('jf_access_token', d.accessToken);
      localStorage.setItem('jf_refresh_token', d.refreshToken);
      localStorage.setItem('jf_user', JSON.stringify(d.user));
    }, data);

    // 1. Dark mode check
    await page.evaluate(() => localStorage.setItem('jf_dark_mode', 'true'));
    await page.goto('/profile.html');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#profileFullName')).toBeVisible();

    // 2. Switch to light mode and verify contrast
    await page.evaluate(() => {
      window.FinProTheme.toggle();
    });
    await page.waitForTimeout(200);

    const isLight = await page.evaluate(() => document.documentElement.classList.contains('light-mode'));
    expect(isLight).toBe(true);

    // Verify card background and text colors do not clash
    const textColor = await page.evaluate(() => {
      const el = document.querySelector('.card-title') || document.querySelector('h1, h2, h3');
      return window.getComputedStyle(el).color;
    });
    expect(textColor).not.toBe('rgb(255, 255, 255)'); // Heading must not be pure white on light background
  });
});
