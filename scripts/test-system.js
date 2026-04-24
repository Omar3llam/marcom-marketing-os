#!/usr/bin/env node
// ============================================================
// MARCOM — System Integration Tests
// Run: npm test  (server must be running on PORT 3000)
//
// Webhook tests sign requests with HMAC-SHA256 using
// WEBHOOK_SECRET from .env — matching validateWebhook.js.
// Auth-protected /api/* tests verify 401 rejection without JWT.
// ============================================================
import 'dotenv/config';
import crypto from 'crypto';

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

let sessionId = null;
let passed = 0;
let failed = 0;

// ── HMAC SIGNING ──────────────────────────────────────────────
function signedWebhookHeaders(body) {
  const ts = Math.floor(Date.now() / 1_000).toString();
  const payload = `${ts}.${body}`;
  const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  return {
    'Content-Type': 'application/json',
    'x-webhook-signature': `sha256=${sig}`,
    'x-webhook-timestamp': ts,
  };
}

async function webhookPost(path, body) {
  const raw = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: signedWebhookHeaders(raw),
    body: raw,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function apiPost(path, body, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// ── TEST RUNNER ───────────────────────────────────────────────
async function test(label, fn) {
  process.stdout.write(`  ${label}... `);
  try { await fn(); console.log('✓ PASS'); passed++; }
  catch (err) { console.log(`✗ FAIL — ${err.message}`); failed++; }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ── TEST SUITES ───────────────────────────────────────────────
async function run() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║        MARCOM — System Integration Tests             ║
╚══════════════════════════════════════════════════════╝
`);
  if (!WEBHOOK_SECRET) {
    console.warn('  ⚠ WEBHOOK_SECRET not set — webhook signature tests will fail.\n');
  }

  // ── [1] HEALTH ──────────────────────────────────────────────
  console.log('[1] Health Check');
  await test('GET /health returns 200', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const d = await res.json();
    assert(['ok', 'degraded'].includes(d.status), `Unexpected status: ${d.status}`);
    assert(d.system === 'MARCOM', `Expected MARCOM, got ${d.system}`);
  });

  // ── [2] AUTH GUARDS ─────────────────────────────────────────
  console.log('\n[2] Auth Guards (must reject unauthenticated requests)');
  await test('POST /api/chat without JWT returns 401', async () => {
    const { status } = await apiPost('/api/chat', { message: 'hello' });
    assert(status === 401, `Expected 401, got ${status}`);
  });

  await test('POST /api/export without JWT returns 401', async () => {
    const { status } = await apiPost('/api/export', { export_type: 'campaign' });
    assert(status === 401, `Expected 401, got ${status}`);
  });

  // ── [3] WEBHOOK — NEW SESSION ───────────────────────────────
  console.log('\n[3] Webhook Chat — New Session (Mode 1)');
  await test('POST /webhook/chat creates new session', async () => {
    const { status, data } = await webhookPost('/webhook/chat', { message: 'Hello' });
    assert(status === 200, `Expected 200, got ${status} — ${data.message || data.error || ''}`);
    assert(data.status === 'ok', data.message || data.error);
    assert(data.session_id, 'No session_id returned');
    assert(data.session_id.startsWith('MARCOM_'), `Expected MARCOM_ prefix, got ${data.session_id}`);
    assert(data.current_mode === 1, `Expected mode 1, got ${data.current_mode}`);
    assert(data.message && data.message.length > 0, 'Empty AI response');
    sessionId = data.session_id;
    console.log(`\n       Session: ${sessionId}`);
  });

  // ── [4] SESSION PERSISTENCE ─────────────────────────────────
  console.log('\n[4] Session Persistence');
  await test('Second message uses same session', async () => {
    assert(sessionId, 'No session from previous test — skipping');
    const { status, data } = await webhookPost('/webhook/chat', {
      session_id: sessionId,
      message: 'My company is TestCorp, we do B2B SaaS.',
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.status === 'ok', data.error || data.message);
    assert(data.session_id === sessionId, `Session changed: ${data.session_id}`);
    assert(data.current_mode === 1, `Expected mode 1, got ${data.current_mode}`);
  });

  // ── [5] MODE OVERRIDE ───────────────────────────────────────
  console.log('\n[5] Mode Override (server-side validation)');
  await test('Force mode 4 — content scoring', async () => {
    assert(sessionId, 'No session from previous test — skipping');
    const { status, data } = await webhookPost('/webhook/chat', {
      session_id: sessionId, message: 'Evaluate this content for me', mode: 4,
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.message && data.message.length > 0, 'Empty response for mode 4');
  });

  await test('Force mode 5 — campaign analysis', async () => {
    assert(sessionId, 'No session from previous test — skipping');
    const { status, data } = await webhookPost('/webhook/chat', {
      session_id: sessionId, message: 'I have campaign metrics', mode: 5,
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.message && data.message.length > 0, 'Empty response for mode 5');
  });

  await test('Invalid mode (9) is rejected by validation', async () => {
    assert(sessionId, 'No session from previous test — skipping');
    const { status } = await webhookPost('/webhook/chat', {
      session_id: sessionId, message: 'test', mode: 9,
    });
    assert(status === 422, `Expected 422, got ${status}`);
  });

  // ── [6] INPUT VALIDATION ────────────────────────────────────
  console.log('\n[6] Input Validation');
  await test('Empty message returns 422', async () => {
    const { status } = await webhookPost('/webhook/chat', { message: '' });
    assert(status === 422, `Expected 422, got ${status}`);
  });

  await test('Missing message returns 422', async () => {
    const { status } = await webhookPost('/webhook/chat', { session_id: 'test' });
    assert(status === 422, `Expected 422, got ${status}`);
  });

  // ── [7] WEBHOOK AUTH ────────────────────────────────────────
  console.log('\n[7] Webhook Authentication');
  await test('Request without HMAC signature returns 401', async () => {
    const res = await fetch(`${BASE_URL}/webhook/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'no auth' }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test('Request with wrong secret returns 401', async () => {
    const ts = Math.floor(Date.now() / 1_000).toString();
    const body = JSON.stringify({ message: 'wrong secret' });
    const badSig = crypto.createHmac('sha256', 'wrong-secret').update(`${ts}.${body}`).digest('hex');
    const res = await fetch(`${BASE_URL}/webhook/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': `sha256=${badSig}`,
        'x-webhook-timestamp': ts,
      },
      body,
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test('Replay attack (old timestamp) returns 401', async () => {
    const staleTs = (Math.floor(Date.now() / 1_000) - 400).toString(); // 400s ago > 300s window
    const body = JSON.stringify({ message: 'replay' });
    const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${staleTs}.${body}`).digest('hex');
    const res = await fetch(`${BASE_URL}/webhook/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': `sha256=${sig}`,
        'x-webhook-timestamp': staleTs,
      },
      body,
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // ── RESULTS ─────────────────────────────────────────────────
  console.log(`
╔══════════════════════════════════════════════════════╗
║                    RESULTS                           ║
╠══════════════════════════════════════════════════════╣
║  Passed : ${String(passed).padEnd(43)}║
║  Failed : ${String(failed).padEnd(43)}║
║  Total  : ${String(passed + failed).padEnd(43)}║
╚══════════════════════════════════════════════════════╝
  `);

  if (failed > 0) { console.log('⚠ Some tests failed. Check server logs.\n'); process.exit(1); }
  else { console.log('✓ All tests passed. System is ready.\n'); }
}

run().catch(err => {
  console.error('\nTest runner error:', err.message);
  console.error('Make sure the server is running: npm run dev\n');
  process.exit(1);
});
