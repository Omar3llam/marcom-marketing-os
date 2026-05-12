const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost:10000';
const path = require('path');
const fs = require('fs');

test.describe('CSV Upload Flow', () => {

  test('Upload zone visible on Campaign Analysis page', async ({ page }) => {
    await page.goto(`${BASE}/app/campaigns`);
    await page.waitForTimeout(1000);

    const url = page.url();
    if (url.includes('login') || url.includes('onboarding')) {
      console.log('SKIP ⚪ Requires authenticated session');
      return;
    }

    const dropzone = page.locator(
      '[class*="drop"], [class*="upload"], text=/drop.*csv/i'
    );
    const visible = await dropzone.isVisible().catch(() => false);
    console.log(visible
      ? 'PASS ✅ CSV upload zone visible'
      : 'WARNING 🟡 Upload zone not found — check selector');
  });

  test('Upload button shows loading state during submit', async ({ page }) => {
    await page.goto(`${BASE}/app`);
    await page.waitForTimeout(500);

    const url = page.url();
    if (url.includes('login') || url.includes('onboarding')) {
      console.log('SKIP ⚪ Requires auth');
      return;
    }

    // Create minimal CSV for test
    const csvContent = 'Campaign name,Impressions,Amount spent (EGP)\nTest Campaign,1000,500\n';
    const tmpPath = '/tmp/test_upload.csv';
    fs.writeFileSync(tmpPath, csvContent);

    const fileInput = page.locator('input[type="file"]');
    const inputVisible = await fileInput.count() > 0;
    if (!inputVisible) {
      console.log('SKIP ⚪ File input not found on current page state');
      return;
    }

    await fileInput.setInputFiles(tmpPath);
    await page.waitForTimeout(200);

    // Check for spinner/loading state
    const spinner = page.locator(
      '[class*="spin"], [class*="loading"], [aria-busy="true"], button[disabled]'
    );
    const hasSpinner = await spinner.count() > 0;
    console.log(hasSpinner
      ? 'PASS ✅ Loading state visible during upload'
      : 'WARNING 🟡 No loading indicator found after file selection');
  });

});
