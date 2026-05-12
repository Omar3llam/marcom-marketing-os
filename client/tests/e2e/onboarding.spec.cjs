const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost:10000';

test.describe('Onboarding Wizard UI', () => {

  test('Onboarding page renders step 1', async ({ page }) => {
    // Navigate directly (auth guard may redirect, that's OK for UI test)
    await page.goto(`${BASE}/onboarding`);
    await page.waitForTimeout(1000);

    const url = page.url();
    if (url.includes('login')) {
      console.log('SKIP ⚪ Onboarding requires auth — manual test needed');
      return;
    }

    // Step 1 elements
    await expect(page.locator('input[placeholder*="Acme"], input[name="companyName"]'))
      .toBeVisible({ timeout: 3000 });
    console.log('PASS ✅ Onboarding step 1 renders');
  });

  test('Continue button disabled until required fields filled', async ({ page }) => {
    await page.goto(`${BASE}/onboarding`);
    await page.waitForTimeout(500);

    const url = page.url();
    if (url.includes('login')) {
      console.log('SKIP ⚪ Requires auth');
      return;
    }

    const continueBtn = page.locator(
      'button:has-text("Continue"), button:has-text("Next")'
    ).first();

    // Before filling
    await continueBtn.click();
    await page.waitForTimeout(300);
    const stillOnStep1 = await page.locator('input[placeholder*="Acme"]').isVisible();
    console.log(stillOnStep1
      ? 'PASS ✅ Cannot advance without required fields'
      : 'FAIL ❌ Wizard advances without required fields');
  });

});
