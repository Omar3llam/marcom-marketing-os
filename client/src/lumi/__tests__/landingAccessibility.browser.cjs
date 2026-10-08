// Browser-layout regressions: run against a built public landing, independently
// of jsdom (which cannot measure reflow). Uses the existing Playwright dependency.
// P8_05_PREVIEW_URL=http://localhost:10000 node src/lumi/__tests__/landingAccessibility.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const tokens = fs.readFileSync(path.resolve(__dirname, '../../../design-system/foundation/generated/tokens.css'), 'utf8');
// Model text-only enlargement without scaling the available layout width.
// Double line-height as well as font size, as browser text enlargement does.
const enlargedType = [...tokens.matchAll(/(--lumi-type-[\w-]+-(?:size|line-height)):\s*([\d.]+)px/g)]
  .map((match) => `${match[1]}: ${Number(match[2]) * 2}px;`).join('\n');
const normalized = (text) => text.replace(/\s+/g, ' ').trim();

async function checkPage(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(process.env.P8_05_PREVIEW_URL || 'http://localhost:10000');
  await page.locator('#hero-title').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const originalText = normalized(await page.locator('main').innerText());
  const originalSize = await page.locator('#hero-title').evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  await page.addStyleTag({ content: `:root { ${enlargedType} }` });
  assert.equal(await page.locator('#hero-title').evaluate((element) => parseFloat(getComputedStyle(element).fontSize)), originalSize * 2);
  assert.equal(normalized(await page.locator('main').innerText()), originalText, 'Enlargement must not remove or replace any visible content');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, 'Enlarged landing must not require horizontal scrolling');

  const escaped = await page.locator(width === 320 ? '#hero-title' : '[data-landing-spine="model"] > li')
    .evaluateAll((elements) => elements.flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const failures = [];
      for (let node; (node = walker.nextNode());) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if ([...range.getClientRects()].some((rect) => rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1))) {
          failures.push(node.textContent.trim());
        }
      }
      return failures;
    }));
  assert.deepEqual(escaped, [], 'Every heading/stage text run must remain within its own reading region');
  assert.equal(await page.locator('[data-landing-spine="model"] button').count(), 7, 'All seven model stages remain present');
  const splitNames = await page.locator('[data-landing-spine="model"] button').evaluateAll((buttons) => buttons.filter((button) => {
    const range = document.createRange();
    range.selectNodeContents(button);
    return range.getClientRects().length !== 1;
  }).map((button) => button.textContent.trim()));
  assert.deepEqual(splitNames, [], 'Enlarged stage names remain whole, rather than breaking into letter fragments');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let failed = 0;
  try {
    const page = await browser.newPage();
    for (const width of [320, 688, 1096, 1440]) {
      try {
        await checkPage(page, width);
        console.log(`PASS: 200% text at ${width}px retains complete, non-overlapping content`);
      } catch (error) {
        failed += 1;
        console.error(`FAIL: 200% text at ${width}px: ${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }
  process.exitCode = failed ? 1 : 0;
})().catch((error) => { console.error(error); process.exitCode = 1; });
