// ============================================================
// MARCOM / Lumi — executionSignals
// ------------------------------------------------------------
// "Lumi, do this." The other half of decisionSignals.js, and deliberately a
// SEPARATE module rather than another function beside recordExecute — because
// the two are different acts and the product must never blur them:
//
//   decisionSignals.recordExecute   "I already did this myself."  → a timestamp
//   executionSignals.executeWithLumi "You do it."                 → a real Meta
//                                                                   mutation
//
// One of these changes a customer's live ad account. Putting it in the same
// file as the self-report, under a similar name, is how a click ends up meaning
// something the person did not intend.
//
// THE IDENTITY RULE. `decisionId` is the only thing that names WHAT is being
// carried out. Never a campaign name, never an external id on its own, never a
// row index. The server re-resolves it inside the workspace (resolveAttribution)
// and refuses with 422 rather than executing unattributed — so the client does
// not, and must not, carry any attribution logic of its own.
//
// THE PARAMETER RULE. `actionType`, `targetId` and `targetType` are NOT derived
// here. They arrive on the verdict payload's `execution` block, decided by the
// server from the mutation layer's own rules. A client that computed them would
// be a second copy of the execution contract, and the first thing it would get
// wrong is which verdicts are executable at all.
// ============================================================
import { api } from '@/api/client';

/**
 * A per-attempt idempotency key. Random, not derived from the decision: two
 * deliberate executions of the same decision are two executions (a retry after
 * a failure, say), and a derived key would silently return the first one's
 * result for the second. The server's own 409 handles a double-CLICK, which is
 * the case that actually needs deduplicating.
 */
export function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `exec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Queue a real platform mutation for a decision.
 *
 * Resolves with the producer's 202 body — `{ executionId, status, … }`. That is
 * a RECEIPT, not a result: the mutation has been accepted for execution, and
 * whether Meta accepted it is answered later by the execution read path. The
 * caller must not render "executed" from this.
 *
 * @param {object} args
 * @param {string} args.decisionId — canonical Decision id; required
 * @param {string} args.actionType — from the verdict's `execution` block
 * @param {string} args.targetId   — the Meta object id, from the same block
 * @param {string} args.targetType — 'campaign' | 'adset' | 'ad'
 */
export function executeWithLumi({ decisionId, actionType, targetId, targetType } = {}) {
  // Rejected rather than silently posted: a request missing any of these would
  // be refused by the server anyway, and failing here names the real problem
  // instead of surfacing a validation message about a field the user never saw.
  if (!decisionId) return Promise.reject(new Error('executeWithLumi: decisionId is required'));
  if (!actionType || !targetId || !targetType) {
    return Promise.reject(new Error('executeWithLumi: actionType, targetId and targetType are required'));
  }

  return api.post('/api/execute/meta', {
    decisionId,
    actionType,
    targetId,
    targetType,
    idempotencyKey: newIdempotencyKey(),
  });
}

/**
 * What has actually been executed for this decision.
 *
 * Returns the whole list plus `current`, because a decision can own several
 * executions (a retry mints a new row). The UI reads `current` for state and
 * keeps the rest for lineage.
 */
export function fetchDecisionExecutions(decisionId) {
  if (!decisionId) return Promise.reject(new Error('fetchDecisionExecutions: decisionId is required'));
  return api.get(`/api/lumi/decisions/${encodeURIComponent(decisionId)}/executions`);
}
