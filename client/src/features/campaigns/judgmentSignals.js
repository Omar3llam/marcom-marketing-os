// ============================================================
// MARCOM / Lumi — judgment signals (R13-b)
// ------------------------------------------------------------
// One request: the operator's judgement of a verdict.
//
// Deliberately NOT in decisionSignals.js beside execute/dismiss. Those record
// what happened on the ad platform; this records what the human THOUGHT of the
// call, which is a different axis with a different route, a different payload
// and a different conflict contract. Sharing a file would invite sharing a
// helper, and the two must never converge — an OVERRIDE is not a dismissal.
//
// ── BY ID ONLY, AND THAT IS THE CONTRACT ────────────────────────────────────
// execute/dismiss carry a by-entity fallback because a campaign with no stored
// Decision still has an entity to name. Judgement has no such route and must
// not grow one: "the newest PROPOSED decision for this entity" is a QUERY, and
// attaching an operator's reasoning to whatever row that query resolves to at
// write time attributes their judgement to a call they may never have seen.
// No decisionId ⇒ no judgement UI. The caller enforces that; this module simply
// has no other path to offer.
//
// THROWS. Like recordExecute/recordDismiss and unlike the explain/intent
// telemetry: this is a claim the operator will believe landed, and the whole
// value of the record is that it is trustworthy. A swallowed failure would show
// a recorded judgement over an empty column.
// ============================================================
import { api } from '@/api/client';

/**
 * Record a human judgement against ONE decision.
 *
 * The body is built field by field rather than spread from a form object: the
 * server validates `reasonCode` against an enum and `reasonNote` against a
 * type, so an accidental `reasonCode: undefined` or `reasonNote: ''` travels as
 * a real value and gets a 400 the operator cannot act on. A CONFIRM sends
 * `{ response }` and nothing else, because it has nothing else to say.
 *
 * @param {string} decisionId — the STORED decision's id. Required.
 * @param {object} judgement
 * @param {'CONFIRM'|'OVERRIDE'|'ADJUST'} judgement.response
 * @param {?string} [judgement.reasonCode] — one of the nine canonical codes
 * @param {?string} [judgement.reasonNote] — free text; blank is omitted, not sent
 * @returns {Promise<import('axios').AxiosResponse>} rejects on any non-2xx
 */
export function recordJudgment(decisionId, { response, reasonCode = null, reasonNote = null } = {}) {
  if (!decisionId) {
    // A programming error, not a server one — surfaced as a rejection so the
    // hook's error path reports it rather than a request 404-ing on `/undefined`.
    return Promise.reject(new Error('recordJudgment: decisionId is required'));
  }

  const body = { response };
  if (reasonCode) body.reasonCode = reasonCode;

  const note = typeof reasonNote === 'string' ? reasonNote.trim() : '';
  if (note) body.reasonNote = note;

  return api.patch(`/api/lumi/decisions/${encodeURIComponent(decisionId)}/judgment`, body);
}
