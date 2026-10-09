// Run from client/: node src/pages/OnboardingPage/__tests__/firstFrame.browser.cjs
// Builds real components + production CSS into an external temporary directory.
// No App, production auth provider, route guard or backend is mounted/bypassed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require('@playwright/test');

const client = path.resolve(__dirname, '../../../..');
const output = process.env.P9_02_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-p9-02-'));
const modules = {
  '/context/AuthContext.jsx': 'export const useAuth = () => ({ currentUser: { email: "synthetic@example.invalid" } });',
  '/hooks/useConnectorVerdicts.js': 'export const useConnectorVerdicts = () => window.__onboardingFixture.verdicts;',
  '/hooks/useConnectorCampaigns.js': 'export const useConnectorCampaigns = () => window.__onboardingFixture.campaigns;',
  '/hooks/useConnections.js': 'export const useConnections = () => window.__onboardingFixture.connections;',
  '/hooks/useProjectId.js': 'export const useProjectId = () => ({ projectId: "synthetic", loading: false, refetch: () => {} });',
  '/features/connectors/startConnect.js': 'export const startConnect = () => { throw new Error("OAuth is not exercised in this fixture"); };',
  '/lib/api.js': 'export const api = new Proxy({}, { get() { return () => { throw new Error("No backend operations in first-frame fixture"); }; } });',
};
const result = { fixture: 'SYNTHETIC: real components and compiled CSS; no authenticated runtime', cases: [], errors: [], requests: [], failures: [] };

