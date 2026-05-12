# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: csv-upload.spec.cjs >> CSV Upload Flow >> Upload zone visible on Campaign Analysis page
- Location: tests\e2e\csv-upload.spec.cjs:8:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:10000/app/campaigns
Call log:
  - navigating to "http://localhost:10000/app/campaigns", waiting until "load"

```

# Test source

```ts
  1  | const { test, expect } = require('@playwright/test');
  2  | const BASE = 'http://localhost:10000';
  3  | const path = require('path');
  4  | const fs = require('fs');
  5  | 
  6  | test.describe('CSV Upload Flow', () => {
  7  | 
  8  |   test('Upload zone visible on Campaign Analysis page', async ({ page }) => {
> 9  |     await page.goto(`${BASE}/app/campaigns`);
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:10000/app/campaigns
  10 |     await page.waitForTimeout(1000);
  11 | 
  12 |     const url = page.url();
  13 |     if (url.includes('login') || url.includes('onboarding')) {
  14 |       console.log('SKIP ⚪ Requires authenticated session');
  15 |       return;
  16 |     }
  17 | 
  18 |     const dropzone = page.locator(
  19 |       '[class*="drop"], [class*="upload"], text=/drop.*csv/i'
  20 |     );
  21 |     const visible = await dropzone.isVisible().catch(() => false);
  22 |     console.log(visible
  23 |       ? 'PASS ✅ CSV upload zone visible'
  24 |       : 'WARNING 🟡 Upload zone not found — check selector');
  25 |   });
  26 | 
  27 |   test('Upload button shows loading state during submit', async ({ page }) => {
  28 |     await page.goto(`${BASE}/app`);
  29 |     await page.waitForTimeout(500);
  30 | 
  31 |     const url = page.url();
  32 |     if (url.includes('login') || url.includes('onboarding')) {
  33 |       console.log('SKIP ⚪ Requires auth');
  34 |       return;
  35 |     }
  36 | 
  37 |     // Create minimal CSV for test
  38 |     const csvContent = 'Campaign name,Impressions,Amount spent (EGP)\nTest Campaign,1000,500\n';
  39 |     const tmpPath = '/tmp/test_upload.csv';
  40 |     fs.writeFileSync(tmpPath, csvContent);
  41 | 
  42 |     const fileInput = page.locator('input[type="file"]');
  43 |     const inputVisible = await fileInput.count() > 0;
  44 |     if (!inputVisible) {
  45 |       console.log('SKIP ⚪ File input not found on current page state');
  46 |       return;
  47 |     }
  48 | 
  49 |     await fileInput.setInputFiles(tmpPath);
  50 |     await page.waitForTimeout(200);
  51 | 
  52 |     // Check for spinner/loading state
  53 |     const spinner = page.locator(
  54 |       '[class*="spin"], [class*="loading"], [aria-busy="true"], button[disabled]'
  55 |     );
  56 |     const hasSpinner = await spinner.count() > 0;
  57 |     console.log(hasSpinner
  58 |       ? 'PASS ✅ Loading state visible during upload'
  59 |       : 'WARNING 🟡 No loading indicator found after file selection');
  60 |   });
  61 | 
  62 | });
  63 | 
```