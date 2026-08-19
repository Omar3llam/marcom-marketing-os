// ============================================================
// MARCOM / Lumi — useLumiExecution
// ------------------------------------------------------------
// The execution lifecycle, kept separate from the Decision lifecycle.
//
// THE ONE RULE THIS FILE EXISTS FOR: a 202 from the producer is a RECEIPT, not
// a result. It says a request was accepted and queued. Whether Meta accepted
// the mutation is decided later, by a worker, and is only knowable by reading
// the persisted execution back. So this hook never renders success from the
// POST — it renders QUEUED, then polls, and lets the row say what happened.
//
// Collapsing those two would be the worst class of lie this product can tell:
// an operator seeing "Paused" while the campaign is still spending, with the
// failure visible nowhere.
//
// STATE, and why each one is distinct:
//   READY            nothing attempted
//   SUBMITTING       the POST is in flight — ours, not the platform's
//   QUEUED           accepted and enqueued; Meta has not been called yet
//   EXECUTING        the worker has picked it up
//   EXECUTED_SUCCESS Meta accepted the mutation
//   EXECUTED_FAILED  Meta refused it, or the retries ran out
//   TIMED_OUT / CANCELLED  terminal, and neither a success nor a Meta refusal
//   REJECTED         the producer refused the REQUEST (4xx) — nothing was queued
//
// REJECTED is deliberately not folded into EXECUTED_FAILED: one means the ad
// platform said no, the other means we never asked. The remedies differ.
// ============================================================
import { useState, useCallback, useRef, useEffect } from 'react';
import { executeWithLumi, fetchDecisionExecutions } from './executionSignals.js';

export const EXEC_STATE = Object.freeze({
  READY:            'READY',
  SUBMITTING:       'SUBMITTING',
  QUEUED:           'QUEUED',
  EXECUTING:        'EXECUTING',
  EXECUTED_SUCCESS: 'EXECUTED_SUCCESS',
  EXECUTED_FAILED:  'EXECUTED_FAILED',
  TIMED_OUT:        'TIMED_OUT',
  CANCELLED:        'CANCELLED',
  REJECTED:         'REJECTED',
});

/** States that will never change again without a new action. */
export const TERMINAL = Object.freeze([
  EXEC_STATE.EXECUTED_SUCCESS, EXEC_STATE.EXECUTED_FAILED,
  EXEC_STATE.TIMED_OUT, EXEC_STATE.CANCELLED, EXEC_STATE.REJECTED,
]);

const POLL_MS = 2000;
// A ceiling, not a timeout: after this the hook stops asking and says so. It
// does NOT invent a failure — the execution may still be running, and the row
// remains the truth. "We stopped watching" and "it failed" are different.
const MAX_POLLS = 45;

/**
 * PURE: map a producer rejection onto a reason the surface can say out loud.
 *
 * Reads the server's status and code, never the action attempted. Each of these
 * is a real, distinct answer — none of them is "try again".
 */
export function rejectionFor(err) {
  const status = err?.response?.status ?? null;
  const code = err?.response?.data?.code ?? err?.response?.data?.error ?? null;

  // The decision id did not name a decision in this workspace. The one refusal
  // that must never be worked around by falling back to entity identity.
  if (status === 422 || code === 'ATTRIBUTION_UNRESOLVED') return 'ATTRIBUTION_UNRESOLVED';
  // Already queued under this key — an existing execution, not a new one.
  if (status === 409) return 'ALREADY_QUEUED';
  if (status === 403) return 'NOT_PERMITTED';
  if (status === 401) return 'NOT_AUTHENTICATED';
  if (status === 429 || code === 'QUEUE_FULL') return 'BUSY';
  if (status === 400) return 'INVALID_REQUEST';
  return 'REQUEST_FAILED';
}

/** PURE: an execution row's status → the hook's state vocabulary. */
export function stateFromStatus(status) {
  switch (status) {
    case 'PENDING':
    case 'QUEUED':           return EXEC_STATE.QUEUED;
    case 'EXECUTING':        return EXEC_STATE.EXECUTING;
    case 'EXECUTED_SUCCESS': return EXEC_STATE.EXECUTED_SUCCESS;
    case 'EXECUTED_FAILED':  return EXEC_STATE.EXECUTED_FAILED;
    case 'TIMED_OUT':        return EXEC_STATE.TIMED_OUT;
    case 'CANCELLED':        return EXEC_STATE.CANCELLED;
    // An unknown status is NOT quietly treated as success or failure. Reporting
    // it as still-running is the honest reading: something exists and we do not
    // recognise its state.
    default:                 return status ? EXEC_STATE.EXECUTING : EXEC_STATE.READY;
  }
}

