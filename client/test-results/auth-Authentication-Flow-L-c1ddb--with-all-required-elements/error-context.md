# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.cjs >> Authentication Flow >> Login page renders with all required elements
- Location: tests\e2e\auth.spec.cjs:6:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:10000/login
Call log:
  - navigating to "http://localhost:10000/login", waiting until "load"

```

# Test source

```ts
  1  | const { test, expect } = require('@playwright/test');
  2  | const BASE = 'http://localhost:10000';
  3  | 
  4  | test.describe('Authentication Flow', () => {
  5  | 
  6  |   test('Login page renders with all required elements', async ({ page }) => {
> 7  |     await page.goto(`${BASE}/login`);
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:10000/login
  8  |     await expect(page).toHaveTitle(/.*/);
  9  | 
  10 |     // Google sign-in button
  11 |     const googleBtn = page.locator('button:has-text("Google"), button[aria-label*="Google"]');
  12 |     await expect(googleBtn).toBeVisible();
  13 | 
  14 |     // Email input
  15 |     await expect(page.locator('input[type="email"]')).toBeVisible();
  16 | 
  17 |     // Password input
  18 |     await expect(page.locator('input[type="password"]')).toBeVisible();
  19 | 
  20 |     // Submit button
  21 |     const submitBtn = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log In")');
  22 |     await expect(submitBtn).toBeVisible();
  23 | 
  24 |     console.log('PASS ✅ Auth page renders all elements');
  25 |   });
  26 | 
  27 |   test('Submit button disabled when fields empty', async ({ page }) => {
  28 |     await page.goto(`${BASE}/login`);
  29 |     const submitBtn = page.locator('button[type="submit"]').first();
  30 |     // Either disabled attribute or clicking does nothing
  31 |     const isDisabled = await submitBtn.isDisabled();
  32 |     console.log(isDisabled
  33 |       ? 'PASS ✅ Submit disabled on empty fields'
  34 |       : 'WARNING 🟡 Submit not disabled on empty fields — check validation');
  35 |   });
  36 | 
  37 |   test('Empty email shows validation error', async ({ page }) => {
  38 |     await page.goto(`${BASE}/login`);
  39 |     await page.fill('input[type="password"]', 'password123');
  40 |     await page.click('button[type="submit"]');
  41 |     await page.waitForTimeout(300);
  42 | 
  43 |     const hasError = await page.locator(
  44 |       'text=/email/i, [class*="error"], [role="alert"]'
  45 |     ).count() > 0;
  46 |     console.log(hasError
  47 |       ? 'PASS ✅ Validation error shown for empty email'
  48 |       : 'FAIL ❌ No validation error on empty email');
  49 |   });
  50 | 
  51 |   test('Unauthenticated access to /app redirects to login', async ({ page }) => {
  52 |     await page.goto(`${BASE}/app`);
  53 |     await page.waitForURL(/\/(login|onboarding|signup)/, { timeout: 5000 }).catch(() => {});
  54 |     const url = page.url();
  55 |     const redirected = url.includes('login') || url.includes('onboarding') || url.includes('signup');
  56 |     console.log(redirected
  57 |       ? `PASS ✅ /app redirected to ${url}`
  58 |       : `FAIL ❌ /app accessible without auth: ${url}`);
  59 |   });
  60 | 
  61 | });
  62 | 
```