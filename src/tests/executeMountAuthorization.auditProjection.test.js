// ============================================================
// SLICE C · RED — GET /audit must not widen its own projection
// ------------------------------------------------------------
// Closure condition 8: "GET /audit cannot widen its projection into privileged
// operational data merely because a future column is added."
//
// THE MECHANISM. audit.js reads `prisma.auditLog.findMany({ where, orderBy,
// skip, take })` — with NO `select`. Prisma's default projection is "every
// scalar column", so the route returns whatever the table happens to hold. The
// day a column is added to AuditLog, that column ships from this endpoint, and
// nobody editing the schema has any reason to look at a route file.
//
// This is [[prisma-default-projection-widening]] — a law this repository has
// already measured once — arriving at the read with the widest audience on the
// mount. The two defects compound: an unprojected read is a question about
// WHAT is returned, an ungated route is a question about WHO receives it, and
// /audit is currently the wrong answer to both.
//
// ⚠️ THE CLOSURE CONDITION, AS OMAR CORRECTED IT. My first wording made this
// file assert that /audit "may only return declared columns", which smuggles a
// data-contract decision in under a security heading. The security property is
// narrower and stronger:
//
//   The audit response must have an EXPLICIT, TESTED projection. Adding a new
//   database column must not automatically make that column externally readable.
//
// So this file does NOT decide whether `payload` or `response` belong in the
// response. The implementation chooses the projection; these cases pin whatever
// it chose and prove that schema evolution cannot widen it. Narrowing the audit
// contract remains a separate product ruling that has not been given.
//
// The seat here is a STRATEGIST — fully authorized. Projection is a separate
// question from authorization, and asking it from an authorized seat keeps the
// two from hiding behind each other.
//
// ⚠️ THIS FILE IS RED on trunk.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';

