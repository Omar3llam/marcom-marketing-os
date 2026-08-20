// ============================================================
// decisionAttribution — which Decision a platform execution carries out
// ============================================================
// R10 (I55). Before this module a real Meta mutation had no link back to the
// call that prompted it. `Decision.executedAt` — the column the whole Proof
// Engine population is derived from (DecisionAccuracyService.ACTIONED) — was
// written by exactly one thing: an operator clicking "I did this" in the UI. So
// an operator who let Lumi execute the action, rather than telling Lumi they had
// executed it themselves, produced a decision the Proof Engine could never see.
//
// TWO FUNCTIONS, AND THE SPLIT IS DELIBERATE
//   resolveAttribution() runs at REQUEST time and answers "may this execution
//   claim this decision". It fails CLOSED: an id from another workspace, or one
//   that does not exist, resolves to null rather than to somebody else's row.
//
//   stampDecisionExecuted() runs at SUCCESS time and answers "record that the
//   operator acted". Never at queue time, never on failure — see below.
//
// QUEUED ≠ ATTEMPTED ≠ EXECUTED
//   The stamp means a platform mutation actually landed. An execution that was
//   accepted, queued, and then rejected by Meta is not an action anybody took,
//   and counting it would put a decision into the accuracy population whose
//   "outcome" is the absence of an intervention. That is the single most
//   corrupting row this system could hold, because it looks exactly like a real
//   one.
//
// FIRST SUCCESS WINS
//   One Decision can own several ExecutionRequests: `retry` mints a fresh row,
//   and one verdict can be acted on at more than one target.
//   `platformExecutedAt` is set ONCE and never overwritten — it records WHEN
//   Lumi first landed a mutation for this call, not how many times. So the stamp
//   is conditional on that column still being null, and a second success is a
//   no-op rather than a
//   re-dating. This is also what makes the worker safe to retry: BullMQ can
//   deliver the same job twice and the second delivery changes nothing.
//
// NEVER OVERTURNS A DISMISSAL
//   A decision the operator explicitly rejected must not become "executed"
//   because an unrelated execution named it. The two human signals are mutually
//   exclusive by construction in routes/lumi/decisions.js, and that rule holds
//   here too — enforced in the WHERE, not by reading and then deciding, so a
//   concurrent dismissal cannot slip between the check and the write.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

/**
 * Validate that `decisionId` names a Decision in THIS workspace.
 *
 * @param {string} workspaceId — from trusted context, NEVER a request field (I2)
 * @param {unknown} decisionId — as supplied by the caller; may be absent
 * @returns {Promise<{ decisionId: string|null, rejected: boolean }>}
 *   `rejected` is true only when an id WAS supplied and did not resolve — the
 *   caller can then refuse the execution rather than silently executing it
 *   unattributed. Absent input is not a rejection: an execution with no
 *   originating decision is a normal, honest state.
 */
export async function resolveAttribution(workspaceId, decisionId) {
  if (!workspaceId) throw new Error('resolveAttribution: workspaceId required');
  if (decisionId == null || decisionId === '') return { decisionId: null, rejected: false };
  if (typeof decisionId !== 'string') return { decisionId: null, rejected: true };

  // Scoped in the WHERE (R9 · I40). A findUnique on the id alone would resolve
  // another workspace's decision and then leave the scope check to whoever
  // remembered to write one.
  const found = await prisma.decision.findFirst({
    where: { id: decisionId, workspaceId },
    select: { id: true },
  }).catch((err) => {
    // A failed lookup is not "no attribution" — it is "we could not establish
    // attribution", and writing null would record a false fact about a real
    // mutation. Rejected, so the caller refuses rather than mis-attributes.
    logger.error({ err: err.message, workspaceId, decisionId }, '[decisionAttribution] lookup failed');
    return null;
  });

  return found ? { decisionId: found.id, rejected: false } : { decisionId: null, rejected: true };
}

/**
 * Record that a human acted on this decision, because a platform mutation
 * succeeded. Idempotent and first-success-only (see the header).
 *
 * Best-effort BY DESIGN: the mutation has already happened on the ad platform
 * and the execution's own lifecycle row is the record of it. A failure to stamp
 * must not fail the job and cause BullMQ to re-run a Meta write. It IS logged at
 * error level — a silently unstamped decision is the exact gap R10 exists to
 * close, and it must be visible when it happens.
 *
 * @param {object} args
 * @param {string} args.workspaceId
 * @param {string|null} args.decisionId
 * @param {Date} [args.at] — server time; injected for tests
 * @returns {Promise<{ stamped: boolean, reason: string }>}
 */
export async function stampDecisionExecuted({ workspaceId, decisionId, at = new Date() } = {}) {
  if (!workspaceId || !decisionId) return { stamped: false, reason: 'NOT_ATTRIBUTED' };

  try {
    // updateMany, not update: the predicate carries the whole rule, so the
    // database decides. `platformExecutedAt: null` makes the first success win; a
    // `dismissedAt: null` makes an explicit rejection unoverturnable; and
    // `workspaceId` keeps the write scoped even though the id came from a
    // scoped read, because a second guarantee costs one column.
    // B4-A — this writes PLATFORM provenance and nothing else. It is the only
    // writer of `platformExecutedAt` in the system, and the column means one
    // thing: Meta accepted a mutation Lumi performed. `humanExecutedAt` is a
    // different fact with a different writer and is deliberately untouched
    // here — an operator's earlier self-report is not overwritten, corrected or
    // cleared by Lumi later executing the same call.
    const { count } = await prisma.decision.updateMany({
      where: { id: decisionId, workspaceId, platformExecutedAt: null, dismissedAt: null },
      data: { platformExecutedAt: at },
    });

    if (count > 0) {
      logger.info({ workspaceId, decisionId, platformExecutedAt: at }, '[decisionAttribution] decision stamped platform-executed');
      return { stamped: true, reason: 'STAMPED' };
    }
    // Nothing matched. Either it was already stamped (a retry, or a second
    // execution of the same call) or the operator had dismissed it. Both are
    // correct outcomes, and neither is an error.
    return { stamped: false, reason: 'ALREADY_RESOLVED' };
  } catch (err) {
    logger.error(
      { err: err.message, workspaceId, decisionId },
      '[decisionAttribution] could not stamp platformExecutedAt — this execution is missing from the accuracy population',
    );
    return { stamped: false, reason: 'ERROR' };
  }
}