/**
 * Execution state for the decisions on screen, keyed by decisionId.
 *
 * @returns {{ states, executions, rejections, watching, run, refresh }}
 */
export function useLumiExecution() {
  const [states, setStates] = useState({});       // decisionId → EXEC_STATE
  const [executions, setExecutions] = useState({}); // decisionId → the read-path envelope
  const [rejections, setRejections] = useState({}); // decisionId → rejection reason

  // In-flight guard. A ref, not the state map: React batches updates, so a
  // second click in the same tick would read a stale map and queue a second
  // real mutation. This is the one place in the product where that costs money.
  const busy = useRef(new Set());
  const timers = useRef(new Map());
  const alive = useRef(true);

  useEffect(() => () => {
    alive.current = false;
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
  }, []);

  const stopWatching = useCallback((decisionId) => {
    const t = timers.current.get(decisionId);
    if (t) clearTimeout(t);
    timers.current.delete(decisionId);
  }, []);

  /** Read the execution back and settle, or schedule another look. */
  const poll = useCallback(async (decisionId, remaining) => {
    if (!alive.current) return;
    try {
      const { data } = await fetchDecisionExecutions(decisionId);
      if (!alive.current) return;

      setExecutions((m) => ({ ...m, [decisionId]: data }));
      const next = stateFromStatus(data?.current?.status ?? null);
      setStates((m) => ({ ...m, [decisionId]: next }));

      if (TERMINAL.includes(next) || remaining <= 0) {
        stopWatching(decisionId);
        return;
      }
    } catch {
      // A failed READ says nothing about the execution. Leaving the state where
      // it was — and continuing to watch — is the only honest response; turning
      // a polling hiccup into EXECUTED_FAILED would report a platform refusal
      // that never happened.
      if (remaining <= 0) { stopWatching(decisionId); return; }
    }
    const t = setTimeout(() => poll(decisionId, remaining - 1), POLL_MS);
    timers.current.set(decisionId, t);
  }, [stopWatching]);

  /**
   * Ask Lumi to carry out a decision.
   * @param {string} decisionId
   * @param {{actionType, targetId, targetType}} execution — the server's own
   *   descriptor from the verdict payload, passed through untouched.
   */
  const run = useCallback(async (decisionId, execution) => {
    if (!decisionId || busy.current.has(decisionId)) return;
    busy.current.add(decisionId);

    setRejections((m) => ({ ...m, [decisionId]: null }));
    setStates((m) => ({ ...m, [decisionId]: EXEC_STATE.SUBMITTING }));

    try {
      await executeWithLumi({ decisionId, ...execution });
      if (!alive.current) return;
      // QUEUED, never EXECUTED. The receipt says the request exists; the row
      // will say what Meta did with it.
      setStates((m) => ({ ...m, [decisionId]: EXEC_STATE.QUEUED }));
      poll(decisionId, MAX_POLLS);
    } catch (err) {
      if (!alive.current) return;
      const reason = rejectionFor(err);
      setRejections((m) => ({ ...m, [decisionId]: reason }));
      setStates((m) => ({ ...m, [decisionId]: EXEC_STATE.REJECTED }));
      // A 409 means an execution already exists under this decision. Reading it
      // back turns a refusal into the truth about what is already running.
      if (reason === 'ALREADY_QUEUED') poll(decisionId, MAX_POLLS);
    } finally {
      busy.current.delete(decisionId);
    }
  }, [poll]);

  /** Load existing execution state without starting anything. */
  const refresh = useCallback(async (decisionId) => {
    if (!decisionId) return;
    try {
      const { data } = await fetchDecisionExecutions(decisionId);
      if (!alive.current) return;
      setExecutions((m) => ({ ...m, [decisionId]: data }));
      // No executions is a real answer: this decision has never been executed
      // by Lumi. It is READY, not failed — and if the operator self-reported,
      // the envelope's own executedAt says so separately.
      setStates((m) => ({ ...m, [decisionId]: stateFromStatus(data?.current?.status ?? null) }));
    } catch {
      // Unknown stays unknown. The button is not re-enabled on our failure.
    }
  }, []);

  return { states, executions, rejections, run, refresh };
}
