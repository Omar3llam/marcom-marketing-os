// ============================================================
// SLICE C · RED — authorization is OPT-IN on the /api/execute mount
// ------------------------------------------------------------
// THE ARCHITECTURAL DEFECT, in Omar's words, which is the wording to keep:
//
//   "authorization is opt-in on the execute mount"
//
// The thirteen ungated routes are its CURRENT MANIFESTATION, not the problem.
// The problem is that the mount supplies authentication, workspace resolution
// and rate limiting, and then leaves authorization to whoever writes the next
// route. A route that forgets a gate is not refused. It is published.
//
//   /api/execute
//      ├── authentication       ✓ requireAuth
//      ├── workspace resolution ✓ requireWorkspace
//      ├── rate limiting        ✓ apiLimiter + executionLimiter
//      └── authorization        ✗ opt-in, per route
//
// THE ORDER OF THIS FILE IS THE ORDER OMAR REQUIRED. The policy is pinned
// first, from the product's own model. Only then is any route asked to obey it.
// Nothing here asserts "all 13 must become BUYER/STRATEGIST" as a premise; the
// audience of each route is read from executeMountAuthorization.policy.js,
// where every row carries the evidence that classified it.
//
// ⚠️ THIS FILE IS RED. Thirteen cases fail on trunk, one per ungated route: a
// CLIENT seat reaches an execution-operational surface and is answered, where
// the product's role model says it sees the REPORT only. The five routes that
// already carry a gate pass, which is what makes the thirteen a measurement of
// a gap rather than of an absent feature.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

import {
  EXECUTE_MOUNT_POLICY,
  UNGATED_TODAY,
  CLIENT_READABLE,
  AUDIENCE,
  requestPath,
  label,
} from './executeMountAuthorization.policy.js';

const store = vi.hoisted(() => ({
  /** uid -> the user row the identity store would return. */
  rows: new Map(),
  /**
   * A real execution and a real artifact, both in the CLIENT's OWN workspace.
   *
   * These are seated by default and that is deliberate. With an empty store the
   * seven per-execution reads answer 404 — and a 404 is not a refusal, it is an
   * empty fixture. Reading protection into it would be exactly the mistake this
   * programme keeps finding. Seated, every one of the thirteen answers a CLIENT
   * with 200, which is the actual measurement. One case below empties the store
   * again to show the 404 was the fixture talking.
   */
  execution: null,
  artifact: null,
}));

const EXECUTION_FIXTURE = {
  id: 'exec-1', workspaceId: 'ws-1', actionType: 'PAUSE_CAMPAIGN', targetId: 'camp-1',
  status: 'QUEUED', version: 1, correlationId: 'corr-1', decisionId: null, transitions: [],
  createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-01T00:00:00Z'),
};

const ARTIFACT_FIXTURE = {
  id: 'art-1', workspaceId: 'ws-1', executionId: 'exec-1', status: 'PENDING_APPROVAL',
  kind: 'COPY', storageKey: 'k1', createdAt: new Date('2026-09-01T00:00:00Z'),
};

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

