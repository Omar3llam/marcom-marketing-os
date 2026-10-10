// Run from client/: node src/pages/OnboardingPage/__tests__/focus.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require('@playwright/test');
const { buildFixture } = require('./firstFrame.browser.cjs');
const output = process.env.P9_03_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-p9-03-'));
const result = { fixture: 'SYNTHETIC: actual components/CSS; local callbacks only, no authenticated runtime', cases: [], errors: [], requests: [] };
const overrides = {
  '/hooks/useProjectId.js': 'export const useProjectId = () => ({ ...window.__onboardingFixture.project, refetch: () => {} });',
  '/features/connectors/startConnect.js': 'export const startConnect = () => { window.__onboardingFixture.calls.connect++; return new Promise(() => {}); };',
  '/lib/api.js': `export const api = { post(url) {
    if (url !== '/api/lumi/connections/sync') throw new Error('Unexpected synthetic operation');
    const f = window.__onboardingFixture; f.calls.sync++;
    if (f.calls.sync > 1 || f.sync === 'sync-pending') return new Promise(() => {});
    if (f.sync === 'sync-partial') return Promise.resolve({ data: { ok: true, synced: 1, results: [{ status: 'success' }, { status: 'error' }] } });
    return Promise.reject(f.sync === 'sync-refused' ? { httpStatus: 403 } : new Error('Synthetic read failure'));
  } };`,
};
const states = ['name-present', 'name-empty', 'connect-idle', 'connect-failed', 'connect-loading',
  'connect-missing', 'connect-saving', 'connect-failed-saving', 'connect-connecting', 'sync-failed',
  'sync-partial', 'sync-pending', 'sync-refused', 'ready-present', 'ready-empty', 'ready-failed', 'ready-pending'];
const disabled = ['name-empty', 'connect-loading', 'connect-missing', 'connect-saving', 'connect-failed-saving', 'connect-connecting'];
const absent = ['sync-pending', 'sync-refused', 'ready-pending'];

