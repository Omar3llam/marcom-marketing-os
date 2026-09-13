// ============================================================
// SLICE D — a harness over the REAL execution lifecycle
// ------------------------------------------------------------
// THE INVARIANT Slice D exists to establish:
//
//   Every execution accepted into an in-flight state must either progress to
//   execution or reach a TERMINAL state, and any timeout policy the system
//   declares must be actively reachable in production.
//
// Terminal-state integrity is the PRIMARY invariant. Visibility and
// recoverability are consequences of it, never substitutes for it — which is
// why nothing in these suites asserts that a counter should count differently
// or that a new status should become retryable.
//
// WHAT IS REAL
//   • the shipped execution router (imported whole — Slice C's lesson: a
//     harness that declares its own routes can assert the opposite of the
//     product, as PARITY-02 measured)
//   • ExecutionLifecycleService — its validation, its OCC, its telemetry
//   • occHelpers.updateWithOCC, against a store that really implements the lock
//   • the timeout policy in @marcom/runtime-contracts
//
// WHAT IS STUBBED
//   • the identity stores (Firebase verifier, user row)
//   • the QUEUE — so a test can make `enqueueExecution` fail, which is the
//     precondition under examination
//   • Meta — no suite here performs a platform call
//
// ⚠️ THE STORE IMPLEMENTS OCC FOR REAL. `updateMany({ where: { id, version } })`
// matches on the version or affects zero rows, exactly as Postgres would. A
// store that ignored the version would make every transition succeed and the
// lifecycle service's central guarantee untestable — the suite would be
// measuring its own fixture.
// ============================================================
import express from 'express';

/** An in-memory ExecutionRequest table with a real optimistic lock. */
export function createExecutionStore() {
  const rows = new Map();
  const transitions = [];
  const auditLogs = [];

  const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && Array.isArray(v.in)) return v.in.includes(row[k]);
    if (v && typeof v === 'object' && v.lt instanceof Date) return new Date(row[k]) < v.lt;
    if (v && typeof v === 'object' && v.gte instanceof Date) return new Date(row[k]) >= v.gte;
    return row[k] === v;
  });

  const project = (row, select) => {
    if (!row) return null;
    if (!select) return { ...row };
    const out = {};
    for (const k of Object.keys(select)) {
      if (!select[k]) continue;
      // A nested object is a RELATION select, not a scalar. GET /active asks for
      // `transitions: { orderBy, take, select }` and then reads
      // `e.transitions[0]`, so returning undefined here would crash the route
      // and the suite would be measuring this fixture's gap rather than the
      // product. Relations resolve to the rows that actually reference this id.
      if (typeof select[k] === 'object') {
        out[k] = transitions
          .filter((t) => t.executionId === row.id)
          .slice(0, select[k].take ?? undefined);
        continue;
      }
      out[k] = row[k];
    }
    return out;
  };

  return {
    rows,
    transitions,
    auditLogs,

    /** Seat a row directly, for the states a route cannot legally produce. */
    seat(row) {
      const full = {
        id: row.id,
        workspaceId: row.workspaceId ?? 'ws-1',
        userId: row.userId ?? 'u-1',
        status: row.status,
        version: row.version ?? 1,
        actionType: row.actionType ?? 'PAUSE_CAMPAIGN',
        targetId: row.targetId ?? '123456',
        correlationId: row.correlationId ?? ('corr-' + row.id),
        decisionId: row.decisionId ?? null,
        payload: row.payload ?? { targetType: 'campaign', options: {} },
        retryMetadata: row.retryMetadata ?? null,
        createdAt: row.createdAt ?? new Date(),
        updatedAt: row.updatedAt ?? new Date(),
      };
      rows.set(full.id, full);
      return full;
    },

    prisma: {
      executionRequest: {
        create: async ({ data, select }) => {
          const row = {
            id: data.id ?? ('exec-' + (rows.size + 1)),
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            retryMetadata: null,
            decisionId: null,
            ...data,
          };
          rows.set(row.id, row);
          return project(row, select);
        },
        findUnique: async ({ where, select }) => project(rows.get(where.id), select),
        findFirst: async ({ where, select }) => {
          for (const r of rows.values()) if (matches(r, where)) return project(r, select);
          return null;
        },
        findMany: async ({ where, select } = {}) => {
          const out = [];
          for (const r of rows.values()) if (matches(r, where)) out.push(project(r, select));
          return out;
        },
        count: async ({ where } = {}) => {
          let n = 0;
          for (const r of rows.values()) if (matches(r, where)) n += 1;
          return n;
        },
        // THE OPTIMISTIC LOCK, for real.
        updateMany: async ({ where, data }) => {
          const row = rows.get(where.id);
          if (!row) return { count: 0 };
          if (where.version !== undefined && row.version !== where.version) return { count: 0 };
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && typeof v.increment === 'number') row[k] = (row[k] ?? 0) + v.increment;
            else row[k] = v;
          }
          row.updatedAt = data.updatedAt ?? new Date();
          return { count: 1 };
        },
      },
      executionTransition: {
        create: async ({ data }) => { transitions.push({ ...data }); return { ...data, id: 't' + transitions.length }; },
        findMany: async ({ where } = {}) => transitions.filter((t) => matches(t, where)),
      },
      executionMetric: { findMany: async () => [], findFirst: async () => null },
      auditLog: {
        create: async ({ data }) => { auditLogs.push({ ...data }); return { ...data, id: 'a' + auditLogs.length }; },
        findMany: async () => [...auditLogs],
        count: async () => auditLogs.length,
      },
      artifact: { findMany: async () => [], findUnique: async () => null, count: async () => 0 },
      decision: { findFirst: async () => null, findUnique: async () => null },
      outcomeSnapshot: { count: async () => 0 },
      $queryRaw: async () => [{ 1: 1 }],
    },
  };
}

/**
 * Build an app serving the REAL execution router behind the real upstream
 * chain. Call AFTER the suite's vi.mock declarations.
 */
export async function buildExecutionApp() {
  const { firebaseAuthMiddleware, requireAuth } = await import('../middleware/firebaseAuth.js');
  const { requireWorkspace } = await import('../middleware/requireWorkspace.js');
  const executionRouter = (await import('../routes/execution/index.js')).default;

  const app = express();
  app.use(express.json());
  app.use(firebaseAuthMiddleware);
  app.use('/api/execute', requireAuth, requireWorkspace, executionRouter);
  return app;
}

/** The operator seat these suites act as. Slice C's baseline gates the mount. */
export const OPERATOR = { uid: 'seat-operator', collabRole: 'STRATEGIST' };
export const WORKSPACE_ID = 'ws-1';

export const userRowFor = (seat) => ({
  id: 'u-' + seat.uid,
  workspaceId: WORKSPACE_ID,
  role: 'USER',
  collabRole: seat.collabRole,
});

export const tokenFor = (seat) => 'token-for-' + seat.uid;

/** A body POST /meta accepts. */
export const VALID_META_BODY = Object.freeze({
  actionType: 'PAUSE_CAMPAIGN',
  targetId: '123456',
  targetType: 'campaign',
  idempotencyKey: 'idem-1',
});