const store = vi.hoisted(() => ({
  rows: new Map(),
  auditRows: [],
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

vi.mock('../lib/prisma.js', () => {
  const empty = async () => [];
  const none = async () => null;
  const zero = async () => 0;
  return {
    prisma: {
      user: { findUnique: vi.fn(async ({ where }) => store.rows.get(where.clerkId) ?? null) },
      // ── THE SEAM UNDER TEST ────────────────────────────────────────
      // This stub mirrors Prisma's documented projection contract exactly:
      //
      //   findMany({ ... })                 -> every scalar column
      //   findMany({ ..., select: { a } })  -> only the named fields
      //
      // That is the whole mechanism. The stub does not decide the outcome; it
      // reproduces the client's behaviour and lets the ROUTE's own choice of
      // whether to declare a projection decide — the same split Slice B used
      // for verifyIdToken, where the stub honoured `checkRevoked` and the
      // product's choice of call was the finding.
      //
      // A stub that ignored `select` could not observe a projection at all,
      // which is how the first version of this file failed to see the fix.
      auditLog: {
        findMany: vi.fn(async ({ select } = {}) => (
          select
            ? store.auditRows.map((row) => Object.fromEntries(
              Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]),
            ))
            : store.auditRows
        )),
        count: vi.fn(async () => store.auditRows.length),
        create: async () => ({}),
      },
      executionRequest: { findUnique: none, findFirst: none, findMany: empty, count: zero },
      executionTransition: { findMany: empty },
      executionMetric: { findMany: empty, findFirst: none },
      artifact: { findMany: empty, findUnique: none, count: zero },
      decision: { findFirst: none, findUnique: none },
      outcomeSnapshot: { count: zero },
    },
  };
});

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../queues/index.js', () => ({
  executionQueue: { count: vi.fn().mockResolvedValue(0) },
  enqueueExecution: vi.fn().mockResolvedValue({}),
}));
vi.mock('../services/execution-checkpoint/index.js', () => ({
  getLatestCheckpoint: vi.fn().mockResolvedValue(null),
  getPausedExecutions: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/execution-engine/observability/executionTrace.js', () => ({
  buildTrace: vi.fn().mockResolvedValue({ timeline: [] }),
}));
vi.mock('../services/execution-engine/observability/traceSerializer.js', () => ({
  serializeTrace: vi.fn((t) => t),
}));
vi.mock('../services/artifact-storage/index.js', () => ({ getArtifact: vi.fn().mockResolvedValue(null) }));
vi.mock('../services/execution/workerHealth.js', () => ({ getWorkerHeartbeats: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/execution/ExecutionLifecycleService.js', () => ({
  lifecycleService: { transition: vi.fn(), getExecutionState: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../services/execution/ExecutionResumeService.js', () => ({
  resumeWithDecisions: vi.fn(), ResumeError: class extends Error {},
}));

const { buildExecuteMount, SEATS, rowFor, tokenFor } = await import('./executeMountAuthorization.harness.js');

/**
 * THE DECLARED PROJECTION — the fields the route itself says it returns.
 *
 * This list is pinned, not chosen here. Slice C's implementation declares the
 * projection in audit.js and deliberately declares TODAY'S CONTRACT UNCHANGED,
 * so no consumer loses a field it already receives. What changes is that the
 * set is now written down in one place and asserted in another; a column added
 * to the table tomorrow is not in it.
 *
 * Editing this list is how the audit contract changes. That is the point: it
 * should take a decision, not a migration.
 */
const DECLARED_PROJECTION = [
  'id', 'workspaceId', 'userId', 'actionId', 'actionType', 'targetId',
  'platform', 'status', 'payload', 'response', 'errorMessage', 'performedAt',
];

/** A column nobody has declared — the future, standing in for itself. */
const FUTURE_COLUMN = 'providerAccessContext';

let app;

beforeEach(async () => {
  store.rows.clear();
  for (const seat of Object.values(SEATS)) store.rows.set(seat.uid, rowFor(seat));
  store.auditRows = [{
    id: 'audit-1',
    workspaceId: 'ws-1',
    userId: 'u-seat-strategist',
    actionId: null,
    actionType: 'PAUSE_CAMPAIGN',
    targetId: 'camp-1',
    platform: 'META',
    status: 'PENDING',
    payload: { actionType: 'PAUSE_CAMPAIGN', targetId: 'camp-1' },
    response: null,
    errorMessage: null,
    performedAt: new Date('2026-09-01T00:00:00Z'),
    // Added to the table by a migration nobody connected to this route.
    [FUTURE_COLUMN]: 'a-secret-the-route-never-declared',
  }];
  app = await buildExecuteMount();
});

const getAudit = () => request(app)
  .get('/api/execute/audit')
  .set('Authorization', `Bearer ${tokenFor(SEATS.STRATEGIST)}`);

describe('control — the route is reachable and the fixture is what it reads', () => {
  it('an authorized operator receives the audit log', async () => {
    const res = await getAudit();
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].id).toBe('audit-1');
  });

  it('control — the fixture really does carry the undeclared column', () => {
    // If this failed, the case below would pass for the wrong reason: a route
    // cannot leak a column that was never in the row.
    expect(store.auditRows[0]).toHaveProperty(FUTURE_COLUMN);
  });

  it('control — the stub honours a projection AND widens without one', async () => {
    // The stub's two behaviours, asserted directly, so neither result below can
    // be an accident of how the fixture was written.
    const { prisma } = await import('../lib/prisma.js');

    const unprojected = await prisma.auditLog.findMany({});
    expect(Object.keys(unprojected[0])).toContain(FUTURE_COLUMN);

    const projected = await prisma.auditLog.findMany({ select: { id: true } });
    expect(Object.keys(projected[0])).toEqual(['id']);
  });
});

describe('schema evolution cannot widen the audit response', () => {
  // THE SECURITY PROPERTY. A column reaching the table must not reach the API.
  it('a column added to the table does NOT appear in the response', async () => {
    const res = await getAudit();
    expect(Object.keys(res.body.logs[0])).not.toContain(FUTURE_COLUMN);
  });

  // THE PROJECTION IS TESTED, which is the other half of the condition: an
  // explicit projection nobody asserts can drift as quietly as an absent one.
  it('the response carries exactly the projection the route declares', async () => {
    const res = await getAudit();
    expect(Object.keys(res.body.logs[0]).sort()).toEqual([...DECLARED_PROJECTION].sort());
  });

  it('every field a consumer receives today still arrives — nothing was narrowed', async () => {
    // Slice C closes a widening risk. It is not the slice that decides the
    // audit contract, so it may not quietly shrink one either.
    const res = await getAudit();
    for (const field of DECLARED_PROJECTION) {
      expect(Object.keys(res.body.logs[0]), field).toContain(field);
    }
  });
});

describe('the read declares its projection at source', () => {
  it('auditLog.findMany names the fields it returns', () => {
    // The behavioural cases above can be satisfied by filtering in the handler.
    // This one says where the truth should live: a read that does not declare a
    // projection inherits every future column by default, and no reviewer of
    // the migration will ever see this file.
    const src = readFileSync('src/routes/execution/audit.js', 'utf8');
    const call = src.slice(src.indexOf('auditLog.findMany('));
    const body = call.slice(0, call.indexOf('});') + 3);
    expect(body).toContain('select:');
  });
});