// The identity store, keyed by uid — every gate on this mount reads the role
// from here, whether through the cache, requireCollabRole, or Slice B's
// requireFreshAuthority. One fixture therefore drives all three.
vi.mock('../lib/prisma.js', () => {
  const empty = async () => [];
  const none = async () => null;
  const zero = async () => 0;
  return {
    prisma: {
      user: {
        findUnique: vi.fn(async ({ where }) => store.rows.get(where.clerkId) ?? null),
      },
      executionRequest: {
        findUnique: vi.fn(async () => store.execution),
        findFirst:  vi.fn(async () => store.execution),
        findMany:   vi.fn(async () => (store.execution ? [store.execution] : [])),
        count: zero,
      },
      executionTransition: { findMany: empty },
      executionMetric: { findMany: empty, findFirst: none },
      auditLog: { findMany: empty, count: zero, create: async () => ({}) },
      artifact: {
        findMany:   vi.fn(async () => (store.artifact ? [store.artifact] : [])),
        findUnique: vi.fn(async () => store.artifact),
        count: zero,
      },
      decision: { findFirst: none, findUnique: none },
      outcomeSnapshot: { count: zero },
    },
  };
});

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Heavy services. Stubbed so a PERMITTED request lands on its handler and comes
// back with something — never to decide an authorization outcome, which is what
// this file measures.
vi.mock('../queues/index.js', () => ({
  executionQueue: { count: vi.fn().mockResolvedValue(0), getJobCounts: vi.fn().mockResolvedValue({}) },
  enqueueExecution: vi.fn().mockResolvedValue({}),
}));
vi.mock('../services/execution-checkpoint/index.js', () => ({
  getLatestCheckpoint: vi.fn().mockResolvedValue({ id: 'cp-1', executionId: 'exec-1', nodeId: 'n1' }),
  getPausedExecutions: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/execution-engine/observability/executionTrace.js', () => ({
  buildTrace: vi.fn().mockResolvedValue({ timeline: [] }),
}));
vi.mock('../services/execution-engine/observability/traceSerializer.js', () => ({
  serializeTrace: vi.fn((t) => t),
}));
vi.mock('../services/artifact-storage/index.js', () => ({
  getArtifact: vi.fn().mockResolvedValue({ id: 'art-1', content: 'body' }),
}));
vi.mock('../services/execution/workerHealth.js', () => ({
  getWorkerHeartbeats: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/execution/ExecutionLifecycleService.js', () => ({
  lifecycleService: {
    transition: vi.fn().mockResolvedValue({ version: 2 }),
    getExecutionState: vi.fn().mockResolvedValue({
      id: 'exec-1', status: 'QUEUED', version: 1, isTerminal: false, isStale: false,
    }),
  },
}));
vi.mock('../services/execution/ExecutionResumeService.js', () => ({
  resumeWithDecisions: vi.fn().mockResolvedValue({ status: 'RESUMED' }),
  ResumeError: class ResumeError extends Error {},
}));

const { buildExecuteMount, SEATS, rowFor, tokenFor } = await import('./executeMountAuthorization.harness.js');
const { visibleStates, canExecute, WORKSPACE_ROLE } = await import('../services/collaboration/roleScope.js');

let app;

beforeEach(async () => {
  store.rows.clear();
  for (const seat of Object.values(SEATS)) store.rows.set(seat.uid, rowFor(seat));
  store.execution = { ...EXECUTION_FIXTURE };
  store.artifact  = { ...ARTIFACT_FIXTURE };
  app = await buildExecuteMount();
});

/** Issue the row's request as a seat. GETs and POSTs alike. */
function call(row, seat) {
  const req = row.method === 'POST'
    ? request(app).post(requestPath(row)).send({})
    : request(app).get(requestPath(row));
  return req.set('Authorization', `Bearer ${tokenFor(seat)}`);
}

const OPERATOR_ROUTES = EXECUTE_MOUNT_POLICY.filter((r) => r.audience === AUDIENCE.OPERATORS);

// ── 1. PIN THE POLICY, before asking any route to obey it ───────────────────
describe('the authorization policy the product already declares', () => {
  it('a CLIENT seat sees the REPORT and nothing else', () => {
    expect(visibleStates(WORKSPACE_ROLE.CLIENT)).toEqual(['REPORT']);
  });

  it('a CLIENT seat cannot execute — so it has no operator capability to read from', () => {
    expect(canExecute(WORKSPACE_ROLE.CLIENT)).toBe(false);
    expect(canExecute(WORKSPACE_ROLE.BUYER)).toBe(true);
    expect(canExecute(WORKSPACE_ROLE.STRATEGIST)).toBe(true);
  });

  it('every route on the mount is classified — none is left to inference', () => {
    expect(EXECUTE_MOUNT_POLICY).toHaveLength(18);
    for (const row of EXECUTE_MOUNT_POLICY) {
      expect(Object.values(AUDIENCE)).toContain(row.audience);
      expect(row.evidence.length).toBeGreaterThan(0);
    }
  });

  it('the deliberate CLIENT exception list is EMPTY, and exists', () => {
    // Empty is the measured result of the classification. Present is the
    // mechanism closure condition 3 requires: a CLIENT-readable route must be
    // something a person wrote down, never a gate a person forgot.
    expect(CLIENT_READABLE).toEqual([]);
    expect(Array.isArray(CLIENT_READABLE)).toBe(true);
  });

  it('control — the table describes the mount that ships, not a wish', () => {
    // 13 ungated is the census result. If the product gains or loses a gate,
    // this number must be re-derived rather than edited to match.
    expect(UNGATED_TODAY).toHaveLength(13);
    expect(EXECUTE_MOUNT_POLICY.filter((r) => r.enforcedToday !== null)).toHaveLength(5);
  });
});

