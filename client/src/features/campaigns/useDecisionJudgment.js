// ============================================================
// MARCOM / Lumi — useDecisionJudgment (R13-b)
// ------------------------------------------------------------
// "What did you decide?", for every surface that shows a verdict with a stored
// Decision behind it. ONE hook rather than a copy per mount point, for the same
// reason useDecisionAction is one: the request is trivial, and deciding which
// server answers are FAILURES and which are ANSWERS is not.
//
// ── THE ANSWERS THAT ARE NOT FAILURES ───────────────────────────────────────
// axios rejects on every 4xx, so the naive catch turns three true statements
// into "couldn't record":
//   409 JudgmentAlreadyRecorded — a DIFFERENT judgement is already on record.
//       The response body carries it, so the surface reconciles to the server's
//       version instead of retrying into the same 409 forever.
//   409 DecisionNotActionable  — a sweep superseded the call between render and
//       click. The decision they judged is no longer the live one.
//   404 DecisionNotFound       — the decision is not in this workspace.
// Only 400 (our payload was wrong), 403 (this seat may not) and 5xx/transport
// are worth a different treatment, and only the last of those is retryable.
//
// ── THE SERVER'S COPY WINS, ALWAYS ──────────────────────────────────────────
// `recorded` holds what the SERVER says is on record — from a 200 or from a 409
// body, never from what the operator typed. That is what makes an identical
// re-submit (200, `recorded: false`, the ORIGINAL timestamp) and a conflicting
// one (409, the original judgement) render the same true thing. It is a cache
// of a server answer, not a local source of truth: the verdict read is
// authoritative on load, and this only carries the answer forward within a
// session so the UI need not refetch the whole feed to show one row.
//
// State is keyed by decisionId — ConnectorCampaignsPanel renders many rows from
// one hook instance, and a scalar would have every row echo the last click.
// ============================================================
import { useState, useCallback, useRef } from 'react';
import { recordJudgment } from './judgmentSignals.js';

/**
 * PURE: the terminal state a failed request should settle into.
 *
 * Reads the server's error CODE, never the attempted response — the same rule
 * terminalStateFor follows, and for the same reason: the surface must report
 * what is true, not what was clicked.
 *
 * @param {unknown} err — an axios error, or anything else that got thrown
 * @returns {'conflict'|'superseded'|'unavailable'|'denied'|'invalid'|'error'}
 */
export function judgmentOutcomeFor(err) {
  const status = err?.response?.status ?? null;
  const code = err?.response?.data?.error ?? null;

  if (status === 409 && code === 'JudgmentAlreadyRecorded') return 'conflict';
  if (status === 409) return 'superseded'; // DecisionNotActionable
  if (status === 404) return 'unavailable';
  if (status === 403 || status === 401) return 'denied';
  if (status === 400) return 'invalid';
  return 'error';
}

/**
 * PURE: the judgement a payload asserts is on record, or null.
 *
 * Shared by the 200 and 409 paths because both bodies carry the same four
 * fields — the 409 states what is already there, the 200 states what now is.
 * `humanRespondedAt` is the discriminator: a body without it is not a recorded
 * judgement, and rendering one from a partial payload would date a claim we
 * cannot date.
 */
export function judgmentFrom(payload) {
  if (!payload || !payload.humanRespondedAt) return null;
  return {
    humanResponse:    payload.humanResponse ?? null,
    humanReasonCode:  payload.humanReasonCode ?? null,
    humanReasonNote:  payload.humanReasonNote ?? null,
    humanRespondedAt: payload.humanRespondedAt,
  };
}

/**
 * Records the operator's judgement of a verdict.
 *
 * @returns {{
 *   states: Record<string, string>,
 *   recorded: Record<string, object>,
 *   messages: Record<string, string>,
 *   submit: (decisionId: string, judgement: object) => Promise<void>
 * }}
 *   states[decisionId] — null | 'saving' | 'recorded' | 'conflict'
 *                      | 'superseded' | 'unavailable' | 'denied' | 'invalid' | 'error'
 *   recorded[decisionId] — the SERVER's judgement, present for 'recorded' and
 *                          'conflict' and absent for every other state
 *   messages[decisionId] — the server's own validation message, 'invalid' only
 */
export function useDecisionJudgment() {
  const [states, setStates] = useState({});
  const [recorded, setRecorded] = useState({});
  const [messages, setMessages] = useState({});
  // In-flight decisions. A REF, not the `states` map: React batches state
  // updates, so a second click in the same tick would read `states` before
  // 'saving' had landed and fire a duplicate request. A ref updates
  // synchronously, which is the only thing that can gate a synchronous click.
  const inFlight = useRef(new Set());

  const submit = useCallback(async (decisionId, judgement) => {
    if (!decisionId) return;

    // The server is idempotent for an identical repeat, so this is UX rather
    // than safety — but a double-click should not produce two spinners.
    if (inFlight.current.has(decisionId)) return;
    inFlight.current.add(decisionId);
    setStates((s) => ({ ...s, [decisionId]: 'saving' }));

    try {
      const res = await recordJudgment(decisionId, judgement);
      // NO OPTIMISTIC WRITE. Nothing above this line touched `recorded`, so
      // until Postgres has confirmed it the surface shows "saving" and not a
      // judgement — a recorded state rendered before the server agreed is a
      // claim about a row that may not exist.
      const server = judgmentFrom(res?.data);
      setRecorded((r) => ({ ...r, [decisionId]: server }));
      // A 200 with `recorded: false` is a SUCCESS: the judgement is on record,
      // which is the only thing the operator asked about. Whether THIS click
      // wrote it is our bookkeeping.
      setStates((s) => ({ ...s, [decisionId]: 'recorded' }));
    } catch (err) {
      const outcome = judgmentOutcomeFor(err);
      // The conflict body carries the judgement that is actually stored. Taking
      // it here is what turns 409 from an error into a reconciliation.
      if (outcome === 'conflict') {
        const server = judgmentFrom(err?.response?.data);
        setRecorded((r) => ({ ...r, [decisionId]: server }));
      }
      if (outcome === 'invalid') {
        const msg = err?.response?.data?.message;
        if (msg) setMessages((m) => ({ ...m, [decisionId]: msg }));
      }
      setStates((s) => ({ ...s, [decisionId]: outcome }));
    } finally {
      // Released on every path. A retryable 5xx must be retryable.
      inFlight.current.delete(decisionId);
    }
  }, []);

  return { states, recorded, messages, submit };
}
