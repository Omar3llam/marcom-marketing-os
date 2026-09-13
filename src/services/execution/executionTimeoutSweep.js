// ============================================================
// executionTimeoutSweep — the declared timeout policy, actually applied
// ============================================================
// THE PROPERTY
//
//   An execution accepted into an in-flight state must not remain there
//   indefinitely. Past its declared budget it reaches the terminal state the
//   system already defines for exactly this: TIMED_OUT.
//
// ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
//
// Everything needed already existed and nothing ran it.
//
//   TIMEOUT_POLICY            PENDING 5m · QUEUED 10m · EXECUTING 2m
//   isExecutionTimedOut()     documented "Used by timeout handler to identify
//                             candidates for automatic TIMED_OUT transition"
//   lifecycleService.timeout() the full pipeline — validation, OCC, audit,
//                             telemetry — under ARCHITECTURAL LAW 5,
//                             "Timeouts Are State Transitions"
//
// `timeout()` had FIVE call sites and every one was a test. The handler the
// policy names was never built, so no execution could reach TIMED_OUT in
// production — while `retry.js` accepted TIMED_OUT as retryable, `incident.js`
// rendered it as "timeout collision", and observability queried for it. The
// product was built to surface, retry and report a state nothing could produce.
//
// This is the C-12 shape for the third time — the cure existing with zero
// callers — after C-12 itself and R11 (I61)'s invalidateWorkspaceCache.
//
// ── WHY A SWEEP, AND WHY ON THIS QUEUE ──────────────────────────────────────
//
// It shares the maintenance queue for the reason that queue's own header gives:
// always on, spends nothing. Like planClosureSweep beside it, the fact it
// records is a LIFECYCLE fact, and it must not wait for anyone to open a
// screen — `isStale` was already computed in getExecutionState, but a value
// derived at read time records when somebody LOOKED, not when the budget passed.
//
// It is NOT a setInterval in the API process. The API runs N instances behind a
// load balancer; a per-process timer would sweep N times, and the work belongs
// to the worker topology that already owns scheduled work.
//
// ── WHAT THIS SWEEP MAY NOT DO ──────────────────────────────────────────────
//
// It performs NO direct status write. ARCHITECTURAL LAW 1 — every transition
// goes through the lifecycle service — and that is not a formality here: the
// service re-checks timeout eligibility itself, so a row that moved between
// this query and the call is refused rather than force-timed. The select is a
// candidate list, never an authority.
//
// It invents no second timeout mechanism and no second policy. The budgets are
// read from @marcom/runtime-contracts, which is where the product declares them.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { lifecycleService } from './ExecutionLifecycleService.js';
import { IN_FLIGHT_STATUSES, getTimeoutForStatus } from '@marcom/runtime-contracts';

/**
 * Most executions resolved per sweep. A bound, not a throttle: the sweep runs
 * on a schedule, so a backlog drains over several ticks instead of turning one
 * maintenance job into an unbounded read. An in-flight status with more
 * candidates than this keeps the oldest first, which is the order an operator
 * cares about.
 */
export const SWEEP_BATCH_LIMIT = Number(process.env.EXECUTION_TIMEOUT_BATCH || 200);

/** The in-flight statuses that actually carry a budget. */
export function statusesWithBudget() {
  return IN_FLIGHT_STATUSES.filter((s) => getTimeoutForStatus(s) != null);
}

/**
 * Resolve every execution held past its declared budget.
 *
 * @param {{ now?: Date, limit?: number }} [opts]
 * @returns {Promise<{ timedOut: number, refused: number, failed: number, scanned: number }>}
 */
export async function runExecutionTimeoutSweep({ now = new Date(), limit = SWEEP_BATCH_LIMIT } = {}) {
  let timedOut = 0;
  let refused = 0;
  let failed = 0;
  let scanned = 0;

  for (const status of statusesWithBudget()) {
    const budget = getTimeoutForStatus(status);
    const cutoff = new Date(now.getTime() - budget);

    // One query per status because each status has its OWN budget. A single
    // query would need the widest cutoff and then re-filter in JS, which reads
    // more rows to answer the same question.
    const candidates = await prisma.executionRequest.findMany({
      where:   { status, updatedAt: { lt: cutoff } },
      select:  { id: true, correlationId: true, status: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
      take:    limit,
    });

    scanned += candidates.length;

    for (const row of candidates) {
      try {
        // The service validates eligibility again and holds the OCC. A row that
        // moved since the query is REFUSED here, which is the correct outcome —
        // a worker that just picked it up owns it, not this sweep.
        await lifecycleService.timeout(row.id, row.correlationId ?? row.id);
        timedOut += 1;
      } catch (err) {
        // Losing the race is ordinary and is not a failure of the sweep.
        const raced = /not timed out|already terminal|version|concurren/i.test(err?.message ?? '');
        if (raced) {
          refused += 1;
          continue;
        }
        failed += 1;
        logger.error({
          executionId: row.id, status: row.status, err: err.message,
        }, '[executionTimeoutSweep] could not resolve a timed-out execution');
      }
    }
  }

  // Reported, not swallowed — the same reasoning as its neighbours on this
  // queue. A sweep that quietly did nothing is indistinguishable from one that
  // worked, and this one exists precisely because nothing was watching.
  logger.info({ timedOut, refused, failed, scanned }, '[executionTimeoutSweep] complete');
  return { timedOut, refused, failed, scanned };
}
