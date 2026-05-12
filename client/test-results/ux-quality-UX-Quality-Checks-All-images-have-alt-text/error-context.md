# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux-quality.spec.cjs >> UX Quality Checks >> All images have alt text
- Location: tests\e2e\ux-quality.spec.cjs:68:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:10000/
Call log:
  - navigating to "http://localhost:10000/", waiting until "load"

```

# Test source

```ts
  1   | const { test, expect } = require('@playwright/test');
  2   | const BASE = 'http://localhost:10000';
  3   | 
  4   | test.describe('UX Quality Checks', () => {
  5   | 
  6   |   test('No console errors on landing page', async ({ page }) => {
  7   |     const errors = [];
  8   |     page.on('console', msg => {
  9   |       if (msg.type() === 'error') errors.push(msg.text());
  10  |     });
  11  |     page.on('pageerror', err => errors.push(err.message));
  12  | 
  13  |     await page.goto(`${BASE}/`);
  14  |     await page.waitForTimeout(2000);
  15  | 
  16  |     const criticalErrors = errors.filter(e =>
  17  |       !e.includes('favicon') &&
  18  |       !e.includes('404') &&
  19  |       !e.includes('net::ERR')
  20  |     );
  21  | 
  22  |     console.log(criticalErrors.length === 0
  23  |       ? 'PASS ✅ No console errors on landing'
  24  |       : `FAIL ❌ Console errors: ${criticalErrors.join(' | ')}`);
  25  |   });
  26  | 
  27  |   test('No console errors on login page', async ({ page }) => {
  28  |     const errors = [];
  29  |     page.on('console', msg => {
  30  |       if (msg.type() === 'error') errors.push(msg.text());
  31  |     });
  32  |     await page.goto(`${BASE}/login`);
  33  |     await page.waitForTimeout(1500);
  34  |     console.log(errors.length === 0
  35  |       ? 'PASS ✅ No console errors on /login'
  36  |       : `FAIL ❌ Errors: ${errors.slice(0,3).join(' | ')}`);
  37  |   });
  38  | 
  39  |   test('All buttons have minimum touch target size (44px)', async ({ page }) => {
  40  |     await page.goto(`${BASE}/login`);
  41  |     await page.waitForTimeout(500);
  42  | 
  43  |     const smallButtons = await page.evaluate(() => {
  44  |       const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  45  |       return buttons
  46  |         .filter(el => {
  47  |           const rect = el.getBoundingClientRect();
  48  |           return rect.width > 0 && rect.height > 0 &&
  49  |             (rect.width < 44 || rect.height < 44);
  50  |         })
  51  |         .map(el => ({
  52  |           text: el.textContent?.trim().slice(0, 30),
  53  |           w: Math.round(el.getBoundingClientRect().width),
  54  |           h: Math.round(el.getBoundingClientRect().height),
  55  |         }));
  56  |     });
  57  | 
  58  |     if (smallButtons.length === 0) {
  59  |       console.log('PASS ✅ All touch targets ≥ 44px');
  60  |     } else {
  61  |       console.log(`WARNING 🟡 ${smallButtons.length} small touch targets:`);
  62  |       smallButtons.slice(0, 5).forEach(b =>
  63  |         console.log(`  "${b.text}" → ${b.w}×${b.h}px`)
  64  |       );
  65  |     }
  66  |   });
  67  | 
  68  |   test('All images have alt text', async ({ page }) => {
> 69  |     await page.goto(`${BASE}/`);
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:10000/
  70  |     await page.waitForTimeout(500);
  71  | 
  72  |     const noAlt = await page.evaluate(() =>
  73  |       Array.from(document.querySelectorAll('img'))
  74  |         .filter(img => !img.alt || img.alt.trim() === '')
  75  |         .map(img => img.src.split('/').pop())
  76  |     );
  77  | 
  78  |     console.log(noAlt.length === 0
  79  |       ? 'PASS ✅ All images have alt text'
  80  |       : `FAIL ❌ Images missing alt: ${noAlt.join(', ')}`);
  81  |   });
  82  | 
  83  |   test('Keyboard navigation: Tab reaches main interactive elements', async ({ page }) => {
  84  |     await page.goto(`${BASE}/login`);
  85  |     await page.waitForTimeout(500);
  86  | 
  87  |     // Tab through the page
  88  |     const focusedElements = [];
  89  |     for (let i = 0; i < 6; i++) {
  90  |       await page.keyboard.press('Tab');
  91  |       const focused = await page.evaluate(() => {
  92  |         const el = document.activeElement;
  93  |         return {
  94  |           tag: el?.tagName,
  95  |           type: el?.type,
  96  |           text: el?.textContent?.trim().slice(0, 20),
  97  |         };
  98  |       });
  99  |       focusedElements.push(focused);
  100 |     }
  101 | 
  102 |     const reachesInput = focusedElements.some(
  103 |       el => el.tag === 'INPUT' || el.tag === 'BUTTON'
  104 |     );
  105 |     console.log(reachesInput
  106 |       ? 'PASS ✅ Keyboard Tab reaches inputs and buttons'
  107 |       : 'FAIL ❌ Tab navigation not reaching interactive elements');
  108 |   });
  109 | 
  110 |   test('No horizontal scroll on mobile viewport', async ({ page }) => {
  111 |     await page.setViewportSize({ width: 390, height: 844 });
  112 |     await page.goto(`${BASE}/login`);
  113 |     await page.waitForTimeout(500);
  114 | 
  115 |     const hasHorizontalScroll = await page.evaluate(() =>
  116 |       document.documentElement.scrollWidth > document.documentElement.clientWidth
  117 |     );
  118 |     console.log(!hasHorizontalScroll
  119 |       ? 'PASS ✅ No horizontal scroll on mobile'
  120 |       : 'FAIL ❌ Horizontal scroll detected on 390px viewport');
  121 |   });
  122 | 
  123 |   test('Context: Locked visible in bottom bar (authenticated)', async ({ page }) => {
  124 |     await page.goto(`${BASE}/app`);
  125 |     await page.waitForTimeout(1000);
  126 | 
  127 |     const url = page.url();
  128 |     if (url.includes('login') || url.includes('onboarding')) {
  129 |       console.log('SKIP ⚪ Requires auth');
  130 |       return;
  131 |     }
  132 | 
  133 |     const contextBar = page.locator('text=/Context.*Locked/i, text=/Dual-Agent/i');
  134 |     const visible = await contextBar.isVisible().catch(() => false);
  135 |     console.log(visible
  136 |       ? 'PASS ✅ ContextBar visible with status'
  137 |       : 'WARNING 🟡 ContextBar or status text not found');
  138 |   });
  139 | 
  140 | });
  141 | 
```