// ── 2. THE CLOSURE CONDITION ────────────────────────────────────────────────
describe('a CLIENT seat cannot reach an operator surface on this mount', () => {
  it.each(OPERATOR_ROUTES.map((r) => [label(r), r]))(
    '%s refuses a CLIENT',
    async (_name, row) => {
      const res = await call(row, SEATS.CLIENT);
      expect(res.status).toBe(403);
    },
  );
});

// ── 3. A seat carrying no role at all ───────────────────────────────────────
describe('a seat with no collaboration role is refused, never defaulted upward', () => {
  it.each(OPERATOR_ROUTES.map((r) => [label(r), r]))(
    '%s refuses a seat with a null role',
    async (_name, row) => {
      const res = await call(row, SEATS.NO_ROLE);
      // R11 (I61): the old default answered STRATEGIST here. Surfacing may
      // still render a default seat; ENFORCEMENT never does.
      expect(res.status).toBe(403);
    },
  );
});

// ── 4. CONTROLS — the operator tier must not be broken by any of this ───────
describe('controls — an operator is NOT refused', () => {
  it.each(OPERATOR_ROUTES.map((r) => [label(r), r]))(
    '%s admits a STRATEGIST',
    async (_name, row) => {
      const res = await call(row, SEATS.STRATEGIST);
      expect(res.status).not.toBe(403);
      // A 5xx would mean the route never really ran, and a suite that cannot
      // reach a handler cannot claim the gate is what stopped anyone.
      expect(res.status).toBeLessThan(500);
    },
  );

  it.each(OPERATOR_ROUTES.map((r) => [label(r), r]))(
    '%s admits a BUYER',
    async (_name, row) => {
      const res = await call(row, SEATS.BUYER);
      expect(res.status).not.toBe(403);
      expect(res.status).toBeLessThan(500);
    },
  );
});

// ── 5. TENANT ISOLATION — a property Slice C must not cost ──────────────────
describe('tenant isolation holds independently of role', () => {
  // Closure condition 7. src/routes/execution/tenancy.test.js covers the
  // idempotency lookup and the retry-chain bound on the MUTATION paths; the
  // reads had no cross-tenant case at all, so these are new ground rather than
  // a duplicate. They PASS on trunk — every one of the thirteen is already
  // workspace-scoped — which makes them regression guards, not RED. Slice C
  // changes who may ask; it must not change whose rows come back.
  const STORE_BACKED = [
    '/:id/transitions', '/:id/incident', '/:id/checkpoint', '/:id/active',
    '/:executionId/artifacts', '/:executionId/artifacts/pending-approval',
    '/artifacts/:id',
  ];
  const rows = UNGATED_TODAY.filter((r) => STORE_BACKED.includes(r.path));

  it.each(rows.map((r) => [label(r), r]))(
    '%s does not serve a foreign workspace execution to a full operator',
    async (_name, row) => {
      // Every role privilege, none of the tenancy: the seat is a STRATEGIST,
      // so nothing here can pass merely because a role gate refused it.
      const res = await call(row, SEATS.FOREIGN_OPERATOR);
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(403); // refused for TENANCY, not for role
    },
  );

  it('control — the same seat, in the owning workspace, IS served', async () => {
    const row = rows.find((r) => r.path === '/:id/transitions');
    const res = await call(row, SEATS.STRATEGIST);
    expect(res.status).toBe(200);
  });
});

