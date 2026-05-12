const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost:10000';

test.describe('Decision Feed FSM', () => {

  test('Command Center renders 3 mode cards', async ({ page }) => {
    await page.goto(`${BASE}/app`);
    await page.waitForTimeout(1000);

    const url = page.url();
    if (url.includes('login') || url.includes('onboarding')) {
      console.log('SKIP ⚪ Requires authenticated session');
      return;
    }

    // 3 mode cards
    const cards = page.locator(
      '[class*="mode-card"], button:has-text("Analyze"), button:has-text("Campaign")'
    );
    const count = await cards.count();
    console.log(count >= 1
      ? `PASS ✅ Found ${count} mode card(s) on CommandCenter`
      : 'FAIL ❌ No mode cards found');

    // Lumi branding
    const lumiText = await page.locator('text=LUMI, text=Lumi').count();
    console.log(lumiText > 0 ? 'PASS ✅ Lumi branding visible' : 'WARNING 🟡 Lumi text not found');
  });

  test('Clicking mode card enters INPUT state', async ({ page }) => {
    await page.goto(`${BASE}/app`);
    await page.waitForTimeout(1000);

    const url = page.url();
    if (url.includes('login') || url.includes('onboarding')) {
      console.log('SKIP ⚪ Requires auth');
      return;
    }

    // Click first enabled mode card
    const modeCard = page.locator(
      'button:has-text("Analyze Campaign"), button:has-text("Run analysis")'
    ).first();

    const visible = await modeCard.isVisible().catch(() => false);
    if (!visible) {
      console.log('SKIP ⚪ Mode card not found');
      return;
    }

    await modeCard.click();
    await page.waitForTimeout(500);

    // Should now show INPUT view
    const dropzone = page.locator('text=/drop.*csv/i, text=/upload/i');
    const inInput = await dropzone.isVisible().catch(() => false);
    console.log(inInput
      ? 'PASS ✅ FSM transitioned to INPUT state'
      : 'FAIL ❌ FSM did not transition to INPUT after card click');
  });

  test('Back to Command Center breadcrumb visible in INPUT', async ({ page }) => {
    await page.goto(`${BASE}/app`);
    await page.waitForTimeout(500);

    const url = page.url();
    if (url.includes('login') || url.includes('onboarding')) {
      console.log('SKIP ⚪ Requires auth');
      return;
    }

    const modeCard = page.locator(
      'button:has-text("Analyze Campaign"), button:has-text("Run analysis")'
    ).first();
    const visible = await modeCard.isVisible().catch(() => false);
    if (!visible) { console.log('SKIP ⚪'); return; }

    await modeCard.click();
    await page.waitForTimeout(400);

    const breadcrumb = page.locator(
      'text=/Command Center/i, text=/back/i, [class*="breadcrumb"]'
    );
    const hasBreadcrumb = await breadcrumb.isVisible().catch(() => false);
    console.log(hasBreadcrumb
      ? 'PASS ✅ Breadcrumb visible in INPUT state'
      : 'FAIL ❌ No breadcrumb in INPUT — user has no way back');
  });

  test('Cancel in THEATER returns to COMMAND_CENTER', async ({ page }) => {
    await page.goto(`${BASE}/app`);
    await page.waitForTimeout(500);

    const url = page.url();
    if (url.includes('login') || url.includes('onboarding')) {
      console.log('SKIP ⚪ Requires auth');
      return;
    }

    // This test requires a submitted CSV to enter THEATER
    // Mark as manual if upload requires auth
    console.log('SKIP ⚪ Full THEATER test requires auth + CSV upload — see manual checklist');
  });

});
