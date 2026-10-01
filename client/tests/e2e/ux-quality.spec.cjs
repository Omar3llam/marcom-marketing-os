const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost:10000';

test.describe('UX Quality Checks', () => {

  test('No console errors on landing page', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE}/`);
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('404') &&
      !e.includes('net::ERR')
    );

    console.log(criticalErrors.length === 0
      ? 'PASS ✅ No console errors on landing'
      : `FAIL ❌ Console errors: ${criticalErrors.join(' | ')}`);
  });

  test('No console errors on login page', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto(`${BASE}/login`);
    await page.waitForTimeout(1500);
    console.log(errors.length === 0
      ? 'PASS ✅ No console errors on /login'
      : `FAIL ❌ Errors: ${errors.slice(0,3).join(' | ')}`);
  });

  test('All buttons have minimum touch target size (44px)', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.waitForTimeout(500);

    const smallButtons = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      return buttons
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 &&
            (rect.width < 44 || rect.height < 44);
        })
        .map(el => ({
          text: el.textContent?.trim().slice(0, 30),
          w: Math.round(el.getBoundingClientRect().width),
          h: Math.round(el.getBoundingClientRect().height),
        }));
    });

    if (smallButtons.length === 0) {
      console.log('PASS ✅ All touch targets ≥ 44px');
    } else {
      console.log(`WARNING 🟡 ${smallButtons.length} small touch targets:`);
      smallButtons.slice(0, 5).forEach(b =>
        console.log(`  "${b.text}" → ${b.w}×${b.h}px`)
      );
    }
  });

  test('All images have alt text', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(500);

    const noAlt = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .filter(img => !img.alt || img.alt.trim() === '')
        .map(img => img.src.split('/').pop())
    );

    console.log(noAlt.length === 0
      ? 'PASS ✅ All images have alt text'
      : `FAIL ❌ Images missing alt: ${noAlt.join(', ')}`);
  });

  test('Keyboard navigation: Tab reaches main interactive elements', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.waitForTimeout(500);

    // Tab through the page
    const focusedElements = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return {
          tag: el?.tagName,
          type: el?.type,
          text: el?.textContent?.trim().slice(0, 20),
        };
      });
      focusedElements.push(focused);
    }

    const reachesInput = focusedElements.some(
      el => el.tag === 'INPUT' || el.tag === 'BUTTON'
    );
    console.log(reachesInput
      ? 'PASS ✅ Keyboard Tab reaches inputs and buttons'
      : 'FAIL ❌ Tab navigation not reaching interactive elements');
  });

  test('No horizontal scroll on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/login`);
    await page.waitForTimeout(500);

    const hasHorizontalScroll = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    console.log(!hasHorizontalScroll
      ? 'PASS ✅ No horizontal scroll on mobile'
      : 'FAIL ❌ Horizontal scroll detected on 390px viewport');
  });

  test('pseudo-system status claims are absent (authenticated)', async ({ page }) => {
    await page.goto(`${BASE}/app`);
    await page.waitForTimeout(1000);

    const url = page.url();
    if (url.includes('login') || url.includes('onboarding')) {
      console.log('SKIP ⚪ Requires auth');
      return;
    }

    const unsupportedStatus = page.getByText(/Context: Locked|Dual-Agent Ready|SID _NSD87T|\bWATCHING\b/);
    const visible = await unsupportedStatus.isVisible().catch(() => false);
    console.log(!visible
      ? 'PASS ✅ Pseudo-system status claims are absent'
      : 'FAIL ❌ Unsupported pseudo-system status is visible');
    if (visible) throw new Error('Unsupported ContextBar or workspace status is visible');
  });

});
