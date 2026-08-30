// ============================================================
// Execution schema-skew safety (B5-01R′)
// ============================================================
// WHAT THIS PROTECTS
//
//   A worker running code for schema N, against a database still at N-1, must
//   not reach the ad platform. Not once, and not on any retry.
//
// WHY IT NEEDS PROTECTING
//
// render.yaml deploys lumi-backend and lumi-worker independently, both with
// autoDeploy, with no `dependsOn` and no readiness gate. The worker's build is
// the shorter of the two (`npm install && prisma generate`, no migration, no
// vite), so it routinely starts FIRST — before the backend's build has run
// `prisma migrate deploy`. B5-01R proved that window is real and provable from
// repository configuration alone.
//
// Inside that window the system is safe today, but nothing says so and no test
// asserted it. The safety comes from ONE query that reads the whole row:
//
//     ExecutionLifecycleService.transition()  →  src/services/execution/…:110
//     const currentExecution = await prisma.executionRequest.findUnique({
//       where: { id: executionId },        ← NO select. Prisma names every column.
//     });
//
// A column the datamodel declares and the database lacks makes that read throw
// P2022, and it throws BEFORE the OCC write moves the row out of QUEUED. So
// every retry lands in the same place and the platform is never called.
//
// ── WHY A NARROWER READ IS NOT A SAFE OPTIMISATION ──────────────────────────
// MEASURED (B5-01R, counterfactual, reverted): give that read an explicit
// `select` and the barrier inverts.
//
//     attempt 1  OCC updateMany succeeds  → status becomes EXECUTING
//                occHelpers.js:90 re-read (still unselected) throws → job fails
//     attempt 2  worker sees status !== QUEUED → SKIPS the transition
//                → executeMetaAction FIRES — a real budget mutation
//                → post-provider write throws → job fails → retry
//     attempt 3  fires it AGAIN
//
// The unselected re-read in occHelpers is NOT a backstop: it fails one step too
// late, after the row has already left QUEUED, which is precisely what unlocks
// the platform call. The barrier is the read at :110 failing FIRST.
//
// ── WHAT THIS FILE IS, AND IS NOT ───────────────────────────────────────────
// The contract below is BEHAVIOURAL: it reproduces the skew and counts calls to
// the platform. It does not care how the property is achieved. Replace the
// accidental barrier with a deliberate one — a real schema check at worker
// boot, a version gate, a refusal on non-QUEUED rows — and these tests keep
// passing, which is the point. They protect the floor, not the implementation.
//
// The single structural pin at the end exists only to make the dependency
// FINDABLE from the code it depends on. It is explicitly replaceable; see its
// failure message.
//
// This is a ratchet, not the architectural fix. The open question B5-01R
// surfaced — whether a worker should be blocked outright from operating against
// a schema older than its code — is still open, and still an operations
// decision. This holds the floor until it is answered.
// ============================================================
import {
  describe, it, expect, vi, beforeAll, afterAll, beforeEach,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ── Mocks: everything EXCEPT the database and the lifecycle under test ──────
// prisma, ExecutionLifecycleService and occHelpers are all REAL. Mocking any of
// them would mock away the failure this file exists to prove.
let captured = null;
vi.mock('bullmq', () => ({
  Worker: class { constructor(_name, handler) { captured = handler; } on() {} close() {} },
  Queue: class { add() {} on() {} close() {} },
}));
vi.mock('../queues/connection.js', () => ({ bullConnection: {}, QUEUE_PREFIX: 'b5r-test' }));
vi.mock('../queues/index.js', () => ({ EXECUTION_QUEUE_NAME: 'executions' }));
vi.mock('../services/execution/workerHealth.js', () => ({
  startHeartbeat: () => ({ workerId: 'b5r-test', stop: vi.fn() }),
}));
// The platform seam. The whole measurement is "how many times was this called".
vi.mock('../services/metaExecutionService.js', () => ({
  executeMetaAction: vi.fn(async () => ({ success: true, data: { id: 'meta-accepted' } })),
}));
vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => ({
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    }),
  },
}));

import { executeMetaAction } from '../services/metaExecutionService.js';
import { prisma } from '../lib/prisma.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ENABLED = process.env.REQUIRE_DB === '1';

const WS = 'b5701700-0000-4000-8000-000000000001';
const ENTITY = 'b5701700-0000-4000-8000-000000000002';
const TARGET = '120200000000001';

/**
 * The skewed column. It must satisfy three things at once, or the test proves
 * something other than what it claims:
 *
 *   1. declared in schema.prisma            → the datamodel expects it
 *   2. NOT in executionWorker's own select  → the worker's read is not what fails
 *   3. written only AFTER the platform call → so a narrowed lifecycle read would
 *      genuinely reach the platform first
 *
 * `response` is the only column that satisfies all three. It carries the Meta
 * API response and is set by the EXECUTED_SUCCESS transition.
 */
