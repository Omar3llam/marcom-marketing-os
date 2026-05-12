# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: onboarding.spec.cjs >> Onboarding Wizard UI >> Onboarding page renders step 1
- Location: tests\e2e\onboarding.spec.cjs:6:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:10000/onboarding
Call log:
  - navigating to "http://localhost:10000/onboarding", waiting until "load"

```

# Test source

```ts
  1  | const { test, expect } = require('@playwright/test');
  2  | const BASE = 'http://localhost:10000';
  3  | 
  4  | test.describe('Onboarding Wizard UI', () => {
  5  | 
  6  |   test('Onboarding page renders step 1', async ({ page }) => {
  7  |     // Navigate directly (auth guard may redirect, that's OK for UI test)
> 8  |     await page.goto(`${BASE}/onboarding`);
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:10000/onboarding
  9  |     await page.waitForTimeout(1000);
  10 | 
  11 |     const url = page.url();
  12 |     if (url.includes('login')) {
  13 |       console.log('SKIP ⚪ Onboarding requires auth — manual test needed');
  14 |       return;
  15 |     }
  16 | 
  17 |     // Step 1 elements
  18 |     await expect(page.locator('input[placeholder*="Acme"], input[name="companyName"]'))
  19 |       .toBeVisible({ timeout: 3000 });
  20 |     console.log('PASS ✅ Onboarding step 1 renders');
  21 |   });
  22 | 
  23 |   test('Continue button disabled until required fields filled', async ({ page }) => {
  24 |     await page.goto(`${BASE}/onboarding`);
  25 |     await page.waitForTimeout(500);
  26 | 
  27 |     const url = page.url();
  28 |     if (url.includes('login')) {
  29 |       console.log('SKIP ⚪ Requires auth');
  30 |       return;
  31 |     }
  32 | 
  33 |     const continueBtn = page.locator(
  34 |       'button:has-text("Continue"), button:has-text("Next")'
  35 |     ).first();
  36 | 
  37 |     // Before filling
  38 |     await continueBtn.click();
  39 |     await page.waitForTimeout(300);
  40 |     const stillOnStep1 = await page.locator('input[placeholder*="Acme"]').isVisible();
  41 |     console.log(stillOnStep1
  42 |       ? 'PASS ✅ Cannot advance without required fields'
  43 |       : 'FAIL ❌ Wizard advances without required fields');
  44 |   });
  45 | 
  46 | });
  47 | 
```