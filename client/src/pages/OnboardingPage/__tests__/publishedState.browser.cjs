// Run from client/: node src/pages/OnboardingPage/__tests__/publishedState.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require('@playwright/test');
const { buildFixture } = require('./firstFrame.browser.cjs');
const output = process.env.P9_06_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-p9-06-'));
const confirmed = { workspaceId: 'synthetic-workspace', connections: [{ platform: 'META', connected: true, isActive: true }] };
const historical = { platform: 'META', connected: false, isActive: false, connection: 'DISCONNECTED' };
const withHistory = { ...confirmed, connections: [historical, ...confirmed.connections] };
const emptyRead = { data: { workspaceId: 'synthetic-workspace', connections: [] }, loading: false, error: null };
// Synthetic wire tuples from gatingReason.js; production uses the real registry.
const tuples = {
  NO_MEASURABLE_DELIVERY: { knowledge: 'NOTHING_THERE', prerequisite: 'DELIVERY' },
  NO_CANONICAL_WINDOW: { knowledge: 'NOTHING_THERE', prerequisite: 'FIRST_MEASUREMENT' },
  CANONICAL_EVIDENCE_STALE: { knowledge: 'NOT_ENOUGH', prerequisite: 'FRESH_MEASUREMENT' },
};
const gate = (reason) => ({ id: reason, name: 'Synthetic gated campaign', reason, ...tuples[reason] });
const overrides = {
  '/hooks/useConnections.js': `import { useState, useCallback } from 'react';
    export function useConnections() {
      const [read, setRead] = useState(window.__published.connections);
      window.publishConnection = value => setRead(value);
      const refetch = useCallback(() => {
        window.__published.calls.checks++; setRead({ data: null, loading: true, error: null });
      }, []);
      return { ...read, refetch };
    }`,
  '/hooks/useProjectId.js': 'export const useProjectId = () => ({ projectId: "synthetic-project", loading: false });',
  '/hooks/useConnectorVerdicts.js': 'export const useConnectorVerdicts = () => window.__published.verdicts;',
  '/hooks/useConnectorCampaigns.js': 'export const useConnectorCampaigns = () => window.__published.campaigns;',
  '/features/connectors/startConnect.js': `export const startConnect = () => {
    window.__published.calls.connect++;
    return window.__published.startError ? Promise.reject(window.__published.startError) : Promise.resolve(false);
  };`,
};
const cases = [];
for (const code of ['role_forbidden', 'authority_unavailable', 'workspace_unavailable', 'workspace_mismatch', 'project_not_found', 'incomplete_connection', 'invalid_state', 'denied', 'unknown_code']) {
  cases.push({ name: 'callback-' + code, step: 'connect', query: '&meta_error=' + code + '&meta_connected=1', connections: { ...emptyRead, data: confirmed }, refusal: true });
}
cases.push(
  { name: 'google-only', step: 'connect', connections: { ...emptyRead, data: { ...confirmed, connections: [{ platform: 'GOOGLE', connected: true }] } } },
  { name: 'workspace-unresolved', step: 'connect', connections: { ...emptyRead, data: { ...confirmed, workspaceId: null } } },
  { name: 'callback-stale', step: 'connect', query: '&meta_connected=1', connections: { ...emptyRead, data: confirmed } },
  { name: 'callback-failed', step: 'connect', query: '&meta_connected=1', connections: emptyRead, publish: { data: null, loading: false, error: { message: 'Synthetic read failure' } } },
  { name: 'callback-no-workspace', step: 'connect', query: '&meta_connected=1', connections: emptyRead, publish: { ...emptyRead, data: { ...confirmed, workspaceId: null } } },
  { name: 'callback-confirmed', step: 'connect', query: '&meta_connected=1', connections: emptyRead, publish: { ...emptyRead, data: confirmed }, advances: true },
  { name: 'reader-confirmed', step: 'connect', connections: { ...emptyRead, data: confirmed }, advances: true },
  { name: 'reader-active-with-history', step: 'connect', connections: { ...emptyRead, data: withHistory }, advances: true },
  { name: 'reader-two-active', step: 'connect', connections: { ...emptyRead, data: { ...confirmed, connections: [...confirmed.connections, { ...confirmed.connections[0], accountId: 'other' }] } } },
  { name: 'reader-no-active', step: 'connect', connections: { ...emptyRead, data: { ...confirmed, connections: [historical] } } },
  { name: 'reader-contradictory-active', step: 'connect', connections: { ...emptyRead, data: { ...confirmed, connections: [{ ...confirmed.connections[0], connection: 'DISCONNECTED' }, historical] } } },
  { name: 'callback-active-with-history', step: 'connect', query: '&meta_connected=1', connections: { ...emptyRead, data: withHistory }, publish: { ...emptyRead, data: withHistory }, advances: true },
);
for (const status of [401, 403, 503]) cases.push({ name: 'start-' + status, step: 'connect', connections: emptyRead, startError: { httpStatus: status }, refusal: true });
for (const status of ['NO_WORKSPACE', 'NO_CAMPAIGNS', 'NO_ELIGIBLE_CAMPAIGNS', 'OK', null, 'FUTURE']) {
  cases.push({ name: 'ready-' + status, step: 'ready', connections: emptyRead, verdicts: { verdicts: [], gatedOut: [], status, loading: false }, campaigns: { campaigns: [], loading: false } });
}
cases.push({ name: 'ready-active-with-history', step: 'ready', connections: { ...emptyRead, data: withHistory }, expectedMeta: true,
  verdicts: { verdicts: [], gatedOut: [], status: 'NO_CAMPAIGNS', loading: false }, campaigns: { campaigns: [], loading: false } });