const SKEWED_COLUMN = 'response';
const DROP = `ALTER TABLE "execution_requests" DROP COLUMN IF EXISTS "${SKEWED_COLUMN}"`;
const RESTORE = `ALTER TABLE "execution_requests" ADD COLUMN IF NOT EXISTS "${SKEWED_COLUMN}" JSONB`;

let seq = 0;
async function seedQueuedExecution() {
  const id = `b5r-skew-${++seq}`;
  const decision = await prisma.decision.create({
    data: {
      workspaceId: WS,
      entityId: ENTITY,
      entityLevel: 'CAMPAIGN',
      verdict: 'KILL',
      confidence: 0.9,
      diagnosis: 'b5-01r-prime fixture',
      status: 'PROPOSED',
    },
    select: { id: true },
  });
  await prisma.executionRequest.create({
    data: {
      id,
      workspaceId: WS,
      idempotencyKey: id,
      actionType: 'PAUSE_CAMPAIGN',
      targetId: TARGET,
      status: 'QUEUED',
      version: 0,
      payload: { targetType: 'campaign', options: {} },
      decisionId: decision.id,
    },
  });
  return id;
}

const makeJob = (executionId, attemptsMade = 0) => ({
  data: {
    executionId, workspaceId: WS, userId: 'b5r-user',
    actionType: 'PAUSE_CAMPAIGN', targetId: TARGET,
  },
  attemptsMade,
  opts: { attempts: 3 },
});

/** Run the real handler. Never lets a throw escape — a thrown job IS a result. */
async function runAttempt(executionId, attemptsMade) {
  try {
    return { threw: false, value: await captured(makeJob(executionId, attemptsMade)) };
  } catch (err) {
    return { threw: true, code: err.code ?? null, message: String(err.message ?? err) };
  }
}

/** Read status with raw SQL — a Prisma read would itself trip on the skew. */
async function rawStatus(id) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT status FROM execution_requests WHERE id = $1', id,
  );
  return rows[0]?.status ?? null;
}

