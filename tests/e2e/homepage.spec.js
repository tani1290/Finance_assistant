const { test, expect } = require('@playwright/test');

test.describe('Homepage E2E & Content Contrast Tests', () => {

  test('Homepage renders hero, features, dashboard showcase, and CTA', async ({ page }) => {
    await page.goto('/');

    // Check title and brand
    await expect(page).toHaveTitle(/FinPro/i);
    await expect(page.locator('.brand-text')).toContainText('FinPro');

    // Navigation items
    await expect(page.locator('nav .nav-links')).toBeVisible();
    await expect(page.locator('.landing-theme-toggle')).toBeVisible();

    // Hero section
    await expect(page.locator('.hero h1')).toBeVisible();
    await expect(page.locator('.hero-ctas, .hero-cta-group')).toBeVisible();

    // Dashboard Showcase card
    const showcase = page.locator('.showcase-card');
    await expect(showcase).toBeVisible();
    await expect(showcase.locator('.greeting-text h4')).toContainText('Rahul');
    await expect(showcase.locator('.ai-insight-content h5')).toContainText('Gentle AI Recommendation for You');

    // Final CTA section
    const finalCta = page.locator('.final-cta');
    await expect(finalCta).toBeVisible();
    await expect(finalCta.locator('h2')).toContainText('Bring calm to your finances today.');
    await expect(finalCta.locator('.btn-hero-lg')).toBeVisible();

    // Footer
    await expect(page.locator('footer')).toBeVisible();
  });

  test('CTA Section and Dashboard Preview have readable text contrast in Light Mode', async ({ page }) => {
    await page.goto('/');

    // Ensure light mode
    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'false');
      window.FinProTheme.apply(false);
    });
    await page.waitForTimeout(200);

    // Verify Final CTA heading is dark text
    const ctaHeadingColor = await page.evaluate(() => {
      const h2 = document.querySelector('.final-cta h2');
      return window.getComputedStyle(h2).color;
    });
    // #0f172a translates to rgb(15, 23, 42)
    expect(ctaHeadingColor).toBe('rgb(15, 23, 42)');

    // Verify Gentle AI recommendation heading is dark emerald
    const aiHeadingColor = await page.evaluate(() => {
      const h5 = document.querySelector('.ai-insight-content h5');
      return window.getComputedStyle(h5).color;
    });
    // #065f46 translates to rgb(6, 95, 70)
    expect(aiHeadingColor).toBe('rgb(6, 95, 70)');
  });

  test('CTA Section and Dashboard Preview have readable text contrast in Dark Mode', async ({ page }) => {
    await page.goto('/');

    // Ensure dark mode
    await page.evaluate(() => {
      localStorage.setItem('jf_dark_mode', 'true');
      window.FinProTheme.apply(true);
    });
    await page.waitForTimeout(200);

    // Verify Final CTA heading is light text
    const ctaHeadingColor = await page.evaluate(() => {
      const h2 = document.querySelector('.final-cta h2');
      return window.getComputedStyle(h2).color;
    });
    // #f8fafc translates to rgb(248, 250, 252)
    expect(ctaHeadingColor).toBe('rgb(248, 250, 252)');

    // Verify Gentle AI recommendation heading is emerald green
    const aiHeadingColor = await page.evaluate(() => {
      const h5 = document.querySelector('.ai-insight-content h5');
      return window.getComputedStyle(h5).color;
    });
    // #34d399 translates to rgb(52, 211, 153)
    expect(aiHeadingColor).toBe('rgb(52, 211, 153)');
  });
});