// ── 6. MEASUREMENT — what the mount does today ──────────────────────────────
describe('measurement — authentication is granted, authorization is not asked', () => {
  // These two cases stay TRUE after the fix. They are what makes the denial
  // above an AUTHORIZATION result: the CLIENT is a real, authenticated member
  // of a resolved workspace, refused for what it may do and not for who it is.
  it('a CLIENT presents a credential the mount accepts', async () => {
    const res = await call(EXECUTE_MOUNT_POLICY.find((r) => r.path === '/audit'), SEATS.CLIENT);
    expect(res.status).not.toBe(401);
  });

  it('a CLIENT resolves to a workspace', async () => {
    const res = await call(EXECUTE_MOUNT_POLICY.find((r) => r.path === '/audit'), SEATS.CLIENT);
    expect(res.status).not.toBe(409);
  });

  // ⚠️ THIS CASE WAS INVERTED BY THE FIX, and the inversion is the proof.
  //
  // It was declared as the one case that would invert BEFORE the baseline was
  // written. While the defect stood it read:
  //
  //   it('TODAY: all thirteen ungated routes answer a CLIENT with 200', …)
  //     → expect(answered).toEqual([ 'GET /audit -> 200', …twelve more… ]);
  //
  // That was a true measurement of the shipped mount, and it is why RED was an
  // observation rather than an assertion about something nobody looked at. The
  // same thirteen paths are walked now; only the answer changed.
  it('all thirteen formerly-ungated routes now refuse a CLIENT', async () => {
    const answered = [];
    for (const row of UNGATED_TODAY) {
      const res = await call(row, SEATS.CLIENT);
      answered.push(`${label(row)} -> ${res.status}`);
    }
    // Pinned, not counted. A count would let one route change its answer
    // without anybody noticing which one.
    expect(answered).toEqual([
      'GET /audit -> 403',
      'GET /vitals -> 403',
      'GET /active -> 403',
      'GET /paused -> 403',
      'GET /metrics/summary -> 403',
      'GET /:id/trace -> 403',
      'GET /:id/transitions -> 403',
      'GET /:id/incident -> 403',
      'GET /:id/checkpoint -> 403',
      'GET /:id/active -> 403',
      'GET /:executionId/artifacts -> 403',
      'GET /:executionId/artifacts/pending-approval -> 403',
      'GET /artifacts/:id -> 403',
    ]);
  });

  // ⚠️ A 404 IS NOT A REFUSAL, AND THE FIX MUST NOT MAKE IT ONE.
  //
  // This case was declared RED-side as "the 404s an empty store produces are
  // the FIXTURE, never a denial" — it emptied the store and showed a CLIENT
  // getting 404 from seven routes, so nobody could mistake data absence for
  // protection. The baseline inverted its premise: a CLIENT is now refused
  // BEFORE any handler runs, so it can no longer observe a 404 at all.
  //
  // That is exactly what Omar required — "the fix should not use 404 as the
  // authorization mechanism for these routes" — so the case now asserts the
  // SEPARATION rather than the old observation. Both halves matter:
  //
  //   authorized seat + empty store  -> 404   data absence, unchanged
  //   CLIENT seat     + any store    -> 403   the canonical refusal
  //
  // A fix that let a CLIENT fall through to 404 would look protective and
  // would not be: it would leak the difference between an execution that
  // exists and one that does not.
  it('404 still means data absence, and 403 is what a CLIENT gets either way', async () => {
    const STORE_BACKED = [
      '/:id/transitions', '/:id/incident', '/:id/checkpoint', '/:id/active',
      '/:executionId/artifacts', '/:executionId/artifacts/pending-approval',
      '/artifacts/:id',
    ];
    const rows = UNGATED_TODAY.filter((r) => STORE_BACKED.includes(r.path));
    expect(rows).toHaveLength(7);

    // 1. An operator on an EMPTY store still gets data absence.
    store.execution = null;
    store.artifact = null;
    for (const row of rows) {
      const res = await call(row, SEATS.STRATEGIST);
      expect(res.status, label(row)).toBe(404);
    }

    // 2. A CLIENT gets the SAME answer whether the row exists or not — so the
    //    refusal carries no information about what the workspace contains.
    const clientOnEmpty = [];
    for (const row of rows) clientOnEmpty.push((await call(row, SEATS.CLIENT)).status);

    store.execution = { ...EXECUTION_FIXTURE };
    store.artifact = { ...ARTIFACT_FIXTURE };
    const clientOnSeated = [];
    for (const row of rows) clientOnSeated.push((await call(row, SEATS.CLIENT)).status);

    expect(clientOnEmpty).toEqual(clientOnSeated);
    expect(new Set(clientOnEmpty)).toEqual(new Set([403]));
  });
});
