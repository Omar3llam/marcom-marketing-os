# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: decision-feed.spec.cjs >> Decision Feed FSM >> Clicking mode card enters INPUT state
- Location: tests\e2e\decision-feed.spec.cjs:30:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:10000/app
Call log:
  - navigating to "http://localhost:10000/app", waiting until "load"

```

# Test source

```ts
  1   | const { test, expect } = require('@playwright/test');
  2   | const BASE = 'http://localhost:10000';
  3   | 
  4   | test.describe('Decision Feed FSM', () => {
  5   | 
  6   |   test('Command Center renders 3 mode cards', async ({ page }) => {
  7   |     await page.goto(`${BASE}/app`);
  8   |     await page.waitForTimeout(1000);
  9   | 
  10  |     const url = page.url();
  11  |     if (url.includes('login') || url.includes('onboarding')) {
  12  |       console.log('SKIP ⚪ Requires authenticated session');
  13  |       return;
  14  |     }
  15  | 
  16  |     // 3 mode cards
  17  |     const cards = page.locator(
  18  |       '[class*="mode-card"], button:has-text("Analyze"), button:has-text("Campaign")'
  19  |     );
  20  |     const count = await cards.count();
  21  |     console.log(count >= 1
  22  |       ? `PASS ✅ Found ${count} mode card(s) on CommandCenter`
  23  |       : 'FAIL ❌ No mode cards found');
  24  | 
  25  |     // Lumi branding
  26  |     const lumiText = await page.locator('text=LUMI, text=Lumi').count();
  27  |     console.log(lumiText > 0 ? 'PASS ✅ Lumi branding visible' : 'WARNING 🟡 Lumi text not found');
  28  |   });
  29  | 
  30  |   test('Clicking mode card enters INPUT state', async ({ page }) => {
> 31  |     await page.goto(`${BASE}/app`);
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:10000/app
  32  |     await page.waitForTimeout(1000);
  33  | 
  34  |     const url = page.url();
  35  |     if (url.includes('login') || url.includes('onboarding')) {
  36  |       console.log('SKIP ⚪ Requires auth');
  37  |       return;
  38  |     }
  39  | 
  40  |     // Click first enabled mode card
  41  |     const modeCard = page.locator(
  42  |       'button:has-text("Analyze Campaign"), button:has-text("Run analysis")'
  43  |     ).first();
  44  | 
  45  |     const visible = await modeCard.isVisible().catch(() => false);
  46  |     if (!visible) {
  47  |       console.log('SKIP ⚪ Mode card not found');
  48  |       return;
  49  |     }
  50  | 
  51  |     await modeCard.click();
  52  |     await page.waitForTimeout(500);
  53  | 
  54  |     // Should now show INPUT view
  55  |     const dropzone = page.locator('text=/drop.*csv/i, text=/upload/i');
  56  |     const inInput = await dropzone.isVisible().catch(() => false);
  57  |     console.log(inInput
  58  |       ? 'PASS ✅ FSM transitioned to INPUT state'
  59  |       : 'FAIL ❌ FSM did not transition to INPUT after card click');
  60  |   });
  61  | 
  62  |   test('Back to Command Center breadcrumb visible in INPUT', async ({ page }) => {
  63  |     await page.goto(`${BASE}/app`);
  64  |     await page.waitForTimeout(500);
  65  | 
  66  |     const url = page.url();
  67  |     if (url.includes('login') || url.includes('onboarding')) {
  68  |       console.log('SKIP ⚪ Requires auth');
  69  |       return;
  70  |     }
  71  | 
  72  |     const modeCard = page.locator(
  73  |       'button:has-text("Analyze Campaign"), button:has-text("Run analysis")'
  74  |     ).first();
  75  |     const visible = await modeCard.isVisible().catch(() => false);
  76  |     if (!visible) { console.log('SKIP ⚪'); return; }
  77  | 
  78  |     await modeCard.click();
  79  |     await page.waitForTimeout(400);
  80  | 
  81  |     const breadcrumb = page.locator(
  82  |       'text=/Command Center/i, text=/back/i, [class*="breadcrumb"]'
  83  |     );
  84  |     const hasBreadcrumb = await breadcrumb.isVisible().catch(() => false);
  85  |     console.log(hasBreadcrumb
  86  |       ? 'PASS ✅ Breadcrumb visible in INPUT state'
  87  |       : 'FAIL ❌ No breadcrumb in INPUT — user has no way back');
  88  |   });
  89  | 
  90  |   test('Cancel in THEATER returns to COMMAND_CENTER', async ({ page }) => {
  91  |     await page.goto(`${BASE}/app`);
  92  |     await page.waitForTimeout(500);
  93  | 
  94  |     const url = page.url();
  95  |     if (url.includes('login') || url.includes('onboarding')) {
  96  |       console.log('SKIP ⚪ Requires auth');
  97  |       return;
  98  |     }
  99  | 
  100 |     // This test requires a submitted CSV to enter THEATER
  101 |     // Mark as manual if upload requires auth
  102 |     console.log('SKIP ⚪ Full THEATER test requires auth + CSV upload — see manual checklist');
  103 |   });
  104 | 
  105 | });
  106 | 
```