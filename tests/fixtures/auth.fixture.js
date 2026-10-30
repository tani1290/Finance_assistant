/**
 * FinPro — Playwright Authentication Fixture
 */

const { test: base } = require('@playwright/test');
const { testUser } = require('./test-data');

/**
 * Extended Playwright test with pre-authenticated page fixture
 */
const test = base.extend({
  authenticatedPage: async ({ page, request, baseURL }, use) => {
    // 1. Register or login user via backend API
    const regRes = await request.post(`${baseURL}/api/v1/auth/register`, {
      data: testUser,
    });

    let tokens;
    if (regRes.ok()) {
      const body = await regRes.json();
      tokens = body.data;
    } else {
      // If already registered, login
      const loginRes = await request.post(`${baseURL}/api/v1/auth/login`, {
        data: {
          email: testUser.email,
          password: testUser.password,
        },
      });
      const body = await loginRes.json();
      tokens = body.data;
    }

    // 2. Set tokens in localStorage on page origin
    await page.goto(`${baseURL}/login.html`);
    await page.evaluate((data) => {
      localStorage.setItem('jf_access_token', data.accessToken);
      localStorage.setItem('jf_refresh_token', data.refreshToken);
      localStorage.setItem('jf_user', JSON.stringify(data.user));
    }, tokens);

    // 3. Provide authenticated page
    await use(page);
  },
});

module.exports = {
  test,
  expect: test.expect,
};
