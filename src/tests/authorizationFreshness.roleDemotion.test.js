// ============================================================
// SLICE B · RED-2 — a DEMOTED collaboration role and the money path
// ------------------------------------------------------------
// THE THREAT: a principal's authority changes, but an already-cached
// authorization state keeps permitting a real-money mutation.
//
// MECHANISM 2 OF 2: the collaboration-role cache.
//
// `firebaseAuth.js` keeps a per-process Map, uid → { workspaceId, role,
// collabRole, expiresAt }, with a 60-second TTL. On a cache hit it sets
// `req.collabRole` from the cached value and returns without touching the
// database. `requireCollabRole` then trusts `req.collabRole` — it only reads the
// database when that field is unset.
//
// So a seat demoted to CLIENT through PUT /api/team/:userId/role or PATCH
// /api/admin/users/:id/role keeps BUYER/STRATEGIST authority until the entry
// expires on its own.
//
// ⚠️ THE CURE EXISTS AND IS NEVER CALLED. `invalidateWorkspaceCache(uid)` is
// exported from firebaseAuth.js and has ZERO callers anywhere in the repository
// — the same shape as C-12, where the fix was already written and nothing
// invoked it. Note also that calling it fixes ONE process: the cache is
// per-instance, so a scaled deployment needs the revocation to be visible
// across instances, not merely local.
//
// ⚠️ THIS FILE WAS RED. Four cases failed on trunk: a demoted seat reached the
// sentinel and received 202 inside the TTL, on BOTH canonical paths. They pass
// now because the money boundary reads the row instead of trusting the cached
// role. The final block measures WHERE the role is read; one of its assertions
// was inverted by the fix and says so in place.
//
// Mechanism 1 (Firebase token revocation) is a SEPARATE file on purpose. A fix
// that closed this 60-second window alone would present a boundary that looks
// repaired while the hour-long one stayed open.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const store = vi.hoisted(() => ({
  /** the user row, as the database would return it RIGHT NOW. */
  row: { id: 'u-1', workspaceId: 'ws-1', role: 'USER', collabRole: 'STRATEGIST' },
  /** every database read, so the suite can show when the cache served instead. */
  reads: 0,
}));

