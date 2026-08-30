// ============================================================
// Worker schema readiness gate (B5-01R‴)
// ============================================================
// The companion to executionSchemaSkew.test.js, and deliberately not a
// replacement for it. That file pins the ACCIDENTAL barrier (a full-row Prisma
// read that happens to throw first). This file proves the INTENTIONAL one, and
// proves it still holds when the accidental barrier is taken away — which is
// the only way to know the policy is real rather than inherited.
//
// Skew is simulated the way a deploy actually produces it: a migration this
// image ships is not recorded applied in the database. That is exactly the state
// a worker sees when it starts before the backend has finished migrating — the
// DEFAULT on every deploy, since the worker's build is the shorter one.
//
// The provider seam is the measurement. Not a log line, not a status, not "the
// execution failed": the number of times executeMetaAction was called.
// ============================================================
import {
  describe, it, expect, vi, beforeAll, afterAll, beforeEach,
} from 'vitest';

let captured = null;
vi.mock('bullmq', () => ({
  Worker: class { constructor(_name, handler) { captured = handler; } on() {} close() {} },
  Queue: class { add() {} on() {} close() {} },
}));
vi.mock('../queues/connection.js', () => ({ bullConnection: {}, QUEUE_PREFIX: 'b5r3' }));
vi.mock('../queues/index.js', () => ({ EXECUTION_QUEUE_NAME: 'executions' }));
vi.mock('../services/execution/workerHealth.js', () => ({
  startHeartbeat: () => ({ workerId: 'b5r3', stop: vi.fn() }),
}));
vi.mock('../services/metaExecutionService.js', () => ({
  executeMetaAction: vi.fn(async () => ({ success: true, data: { id: 'meta-accepted' } })),
}));
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { executeMetaAction } from '../services/metaExecutionService.js';
import { prisma } from '../lib/prisma.js';
import {
  checkExecutionSchemaReady, assertExecutionSchemaReady, shippedMigrations,
  SchemaNotReadyError, __resetReadinessCache,
} from '../services/execution/schemaReadiness.js';

const ENABLED = process.env.REQUIRE_DB === '1';
const WS = 'b5013000-0000-4000-8000-000000000001';
const ENTITY = 'b5013000-0000-4000-8000-000000000002';
const TARGET = '120200000000001';

const raw = (s) => prisma.$executeRawUnsafe(s);

/** The migration this image ships last — the one a lagging database lacks. */
const LATEST = shippedMigrations().at(-1);

let seq = 0;
async function seedQueued() {
  const id = `b5r3-${++seq}`;
  const decision = await prisma.decision.create({
    data: {
      workspaceId: WS, entityId: ENTITY, entityLevel: 'CAMPAIGN', verdict: 'KILL',
      confidence: 0.9, diagnosis: 'b5-01r3 fixture', status: 'PROPOSED',
    },
    select: { id: true },
  });
  await prisma.executionRequest.create({
    data: {
      id, workspaceId: WS, idempotencyKey: id, actionType: 'PAUSE_CAMPAIGN',
      targetId: TARGET, status: 'QUEUED', version: 0,
      payload: { targetType: 'campaign', options: {} }, decisionId: decision.id,
    },
  });
  return id;
}

const makeJob = (executionId, attemptsMade = 0) => ({
  data: {
    executionId, workspaceId: WS, userId: 'b5r3-user',
    actionType: 'PAUSE_CAMPAIGN', targetId: TARGET,
  },
  attemptsMade,
  opts: { attempts: 3 },
});

async function runAttempt(executionId, attemptsMade = 0) {
  try {
    return { threw: false, value: await captured(makeJob(executionId, attemptsMade)) };
  } catch (err) {
    return { threw: true, code: err.code ?? null, message: String(err.message ?? err) };
  }
}

const rawStatus = async (id) => (await prisma.$queryRawUnsafe(
  'SELECT status FROM execution_requests WHERE id = $1', id,
))[0]?.status ?? null;

/** Hide one applied migration: a database that has not run this image's latest. */
async function withLaggingDatabase(fn) {
  // Every column is captured, so the row goes back byte-for-byte rather than
  // merely equivalently. Worker databases are shared between FILES, so anything
  // this leaves altered is a trap for whichever suite runs next in the slot —
  // a lesson this run actually taught (see the RENAME note in
  // executionSchemaSkew.test.js).
  const [row] = await prisma.$queryRawUnsafe(
    'SELECT id, checksum, migration_name, started_at, finished_at, logs, rolled_back_at,'
    + ' applied_steps_count FROM _prisma_migrations WHERE migration_name = $1', LATEST,
  );
  expect(row, `${LATEST} must be applied in the test database before it can be hidden`).toBeTruthy();
  await raw(`DELETE FROM _prisma_migrations WHERE migration_name = '${LATEST}'`);
  __resetReadinessCache();
  try {
    return await fn();
  } finally {
    await prisma.$executeRawUnsafe(
      'INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at,'
      + ' logs, rolled_back_at, applied_steps_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      row.id, row.checksum, row.migration_name, row.started_at, row.finished_at,
      row.logs, row.rolled_back_at, row.applied_steps_count,
    );
    __resetReadinessCache();
  }
}

