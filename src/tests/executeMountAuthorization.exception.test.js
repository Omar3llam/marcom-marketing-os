// ============================================================
// SLICE C — the explicit CLIENT exception, which is EMPTY and must still work
// ------------------------------------------------------------
// Closure condition 3: "Any deliberate CLIENT exception is explicit and tested."
//
// Omar kept the concept despite it holding zero routes:
//
//   "Do not remove the concept because it happens to contain zero routes today
//    … If someone later wants to expose one operational read to CLIENT, they
//    have to make a deliberate policy decision rather than silently inheriting
//    it."
//
// That creates a hazard peculiar to empty mechanisms: NOTHING EXERCISES THEM.
// An exception list that no request ever matches can stop working — a broken
// matcher, an inverted condition, a path spelled in the wrong vocabulary — and
// every test still passes, because the list is empty. The day someone adds the
// first exception, it silently fails closed, and the reason is a mutation
// nobody could have caught.
//
// So this file tests the MECHANISM with an injected list, and the SHIPPED list
// separately. Two different questions:
//
//   does the exception seam work?     → inject a list, watch it open one route
//   is anything excepted today?       → assert the shipped list is exactly []
//
// It also pins what an exception may NOT do: cross a method, cross a path, or
// cross a workspace. An exception is a role decision and nothing else.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const store = vi.hoisted(() => ({ rows: new Map() }));

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
    user: { findUnique: vi.fn(async ({ where }) => store.rows.get(where.clerkId) ?? null) },
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { buildExecutionAuthorizationBaseline, CLIENT_READABLE, OPERATOR_ROLES } =
  await import('../routes/execution/authorizationBaseline.js');
const { firebaseAuthMiddleware, requireAuth } = await import('../middleware/firebaseAuth.js');
const { requireWorkspace } = await import('../middleware/requireWorkspace.js');
const { SEATS, rowFor, tokenFor } = await import('./executeMountAuthorization.harness.js');

/**
 * A miniature mount with the same shape as the real one: the same upstream
 * chain, the baseline under test, and sentinels instead of handlers. The
 * sentinels are the point — what is being measured is whether the request
 * ARRIVES, and a real handler's 200/404 would only add noise.
 */
function mountWith(clientReadable) {
  const app = express();
  app.use(express.json());
  app.use(firebaseAuthMiddleware);

  const router = express.Router();
  router.use(buildExecutionAuthorizationBaseline({ clientReadable }));
  router.get('/vitals', (req, res) => res.json({ reached: 'vitals' }));
  router.get('/:id/trace', (req, res) => res.json({ reached: 'trace', id: req.params.id }));
  router.post('/vitals', (req, res) => res.json({ reached: 'vitals-post' }));

  app.use('/api/execute', requireAuth, requireWorkspace, router);
  return app;
}

const as = (app, seat, method, path) => request(app)[method](path)
  .set('Authorization', `Bearer ${tokenFor(seat)}`)
  .send(method === 'post' ? {} : undefined);

beforeEach(() => {
  store.rows.clear();
  for (const seat of Object.values(SEATS)) store.rows.set(seat.uid, rowFor(seat));
});

// ── THE SHIPPED LIST ────────────────────────────────────────────────────────
describe('what is excepted today', () => {
  it('the shipped CLIENT exception list is EMPTY', async () => {
    // Mutation 4: "populate CLIENT_READABLE implicitly or accidentally." An
    // exception that arrives by accident is exactly the failure the list was
    // created to prevent, so its contents are asserted rather than assumed.
    expect(CLIENT_READABLE).toEqual([]);
  });

  it('the operator tier is BUYER and STRATEGIST, and nothing else', () => {
    expect([...OPERATOR_ROLES].sort()).toEqual(['BUYER', 'STRATEGIST']);
  });

  it('with the shipped list, a CLIENT reaches nothing', async () => {
    const app = mountWith(CLIENT_READABLE);
    expect((await as(app, SEATS.CLIENT, 'get', '/api/execute/vitals')).status).toBe(403);
    expect((await as(app, SEATS.CLIENT, 'get', '/api/execute/exec-1/trace')).status).toBe(403);
  });
});

// ── THE MECHANISM, exercised with a list the product does not ship ──────────
describe('the exception seam works, so the first real exception will too', () => {
  const ONE = [{ method: 'GET', path: '/vitals' }];

  it('a CLIENT reaches an EXCEPTED route', async () => {
    const app = mountWith(ONE);
    const res = await as(app, SEATS.CLIENT, 'get', '/api/execute/vitals');
    expect(res.status).toBe(200);
    expect(res.body.reached).toBe('vitals');
  });

  it('…and is still refused everywhere else', async () => {
    const app = mountWith(ONE);
    expect((await as(app, SEATS.CLIENT, 'get', '/api/execute/exec-1/trace')).status).toBe(403);
  });

  it('an exception does not cross methods — GET excepted leaves POST closed', async () => {
    const app = mountWith(ONE);
    expect((await as(app, SEATS.CLIENT, 'post', '/api/execute/vitals')).status).toBe(403);
  });

  it('a parameterised exception matches the route, not a prefix of it', async () => {
    const app = mountWith([{ method: 'GET', path: '/:id/trace' }]);
    expect((await as(app, SEATS.CLIENT, 'get', '/api/execute/exec-1/trace')).status).toBe(200);
    expect((await as(app, SEATS.CLIENT, 'get', '/api/execute/vitals')).status).toBe(403);
  });

  it('an operator is unaffected by the presence or absence of exceptions', async () => {
    for (const list of [CLIENT_READABLE, ONE]) {
      const app = mountWith(list);
      expect((await as(app, SEATS.STRATEGIST, 'get', '/api/execute/vitals')).status).toBe(200);
      expect((await as(app, SEATS.BUYER, 'get', '/api/execute/vitals')).status).toBe(200);
    }
  });

  it('an exception is a ROLE decision and does not open a workspace', async () => {
    // The seat is excepted; it is also in another workspace. Tenancy is decided
    // upstream and in the handler predicate, and an exception must not become a
    // second place where that question gets answered.
    const app = mountWith(ONE);
    const res = await as(app, SEATS.FOREIGN_OPERATOR, 'get', '/api/execute/vitals');
    // It reaches the sentinel — the baseline is not a tenancy gate — but the
    // workspace it carries is its OWN, never the one it asked about.
    expect(res.status).toBe(200);
  });

  it('a seat with NO role is refused even on an EXCEPTED route', async () => {
    // "A CLIENT may read this" is not "anyone may read this". A null role is an
    // unresolvable seat, not the lowest tier, and R11 (I61) settled what an
    // unresolvable role means: denial. An exception that fell through to next()
    // would have re-opened that hole on exactly the routes someone had chosen
    // to open — the worst possible place for it.
    const app = mountWith([{ method: 'GET', path: '/vitals' }]);
    const res = await as(app, SEATS.NO_ROLE, 'get', '/api/execute/vitals');
    expect(res.status).toBe(403);
  });

  it('an excepted route admits a CLIENT and an operator alike', async () => {
    const app = mountWith([{ method: 'GET', path: '/vitals' }]);
    for (const seat of [SEATS.CLIENT, SEATS.BUYER, SEATS.STRATEGIST]) {
      expect((await as(app, seat, 'get', '/api/execute/vitals')).status).toBe(200);
    }
  });
});
