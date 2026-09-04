// ============================================================
// planClosureSweep — a period ends, and that is ALL this says (C-18)
// ============================================================
// 🔒 C-18, Ruling D: "الوقت يملك انتهاء الصلاحية الإدارية، وليس نتيجة التعلّم."
// Time owns the administrative expiry. It does not own the verdict.
//
// ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
//
// `PlanStatus.CLOSED` had zero writers. Nothing anywhere read `periodEnd` to end
// a plan, so a plan whose period finished six months ago stayed ACTIVE and stayed
// what `AgenticLoopService` called "the active plan" — with Lumi still tracking
// its goals and still raising strategist agenda items about them.
//
// ── THE LINE THIS SWEEP MAY NOT CROSS ───────────────────────────────────────
//
//     periodEnd passes  →  CLOSED + closedAt        a lifecycle fact
//     periodEnd passes  →  ACHIEVED / MISSED        a claim about learning
//
// A clock can prove a period ended. It cannot prove a target was met. So this
// writes two fields on one table and touches nothing else — no NorthStarGoal, no
// AllocationPlan, and above all no Decision.
//
// That last one is Invariant 13, which C-05 settled in the neighbouring slice:
// `decisionLearning` admits a row on `resolution IS NOT NULL` plus an
// intervention stamp, so an administrative close that wrote a resolution would
// enrol everything it touched into institutional memory as a SUCCESS nobody
// claimed — teaching Lumi that a calendar page turning improved the account.
//
// ── WHY IT IS A SWEEP AND NOT A READ-TIME DERIVATION ────────────────────────
//
// Lumi computes almost everything on read, and "expired" could have been
// derived the same way. It is written instead because `closedAt` has to record
// WHEN, and a value derived at read time records when someone LOOKED. Closure
// must not depend on anyone opening a screen.
//
// It shares the maintenance queue for the reason that queue's own header gives:
// always on, spends nothing. This is one deterministic UPDATE.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

/**
 * Close every ACTIVE plan whose period has ended.
 *
 * ONE statement across all workspaces, not a per-workspace fan-out: unlike the
 * learning sweep beside it, this reads no evidence window and runs no engine —
 * it is a single indexed UPDATE, and splitting it per workspace would turn one
 * cheap statement into N.
 *
 * Idempotent. `closedAt: null` is in the predicate as well as `status: ACTIVE`,
 * so a re-run cannot re-stamp a moment that was already recorded.
 *
 * DRAFT plans are left alone. An unpromoted plan whose period lapsed is a
 * separate question — it was never in force, so "closing" it would assert a
 * lifecycle it never entered.
 *
 * @param {{ now?: Date }} [opts]
 * @returns {Promise<{ closed: number }>}
 */
export async function runPlanClosureSweep({ now = new Date() } = {}) {
  const { count } = await prisma.plan.updateMany({
    where: { status: 'ACTIVE', periodEnd: { lt: now }, closedAt: null },
    data:  { status: 'CLOSED', closedAt: now },
  });

  // Reported, not swallowed — the same reasoning as its neighbours on this
  // queue: a sweep that quietly did nothing is indistinguishable from one that
  // worked, and this one exists precisely because nobody was watching.
  logger.info({ closed: count }, '[planClosureSweep] complete');
  return { closed: count };
}
