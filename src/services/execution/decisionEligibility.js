// ============================================================
// R13-D / B4-A (D2) — may this decision be executed?
// ============================================================
// One definition, read at TWO moments, because one check is not enough.
//
//   1. the canonical producer, before an ExecutionRequest exists
//   2. the worker, immediately before the real Meta call
//
// The second is not belt-and-braces. A request can be queued while the decision
// is live and drain seconds or minutes later, and in between the sweep can
// supersede it or an operator can dismiss it. Checking only at the route means
// the platform mutation still lands, against a call nobody stands behind any
// more — and it lands looking exactly like a legitimate one.
//
// WHY A DISMISSED DECISION MUST NOT EXECUTE
// Dismissal is the operator saying "no". Executing afterwards overrides a human
// decision with a queue delay. The self-report route has always refused this
// (409 AlreadyDismissed); the canonical producer did not, so the two paths
// disagreed about the same decision — one refused to RECORD an execution the
// other would actually PERFORM.
//
// WHY A SUPERSEDED DECISION MUST NOT EXECUTE
// SUPERSEDED means the engine has since issued a different verdict for that
// entity. Acting on the replaced one applies advice Lumi has withdrawn, and
// `resolvePrevious` has already scored it as a closed call — an execution
// arriving afterwards would attribute a fresh mutation to a decision whose
// resolution is already written.
//
// PURE + a thin reader. The predicate takes a row so both call sites can test
// it without a database, and `loadExecutability` is the one query, so the
// SELECT and the rule cannot drift apart.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

/** Machine-readable refusals. Each names the ONE thing the caller must fix. */
export const NOT_EXECUTABLE = Object.freeze({
  DECISION_NOT_FOUND: 'DECISION_NOT_FOUND',
  DISMISSED:          'DISMISSED',
  SUPERSEDED:         'SUPERSEDED',
  LOOKUP_FAILED:      'LOOKUP_FAILED',
});

/**
 * The only status that may be acted on.
 *
 * Read as an allow-list, not a deny-list: a status added to the enum later is
 * refused until somebody decides it should be executable, rather than silently
 * inheriting permission.
 */
export const EXECUTABLE_STATUS = 'PROPOSED';

/** Columns the predicate reads. An unselected column is undefined, not null. */
export const ELIGIBILITY_SELECT = Object.freeze({
  id: true,
  status: true,
  dismissedAt: true,
});

/**
 * PURE: may this decision row be executed?
 *
 * @param {{status?:string, dismissedAt?:Date|null}|null} decision
 * @returns {{ executable: boolean, reason: string|null }}
 */
export function eligibilityOf(decision) {
  if (!decision) return { executable: false, reason: NOT_EXECUTABLE.DECISION_NOT_FOUND };

  // Dismissal first: it is the operator's own refusal, and it is the more
  // specific answer when a decision is both dismissed and superseded.
  if (decision.dismissedAt != null) {
    return { executable: false, reason: NOT_EXECUTABLE.DISMISSED };
  }
  if (decision.status !== EXECUTABLE_STATUS) {
    return { executable: false, reason: NOT_EXECUTABLE.SUPERSEDED };
  }
  return { executable: true, reason: null };
}

/**
 * Read one decision, workspace-scoped, and answer whether it may be executed.
 *
 * A FAILED READ IS NOT PERMISSION. The catch returns LOOKUP_FAILED rather than
 * falling through to executable — "we could not establish that this decision is
 * still live" and "this decision is still live" are different facts, and only
 * one of them may precede a real ad-platform mutation.
 *
 * @returns {Promise<{ executable: boolean, reason: string|null }>}
 */
export async function loadExecutability(workspaceId, decisionId) {
  if (!workspaceId) throw new Error('loadExecutability: workspaceId required');
  if (!decisionId) throw new Error('loadExecutability: decisionId required');

  try {
    // Scoped in the WHERE. A findUnique on the id alone would resolve another
    // workspace's decision and then leave the scope check to whoever remembered.
    const decision = await prisma.decision.findFirst({
      where:  { id: decisionId, workspaceId },
      select: ELIGIBILITY_SELECT,
    });
    return eligibilityOf(decision);
  } catch (err) {
    logger.error(
      { err: err.message, workspaceId, decisionId },
      '[decisionEligibility] lookup failed — refusing rather than assuming executable',
    );
    return { executable: false, reason: NOT_EXECUTABLE.LOOKUP_FAILED };
  }
}
