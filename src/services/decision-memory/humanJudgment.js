// ============================================================
// R13 — what the HUMAN decided about a verdict
// ============================================================
// A third axis, independent of the other two. humanExecutedAt (the operator
// reported making the change), platformExecutedAt (Lumi made it) and
// dismissedAt record whether the campaign was touched at all; `verdict` records
// what Lumi believed; this records the operator's judgement OF that belief.
//
// The verdict is NEVER rewritten. If Lumi says KILL and the buyer says KEEP,
// the row keeps verdict=KILL and gains humanResponse=OVERRIDE: "Lumi said KILL"
// stays true, and so does "the buyer disagreed". Collapsing them into a
// corrected verdict would destroy the only evidence the disagreement happened,
// which is precisely what a later learning slice needs to read.
//
// OVERRIDE is NOT dismissal. A buyer who overrides a KILL and keeps spending
// leaves every execution timestamp and dismissedAt null. That is accurate — no
// intervention was made, by the operator or by Lumi — and inferring one here
// would fabricate a signal nobody sent.
//
// Lives here rather than in the route because the route file is at its size
// budget, and because this is decision-memory logic: the route's job is to map
// the result onto HTTP.
// ============================================================
import { prisma } from '../../lib/prisma.js';

export const HUMAN_RESPONSES = Object.freeze(['CONFIRM', 'OVERRIDE', 'ADJUST']);
export const HUMAN_REASONS = Object.freeze([
  'OBJECTIVE_CONTEXT', 'BUSINESS_CONSTRAINT', 'TOF_ROLE', 'BRAND_ROLE',
  'SEASONALITY', 'DATA_CONTEXT', 'TESTING_INTENT', 'RISK_TOLERANCE', 'OTHER',
]);
// Disagreeing without saying why is not a learning signal — it records that
// something was wrong without recording what. CONFIRM needs no reason:
// agreeing with the stated rationale IS the reason.
export const REASON_REQUIRED = Object.freeze(['OVERRIDE', 'ADJUST']);
export const MAX_NOTE_LENGTH = 2000;

/** Blank notes collapse to null — "" is not a note, it is the absence of one. */
function normalizeNote(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return undefined; // caller maps this to InvalidNote
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Validate a judgment payload.
 * @returns {{error:string,message:string}|{response:string,reasonCode:string|null,note:string|null}}
 */
export function validateJudgment(body = {}) {
  const response = body?.response;
  const reasonCode = body?.reasonCode ?? null;
  const note = normalizeNote(body?.reasonNote);

  if (!HUMAN_RESPONSES.includes(response)) {
    return { error: 'InvalidResponse', message: `response must be one of ${HUMAN_RESPONSES.join(', ')}` };
  }
  if (reasonCode !== null && !HUMAN_REASONS.includes(reasonCode)) {
    return { error: 'InvalidReason', message: `reasonCode must be one of ${HUMAN_REASONS.join(', ')}` };
  }
  if (REASON_REQUIRED.includes(response) && reasonCode === null) {
    return { error: 'ReasonRequired', message: `${response} requires a structured reasonCode` };
  }
  if (note === undefined) {
    return { error: 'InvalidNote', message: 'reasonNote must be a string' };
  }
  if (note !== null && note.length > MAX_NOTE_LENGTH) {
    return { error: 'NoteTooLong', message: `reasonNote must be at most ${MAX_NOTE_LENGTH} characters` };
  }
  return { response, reasonCode, note };
}

/**
 * Record the judgment once, against a live decision in the caller's workspace.
 * @returns {Promise<{status:number, payload:object}>}
 */
export async function recordJudgment({ id, workspaceId, response, reasonCode, note }) {
  // id + workspaceId, always. A judgement written across a tenant boundary
  // would attribute one account's reasoning to another's decision.
  const decision = await prisma.decision.findFirst({
    where:  { id, workspaceId },
    select: {
      id: true, status: true, humanResponse: true,
      humanReasonCode: true, humanReasonNote: true, humanRespondedAt: true,
    },
  });

  if (!decision) {
    return { status: 404, payload: { error: 'DecisionNotFound', message: 'No such decision in this workspace' } };
  }

  // Already judged — checked BEFORE the status gate, for the same reason
  // stampSignal checks its timestamp first: a judgement recorded while the
  // decision was live stays reportable after a sweep supersedes it. The claim
  // was true when it was made.
  if (decision.humanRespondedAt) {
    const identical =
      decision.humanResponse   === response &&
      decision.humanReasonCode === reasonCode &&
      decision.humanReasonNote === note;

    // A double-clicked button is one judgement, not two. A DIFFERENT judgement
    // is not a retry — it is an attempt to rewrite history, and the record
    // refuses rather than quietly keeping the last writer.
    if (!identical) {
      return {
        status: 409,
        payload: {
          error:   'JudgmentAlreadyRecorded',
          message: 'A different judgement is already recorded for this decision',
          humanResponse:    decision.humanResponse,
          humanReasonCode:  decision.humanReasonCode,
          humanReasonNote:  decision.humanReasonNote,
          humanRespondedAt: decision.humanRespondedAt,
        },
      };
    }

    return {
      status: 200,
      payload: {
        ok: true, recorded: false,
        humanResponse:    decision.humanResponse,
        humanReasonCode:  decision.humanReasonCode,
        humanReasonNote:  decision.humanReasonNote,
        humanRespondedAt: decision.humanRespondedAt, // the ORIGINAL, never re-stamped
      },
    };
  }

  // Only a live call can be judged. Judging a SUPERSEDED verdict would attach
  // an operator's reasoning to a call the engine no longer stands behind.
  if (decision.status !== 'PROPOSED') {
    return {
      status: 409,
      payload: {
        error:   'DecisionNotActionable',
        message: `Decision is ${decision.status}; only a live (PROPOSED) decision can be judged`,
        status:  decision.status,
      },
    };
  }

  const at = new Date();
  await prisma.decision.update({
    where: { id: decision.id },
    // `verdict` is deliberately absent from this update, and must stay absent.
    data: {
      humanResponse: response, humanReasonCode: reasonCode,
      humanReasonNote: note, humanRespondedAt: at,
    },
  });

  return {
    status: 200,
    payload: {
      ok: true, recorded: true,
      humanResponse: response, humanReasonCode: reasonCode,
      humanReasonNote: note, humanRespondedAt: at,
    },
  };
}
