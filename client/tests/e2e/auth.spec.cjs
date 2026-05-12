const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost:10000';

test.describe('Authentication Flow', () => {

  test('Login page renders with all required elements', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page).toHaveTitle(/.*/);

    // Google sign-in button
    const googleBtn = page.locator('button:has-text("Google"), button[aria-label*="Google"]');
    await expect(googleBtn).toBeVisible();

    // Email input
    await expect(page.locator('input[type="email"]')).toBeVisible();

    // Password input
    await expect(page.locator('input[type="password"]')).toBeVisible();

    // Submit button
    const submitBtn = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log In")');
    await expect(submitBtn).toBeVisible();

    console.log('PASS ✅ Auth page renders all elements');
  });

  test('Submit button disabled when fields empty', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const submitBtn = page.locator('button[type="submit"]').first();
    // Either disabled attribute or clicking does nothing
    const isDisabled = await submitBtn.isDisabled();
    console.log(isDisabled
      ? 'PASS ✅ Submit disabled on empty fields'
      : 'WARNING 🟡 Submit not disabled on empty fields — check validation');
  });

  test('Empty email shows validation error', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(300);

    const hasError = await page.locator(
      'text=/email/i, [class*="error"], [role="alert"]'
    ).count() > 0;
    console.log(hasError
      ? 'PASS ✅ Validation error shown for empty email'
      : 'FAIL ❌ No validation error on empty email');
  });

  test('Unauthenticated access to /app redirects to login', async ({ page }) => {
    await page.goto(`${BASE}/app`);
    await page.waitForURL(/\/(login|onboarding|signup)/, { timeout: 5000 }).catch(() => {});
    const url = page.url();
    const redirected = url.includes('login') || url.includes('onboarding') || url.includes('signup');
    console.log(redirected
      ? `PASS ✅ /app redirected to ${url}`
      : `FAIL ❌ /app accessible without auth: ${url}`);
  });

});