describe.skipIf(!ENABLED)('B5-01R′ · execution schema-skew safety', () => {
  beforeAll(async () => {
    const { startExecutionWorker } = await import('../workers/executionWorker.js');
    startExecutionWorker();
    expect(captured, 'the worker handler was not captured — the bullmq mock changed shape').toBeTruthy();
    await prisma.workspace.upsert({
      where: { id: WS }, update: {}, create: { id: WS, name: 'b5-01r-prime' },
    });
  }, 120_000);

  afterAll(async () => {
    // Belt and braces: every test restores in its own `finally`, but a column
    // left dropped would poison every later file sharing this worker database.
    await prisma.$executeRawUnsafe(RESTORE).catch(() => {});
    await prisma.executionTransition.deleteMany({ where: { workspaceId: WS } }).catch(() => {});
    await prisma.executionRequest.deleteMany({ where: { workspaceId: WS } }).catch(() => {});
    await prisma.decision.deleteMany({ where: { workspaceId: WS } }).catch(() => {});
    await prisma.workspace.deleteMany({ where: { id: WS } }).catch(() => {});
  }, 120_000);

  beforeEach(() => { executeMetaAction.mockClear(); });

  // ── T3 · the healthy path is untouched ──────────────────────────────────
  it('T3 — a current schema still executes normally', async () => {
    const id = await seedQueuedExecution();

    const r = await runAttempt(id, 0);

    expect(r.threw, `the healthy path must not throw: ${r.message ?? ''}`).toBe(false);
    expect(executeMetaAction).toHaveBeenCalledTimes(1);
    expect(await rawStatus(id)).toBe('EXECUTED_SUCCESS');
  }, 120_000);

  // ── T1 · T2 · T5 — the contract ─────────────────────────────────────────
  it('T1/T2/T5 — a database one migration behind never reaches the platform', async () => {
    const id = await seedQueuedExecution();
    const attempts = [];
    let status;

    await prisma.$executeRawUnsafe(DROP);
    try {
      // Three attempts, because BullMQ retries (attempts: 3, exponential
      // backoff). One attempt would not have caught the counterfactual: there,
      // attempt 1 also called the platform zero times, and it was the RETRY
      // that fired the mutation.
      for (let attemptsMade = 0; attemptsMade < 3; attemptsMade += 1) {
        attempts.push(await runAttempt(id, attemptsMade));
      }
      status = await rawStatus(id);
    } finally {
      await prisma.$executeRawUnsafe(RESTORE);
    }

    // T2/T5 — THE assertion. Not "the execution failed", not a log line: the
    // platform seam itself, counted, across every retry.
    expect(
      executeMetaAction.mock.calls.length,
      'SCHEMA-SKEW SAFETY BYPASSED — a worker running against a database one\n'
      + 'migration behind reached the ad platform. This is a real budget or status\n'
      + 'mutation, applied once per BullMQ retry, with nothing recorded.\n\n'
      + 'The usual cause is that ExecutionLifecycleService.transition() no longer\n'
      + 'reads the whole ExecutionRequest row. Narrowing that read lets the OCC\n'
      + 'write move the row out of QUEUED; the next attempt then skips the\n'
      + 'transition entirely and calls executeMetaAction directly.\n'
      + 'See the header of this file for the measured sequence.',
    ).toBe(0);

    // T1 — the skew must actually have been detected. A green count of zero
    // would otherwise be satisfied by an execution that never ran at all.
    expect(attempts.every((a) => a.threw), 'every attempt must fail, not silently succeed').toBe(true);
    expect(
      attempts[0].code,
      `the first attempt must fail on the missing column, not something else: ${attempts[0].message}`,
    ).toBe('P2022');

    // The sharpest signal, and the one that separates the safe barrier from the
    // dangerous one: the row never advanced. In the counterfactual it reached
    // EXECUTING on attempt 1, and that is what unlocked the platform call.
    expect(
      status,
      'the execution left QUEUED under schema skew. The row advancing is what makes\n'
      + 'the platform reachable on retry — see this file\'s header.',
    ).toBe('QUEUED');
  }, 180_000);

  it('T1b — the skew is a real datamodel/database disagreement, not a fixture', async () => {
    // Guards the setup itself (MCC): if the column were never dropped, or were
    // dropped from a table nobody reads, the contract above would pass while
    // proving nothing.
    const schema = readFileSync(resolve(REPO, 'prisma/schema.prisma'), 'utf8');
    const model = schema.slice(schema.indexOf('model ExecutionRequest'));
    expect(
      new RegExp(`^\\s*${SKEWED_COLUMN}\\s`, 'm').test(model.slice(0, model.indexOf('\n}'))),
      `${SKEWED_COLUMN} must be declared in schema.prisma for its absence to be skew`,
    ).toBe(true);

    // ...and it must NOT be in the worker's own select, or the worker's read
    // would fail first and the lifecycle read would never be exercised.
    const worker = readFileSync(resolve(REPO, 'src/workers/executionWorker.js'), 'utf8');
    const select = worker.slice(worker.indexOf('prisma.executionRequest.findUnique'));
    expect(
      new RegExp(`\\b${SKEWED_COLUMN}:\\s*true`).test(select.slice(0, select.indexOf('});'))),
      `${SKEWED_COLUMN} must be absent from executionWorker's select, or this file\n`
      + 'proves the worker read fails rather than the lifecycle read',
    ).toBe(false);
  });

  // ── The structural pin — deliberately replaceable ───────────────────────
  it('makes the load-bearing read findable from the code that depends on it', () => {
    // NOT the contract. The contract is the behavioural test above, and it
    // stands on its own: replace this mechanism with a deliberate one — a schema
    // check at worker boot, a version gate, a refusal to act on a non-QUEUED
    // row — and that test keeps passing while this pin stops making sense.
    //
    // This exists so that someone editing ExecutionLifecycleService.js can find
    // out, from a failing test, that the query they are about to narrow is
    // load-bearing. Deleting this pin as part of a proven replacement is a
    // correct thing to do. Deleting it to make a red test green is not.
    const src = readFileSync(resolve(REPO, 'src/services/execution/ExecutionLifecycleService.js'), 'utf8');
    const transition = src.slice(src.indexOf('async transition('));
    const read = transition.slice(transition.indexOf('prisma.executionRequest.findUnique'));
    const call = read.slice(0, read.indexOf('});') + 3);

    expect(
      /select\s*:/.test(call),
      'ExecutionLifecycleService.transition() now reads ExecutionRequest with an\n'
      + 'explicit `select`. That read is the schema-skew barrier: unselected, it\n'
      + 'throws on a missing column BEFORE the OCC write moves the row out of\n'
      + 'QUEUED, so no retry can reach the ad platform.\n\n'
      + 'If you are deliberately replacing the barrier, the behavioural test in\n'
      + 'this file is the real contract — make it pass by other means and remove\n'
      + 'this pin in the same change. If you are narrowing the query to fetch\n'
      + 'fewer fields, do not: it is measurably not free.',
    ).toBe(false);
  });
});