for (const reason of ['NO_MEASURABLE_DELIVERY', 'NO_CANONICAL_WINDOW', 'CANONICAL_EVIDENCE_STALE']) {
  cases.push({ name: 'gate-' + reason, step: 'ready', connections: emptyRead, verdicts: { verdicts: [], gatedOut: [gate(reason)], status: 'NO_ELIGIBLE_CAMPAIGNS', loading: false }, campaigns: { campaigns: [], loading: false } });
}
const verdict = { id: 'synthetic-call', verdict: 'KILL', name: 'Synthetic supplied winner', confidence: 0.8, spendMinor: 200, rationale: 'Synthetic supplied grounds.' };
for (const state of ['mixed', 'unknown-gate', 'failed', 'pending', 'unresolved-meta']) {
  cases.push({ name: 'ready-' + state, step: 'ready', connections: { ...emptyRead, data: { ...confirmed, workspaceId: null } },
    verdicts: { verdicts: [verdict], gatedOut: state === 'unknown-gate' ? [{ id: 'future', reason: 'FUTURE_REASON' }] : [gate('NO_CANONICAL_WINDOW')], status: 'OK', loading: state === 'pending', error: state === 'failed' ? { message: 'Synthetic failure' } : null },
    campaigns: { campaigns: [{ entityId: 'synthetic-returned' }], loading: false },
  });
}
function snapshot() {
  const subject = document.querySelector('#subject');
  return { text: subject.innerText, headings: [...subject.querySelectorAll('h1')].map(e => {
    const s = getComputedStyle(e); return { text: e.textContent.trim(), opacity: s.opacity, visibility: s.visibility, display: s.display };
  }), statuses: [...subject.querySelectorAll('[role="status"]')].map(e => e.textContent.trim()),
    alerts: [...subject.querySelectorAll('[role="alert"]')].map(e => e.textContent.trim()),
    buttons: [...subject.querySelectorAll('button')].map(e => ({ text: e.textContent.trim(), disabled: e.disabled, height: e.offsetHeight })),
    overflow: document.documentElement.scrollWidth > innerWidth, calls: { ...window.__published.calls } };
}
(async () => {
  process.chdir(path.resolve(__dirname, '../../../..'));
  const dist = await buildFixture(output, 'publishedState.fixture.jsx', overrides);
  const server = http.createServer((request, response) => {
    const file = path.resolve(dist, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(dist + path.sep) && file !== dist) { response.writeHead(403); response.end(); return; }
    const served = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[path.extname(served)] || 'application/octet-stream' }); response.end(fs.readFileSync(served));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const base = 'http://127.0.0.1:' + server.address().port;
  const result = { synthetic: true, browser: browser.version(), cases: [], errors: [], externalRequests: [] };
  try {
    for (const width of [360, 768, 1440]) for (const motion of ['no-preference', 'reduce']) for (const config of cases) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: motion });
      const record = { name: config.name, width, motion, failures: [] }; result.cases.push(record);
      page.on('pageerror', e => result.errors.push(e.message));
      page.on('request', req => { if (!req.url().startsWith(base)) result.externalRequests.push(req.url()); });
      try {
        await page.goto(base); await page.waitForFunction(() => window.mountPublishedFixture);
        record.first = await page.evaluate(config => { window.mountPublishedFixture(config); return document.querySelector('#subject h1')?.textContent.trim(); }, config);
        assert.ok(record.first, 'required heading is present immediately');
        if (config.publish) { await page.evaluate(value => window.publishConnection(value), config.publish); }
        if (config.startError) { await page.getByRole('button', { name: 'Connect Meta', exact: true }).click(); await page.getByRole('alert').waitFor(); }
        record.view = await page.evaluate(snapshot);
        assert.equal(record.view.headings.length, 1); assert.equal(record.view.overflow, false);
        assert.ok(record.view.headings.every(h => h.opacity === '1' && h.visibility === 'visible' && h.display !== 'none'));
        assert.ok(record.view.buttons.every(b => b.height >= 24));
        if (config.step === 'connect') {
          assert.equal(record.view.calls.next, config.advances ? 1 : 0);
          if (config.query?.includes('meta_connected') && !config.refusal) assert.equal(record.view.calls.checks, 1);
          if (config.refusal) assert.equal(record.view.alerts.length, 1);
          if (config.query?.includes('meta_connected') && config.advances) {
            await page.evaluate(value => window.publishConnection(value), config.publish);
            assert.equal(await page.evaluate(() => window.__published.calls.next), 1);
          }
        } else {
          assert.ok(!/analysis complete|after your first sync|once your campaigns have revenue data|0 (?:returned )?(campaign|verdict)/i.test(record.view.text));
          if (['ready-failed', 'ready-pending'].includes(config.name)) assert.ok(!record.view.text.includes('Synthetic supplied winner'));
          if (config.name === 'ready-unknown-gate') assert.ok(record.view.text.includes('could not be confirmed'));
          assert.equal(record.view.text.split('\n').includes('Meta'), config.expectedMeta === true);
        }
        const enabled = page.locator('#subject button:not(:disabled)').first();
        if (await enabled.count()) {
          await page.mouse.move(0, 0); await page.locator('body').click({ position: { x: 0, y: 0 } }); await page.keyboard.press('Tab');
          assert.equal(await enabled.evaluate(e => document.activeElement === e), true);
          await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
          assert.equal(await enabled.evaluate(e => document.activeElement === e), true);
          record.keyboardFocus = true;
        }
        await page.screenshot({ path: path.join(output, width + '-' + motion + '-' + config.name + '.png'), fullPage: true });
      } catch (error) { record.failures.push(error.message); }
      finally { await page.close(); }
    }
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
    result.failures = result.cases.filter(c => c.failures.length);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    console.log('Published-state cases: ' + result.cases.length + '; failures: ' + result.failures.length);
  }
  assert.equal(result.errors.length, 0); assert.equal(result.externalRequests.length, 0); assert.equal(result.failures.length, 0);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
