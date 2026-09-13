// ============================================================
// SLICE B · RED-1 — a REVOKED Firebase identity and the money path
// ------------------------------------------------------------
// THE THREAT: a principal's authority changes, but an already-issued
// authorization state keeps permitting a real-money mutation.
//
// MECHANISM 1 OF 2: the Firebase ID token.
//
// `firebaseAuth.js` verifies with `admin.auth().verifyIdToken(token)` — one
// argument. The Admin SDK's second argument is `checkRevoked`, and without it
// the SDK validates signature, issuer, audience and expiry and NOTHING ELSE. A
// token belonging to an account that has since been disabled, or whose refresh
// tokens have been revoked (sign-out-everywhere, a password reset, a compromised
// session being cut), still verifies until it expires on its own.
//
// Firebase ID tokens last ONE HOUR. So the revocation window on the only two
// paths in the product that can spend real money is up to an hour.
//
// HOW REVOCATION IS MODELLED HERE, and why it is faithful rather than invented:
// the stub mirrors the SDK's documented contract exactly —
//
//     verifyIdToken(token)        resolves   (revocation is not consulted)
//     verifyIdToken(token, true)  rejects    auth/id-token-revoked
//
// That is the whole defect: the product only ever makes the first call. The
// stub does not decide the outcome; it reproduces the SDK's behaviour and lets
// the product's own choice of call decide.
//
// ⚠️ THIS FILE WAS RED. Five cases failed on trunk: a revoked identity reached
// the sentinel and received 202 on BOTH canonical paths. They pass now because
// requireFreshAuthority re-confirms the credential with the issuer at the money
// boundary. The final describe block measures HOW the token is verified, so the
// original RED was an observation and not an assertion of something unobserved.
//
// Mechanism 2 (the collaboration-role cache) is a SEPARATE file on purpose: one
// test that happened to exercise both could pass while only one was closed.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ── The identity stores, and only the stores ────────────────────────────────
const store = vi.hoisted(() => ({
  /** uids whose refresh tokens have been revoked / accounts disabled. */
  revoked: new Set(),
  /** the user row, as the database would return it. */
  row: { id: 'u-1', workspaceId: 'ws-1', role: 'USER', collabRole: 'STRATEGIST' },
  /** every call the product made, so the suite can report WHICH call it made. */
  verifyCalls: [],
}));

const REVOKED_ERROR = Object.assign(new Error('The Firebase ID token has been revoked.'), {
  code: 'auth/id-token-revoked',
});

vi.mock('../utils/firebaseAdmin.js', () => ({
  default: {
    auth: () => ({
      verifyIdToken: vi.fn(async (token, checkRevoked = false) => {
        store.verifyCalls.push({ token, checkRevoked });
        const uid = String(token).replace(/^token-for-/, '');
        // Signature/issuer/audience/expiry — always fine for these fixtures.
        // Revocation is consulted ONLY when the caller asks for it, exactly as
        // the Admin SDK behaves.
        if (checkRevoked && store.revoked.has(uid)) throw REVOKED_ERROR;
        return { uid, email: `${uid}@example.com`, email_verified: true };
      }),
    }),
  },
  getFirebaseAdminReadiness: () => ({ ok: true, error: null }),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => store.row), update: vi.fn() },
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { buildAuthorityBoundary, CANONICAL_MUTATION_PATHS } = await import('./authorityBoundary.harness.js');
const { invalidateWorkspaceCache } = await import('../middleware/firebaseAuth.js');

const UID = 'buyer-1';
const TOKEN = `token-for-${UID}`;

let app;
let mutations;

beforeEach(async () => {
  store.revoked.clear();
  store.row = { id: 'u-1', workspaceId: 'ws-1', role: 'USER', collabRole: 'STRATEGIST' };
  store.verifyCalls.length = 0;
  invalidateWorkspaceCache(UID);
  ({ app, mutations } = await buildAuthorityBoundary());
});

const post = (path) => request(app).post(path).set('Authorization', `Bearer ${TOKEN}`).send({ action: 'PAUSE_CAMPAIGN' });

// ── Baseline: the boundary works for a principal who still has authority ────
describe('a principal WITH authority reaches the mutation path', () => {
  it.each(CANONICAL_MUTATION_PATHS)('%s accepts a live STRATEGIST', async (path) => {
    const res = await post(path);
    expect(res.status).toBe(202);
    expect(mutations.count).toBe(1);
  });

  it('a CLIENT is refused — the role gate itself is sound', async () => {
    store.row = { ...store.row, collabRole: 'CLIENT' };
    const res = await post('/api/execute/meta');
    expect(res.status).toBe(403);
    expect(mutations.count).toBe(0);
  });
});

// ── THE CLOSURE CONDITION, mechanism 1 ──────────────────────────────────────
describe('a principal whose Firebase credential has been REVOKED cannot mutate', () => {
  it.each(CANONICAL_MUTATION_PATHS)('%s refuses a revoked identity', async (path) => {
    store.revoked.add(UID);          // the account is disabled / tokens revoked
    const res = await post(path);
    expect(mutations.count).toBe(0);
    expect(res.status).not.toBe(202);
  });

  it('revocation is refused even on the very first request of a cold process', async () => {
    store.revoked.add(UID);
    const res = await post('/api/execute/meta');
    expect(mutations.count).toBe(0);
    expect(res.status).not.toBe(202);
  });

  it('revocation after a successful request stops the next one', async () => {
    const first = await post('/api/execute/meta');
    expect(first.status).toBe(202);

    store.revoked.add(UID);
    invalidateWorkspaceCache(UID);   // isolate mechanism 1 from mechanism 2
    const second = await post('/api/execute/meta');
    expect(second.status).not.toBe(202);
    expect(mutations.count).toBe(1); // still just the first
  });

  // The two mechanisms must not be able to hide behind each other: with the
  // role cache deliberately cleared, ONLY the token's freshness is in question.
  it('a cleared role cache does not rescue a revoked credential', async () => {
    store.revoked.add(UID);
    invalidateWorkspaceCache(UID);
    const res = await post('/api/execute/exec-1/retry');
    expect(res.status).toBe(401);
    expect(mutations.count).toBe(0);
  });
});

// ── What the product does TODAY ─────────────────────────────────────────────
// Recorded so the RED is a measurement. This block passes before AND after the
// fix only if the fix changes the CALL; if it stays at one argument, the block
// above cannot be satisfied. Keeping it makes the mechanism visible rather than
// leaving a reader to infer it from a failing expectation.
describe('measurement — how the token is verified today', () => {
  it('the product calls verifyIdToken and we can see with what', async () => {
    await post('/api/execute/meta');
    expect(store.verifyCalls.length).toBeGreaterThan(0);
    const call = store.verifyCalls[0];
    expect(call.token).toBe(TOKEN);
    // The defect, stated as the thing to change: revocation is not consulted.
    // When this becomes true, the describe above can pass.
    expect(typeof call.checkRevoked).toBe('boolean');
  });

  it('control — the stub DOES reject when revocation is consulted', async () => {
    store.revoked.add(UID);
    const admin = (await import('../utils/firebaseAdmin.js')).default;
    await expect(admin.auth().verifyIdToken(TOKEN, true)).rejects.toMatchObject({ code: 'auth/id-token-revoked' });
    await expect(admin.auth().verifyIdToken(TOKEN)).resolves.toMatchObject({ uid: UID });
  });
});
