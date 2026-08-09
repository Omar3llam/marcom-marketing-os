// ============================================================
// MARCOM / Lumi — useDecisionAction
// ------------------------------------------------------------
// "I executed this" / "Not applicable", for every surface that shows a verdict.
// ONE hook rather than a copy per mount point, because the interesting part is
// not the request — it is deciding which server answers are FAILURES and which
// are ANSWERS, and two copies of that judgement would drift.
//
// THE RULE THIS EXISTS TO ENFORCE. axios rejects on every 4xx, so the obvious
// `try { … } catch { setError() }` turns three honest answers into "couldn't
// record — try again":
//   409 AlreadyExecuted / AlreadyDismissed — the claim is already on record.
//       Retrying can only produce the same 409, forever.
//   404 NoLiveDecision — a sweep replaced the verdict between render and click.
//       The call they answered is gone; a retry chases a row that no longer
//       matches.
// Only a transport failure or a 5xx is worth offering a retry for. Telling an
// operator to retry the other three is how a surface teaches people to distrust
// it — and this is the one write in the product whose whole purpose is to be
// believed.
//
// State is keyed by entityId: ConnectorCampaignsPanel renders one row per
// campaign from a single hook instance, and a scalar would make every row echo
// whichever one was clicked last.
// ============================================================
import { useState, useCallback } from 'react';
import { recordExecute, recordDismiss } from './decisionSignals.js';

/**
 * PURE: the terminal state a failed request should settle into.
 *
 * Reads the server's error CODE, never the attempted action: `AlreadyDismissed`
 * means the row is dismissed regardless of which button produced it, so the UI
 * reports what is true rather than what was clicked.
 *
 * @param {unknown} err — an axios error, or anything else that got thrown
 * @returns {'executed'|'dismissed'|'stale'|'error'}
 */
export function terminalStateFor(err) {
  const status = err?.response?.status ?? null;
  const code = err?.response?.data?.error ?? null;

  if (status === 409 && code === 'AlreadyExecuted') return 'executed';
  if (status === 409 && code === 'AlreadyDismissed') return 'dismissed';
  // DecisionNotActionable is the by-id route's superseded refusal. The by-entity
  // adapter cannot emit it (its lookup filters on PROPOSED, so a superseded row
  // is a 404 instead) — handled anyway so repointing at the by-id routes later
  // does not silently reclassify it as a retryable failure.
  if (status === 404 || (status === 409 && code === 'DecisionNotActionable')) return 'stale';
  return 'error';
}

/**
 * Records the operator's answer to a verdict.
 *
 * @returns {{ states: Record<string, string>, execute: Function, dismiss: Function }}
 *   states[entityId] — null | 'executing' | 'executed' | 'dismissing'
 *                    | 'dismissed' | 'stale' | 'error'
 */
export function useDecisionAction() {
  const [states, setStates] = useState({});

  // `decisionId` is optional and stays optional: a campaign no sweep has written
  // a Decision for has none to send, and the by-entity fallback is the correct
  // route for it — not a degraded one. State is keyed by entityId either way,
  // since that is what the caller has a button for.
  const run = useCallback(async (entityId, kind, decisionId = null) => {
    if (!entityId) return;
    const isExecute = kind === 'execute';

    setStates((s) => ({ ...s, [entityId]: isExecute ? 'executing' : 'dismissing' }));
    try {
      // A 200 with `recorded: false` is a SUCCESS, not a no-op to report
      // differently: the operator's claim is on record, which is the only thing
      // they asked about. Whether this particular click was the one that wrote
      // it is our bookkeeping, not theirs.
      await (isExecute ? recordExecute(entityId, decisionId) : recordDismiss(entityId, decisionId));
      setStates((s) => ({ ...s, [entityId]: isExecute ? 'executed' : 'dismissed' }));
    } catch (err) {
      setStates((s) => ({ ...s, [entityId]: terminalStateFor(err) }));
    }
  }, []);

  const execute = useCallback((entityId, decisionId) => run(entityId, 'execute', decisionId), [run]);
  const dismiss = useCallback((entityId, decisionId) => run(entityId, 'dismiss', decisionId), [run]);

  return { states, execute, dismiss };
}
