// Run explicitly with Node 24.20.x. Identity images support author review, not aesthetic automation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require('@playwright/test');
const { buildFixture } = require('./firstFrame.browser.cjs');
const output = process.env.P9_08_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-p9-08-'));
const blank = { verdicts: [], gatedOut: [], status: 'NO_CAMPAIGNS', loading: false, error: null };
const connection = { data: { workspaceId: 'synthetic-workspace', connections: [] }, loading: false, error: null };
const campaign = { campaigns: [{ id: 'supplied' }], loading: false, error: null };
const verdict = { id: 'supplied', name: 'Synthetic campaign', verdict: 'KILL', confidence: 0.8,
  rationale: 'Synthetic published rationale: the canonical result is below its supplied boundary.',
  recommendation: 'Synthetic supplied recommendation; this screen does not execute it.', spendMinor: 200 };
const gate = { id: 'gated', name: 'Synthetic gated campaign', reason: 'NO_CANONICAL_WINDOW', knowledge: 'NOTHING_THERE', prerequisite: 'FIRST_MEASUREMENT' };
const cases = [
  { name: 'workspace', step: 'name' },
  { name: 'connect', step: 'connect' },
  { name: 'connect-checking', step: 'connect', query: '&meta_connected=1' },
  { name: 'connect-refused', step: 'connect', query: '&meta_error=role_forbidden&meta_connected=1' },
  { name: 'connect-unavailable', step: 'connect', project: { projectId: null, loading: false } },
  { name: 'sync-pending', step: 'sync', sync: 'pending' },
  { name: 'sync-failed', step: 'sync', sync: 'failed' },
  { name: 'sync-partial', step: 'sync', sync: 'partial' },
  { name: 'ready-kill', step: 'ready', verdicts: { ...blank, status: 'OK', verdicts: [verdict] }, winner: 'KILL' },
  { name: 'ready-scale', step: 'ready', verdicts: { ...blank, status: 'OK', verdicts: [{ ...verdict, verdict: 'SCALE' }] }, winner: 'SCALE' },
  { name: 'ready-mixed', step: 'ready', verdicts: { ...blank, status: 'OK', verdicts: [verdict], gatedOut: [gate] }, winner: 'KILL' },
  { name: 'ready-pending', step: 'ready', verdicts: { ...blank, loading: true } },
  { name: 'ready-failed', step: 'ready', verdicts: { ...blank, error: { message: 'Synthetic read failed' }, verdicts: [verdict] } },
  { name: 'ready-empty', step: 'ready' },
  { name: 'ready-unknown', step: 'ready', verdicts: { ...blank, status: 'FUTURE' } },
  { name: 'ready-unavailable', step: 'ready', verdicts: { ...blank, status: 'NO_WORKSPACE' } },
  { name: 'ready-gated', step: 'ready', verdicts: { ...blank, status: 'NO_ELIGIBLE_CAMPAIGNS', gatedOut: [gate] } },
  { name: 'ready-stale', step: 'ready', verdicts: { ...blank, status: 'NO_ELIGIBLE_CAMPAIGNS', gatedOut: [{ ...gate, reason: 'CANONICAL_EVIDENCE_STALE', knowledge: 'NOT_ENOUGH', prerequisite: 'FRESH_MEASUREMENT' }] } },
];
const overrides = {
  '/hooks/useConnectorVerdicts.js': 'export const useConnectorVerdicts = () => window.__composition.verdicts;',
  '/hooks/useConnectorCampaigns.js': 'export const useConnectorCampaigns = () => window.__composition.campaigns;',
  '/hooks/useConnections.js': 'export const useConnections = () => ({ ...window.__composition.connections, refetch: () => {} });',
  '/hooks/useProjectId.js': 'export const useProjectId = () => ({ ...window.__composition.project, refetch: () => {} });',
  '/lib/api.js': `export const api = { post: () => {
    const state = window.__composition.sync;
    if (state === 'pending') return new Promise(() => {});
    if (state === 'failed') return Promise.reject({ response: { status: 503 } });
    return Promise.resolve({ data: { ok: true, synced: 1, results: [{ status: 'success' }, { status: 'failed' }] } });
  } };`,
};
function measure() {
  const subject = document.querySelector('#subject');
  const text = [...subject.querySelectorAll('*')].filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
  const inspect = e => {
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    let ground = e;
    while (ground.parentElement && getComputedStyle(ground).backgroundColor === 'rgba(0, 0, 0, 0)') ground = ground.parentElement;
    return { tag: e.tagName, text: e.textContent.trim(), color: s.color, background: getComputedStyle(ground).backgroundColor,
      font: s.fontFamily, size: parseFloat(s.fontSize), weight: s.fontWeight, radius: s.borderRadius,
      x: r.x, y: r.y, width: r.width, height: r.height, transition: s.transitionProperty, animation: s.animationName };
  };
  return { text: subject.innerText, headings: [...subject.querySelectorAll('h1')].map(inspect),
    textNodes: text.map(inspect), boxes: [...subject.querySelectorAll('section,ol,li,h1,h2,p,button,input,ul')].map(inspect),
    progress: [...subject.querySelectorAll('[aria-current="step"]')].map(e => e.textContent.trim()),
    mark: subject.querySelector('[data-verdict-mark]') ? inspect(subject.querySelector('[data-verdict-mark]')) : null,
    main: subject.querySelector('main') ? inspect(subject.querySelector('main')) : null,
    overflow: document.documentElement.scrollWidth > innerWidth,
    running: subject.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length };
}
const channels = c => c.match(/[\d.]+/g).slice(0, 3).map(Number);
const lum = c => channels(c).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a,v,i) => a + v * [.2126,.7152,.0722][i],0);
const contrast = (a,b) => (Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
async function identity(page, variant) {
  await page.evaluate(mode => {
    const subject = document.querySelector('#subject');
    if (mode === 'logo-neutral') subject.querySelectorAll('img,[data-brand]').forEach(e => { e.style.visibility = 'hidden'; });
    if (mode === 'grayscale') subject.style.filter = 'grayscale(1)';
    if (mode === 'copy-neutral') {
      const walker = document.createTreeWalker(subject, NodeFilter.SHOW_TEXT);
      const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.filter(n => n.textContent.trim()).forEach(n => { n.textContent = n.textContent.replace(/[A-Za-z]/g, 'x'); });
    }
    if (mode === 'structure') {
      subject.style.filter = 'grayscale(1)';
      subject.querySelectorAll('*').forEach(e => { e.style.color = 'transparent'; });
      subject.querySelectorAll('h1,h2,p,button,input,ol,ul,section').forEach(e => {
        e.style.outline = '1px solid rgb(100,100,100)'; e.style.color = 'transparent'; e.style.backgroundColor = 'rgb(150,150,150)';
      });
    }
  }, variant);
}
(async () => {
  process.chdir(path.resolve(__dirname, '../../../..'));
  const dist = process.env.P9_08_EXISTING_DIST || await buildFixture(output, 'composition.fixture.jsx', overrides);
  const server = http.createServer((req,res) => {
    const target = path.resolve(dist, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!target.startsWith(dist + path.sep) && target !== dist) { res.writeHead(403); res.end(); return; }
    const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(dist, 'index.html');
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const browser = await chromium.launch({ headless: true });
  const base = 'http://127.0.0.1:' + server.address().port;
  const result = { synthetic: true, browser: browser.version(), cases: [], errors: [], externalRequests: [] };
  try {
    for (const width of [360,768,1440]) for (const motion of ['no-preference','reduce']) for (const config of cases) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: motion });
      const record = { name: config.name, width, motion, failures: [] }; result.cases.push(record);
      page.on('pageerror', e => result.errors.push(e.message));
      page.on('request', req => { if (!req.url().startsWith(base)) result.externalRequests.push(req.url()); });
      const mount = { connections: connection, campaigns: campaign, verdicts: blank, project: { projectId: 'synthetic', loading: false }, ...config };
      try {
        await page.goto(base); await page.waitForFunction(() => window.mountComposition); await page.evaluate(() => document.fonts.ready);
        record.first = await page.evaluate(c => { window.mountComposition(c); return document.querySelector('#subject h1')?.textContent; }, mount);
        if (config.name === 'sync-failed' || config.name === 'sync-partial') await page.getByRole('alert').waitFor();
        record.view = await page.evaluate(measure);
        const check = (name, fn) => { try { fn(); } catch(e) { record.failures.push(name + ': ' + e.message); } };
        check('first-frame/reflow', () => { assert.ok(record.first); assert.equal(record.view.overflow,false); assert.equal(record.view.headings.length,1); assert.equal(record.view.running,0); });
        check('product environment', () => { assert.ok(record.view.main, 'native main landmark'); assert.equal(record.view.main.background,'rgb(11, 15, 20)', 'PR-9 product ground'); });
        check('readability', () => { assert.ok(record.view.textNodes.every(n => n.size >= 12),'12px floor');
          const pairs = record.view.textNodes.filter(n => n.tag !== 'BUTTON');
          assert.ok(pairs.every(n => contrast(n.color,n.background) >= 4.5), 'normal text contrast'); });
        check('progress', () => { assert.equal(record.view.progress.length,1); for (const name of ['Workspace','Connect','Analyze','Verdict']) assert.ok(record.view.text.includes(name)); });
        if (config.winner) {
          check('verdict hierarchy/tense', () => { const h = record.view.headings[0]; assert.equal(h.text,config.winner,'verdict is semantic page claim');
            assert.ok(h.font.includes('Inter')); assert.ok(record.view.text.includes('NOW') && record.view.text.includes('Current assessment'));
            assert.ok(!record.view.text.includes('AT DECISION')); assert.ok(record.view.mark,'mark beside neutral word');
            assert.ok(contrast(record.view.mark.background,record.view.main.background) >= 3, 'semantic mark contrast');
            assert.ok(h.size >= Math.max(...record.view.textNodes.map(n => n.size))); });
          check('grounds', () => { assert.ok(record.view.text.includes(verdict.rationale)); assert.ok(record.view.text.includes('80% confidence'));
            assert.ok(record.view.text.includes(verdict.recommendation)); assert.ok(!/Record decision|Execute|Outcome|Memory/.test(record.view.text)); });
        } else if (config.step === 'ready') check('no invented verdict', () => { assert.ok(!/\b(KILL|SCALE)\b/.test(record.view.headings[0].text) || record.view.headings[0].text.startsWith('No ')); assert.equal(record.view.mark,null); });
        for (const variant of ['original','logo-neutral','grayscale','copy-neutral','structure']) {
          if (variant !== 'original') { await page.evaluate(c => window.mountComposition(c), mount); if (config.name.startsWith('sync-') && config.sync !== 'pending') await page.getByRole('alert').waitFor(); await identity(page,variant); }
          await page.screenshot({ path: path.join(output, `${width}-${motion}-${config.name}-${variant}.png`), fullPage: true });
        }
      } catch(e) { record.failures.push(e.message); } finally { await page.close(); }
    }
  } finally { await browser.close(); await new Promise(r => server.close(r));
    result.failures = result.cases.filter(c => c.failures.length); fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));
    console.log(`Composition cases: ${result.cases.length}; failed: ${result.failures.length}; browser errors: ${result.errors.length}`); }
  assert.equal(result.errors.length,0); assert.equal(result.externalRequests.length,0); assert.equal(result.failures.length,0);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
