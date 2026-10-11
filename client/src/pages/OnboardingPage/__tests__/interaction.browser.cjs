// Run from client/: node src/pages/OnboardingPage/__tests__/interaction.browser.cjs
// Computed browser evidence, not class-string assertions. No live APIs are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require('@playwright/test');
const { buildFixture } = require('./firstFrame.browser.cjs');
const output = process.env.P9_07_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-p9-07-'));
const result = { fixture: 'SYNTHETIC: actual components and compiled CSS; no authenticated runtime, OAuth or backend',
  cases: [], errors: [], externalRequests: [] };
const overrides = {
  '/hooks/useProjectId.js': 'export const useProjectId = () => ({ projectId: "synthetic", loading: false, refetch() {} });',
  '/lib/api.js': `export const api = {
    post(url) { if (url !== '/api/lumi/connections/sync') throw new Error('Unexpected synthetic operation');
      const f = window.__onboardingFixture; if (f.calls) f.calls.sync++; return new Promise(() => {}); },
    put(url) { if (url !== '/api/campaigns/me/context') throw new Error('Unexpected synthetic operation');
      window.__interactionSave.calls++; return window.__interactionSave.calls === 1
        ? Promise.reject(new Error('Synthetic save failure')) : new Promise(() => {}); }
  };`,
};
const labels = ['Workspace', 'Connect', 'Analyze', 'Verdict'];
const steps = ['name', 'connect', 'sync', 'ready'];
const controls = [
  { name: 'input', state: 'name-present', selector: 'input', action: 'next' },
  { name: 'primary', state: 'name-present', selector: 'button', action: 'next' },
  { name: 'ghost', state: 'connect-failed', selector: 'button:last-of-type', action: 'skip' },
  { name: 'disabled-primary', state: 'name-empty', selector: 'button', disabled: true },
  { name: 'disabled-ghost', state: 'connect-failed-saving', selector: 'button:last-of-type', disabled: true },
  { name: 'save-error-ghost', state: 'page-error', buttonName: 'Retry saving workspace', action: 'save' },
];
function check(record, name, fn) {
  try { fn(); } catch (error) { record.failures.push(`${name}: ${error.message}`); }
}
function luminance(color) {
  const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(a, b) {
  const channels = a.match(/[\d.]+/g).map(Number), surface = b.match(/[\d.]+/g).slice(0, 3).map(Number);
  if (channels.length === 4) a = `rgb(${channels.slice(0, 3).map((v, i) => v * channels[3] + surface[i] * (1 - channels[3])).join(',')})`;
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
function snapshot(element) {
  const s = getComputedStyle(element), r = element.getBoundingClientRect();
  let background = s.backgroundColor;
  const surfaces = [];
  for (let p = element.parentElement; p; p = p.parentElement) {
    const color = getComputedStyle(p).backgroundColor;
    if (color !== 'rgba(0, 0, 0, 0)') surfaces.push(color);
  }
  if (background === 'rgba(0, 0, 0, 0)') background = surfaces[0];
  return { focused: document.activeElement === element, focusVisible: element.matches(':focus-visible'),
    outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineOffset: s.outlineOffset, outlineColor: s.outlineColor,
    background, surfaces, color: s.color, fontSize: s.fontSize, fontWeight: s.fontWeight,
    borderColor: s.borderColor, radius: s.borderRadius, shadow: s.boxShadow,
    transition: s.transitionProperty, duration: s.transitionDuration, easing: s.transitionTimingFunction,
    animation: s.animationName, transform: s.transform, active: element.matches(':active'),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    opacity: s.opacity, visible: s.display !== 'none' && s.visibility === 'visible' && parseFloat(s.opacity) > 0,
    disabled: element.disabled, overflow: document.documentElement.scrollWidth > innerWidth,
    runningAnimations: element.getAnimations().filter(a => a.playState === 'running').length };
}
function staticFeedback(record, value, state) {
  check(record, `${state} static transition`, () => assert.equal(value.transition, 'none', 'no transition properties, including focus or color'));
  check(record, `${state} static animation`, () => {
    assert.equal(value.animation, 'none', 'no loading/decorative animation');
    assert.equal(value.runningAnimations, 0);
  });
  check(record, `${state} static geometry`, () => assert.equal(value.transform, 'none', 'no press scaling or positional transform'));
  check(record, `${state} no glow`, () => {
    const colors = [...value.shadow.matchAll(/rgba?\(([^)]+)\)/g)];
    assert.ok(value.shadow === 'none' || (colors.length > 0 && colors.every(([, color]) => {
      const channels = color.split(',').map(Number); return channels.length === 4 && channels[3] === 0;
    })), `no visible decorative shadow: ${value.shadow}`);
  });
}
function focusIndicator(record, value, state) {
  record.focusContrast ||= [];
  const pairs = [...value.surfaces, value.background].map(surface => ({ state, surface, ratio: contrast(value.outlineColor, surface) }));
  record.focusContrast.push(...pairs);
  check(record, `${state} focus`, () => {
    assert.ok(value.focused && value.focusVisible, 'native keyboard focus-visible');
    assert.equal(value.outlineStyle, 'solid');
    assert.ok(parseFloat(value.outlineWidth) >= 2 && parseFloat(value.outlineOffset) >= 2, '2px outline and separation');
    const channels = value.outlineColor.match(/[\d.]+/g).slice(0, 3).map(Number);
    assert.equal(Math.max(...channels), Math.min(...channels), 'neutral outline');
    const alpha = value.outlineColor.match(/[\d.]+/g).map(Number)[3];
    assert.ok(alpha == null || alpha === 1, 'opaque indicator; transparent outline cannot certify focus');
    assert.ok(pairs.length && pairs.every(pair => pair.ratio >= 3), '3:1 against control and adjacent surfaces');
  });
  staticFeedback(record, value, state);
}
async function mountControl(page, config) {
  if (config.state === 'page-error') {
    await page.evaluate(() => window.mountInteractionPage('connect', true));
    await page.getByRole('button', { name: /continue without connecting/i }).click();
    await page.getByRole('alert').filter({ hasText: /couldn’t save your workspace/i }).waitFor();
  } else {
    await page.evaluate(state => window.mountFocusFixture(state), config.state);
    if (config.state === 'connect-failed-saving') await page.evaluate(() => window.setFocusSaving());
  }
  return locateControl(page, config);
}
function locateControl(page, config) {
  return config.buttonName ? page.getByRole('button', { name: config.buttonName, exact: true })
    : page.locator('#subject').locator(config.selector);
}
async function tabTo(page, control) {
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    if (await control.evaluate(el => document.activeElement === el)) return;
  }
  throw new Error('control unreachable by native Tab');
}
async function controlCase(page, record) {
  let control = await mountControl(page, record);
  record.before = await control.evaluate(snapshot);
  staticFeedback(record, record.before, 'default');
  check(record, 'target/reflow', () => {
    assert.ok(record.before.rect.width >= 24 && record.before.rect.height >= 24);
    assert.equal(record.before.overflow, false); assert.equal(record.before.visible, true);
  });
  if (record.disabled) {
    assert.equal(await control.isDisabled(), true);
    for (const key of ['Tab', 'Shift+Tab', 'Tab']) {
      await page.keyboard.press(key);
      assert.equal(await control.evaluate(el => document.activeElement === el), false, 'disabled control skipped');
    }
    await control.hover(); await page.mouse.down(); await page.waitForTimeout(180);
    record.press = await control.evaluate(snapshot); staticFeedback(record, record.press, 'disabled press');
    await page.mouse.move(0, 0); await page.mouse.up();
    check(record, 'disabled stable geometry', () => assert.deepEqual(record.press.rect, record.before.rect));
    await control.evaluate(el => el.click());
    assert.deepEqual(await page.evaluate(() => window.__onboardingFixture.calls), { connect: 0, sync: 0, next: 0, enter: 0, skip: 0 });
  } else {
    await tabTo(page, control);
    record.immediate = await control.evaluate(snapshot); focusIndicator(record, record.immediate, 'immediate');
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    record.returned = await control.evaluate(snapshot); focusIndicator(record, record.returned, 'Shift+Tab return');
    await control.hover(); record.hover = await control.evaluate(snapshot); focusIndicator(record, record.hover, 'hover while keyboard-focused');
    await page.mouse.down(); await page.waitForTimeout(180);
    record.press = await control.evaluate(snapshot); focusIndicator(record, record.press, 'pointer held while focused');
    assert.equal(record.press.active, true, 'actual native press state measured');
    await page.mouse.move(0, 0); await page.mouse.up();
    record.released = await control.evaluate(snapshot); focusIndicator(record, record.released, 'released');
    check(record, 'stable geometry', () => {
      for (const frame of [record.immediate, record.returned, record.hover, record.press, record.released]) {
        assert.deepEqual(frame.rect, record.before.rect); assert.equal(frame.radius, record.before.radius);
      }
    });
    if (record.name === 'input') {
      control = await mountControl(page, record); await tabTo(page, control); await control.fill('Synthetic Workspace');
      await page.keyboard.press('Space');
      assert.equal(await page.evaluate(() => window.__onboardingFixture.calls.next), 0, 'Space edits input; never advances');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__onboardingFixture.calls.next === 1);
      assert.equal(await page.evaluate(() => window.__onboardingFixture.calls.next), 1, 'native input Enter advances once');
    } else for (const key of ['Enter', 'Space']) {
      control = await mountControl(page, record); await tabTo(page, control); await page.keyboard.press(key);
      if (record.action === 'save') {
        await page.getByRole('status').waitFor();
        assert.equal(await page.evaluate(() => window.__interactionSave.calls), 2);
        assert.equal(new URL(page.url()).search, '?step=connect&meta_error=role_forbidden');
        assert.equal(await control.count(), 0, 'retry clears the prior error while saving');
        assert.equal(await page.getByRole('button', { name: /continue without connecting/i }).isDisabled(), true, 'native skip disabled while saving');
      } else assert.equal(await page.evaluate(action => window.__onboardingFixture.calls[action], record.action), 1);
    }
  }
  await mountControl(page, record); if (!record.disabled) await tabTo(page, locateControl(page, record));
}
async function progressSnapshot(page) {
  const values = [];
  for (const label of labels) values.push(await page.getByText(label, { exact: true }).evaluate(el => ({
    ...(() => { const s = getComputedStyle(el), r = el.getBoundingClientRect();
      let p = el.parentElement; while (p && getComputedStyle(p).backgroundColor === 'rgba(0, 0, 0, 0)') p = p.parentElement;
      return { color: s.color, background: getComputedStyle(p).backgroundColor, fontSize: s.fontSize, weight: s.fontWeight,
        decoration: s.textDecorationLine, transition: s.transitionProperty, duration: s.transitionDuration,
        animation: s.animationName, opacity: s.opacity, visibility: s.visibility, display: s.display,
        x: r.x, right: r.right, width: r.width, height: r.height, fits: el.scrollWidth <= el.clientWidth,
        current: el.getAttribute('aria-current'), container: el.parentElement.tagName, containerName: el.parentElement.getAttribute('aria-label') }; })(), text: el.textContent,
  })));
  const bars = await page.getByText('Workspace', { exact: true }).evaluate(el => [...el.parentElement.previousElementSibling.children].map(bar => {
    const s = getComputedStyle(bar); return { background: s.backgroundColor, transition: s.transitionProperty, duration: s.transitionDuration,
      animation: s.animationName, transform: s.transform, running: bar.getAnimations().filter(a => a.playState === 'running').length };
  }));
  return { labels: values, bars, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) };
}
function checkProgress(record, value, step) {
  record.textContrast ||= [];
  const pairs = value.labels.map(label => ({ step, label: label.text, color: label.color, background: label.background, ratio: contrast(label.color, label.background) }));
  record.textContrast.push(...pairs);
  check(record, 'label contrast', () => assert.ok(pairs.every(pair => pair.ratio >= 4.5), 'normal text contrast >=4.5:1'));
  check(record, 'label readability/reflow', () => {
    assert.deepEqual(value.labels.map(l => l.text), labels);
    for (const label of value.labels) {
      assert.ok(parseFloat(label.fontSize) >= 12, 'minimum readable 12px');
      assert.ok(contrast(label.color, label.background) >= 4.5, 'normal text contrast >=4.5:1');
      assert.ok(label.opacity === '1' && label.visibility === 'visible' && label.display !== 'none');
      assert.ok(label.width > 0 && label.height > 0 && label.x >= 0 && label.right <= record.width && label.fits, 'all labels fit');
    }
    assert.equal(value.overflow, false);
  });
  check(record, 'current-step semantics', () => {
    assert.equal(value.labels[0].container, 'OL'); assert.equal(value.labels[0].containerName, 'Onboarding steps');
    assert.deepEqual(value.labels.filter(l => l.current === 'step').map(l => l.text), [labels[steps.indexOf(step)]]);
    assert.ok(value.labels[steps.indexOf(step)].decoration.includes('underline'), 'current step distinct without color');
  });
  check(record, 'static progress', () => {
    assert.equal(value.bars.length, 4);
    for (const target of [...value.labels, ...value.bars]) {
      assert.equal(target.transition, 'none', 'no bar/label transitions'); assert.equal(target.animation, 'none');
    }
    for (const bar of value.bars) { assert.equal(bar.transform, 'none'); assert.equal(bar.running, 0); }
  });
}
async function progressCase(page, record) {
  await page.evaluate(step => window.mountInteractionPage(step), record.step);
  record.initial = await progressSnapshot(page); checkProgress(record, record.initial, record.step);
  if (record.kind === 'navigation') {
    await page.getByRole('textbox', { name: 'Workspace name' }).press('Enter');
    assert.equal(new URL(page.url()).search, '?step=connect');
    record.changed = await progressSnapshot(page); checkProgress(record, record.changed, 'connect');
    await page.waitForTimeout(550); record.settled = await progressSnapshot(page); checkProgress(record, record.settled, 'connect');
    check(record, 'instant progression', () => assert.deepEqual(record.changed, record.settled));
    assert.equal(await page.getByRole('button', { name: 'Connect Meta', exact: true }).count(), 1);
  }
}
(async () => {
  process.chdir(path.resolve(__dirname, '../../../..')); fs.mkdirSync(output, { recursive: true });
  const dist = process.env.P9_07_EXISTING_DIST || await buildFixture(output, 'interaction.fixture.jsx', overrides);
  const server = http.createServer((request, response) => {
    const file = path.resolve(dist, `.${new URL(request.url, 'http://localhost').pathname}`);
    if (!file.startsWith(dist + path.sep) && file !== dist) { response.writeHead(403); response.end(); return; }
    const served = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[path.extname(served)] || 'application/octet-stream' });
    response.end(fs.readFileSync(served));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true });
  try {
    result.browser = browser.version();
    for (const deviceScaleFactor of process.env.P9_07_DPR ? [Number(process.env.P9_07_DPR)] : [1, 1.25])
      for (const width of [360, 768, 1440]) for (const motion of ['no-preference', 'reduce']) {
      const scenarios = [...controls.map(control => ({ ...control, kind: 'control' })),
        ...steps.map(step => ({ step, name: 'progress-' + step, kind: 'progress' })), { step: 'name', name: 'progress-navigation', kind: 'navigation' }]
        .filter(scenario => !process.env.P9_07_CASE || scenario.name === process.env.P9_07_CASE);
      for (const scenario of scenarios) {
        const record = { ...scenario, width, motion, deviceScaleFactor, failures: [] }; result.cases.push(record);
        const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: motion, deviceScaleFactor });
        page.setDefaultTimeout(5000);
        page.on('pageerror', error => result.errors.push(error.message));
        page.on('request', request => { if (!request.url().startsWith(base)) result.externalRequests.push(request.url()); });
        try {
          await page.goto(base); await page.waitForFunction(() => window.mountInteractionPage); await page.evaluate(() => document.fonts.ready);
          if (record.kind === 'control') await controlCase(page, record); else await progressCase(page, record);
          await page.screenshot({ path: path.join(output, `${deviceScaleFactor}-${width}-${motion}-${record.name}.png`), fullPage: true });
        } catch (error) { record.failures.push(`behavior: ${error.message}`); console.error(`${width}/${motion}/${record.name}: ${error.message}`); }
        finally { await page.close(); }
      }
    }
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
    result.failures = result.cases.filter(record => record.failures.length).map(({ name, width, motion, deviceScaleFactor, failures }) => ({ name, width, motion, deviceScaleFactor, failures }));
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    console.log(`Interaction cases: ${result.cases.length}; failing cases: ${result.failures.length}; browser errors: ${result.errors.length}; external requests: ${result.externalRequests.length}`);
  }
  assert.equal(result.errors.length, 0); assert.equal(result.externalRequests.length, 0); assert.equal(result.failures.length, 0);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
