// Built public-route verification: P8_06A_PREVIEW_URL=http://localhost:10000 node src/lumi/__tests__/landingBrand.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const url = process.env.P8_06A_PREVIEW_URL || 'http://localhost:10000';
const out = process.env.P8_06A_EVIDENCE_DIR;
const tokens = fs.readFileSync(path.resolve(__dirname, '../../../design-system/foundation/generated/tokens.css'), 'utf8');
const enlarged = [...tokens.matchAll(/(--lumi-type-[\w-]+-(?:size|line-height)):\s*([\d.]+)px/g)]
  .map(match => `${match[1]}: ${Number(match[2]) * 2}px;`).join('\n');
const widths = [320, 360, 390, 687, 688, 768, 1095, 1096, 1100, 1440];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const evidence = { cases: [], errors: [], privateRequests: [] };
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => evidence.errors.push(error.message));
    page.on('request', request => { if (/\/api\//.test(request.url())) evidence.privateRequests.push(request.url()); });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await page.locator('#hero-title').waitFor();
      await page.evaluate(() => document.fonts.ready);
      for (const scale of [1, 2]) {
        if (scale === 2) await page.addStyleTag({ content: `:root { ${enlarged} }` });
        const brands = page.getByRole('link', { name: 'LUMI', exact: true });
        assert.equal(await brands.count(), 2);
        const measurements = await brands.evaluateAll(links => links.map(link => {
          const images = [...link.querySelectorAll('img')].filter(image => image.getBoundingClientRect().width > 0);
          const image = images[0];
          const rect = image?.getBoundingClientRect();
          return { parent: link.closest('header') ? 'header' : 'footer', href: link.getAttribute('href'), visibleCount: images.length,
            src: image?.getAttribute('src'), loaded: image?.complete && image?.naturalWidth > 0,
            rect: rect?.toJSON(), target: link.getBoundingClientRect().toJSON(), scrollWidth: document.documentElement.scrollWidth };
        }));
        for (const m of measurements) {
          assert.equal(m.href, '/');
          assert.equal(m.visibleCount, 1);
          assert.equal(m.loaded, true);
          assert.equal(m.scrollWidth, width, 'No document overflow');
          const ratio = 378.67 / (m.parent === 'header' ? 234.85 : 344.42);
          assert(Math.abs(m.rect.width / m.rect.height - ratio) < 0.002, 'Original proportions preserved');
          assert(m.src.includes(m.parent === 'header' ? 'lumi-symbol-v1' : 'lumi-primary-lockup-v1'));
          assert(!m.src.startsWith('data:'), 'Approved SVG remains an external static resource');
          assert(m.rect.left >= 0 && m.rect.right <= width, 'Logo inside viewport');
          assert(m.rect.top >= m.target.top - 1 && m.rect.bottom <= m.target.bottom + 1, 'Logo inside home link');
        }
        const collision = await page.locator('header').evaluate(header => {
          const logo = header.querySelector('[data-lumi-brand]').getBoundingClientRect();
          return [...header.querySelectorAll('a:not([data-lumi-brand])')].some(link => {
            const r = link.getBoundingClientRect();
            return r.width > 0 && r.left < logo.right && r.right > logo.left && r.top < logo.bottom && r.bottom > logo.top;
          });
        });
        assert.equal(collision, false, 'Header identity does not collide with navigation/account controls');
        evidence.cases.push({ width, scale, measurements });
        if (out && [320, 1440].includes(width)) {
          fs.mkdirSync(out, { recursive: true });
          await page.locator('header').screenshot({ path: path.join(out, `after-header-${width}-text${scale}.png`) });
          await page.locator('footer').screenshot({ path: path.join(out, `after-footer-${width}-text${scale}.png`) });
        }
      }
      console.log(`PASS: official brand fit, proportions and identity at ${width}px / 100% and 200% text`);
    }

    await page.goto(url);
    await page.keyboard.press('Tab'); // Document skip link.
    await page.keyboard.press('Tab'); // Header home link.
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-lumi-brand')), 'v1');
    const focus = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), colour: s.outlineColor };
    });
    assert.equal(focus.style, 'solid');
    assert(focus.width >= 2);
    evidence.focus = focus;
    if (out) await page.locator('header').screenshot({ path: path.join(out, 'header-keyboard-focus.png') });
    await page.keyboard.press('Enter');
    assert.equal(new URL(page.url()).pathname, '/');
    let footerFocused = false;
    for (let count = 0; count < 80 && !footerFocused; count += 1) {
      await page.keyboard.press('Tab');
      footerFocused = await page.evaluate(() => Boolean(document.activeElement?.closest('footer') && document.activeElement?.matches('[data-lumi-brand]')));
    }
    assert.equal(footerFocused, true, 'Footer home link is reachable by real keyboard traversal');
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid');
    if (out) await page.locator('footer').screenshot({ path: path.join(out, 'footer-keyboard-focus.png') });
    await page.keyboard.press('Enter');
    assert.equal(new URL(page.url()).pathname, '/');

    await page.route('**/*.svg', route => route.abort());
    await page.reload();
    await page.getByRole('link', { name: 'LUMI', exact: true }).first().getByText('LUMI', { exact: true }).first().waitFor();
    for (const brand of await page.getByRole('link', { name: 'LUMI', exact: true }).all()) {
      assert.equal((await brand.innerText()).trim(), 'LUMI', 'One readable image-failure fallback per link');
      assert.equal(await brand.getAttribute('href'), '/');
    }
    await page.setViewportSize({ width: 320, height: 900 });
    await page.addStyleTag({ content: `:root { ${enlarged} }` });
    const fallbackEscapes = await page.getByRole('link', { name: 'LUMI', exact: true }).evaluateAll(links => links.filter(link => {
      const bounds = link.getBoundingClientRect();
      const spans = [...link.querySelectorAll('span')].filter(span => span.getBoundingClientRect().width > 0);
      return spans.some(span => {
        const range = document.createRange();
        range.selectNodeContents(span);
        return [...range.getClientRects()].some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1);
      });
    }).map(link => link.outerHTML));
    assert.deepEqual(fallbackEscapes, [], 'Enlarged readable fallback remains inside its focusable link');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    evidence.imageFailureFallback = true;
    assert.deepEqual(evidence.errors, []);
    assert.deepEqual(evidence.privateRequests, []);
    if (out) fs.writeFileSync(path.join(out, 'browser-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log('PASS: keyboard focus/home behavior, image-failure fallback and no private requests');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