async function buildFixture() {
  const { build } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  fs.mkdirSync(output, { recursive: true });
  await build({ root: client, configFile: false, plugins: [
    { name: 'isolated-onboarding-test-dependencies', enforce: 'pre',
      resolveId(source) {
        const normalized = source.replaceAll('\\', '/');
        const suffix = Object.keys(modules).find(name => normalized === `@${name}` || normalized === `${client.replaceAll('\\', '/')}/src${name}`);
        return suffix ? `\0onboarding-fixture${suffix}` : null;
      },
      load(id) { return id.startsWith('\0onboarding-fixture') ? modules[id.slice('\0onboarding-fixture'.length)] : null; },
    }, react(),
  ], resolve: { alias: { '@': path.join(client, 'src') } }, build: {
    outDir: path.join(output, 'dist'), emptyOutDir: false, cssCodeSplit: false,
    rollupOptions: { input: path.join(__dirname, 'firstFrame.fixture.jsx'), output: { entryFileNames: 'fixture.js' } },
  } });
  const dist = path.join(output, 'dist');
  const css = fs.readdirSync(path.join(dist, 'assets')).filter(name => name.endsWith('.css'));
  fs.writeFileSync(path.join(dist, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(name => `<link rel="stylesheet" href="/assets/${name}">`).join('')}</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
  return dist;
}

function snapshot(config) {
  const subject = document.querySelector('#subject');
  const root = config.isolated ? subject.firstElementChild : subject.firstElementChild.firstElementChild.children[1];
  const ready = config.isolated ? root : root.firstElementChild;
  const targets = { stepBody: root };
  if (config.step === 'ready' && config.variant !== 'pending') {
    targets.cta = root.querySelector('button');
    if (config.variant === 'present') targets.verdict = root.querySelector('p.text-4xl').parentElement;
    if (['present', 'empty'].includes(config.variant)) targets.chips = ready.lastElementChild;
    targets.heading = root.querySelector('h1');
  } else if (config.step === 'name') targets.heading = root.querySelector('h1');
  const measured = {};
  for (const [name, element] of Object.entries(targets)) {
    if (!element) continue;
    const chain = [];
    for (let current = element; current && current !== subject.parentElement; current = current.parentElement) {
      const style = getComputedStyle(current);
      chain.push({ opacity: style.opacity, transform: style.transform, animation: style.animationName,
        duration: style.animationDuration, delay: style.animationDelay, display: style.display, visibility: style.visibility });
    }
    measured[name] = { text: element.textContent.trim(), chain };
  }
  return { at: performance.now(), measured, text: subject.innerText,
    overflow: document.documentElement.scrollWidth > innerWidth,
    buttons: [...root.querySelectorAll('button')].map(button => button.textContent.trim()),
    alerts: [...root.querySelectorAll('[role="alert"]')].map(element => element.textContent.trim()) };
}

function checkVisibility(record, frame) {
  const failures = [];
  for (const [name, value] of Object.entries(frame.measured)) {
    // Pending skeleton internals retain their existing pulse; only the step
    // container is checked there. State absence must never fabricate a result.
    if (value.chain.some(style => style.opacity !== '1' || style.transform !== 'none'
      || style.display === 'none' || style.visibility === 'hidden' || style.animation !== 'none')) {
      failures.push(`${name} entrance conceals/displaces required content`);
    }
  }
  if (frame.overflow) failures.push('horizontal overflow');
  record.failures.push(...failures);
}

async function runCase(browser, baseURL, config) {
  const page = await browser.newPage({ viewport: { width: config.width, height: 900 }, reducedMotion: config.motion });
  const record = { ...config, frames: [], failures: [] };
  result.cases.push(record);
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('request', request => result.requests.push({ url: request.url(), method: request.method() }));
  try {
    await page.goto(baseURL);
    await page.waitForFunction(() => typeof window.mountFirstFrameFixture === 'function');
    await page.evaluate(() => document.fonts.ready);
    const frames = await page.evaluate(async ({ config, snapshotSource }) => {
      const take = (0, eval)(`(${snapshotSource})`);
      window.mountFirstFrameFixture(config);
      const mounted = performance.now();
      const initial = take(config);
      await new Promise(requestAnimationFrame);
      const first = take(config);
      await new Promise(resolve => setTimeout(resolve, 40));
      const early = take(config);
      await new Promise(resolve => setTimeout(resolve, 200));
      const delayed = take(config);
      await new Promise(resolve => setTimeout(resolve, 500));
      const settled = take(config);
      return [initial, first, early, delayed, settled].map(frame => ({ ...frame, elapsed: frame.at - mounted }));
    }, { config, snapshotSource: snapshot.toString() });
    record.frames = frames;
    for (const frame of frames) checkVisibility(record, frame);
    const text = frames[0].text;
    if (config.step === 'ready') {
      if (config.variant === 'present') {
        assert.ok(text.includes('Synthetic highest spend') && !text.includes('Synthetic lower spend'));
        assert.ok(text.includes('Synthetic supplied recommendation.') && text.includes('80% confidence'));
        assert.ok(text.includes('2 Campaigns') && text.includes('2 Verdicts') && text.includes('Meta'));
      } else if (config.variant === 'empty') {
        assert.ok(text.includes('No campaigns found yet.') && text.includes('0 Campaigns') && text.includes('0 Verdicts'));
        assert.ok(!text.includes('Synthetic highest spend'));
      } else if (config.variant === 'failed') {
        assert.equal(frames[0].alerts.length, 1);
        assert.ok(text.includes('Your results couldn') && !text.includes('No campaigns found') && !text.includes('Synthetic highest spend'));
      } else {
        assert.equal(frames[0].buttons.length, 0);
        assert.ok(!text.includes('Analysis complete') && !text.includes('0 Campaigns') && !text.includes('Synthetic highest spend'));
      }
    }
    // Exercise actual native keyboard order/activation; never invoke an API.
    if (config.variant !== 'pending' || config.step === 'name') {
      if (config.step === 'name') assert.equal(await page.locator('input').evaluate(element => document.activeElement === element), true);
      await page.keyboard.press('Tab');
      record.focus = await page.evaluate(() => {
        const element = document.activeElement, style = getComputedStyle(element);
        return { tag: element.tagName, text: element.textContent.trim(), id: element.id, shadow: style.boxShadow, outline: style.outline };
      });
      assert.equal(record.focus.tag, 'BUTTON');
      if (config.step === 'ready') {
        await page.keyboard.press('Enter');
        record.activation = await page.evaluate(() => ({ path: location.pathname, activations: window.__onboardingFixture.activations,
          savedName: localStorage.getItem('marcom:onboarding:name') }));
        assert.equal(config.isolated ? record.activation.activations : record.activation.path, config.isolated ? 1 : '/app/campaigns');
        if (!config.isolated) assert.equal(record.activation.savedName, null);
      }
    }
    await page.screenshot({ path: path.join(output, `${config.width}-${config.motion}-${config.step}-${config.variant}-${config.isolated ? 'ready' : 'page'}.png`), fullPage: true });
  } catch (error) { record.failures.push(`state/behavior: ${error.message}`); }
  finally { await page.close(); }
}

(async () => {
  // Tailwind/PostCSS resolve their real client config from cwd, as in npm build.
  process.chdir(client);
  const dist = await buildFixture();
  const server = http.createServer((request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(dist, `.${name}`);
    if (!file.startsWith(dist + path.sep) && file !== dist) { response.writeHead(403); response.end(); return; }
    const served = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(served)];
    response.writeHead(200, { 'Content-Type': type || 'application/octet-stream' }); response.end(fs.readFileSync(served));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    result.browser = browser.version();
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    for (const width of [360, 768, 1440]) for (const motion of ['no-preference', 'reduce']) {
      await runCase(browser, baseURL, { width, motion, step: 'name', variant: 'present', isolated: false });
      for (const variant of ['present', 'empty', 'failed', 'pending']) for (const isolated of [false, true]) {
        await runCase(browser, baseURL, { width, motion, step: 'ready', variant, isolated });
      }
    }
    assert.ok(result.requests.every(request => request.url.startsWith(baseURL)), 'fixture must never access production/network services');
    assert.equal(result.errors.length, 0);
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
    result.failures = result.cases.filter(record => record.failures.length).map(record => ({ width: record.width, motion: record.motion,
      step: record.step, variant: record.variant, isolated: record.isolated, failures: record.failures }));
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    console.log(`Browser cases: ${result.cases.length}; failures: ${result.failures.length}; evidence: ${output}`);
  }
  assert.equal(result.failures.length, 0, 'required content must be available without presentation animation');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
