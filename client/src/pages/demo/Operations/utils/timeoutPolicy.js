// ============================================================
// Operations · timeout policy (client mirror)
// ------------------------------------------------------------
// Mirrors src/services/execution/transitionRules.js · TIMEOUT_POLICY.
// Used to flag "overage" segments on the Execution Timeline when
// an in-flight state held longer than its server-side budget.
//
// KEEP IN SYNC with the backend constant. A schema-shared contract
// (e.g. types/execution.ts driving both server + client) is the
// long-term fix; mirroring is the pragmatic short-term choice.
// ============================================================

/** Maximum allowed duration per non-terminal status, in milliseconds. */
export const TIMEOUT_POLICY = Object.freeze({
  PENDING:   5 * 60 * 1000,    // 5 minutes — campaign upload → queue
  QUEUED:    10 * 60 * 1000,   // 10 minutes — queue → worker pickup
  EXECUTING: 2 * 60 * 1000,    // 2 minutes — Meta API call duration
  // RETRYING piggybacks on EXECUTING's budget; explicit entry omitted
  // intentionally so the call site falls back to no overage check.
  // Terminal states never time out.
});

/**
 * Return the overage in milliseconds if a segment exceeded its budget,
 * or null otherwise. `status` is the state HELD during the segment
 * (i.e. the `toStatus` of the entering transition), `elapsedMs` is the
 * wall time spent in it.
 */
export function getTimeoutOverageMs(status, elapsedMs) {
  const budget = TIMEOUT_POLICY[status];
  if (budget == null) return null;
  if (elapsedMs == null || !Number.isFinite(elapsedMs)) return null;
  if (elapsedMs <= budget) return null;
  return elapsedMs - budget;
}
