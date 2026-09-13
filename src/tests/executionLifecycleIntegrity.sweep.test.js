// ============================================================
// SLICE D — the sweep's own contract
// ------------------------------------------------------------
// Written because the mutation battery found three survivors, and each one was
// a real gap rather than an uninteresting mutation:
//
//   sweep-not-scheduled-at-startup        the job is dispatched and the handler
//                                         exists, but nothing registers the
//                                         repeat — so it never runs in
//                                         production and every behavioural case
//                                         still passed, because the suite calls
//                                         the dispatcher directly
//   sweep-counts-a-lost-race-as-a-timeout the sweep reports resolving work it
//                                         did not resolve
//   sweep-reads-without-a-bound           one maintenance tick becomes an
//                                         unbounded read
//
// None of these breaks the lifecycle invariant, which is why the behavioural
// suite could not see them. They break what the sweep CLAIMS and what it COSTS,
// and a backstop that misreports or reads unboundedly is a backstop nobody can
// trust the next time it matters.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const store = vi.hoisted(() => ({
  rows: [],
  findManyArgs: [],
  timeoutBehaviour: null,
  timeoutCalls: [],
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    executionRequest: {
      findMany: vi.fn(async (args) => {
        store.findManyArgs.push(args);
        return store.rows.filter((r) => r.status === args.where.status);
      }),
    },
  },
}));

vi.mock('../services/execution/ExecutionLifecycleService.js', () => ({
  lifecycleService: {
    timeout: vi.fn(async (id, corr) => {
      store.timeoutCalls.push({ id, corr });
      if (store.timeoutBehaviour) throw store.timeoutBehaviour;
      return { id, status: 'TIMED_OUT' };
    }),
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { runExecutionTimeoutSweep, statusesWithBudget, SWEEP_BATCH_LIMIT } =
  await import('../services/execution/executionTimeoutSweep.js');

beforeEach(() => {
  store.rows = [];
  store.findManyArgs = [];
  store.timeoutBehaviour = null;
  store.timeoutCalls = [];
});

const seat = (status, n = 1) => {
  for (let i = 0; i < n; i += 1) {
    store.rows.push({ id: `${status}-${i}`, correlationId: `c-${status}-${i}`, status, updatedAt: new Date(0) });
  }
};

describe('the sweep resolves what it finds', () => {
  it('hands every candidate to the lifecycle service', async () => {
    seat('QUEUED', 3);
    const result = await runExecutionTimeoutSweep();
    expect(result.timedOut).toBe(3);
    expect(store.timeoutCalls).toHaveLength(3);
  });

  it('covers every in-flight status that declares a budget', async () => {
    for (const s of statusesWithBudget()) seat(s, 1);
    const result = await runExecutionTimeoutSweep();
    expect(result.timedOut).toBe(statusesWithBudget().length);
    expect(statusesWithBudget().length).toBeGreaterThan(1);
  });
});

describe('the sweep reports only what it actually did', () => {
  it('a LOST RACE is refused, never counted as a timeout', async () => {
    // The row moved between the query and the call — a worker picked it up, or
    // another sweep instance got there first. That is the correct outcome and
    // the sweep must not claim it resolved anything.
    seat('QUEUED', 2);
    store.timeoutBehaviour = new Error('Cannot timeout execution x: not timed out yet');

    const result = await runExecutionTimeoutSweep();
    expect(result.timedOut).toBe(0);
    expect(result.refused).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('a REAL failure is counted as a failure, not as a race', async () => {
    seat('QUEUED', 1);
    store.timeoutBehaviour = new Error('connection terminated unexpectedly');

    const result = await runExecutionTimeoutSweep();
    expect(result.timedOut).toBe(0);
    expect(result.refused).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('one bad row does not abandon the rest of the sweep', async () => {
    seat('QUEUED', 3);
    let call = 0;
    const { lifecycleService } = await import('../services/execution/ExecutionLifecycleService.js');
    lifecycleService.timeout.mockImplementation(async (id) => {
      call += 1;
      if (call === 2) throw new Error('connection terminated unexpectedly');
      return { id };
    });

    const result = await runExecutionTimeoutSweep();
    expect(result.timedOut).toBe(2);
    expect(result.failed).toBe(1);
  });
});

describe('the sweep is bounded', () => {
  it('every read carries an explicit row limit', async () => {
    seat('QUEUED', 1);
    await runExecutionTimeoutSweep();

    expect(store.findManyArgs.length).toBeGreaterThan(0);
    for (const args of store.findManyArgs) {
      expect(typeof args.take, 'an unbounded sweep turns one tick into an unbounded read')
        .toBe('number');
      expect(args.take).toBeGreaterThan(0);
    }
  });

  it('the limit is the declared batch size, and the oldest go first', async () => {
    seat('QUEUED', 1);
    await runExecutionTimeoutSweep();
    const args = store.findManyArgs[0];
    expect(args.take).toBe(SWEEP_BATCH_LIMIT);
    expect(args.orderBy).toEqual({ updatedAt: 'asc' });
  });
});

describe('the sweep is registered, not merely implemented', () => {
  it('the maintenance worker SCHEDULES the repeat at startup', () => {
    // The mutation that removed this survived every behavioural case, because
    // the suite calls the dispatcher directly and never needed the cron. In
    // production the cron is the only thing that calls the dispatcher at all.
    const worker = readFileSync('src/workers/maintenanceWorker.js', 'utf8');
    expect(worker).toMatch(/scheduleExecutionTimeout\(\)/);
  });

  it('the scheduler replaces its own previous registration', () => {
    // BullMQ repeatables persist in Redis keyed by their pattern. Adding
    // without removing leaves a changed cron running BESIDE the old one — the
    // hazard unscheduleAgenticSweep exists to handle.
    // Read with the line endings normalised: this repository is CRLF on disk,
    // and my first version looked for a '\n}\n' terminator that never matched,
    // so it asserted against a two-character slice. The instrument was wrong,
    // not the scheduler.
    const queues = readFileSync('src/queues/index.js', 'utf8').replace(/\r\n/g, '\n');
    const start = queues.indexOf('export async function scheduleExecutionTimeout');
    expect(start, 'the scheduler must be findable').toBeGreaterThan(-1);
    const fn = queues.slice(start);
    const end = fn.indexOf('\n}\n');
    expect(end, 'the function must terminate').toBeGreaterThan(-1);
    const body = fn.slice(0, end);
    expect(body).toContain('removeRepeatableByKey');
    expect(body).toContain('EXECUTION_TIMEOUT_JOB');
  });
});