function snapshot(element) {
  const s = getComputedStyle(element), r = element.getBoundingClientRect();
  const surfaces = [];
  for (let p = element.parentElement; p; p = p.parentElement) {
    const color = getComputedStyle(p).backgroundColor;
    if (color !== 'rgba(0, 0, 0, 0)') surfaces.push(color);
  }
  return { text: element.textContent.trim(), focused: document.activeElement === element,
    visible: element.matches(':focus-visible'), outline: s.outline, style: s.outlineStyle,
    width: s.outlineWidth, offset: s.outlineOffset, color: s.outlineColor, shadow: s.boxShadow,
    background: s.backgroundColor, transition: s.transitionProperty, duration: s.transitionDuration,
    animation: s.animationName, opacity: s.opacity, transform: s.transform, surfaces,
    hitArea: { width: element.offsetWidth, height: element.offsetHeight },
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    focusToken: s.getPropertyValue('--lumi-color-interaction-focus-ring').trim(),
    overflow: document.documentElement.scrollWidth > innerWidth };
}
function rgb(color) { return color.match(/[\d.]+/g).slice(0, 3).map(Number); }
function contrast(a, b) {
  const luminance = color => rgb(color).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
function shadowLayers(shadow) {
  if (shadow === 'none') return [];
  // Split between layers, never inside rgb()/rgba(). Transparent Tailwind
  // ring/shadow placeholders are valid; inspect actual color, alpha and blur.
  return shadow.split(/,(?![^()]*\))/).map(layer => {
    const color = layer.match(/rgba?\(([^)]+)\)/);
    assert.ok(color, `unrecognized computed shadow: ${layer}`);
    const channels = color[1].split(',').map(Number);
    const lengths = [...layer.replace(color[0], '').matchAll(/(-?[\d.]+)px/g)].map(match => Number(match[1]));
    return { rgb: channels.slice(0, 3), alpha: channels.length === 4 ? channels[3] : 1,
      x: lengths[0], y: lengths[1], blur: lengths[2] || 0, spread: lengths[3] || 0 };
  });
}
function checkShadow(value, record, state) {
  try {
    const layers = shadowLayers(value.shadow);
    (record.shadows ||= []).push({ state, opacity: value.opacity, layers });
    assert.ok(layers.every(layer => layer.alpha === 0),
      `${state}: no visible decorative shadow; computed ${value.shadow}`);
  } catch (error) { record.failures.push(`shadow: ${error.message}`); }
}
function checkIndicator(value, record) {
  checkShadow(value, record, 'keyboard-focus');
  try {
    assert.ok(value.focused && value.visible, 'native keyboard focus-visible must match');
    assert.equal(value.style, 'solid', 'focus outline must actually render');
    assert.ok(parseFloat(value.width) >= 2 && parseFloat(value.offset) >= 2);
    const channels = rgb(value.color);
    assert.equal(Math.max(...channels), Math.min(...channels), 'indicator must be neutral');
    const shadowColors = [...value.shadow.matchAll(/rgba?\(([^)]+)\)/g)];
    assert.ok(value.shadow === 'none' || (shadowColors.length > 0 && shadowColors.every(([, color]) => {
      const channels = color.split(',').map(Number);
      return channels.length === 4 && channels[3] === 0;
    })), 'no visible shadow may carry or obscure focus');
    assert.ok(value.surfaces.length > 0, 'adjacent surface must be resolved');
    record.contrast = [...value.surfaces, value.background].map(surface => ({ surface, ratio: contrast(value.color, surface) }));
    assert.ok(record.contrast.every(pair => pair.ratio >= 3), 'focus contrast must clear 3:1');
    assert.ok(!/all|outline|box-shadow/.test(value.transition), 'indicator must not wait for a transition');
    assert.equal(value.animation, 'none');
    assert.equal(value.overflow, false);
  } catch (error) { record.failures.push(`indicator: ${error.message}`); }
}
async function mount(page, state) {
  await page.evaluate(state => window.mountFocusFixture(state), state);
  if (state === 'sync-failed' || state === 'sync-partial' || state === 'connect-failed' || state === 'connect-failed-saving') {
    await page.getByRole('button', { name: state.startsWith('sync') ? 'Retry sync' : 'Try again', exact: true }).waitFor();
  }
  if (state === 'connect-failed-saving') await page.evaluate(() => window.setFocusSaving());
}
async function run(browser, base, config) {
  const page = await browser.newPage({ viewport: { width: config.width, height: 1000 }, reducedMotion: config.motion });
  const record = { ...config, failures: [] }; result.cases.push(record);
  const key = `${config.width}-${config.motion}-${config.state}`;
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('request', request => result.requests.push(request.url()));
  try {
    await page.goto(base); await page.waitForFunction(() => window.mountFocusFixture);
    await page.evaluate(() => document.fonts.ready); await mount(page, config.state);
    // Identify the real shared-class control, never supply a synthetic button.
    const primary = page.locator('#subject button.bg-lumi-gold');
    if (absent.includes(config.state)) {
      await page.getByRole(config.state === 'sync-refused' ? 'alert' : config.state === 'sync-pending' ? 'status' : 'note').waitFor();
      assert.equal(await primary.count(), 0); record.controlAbsent = true; return;
    }
    if (config.state === 'connect-connecting') { await primary.click(); await page.getByText('Redirecting to Meta…').waitFor(); }
    record.before = await primary.evaluate(snapshot);
    checkShadow(record.before, record, disabled.includes(config.state) ? 'disabled-default' : 'default');
    assert.equal(record.before.overflow, false);
    await page.screenshot({ path: path.join(output, `${key}-before.png`), fullPage: true });
    const callsBeforePointer = await page.evaluate(() => window.__onboardingFixture.calls);
    const pathBeforePointer = new URL(page.url()).pathname;
    await primary.hover(); await page.waitForTimeout(200);
    record.hover = await primary.evaluate(snapshot);
    checkShadow(record.hover, record, disabled.includes(config.state) ? 'disabled-hover' : 'hover');
    await page.screenshot({ path: path.join(output, `${key}-hover.png`), fullPage: true });
    await page.mouse.down(); await page.waitForTimeout(200);
    record.pointerActive = await primary.evaluate(snapshot);
    checkShadow(record.pointerActive, record, disabled.includes(config.state) ? 'disabled-pointer-active' : 'pointer-active');
    await page.screenshot({ path: path.join(output, `${key}-pointer-active.png`), fullPage: true });
    // Release outside the control so presentation probing cannot activate it.
    await page.mouse.move(0, 0); await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.__onboardingFixture.calls), callsBeforePointer);
    assert.equal(new URL(page.url()).pathname, pathBeforePointer);
    assert.deepEqual(record.hover.hitArea, record.before.hitArea);
    assert.deepEqual(record.pointerActive.hitArea, record.before.hitArea);
    assert.equal(record.hover.text, record.before.text);
    assert.equal(record.pointerActive.text, record.before.text);
    assert.equal(record.hover.overflow || record.pointerActive.overflow, false);
    // A pointer press legitimately changes native focus. Remount unchanged
    // fixtures before replaying the original keyboard/activation contract.
    await mount(page, config.state);
    if (config.state === 'connect-connecting') { await primary.click(); await page.getByText('Redirecting to Meta…').waitFor(); }
    if (disabled.includes(config.state)) {
      assert.equal(await primary.isDisabled(), true);
      await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      assert.equal(await primary.evaluate(el => document.activeElement === el), false);
      record.disabledSkipped = true; return;
    }
    await page.keyboard.press('Tab');
    assert.equal(await primary.evaluate(el => document.activeElement === el), true, 'Tab reaches primary after Name input or from document');
    record.immediate = await primary.evaluate(snapshot); checkIndicator(record.immediate, record);
    await page.screenshot({ path: path.join(output, `${key}-focused.png`), fullPage: true });
    await page.keyboard.press('Shift+Tab');
    assert.equal(await primary.evaluate(el => document.activeElement === el), false);
    await page.keyboard.press('Tab');
    record.returned = await primary.evaluate(snapshot); checkIndicator(record.returned, record);
    await page.waitForTimeout(200); record.settled = await primary.evaluate(snapshot); checkIndicator(record.settled, record);
    assert.deepEqual(record.immediate.rect, record.settled.rect, 'focus must not change geometry');
    record.activations = [];
    for (const keyPress of ['Enter', 'Space']) {
      await mount(page, config.state); await page.keyboard.press('Tab'); await page.keyboard.press(keyPress);
      if (config.state === 'connect-failed') await page.getByRole('button', { name: 'Connect Meta', exact: true }).waitFor();
      if (config.state.startsWith('sync')) await page.getByRole('status').waitFor();
      const calls = await page.evaluate(() => window.__onboardingFixture.calls);
      record.activations.push({ keyPress, calls });
      if (config.state.startsWith('name')) assert.equal(calls.next, 1);
      else if (config.state === 'connect-idle') assert.equal(calls.connect, 1);
      else if (config.state.startsWith('sync')) assert.equal(calls.sync, 2);
      else if (config.state.startsWith('ready')) assert.equal(calls.enter, 1);
      else assert.equal(calls.connect, 0, 'callback retry clears refusal without starting OAuth');
    }
  } catch (error) { record.failures.push(`behavior: ${error.message}`); }
  finally { await page.close(); }
}
(async () => {
  process.chdir(path.resolve(__dirname, '../../../..'));
  fs.mkdirSync(output, { recursive: true });
  // Replay a retained compiled baseline with the same assertions, without
  // changing the checkout or replacing historical RED evidence.
  const dist = process.env.P9_03_EXISTING_DIST
    ? path.resolve(process.env.P9_03_EXISTING_DIST)
    : await buildFixture(output, 'focus.fixture.jsx', overrides);
  const server = http.createServer((request, response) => {
    const file = path.resolve(dist, `.${new URL(request.url, 'http://localhost').pathname}`);
    if (!file.startsWith(dist + path.sep) && file !== dist) { response.writeHead(403); response.end(); return; }
    const served = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[path.extname(served)] || 'application/octet-stream' });
    response.end(fs.readFileSync(served));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true }); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    result.browser = browser.version();
    for (const width of [360, 768, 1440]) for (const motion of ['no-preference', 'reduce']) for (const state of states) await run(browser, base, { width, motion, state });
    assert.ok(result.requests.every(url => url.startsWith(base)), 'no external services'); assert.equal(result.errors.length, 0);
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
    result.failures = result.cases.filter(c => c.failures.length);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    console.log(`Focus cases: ${result.cases.length}; failures: ${result.failures.length}; evidence: ${output}`);
  }
  assert.equal(result.failures.length, 0, 'focus, activation and absence of decorative glow must hold');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
