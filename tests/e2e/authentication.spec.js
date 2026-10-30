const { test, expect } = require('@playwright/test');
const { testUser } = require('../fixtures/test-data');

test.describe('Authentication E2E & Google Sign-In Tests', () => {

  test('Registration page renders with exactly one Google button and valid fields', async ({ page }) => {
    await page.goto('/signup.html');

    // Title and branding
    await expect(page).toHaveTitle(/FinPro/i);
    await expect(page.locator('.brand-name')).toContainText('FinPro');

    // Form fields present
    await expect(page.locator('#firstName')).toBeVisible();
    await expect(page.locator('#lastName')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#submitBtn')).toBeVisible();

    // Exactly one Google authentication container
    const googleBtns = page.locator('#googleBtnContainer');
    await expect(googleBtns).toHaveCount(1);
    await expect(page.locator('#googleSignInBtn')).toBeVisible();

    // Verify label contains "Continue with Google"
    await expect(page.locator('#googleBtnContainer')).toContainText('Continue with Google');

    // Verify no duplicate Google actions (button or GIS iframe)
    const googleActions = page.locator('#googleBtnContainer button, #googleBtnContainer iframe');
    await expect(googleActions).toHaveCount(1);
  });

  test('Password strength indicator responds dynamically', async ({ page }) => {
    await page.goto('/signup.html');

    const pwdInput = page.locator('#password');
    const strengthFill = page.locator('#strengthFill');
    const strengthText = page.locator('#strengthText');

    await expect(strengthText).toHaveText('Enter a password');

    // Type weak password
    await pwdInput.fill('abc');
    await expect(strengthText).toHaveText('Too weak');

    // Type medium password
    await pwdInput.fill('Abcdefgh1');
    await expect(strengthText).toHaveText(/Good|Strong/);

    // Type strong password
    await pwdInput.fill('P@ssw0rd123!Safe');
    await expect(strengthText).toHaveText('Strong');
  });

  test('Registration validation triggers on empty or invalid inputs', async ({ page }) => {
    await page.goto('/signup.html');

    // Submit empty form
    await page.locator('#submitBtn').click();

    // Email error should show
    await expect(page.locator('#emailError')).toHaveClass(/show/);
  });

  test('Login page renders with exactly one Google button and valid fields', async ({ page }) => {
    await page.goto('/login.html');

    await expect(page).toHaveTitle(/FinPro/i);
    await expect(page.locator('#emailInput')).toBeVisible();
    await expect(page.locator('#passwordInput')).toBeVisible();
    await expect(page.locator('#loginBtn')).toBeVisible();

    // Exactly one Google button container
    await expect(page.locator('#googleBtnContainer')).toHaveCount(1);
    await expect(page.locator('#googleSignInBtn')).toBeVisible();
    await expect(page.locator('#googleBtnContainer')).toContainText('Continue with Google');

    // No duplicate Google actions (button or GIS iframe)
    const googleActions = page.locator('#googleBtnContainer button, #googleBtnContainer iframe');
    await expect(googleActions).toHaveCount(1);
  });

  test('Login fails gracefully with invalid credentials', async ({ page }) => {
    await page.goto('/login.html');

    await page.locator('#emailInput').fill('nonexistent@example.com');
    await page.locator('#passwordInput').fill('WrongPassword123!');
    await page.locator('#loginBtn').click();

    // Error alert should be displayed
    const alert = page.locator('#loginAlert');
    await expect(alert).toHaveClass(/show/);
    await expect(alert).toContainText(/invalid|not found|error/i);
  });

  test('Public auth config endpoint returns configured Google Client ID', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/v1/auth/config`);
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.googleClientId).toBeDefined();
    expect(data.data.googleClientId).toContain('apps.googleusercontent.com');
  });

  test('Protected routes redirect unauthenticated users to login', async ({ page }) => {
    // Clear any existing tokens
    await page.goto('/login.html');
    await page.evaluate(() => localStorage.clear());

    // Try navigating to profile.html
    await page.goto('/profile.html');
    await page.waitForURL(/login\.html/, { timeout: 10000 });
    expect(page.url()).toContain('/login.html');
  });

  test('Full registration, login, and logout flow', async ({ page }) => {
    const uniqueUser = {
      firstName: 'Playwright',
      lastName: 'Tester',
      username: `pw_${Date.now()}`,
      email: `pw_${Date.now()}@testfinpro.org`,
      password: 'SecurePassword123!',
    };

    // 1. Sign up
    await page.goto('/signup.html');
    await page.locator('#firstName').fill(uniqueUser.firstName);
    await page.locator('#lastName').fill(uniqueUser.lastName);
    await page.locator('#email').fill(uniqueUser.email);
    await page.locator('#username').fill(uniqueUser.username);
    await page.locator('#password').fill(uniqueUser.password);
    await page.locator('#submitBtn').click();

    // Wait for redirect to onboarding or dashboard
    await page.waitForURL(/\/(onboarding|dashboard)\.html/, { timeout: 15000 });

    // Verify tokens were saved in localStorage
    const token = await page.evaluate(() => localStorage.getItem('jf_access_token'));
    expect(token).toBeTruthy();

    // 2. Logout
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login.html');

    // 3. Login with newly created user
    await page.locator('#emailInput').fill(uniqueUser.email);
    await page.locator('#passwordInput').fill(uniqueUser.password);
    await page.locator('#loginBtn').click();

    await page.waitForURL(/\/dashboard\.html/, { timeout: 15000 });
    expect(page.url()).toContain('/dashboard.html');
  });
});