vi.mock('../utils/firebaseAdmin.js', () => ({
  default: {
    auth: () => ({
      verifyIdToken: vi.fn(async (token) => {
        const uid = String(token).replace(/^token-for-/, '');
        return { uid, email: `${uid}@example.com`, email_verified: true };
      }),
    }),
  },
  getFirebaseAdminReadiness: () => ({ ok: true, error: null }),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => { store.reads += 1; return store.row; }),
      update: vi.fn(),
    },
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { buildAuthorityBoundary, CANONICAL_MUTATION_PATHS } = await import('./authorityBoundary.harness.js');
const { invalidateWorkspaceCache } = await import('../middleware/firebaseAuth.js');

const UID = 'seat-1';
const TOKEN = `token-for-${UID}`;
const CACHE_TTL_MS = 60_000;

let app;
let mutations;

beforeEach(async () => {
  store.row = { id: 'u-1', workspaceId: 'ws-1', role: 'USER', collabRole: 'STRATEGIST' };
  store.reads = 0;
  invalidateWorkspaceCache(UID);
  ({ app, mutations } = await buildAuthorityBoundary());
});

afterEach(() => {
  vi.useRealTimers();
  invalidateWorkspaceCache(UID);
});

const post = (path) => request(app).post(path).set('Authorization', `Bearer ${TOKEN}`).send({ action: 'PAUSE_CAMPAIGN' });

/** Demote the seat the way the product's own role-change routes do: in the DB. */
const demoteTo = (collabRole) => { store.row = { ...store.row, collabRole }; };

// ── Baseline ────────────────────────────────────────────────────────────────
describe('the role gate works when nothing is cached', () => {
  it('a STRATEGIST reaches the mutation path', async () => {
    const res = await post('/api/execute/meta');
    expect(res.status).toBe(202);
    expect(mutations.count).toBe(1);
  });

  it('a CLIENT is refused on a cold cache', async () => {
    demoteTo('CLIENT');
    const res = await post('/api/execute/meta');
    expect(res.status).toBe(403);
    expect(mutations.count).toBe(0);
  });
});

// ── THE CLOSURE CONDITION, mechanism 2 ──────────────────────────────────────
describe('a seat DEMOTED after its role was cached cannot mutate', () => {
  it.each(CANONICAL_MUTATION_PATHS)('%s refuses immediately after demotion', async (path) => {
    const warm = await post(path);          // warms the cache as STRATEGIST
    expect(warm.status).toBe(202);

    demoteTo('CLIENT');                     // the role change lands in the DB

    const after = await post(path);         // still inside the 60s TTL
    expect(after.status).not.toBe(202);
    expect(mutations.count).toBe(1);        // only the pre-demotion one
  });

  it('a demotion from STRATEGIST to BUYER still permits — only the removed authority is withdrawn', async () => {
    await post('/api/execute/meta');
    demoteTo('BUYER');                      // BUYER is still allowed on this path
    const after = await post('/api/execute/meta');
    expect(after.status).toBe(202);
  });

  it('every attempt inside the TTL is refused, not just the first', async () => {
    await post('/api/execute/meta');
    demoteTo('CLIENT');
    for (let i = 0; i < 3; i += 1) {
      const res = await post('/api/execute/meta');
      expect(res.status).not.toBe(202);
    }
    expect(mutations.count).toBe(1);
  });

  // Isolation from mechanism 1: the credential here is perfectly valid and
  // un-revoked. Only the ROLE changed.
  it('the credential is untouched — this is a role question, not a token question', async () => {
    await post('/api/execute/meta');
    demoteTo('CLIENT');
    const res = await post('/api/execute/exec-1/retry');
    expect(res.status).not.toBe(202);
    expect(res.status).not.toBe(401);       // the identity is still who they say
  });
});

// ── What the product does TODAY ─────────────────────────────────────────────
describe('measurement — where the role is read', () => {
  // ⚠️ THIS ASSERTION WAS INVERTED BY THE FIX, and the inversion is the proof.
  //
  // While the defect stood, this case read:
  //
  //   it('a second request inside the TTL does not re-read the user row', …)
  //     → expect(store.reads).toBe(afterFirst);   // served from cache
  //
  // That was a true measurement of the money path at the time, and it was the
  // mechanism: the second request inside the window never consulted the row,
  // so a demotion written to the row could not be seen.
  //
  // The cache itself is UNCHANGED and still serves the rest of the API — that
  // is the point of keeping the fix at the money boundary. What changed is that
  // this path no longer rests on it.
  it('the money boundary reads the row on EVERY request, warm cache or not', async () => {
    await post('/api/execute/meta');
    const afterFirst = store.reads;
    expect(afterFirst).toBeGreaterThan(0);

    await post('/api/execute/meta');
    expect(store.reads).toBeGreaterThan(afterFirst);
  });

  it('…and keeps reading it however many times the cache would have been warm', async () => {
    await post('/api/execute/meta');
    const afterFirst = store.reads;
    for (let i = 0; i < 3; i += 1) await post('/api/execute/meta');
    expect(store.reads).toBeGreaterThanOrEqual(afterFirst + 3);
  });

  it('the TTL is no longer what decides whether a demotion is seen', async () => {
    await post('/api/execute/meta');
    demoteTo('CLIENT');

    // Well inside the window the cache would still be warm. It does not matter.
    const insideWindow = await post('/api/execute/meta');
    expect(insideWindow.status).toBe(403);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CACHE_TTL_MS + 1_000);
    const afterWindow = await post('/api/execute/meta');
    vi.useRealTimers();
    expect(afterWindow.status).toBe(403);
  });

  // The mechanism, named: the fix already exists and nothing calls it.
  it('control — invalidating by hand DOES make the demotion take effect', async () => {
    await post('/api/execute/meta');
    demoteTo('CLIENT');
    invalidateWorkspaceCache(UID);
    const res = await post('/api/execute/meta');
    expect(res.status).toBe(403);
  });

  it('control — the harness would notice a mutation if one happened', async () => {
    const res = await post('/api/execute/meta');
    expect(res.status).toBe(202);
    expect(mutations.count).toBe(1);
    expect(mutations.paths).toEqual(['/api/execute/meta']);
  });
});