describe.skipIf(!ENABLED)('B5-01R‴ · worker schema readiness gate', () => {
  beforeAll(async () => {
    const { startExecutionWorker } = await import('../workers/executionWorker.js');
    startExecutionWorker();
    expect(captured, 'worker handler not captured').toBeTruthy();
    await prisma.workspace.upsert({
      where: { id: WS }, update: {}, create: { id: WS, name: 'b5-01r3' },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.executionTransition.deleteMany({ where: { workspaceId: WS } }).catch(() => {});
    await prisma.executionRequest.deleteMany({ where: { workspaceId: WS } }).catch(() => {});
    await prisma.decision.deleteMany({ where: { workspaceId: WS } }).catch(() => {});
    await prisma.workspace.deleteMany({ where: { id: WS } }).catch(() => {});
    __resetReadinessCache();
  }, 120_000);

  beforeEach(() => { executeMetaAction.mockClear(); __resetReadinessCache(); });

  // ── T1 · compatible schema ──────────────────────────────────────────────
  it('T1 — a compatible database is READY and executes normally', async () => {
    const state = await checkExecutionSchemaReady();
    expect(state.ready, `missing: ${state.missing.join(', ')}`).toBe(true);
    expect(state.shippedCount).toBeGreaterThan(60);

    const id = await seedQueued();
    const r = await runAttempt(id);

    expect(r.threw, r.message ?? '').toBe(false);
    expect(executeMetaAction).toHaveBeenCalledTimes(1);
    expect(await rawStatus(id)).toBe('EXECUTED_SUCCESS');
  }, 120_000);

  it('T1b — a database AHEAD of this image is still READY', async () => {
    // Rollback, and the normal rollout overlap: the backend has migrated and the
    // old worker is still draining. Refusing here would turn an ordinary deploy
    // into an outage, so the comparison is one-directional on purpose.
    await raw(
      'INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)'
      + " VALUES (gen_random_uuid()::text, 'b5r3', '29990101000000_from_the_future', now(), 1)",
    );
    try {
      const state = await checkExecutionSchemaReady();
      expect(state.ready).toBe(true);
      expect(state.appliedCount).toBeGreaterThan(state.shippedCount);
    } finally {
      await raw("DELETE FROM _prisma_migrations WHERE migration_name = '29990101000000_from_the_future'");
    }
  }, 120_000);

  // ── T2 · T3 — incompatible schema, and a job already queued ─────────────
  it('T2/T3 — a lagging database refuses, and a queued job reaches no provider', async () => {
    const id = await seedQueued();          // T3: the job exists BEFORE the skew

    const { attempts, status } = await withLaggingDatabase(async () => {
      const out = [];
      for (let a = 0; a < 3; a += 1) out.push(await runAttempt(id, a));
      return { attempts: out, status: await rawStatus(id) };
    });

    expect(
      executeMetaAction.mock.calls.length,
      'READINESS GATE BYPASSED — a worker running against a database older than its\n'
      + 'own code reached the ad platform. That is a real budget or status mutation,\n'
      + 'applied once per BullMQ retry.',
    ).toBe(0);

    expect(attempts.every((a) => a.threw)).toBe(true);
    expect(attempts.every((a) => a.code === 'SCHEMA_NOT_READY')).toBe(true);
    expect(attempts[0].message).toMatch(/database is behind this worker/);
    expect(attempts[0].message).toMatch(new RegExp(LATEST));
    // The row is untouched — no transition, so nothing to unwind when the
    // migration lands and the retry succeeds.
    expect(status).toBe('QUEUED');
  }, 180_000);

  // ── T4 · independent of the accidental barrier ──────────────────────────
  it('T4 — refusal does not depend on any Prisma projection', async () => {
    // The B5-01R′ barrier is a full-row read in ExecutionLifecycleService. This
    // proves the gate carries the property on its own: the skew here removes NO
    // column at all, so every Prisma read in the path would succeed. Only the
    // readiness check can refuse — and it does, before any read happens.
    const id = await seedQueued();

    const r = await withLaggingDatabase(async () => runAttempt(id));

    expect(r.threw).toBe(true);
    expect(r.code, 'the gate must refuse, not a downstream Prisma error').toBe('SCHEMA_NOT_READY');
    expect(executeMetaAction).toHaveBeenCalledTimes(0);
    // Prove the claim rather than asserting it: with the migration row restored,
    // every column the code names is present and the same job succeeds.
    __resetReadinessCache();
    expect((await checkExecutionSchemaReady()).ready).toBe(true);
    const after = await runAttempt(id);
    expect(after.threw, after.message ?? '').toBe(false);
    expect(executeMetaAction).toHaveBeenCalledTimes(1);
  }, 180_000);

  // ── T5 · the check itself failing is NOT READY ──────────────────────────
  it('T5 — a readiness check that cannot run fails closed', async () => {
    const broken = {
      $queryRawUnsafe: async () => { throw new Error('relation "_prisma_migrations" does not exist'); },
    };
    await expect(assertExecutionSchemaReady(broken)).rejects.toThrow(SchemaNotReadyError);
    await expect(assertExecutionSchemaReady(broken)).rejects.toThrow(/could not be determined/);
  }, 60_000);

  it('T5b — a ready answer is cached, a refusal never is', async () => {
    // Recovery without a timer, a poll loop or a sleep: the next job re-asks.
    let calls = 0;
    const lagging = {
      $queryRawUnsafe: async () => { calls += 1; return []; },   // nothing applied
    };
    await expect(assertExecutionSchemaReady(lagging)).rejects.toThrow(SchemaNotReadyError);
    await expect(assertExecutionSchemaReady(lagging)).rejects.toThrow(SchemaNotReadyError);
    expect(calls, 'a NOT-READY answer must be re-asked, or the worker can never recover').toBe(2);

    const ready = {
      $queryRawUnsafe: async () => {
        calls += 1;
        return shippedMigrations().map((migration_name) => ({ migration_name }));
      },
    };
    const before = calls;
    await assertExecutionSchemaReady(ready);
    await assertExecutionSchemaReady(ready);
    expect(calls - before, 'a READY answer is permanent for the process lifetime').toBe(1);
  }, 60_000);
});
