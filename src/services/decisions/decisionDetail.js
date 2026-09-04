// ============================================================
// C-11 — the Decision, read as the object it was
// ============================================================
// Lumi could execute a decision by id, dismiss it, judge it, stamp it and
// record an outcome against it. It could not READ one. Eight by-id reads exist
// on trunk and every one resolves the row to authorise or decorate an ACTION;
// twelve of its thirty-five columns reached no client at all, including the
// entire committed-reasoning block the engine writes once and never touches
// again.
//
// ── THE LAW (R-1 / R-2 / B7-06, constitutional) ─────────────────────────────
//
//     ATTENTION is led by now. DECISION, OUTCOME and LEARNING are led by then.
//     Then and Now are never placed side by side as a diff — a comparison asks
//     which is right, and both are.
//
// So this module publishes what Lumi COMMITTED TO, and nothing else. It holds
// no reference to the verdict engine, to MetricSnapshot, to the evidence
// populations or to the confidence engine — not because they are unavailable,
// but because reaching any of them would turn a record into a re-assessment.
// The live truth already has a surface: the Campaign lens (R-2).
//
// Memory is absent for a different reason. B7-06 rules that until R-6 ships the
// Decision destination shows NO memory at all, and R-6's contract is C-16. A
// traversal added here would decide, inside a read slice, a question a later
// contract owns.
//
// PURE except for one read. No clock: a stored decision is not re-dated when
// somebody looks at it.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import {
  DECISION_CLASS, DECISION_CLASS_VALUES, KNOWLEDGE,
} from '@marcom/runtime-contracts';
import { hasDestination } from './decisionClassScope.js';

/**
 * WHICH CLASS CAPTURES WHICH EVIDENCE — measured from the five writers.
 *
 * This is the whole reason the committed block exists. Two absences share one
 * spelling and mean opposite things:
 *
 *     SIGNAL    + hypotheses = null   →  this row could have carried reasoning
 *                                        and does not. A gap in OUR record.
 *     GUARDRAIL + hypotheses = null   →  a guardrail sweep does not produce
 *                                        hypotheses, and never will. The
 *                                        question does not apply.
 *
 * A client that renders "no reasoning recorded" for the second makes a claim
 * about THIS DECISION when the truth is about its CLASS — and the prerequisite
 * that would end that absence never arrives, which is exactly the shape C-07
 * forbids an absence from hiding.
 *
 * Per class, not per field-is-null: only the writer knows which it is.
 */
export const CLASS_CAPTURES = Object.freeze({
  // persistNode writes all seven. It is the only class with a reasoning artifact.
  [DECISION_CLASS.SIGNAL]: Object.freeze([
    'ctrAtDecision', 'roasAtDecision', 'objective', 'channel',
    'hypotheses', 'counterfactuals', 'evidenceReference',
  ]),
  // The sweep records WHAT IT JUDGED (C-02) but reaches no verdict of its own,
  // so it has evidence provenance and no reasoning and no frozen metrics.
  [DECISION_CLASS.GUARDRAIL]: Object.freeze(['evidenceReference']),
  // Never served as a destination (R-3); declared so the exhaustiveness check
  // below covers every class rather than every class we happen to serve.
  [DECISION_CLASS.ALLOCATION]: Object.freeze(['channel']),
  // Both experiment producers write the eight core columns and nothing else.
  [DECISION_CLASS.EXPERIMENT]: Object.freeze([]),
});

/** The fields whose null is ambiguous, and which therefore carry a knowledge. */
export const COMMITTED_FIELDS = Object.freeze([
  'ctrAtDecision', 'roasAtDecision', 'objective', 'channel',
  'hypotheses', 'counterfactuals', 'evidenceReference',
]);

// Exhaustiveness at MODULE LOAD, the shape C-06 established and C-10 reused. A
// fifth class must not silently inherit "captures nothing", which would publish
// CANNOT_ASK over evidence its writer really does record.
for (const cls of DECISION_CLASS_VALUES) {
  if (!Array.isArray(CLASS_CAPTURES[cls])) {
    throw new Error(`decisionDetail: no capture declaration for decision class "${cls}"`);
  }
  for (const field of CLASS_CAPTURES[cls]) {
    if (!COMMITTED_FIELDS.includes(field)) {
      throw new Error(`decisionDetail: "${cls}" declares "${field}", which is not a committed field`);
    }
  }
}

/**
 * PURE: what we know about one committed field on one row, in C-06's tokens.
 *
 * Four of the five existing tokens, each by its own published definition. No
 * new vocabulary: a fifth spelling for "we do not have this" is how the
 * seven-way name collision C-06 catalogued started.
 */
export function knowledgeOf(decisionClass, field, value) {
  // "The question does not apply here" — the class has no such evidence.
  if (!CLASS_CAPTURES[decisionClass]?.includes(field)) return KNOWLEDGE.CANNOT_ASK;
  // "We could not establish the truth — the read failed, or no record of it
  // exists." Every row written before the column, and any writer that could not
  // establish provenance honestly.
  if (value === null || value === undefined) return KNOWLEDGE.COULD_NOT_LOOK;
  // "We looked, and there is nothing. A finding, not a failure." The schema
  // draws this line itself: [] is the engine running and producing none, which
  // a decision gated under 1 000 impressions genuinely does.
  if (Array.isArray(value) && value.length === 0) return KNOWLEDGE.NOTHING_THERE;
  return KNOWLEDGE.KNOWN;
}

/** PURE: the committed block — each field beside what we know about it. */
export function committedFields(row) {
  const out = {};
  for (const field of COMMITTED_FIELDS) {
    const value = row[field] ?? null;
    out[field] = { value, knowledge: knowledgeOf(row.decisionClass, field, value) };
  }
  return out;
}

/**
 * The columns a detail read states. Explicit, and the reason is the same one
 * B5-01U wrote after MEMORY_SELECT omitted `status` and told every workspace it
 * had learned nothing: a default-less projection is a decision, so it is made
 * here in one place rather than inherited.
 *
 * `executedAt` is NOT among them. It is the deprecated column; the two
 * provenance facts are published separately, and `legacyExecutedAt` exists so a
 * FROZEN client keeps working. A read born today has no frozen client, and
 * starting one with a derived alias re-creates the collapse B4-A undid.
 */
export const DETAIL_SELECT = Object.freeze({
  id: true, decisionClass: true, entityId: true, entityLevel: true, createdAt: true,
  verdict: true, confidence: true, diagnosis: true, rootCause: true, status: true,
  explainedAt: true, intentAt: true,
  humanExecutedAt: true, platformExecutedAt: true, dismissedAt: true,
  resolvedAt: true, resolution: true, confidenceDelta: true, closureReason: true,
  humanResponse: true, humanReasonCode: true, humanReasonNote: true, humanRespondedAt: true,
  ctrAtDecision: true, roasAtDecision: true, objective: true, channel: true,
  hypotheses: true, counterfactuals: true, evidenceReference: true,
  guardrailRuleId: true, openHitKey: true,
});

/** PURE: the row as a response body. */
export function detailBody(row) {
  return {
    id: row.id,
    decisionClass: row.decisionClass,
    entityId: row.entityId,
    entityLevel: row.entityLevel,
    decidedAt: row.createdAt,

    // What Lumi believed. `verdict` is the engine's own, never derived.
    verdict: row.verdict,
    confidence: row.confidence,
    diagnosis: row.diagnosis,
    rootCause: row.rootCause,
    status: row.status,

    // Did a human look, and did they carry it somewhere they could act? Written
    // once each since R7 and read by nothing until now. `intentAt` is adoption
    // and NOT action — the gap between them is however long the operator took
    // to not act, which is a fact worth being able to see.
    explainedAt: row.explainedAt,
    intentAt: row.intentAt,

    // The closure axes, STATED rather than omitted. Omission reads as "not part
    // of this response"; null says "we looked, and it has not happened".
    humanExecutedAt: row.humanExecutedAt,
    platformExecutedAt: row.platformExecutedAt,
    dismissedAt: row.dismissedAt,
    resolvedAt: row.resolvedAt,
    resolution: row.resolution,
    confidenceDelta: row.confidenceDelta,
    closureReason: row.closureReason,

    // The third axis (R13): what the HUMAN decided about what Lumi decided.
    // Null is never CONFIRM and never OTHER — the absence of an opinion is not
    // an opinion.
    humanResponse: row.humanResponse,
    humanReasonCode: row.humanReasonCode,
    humanReasonNote: row.humanReasonNote,
    humanRespondedAt: row.humanRespondedAt,

    // Guardrail identity travels FLAT, not through the committed block. A rule
    // id is identity, not evidence, and its null is unambiguous — the class is
    // published one line above, so nobody has to guess why it is empty.
    guardrailRuleId: row.guardrailRuleId,
    openHitKey: row.openHitKey,

    committed: committedFields(row),
  };
}

/**
 * Read one Decision as a destination.
 *
 * TWO PREDICATES. The FK on `decisions.id` carries no tenant component, so an
 * id alone is a caller-independent key and the database would not catch a
 * cross-workspace row on its own.
 *
 * The class is NOT part of the WHERE, deliberately. Filtering there would
 * collapse "this row is not yours" into "this row is not a destination", and
 * those are different answers owed to different people.
 *
 * @param {{id: string, workspaceId: string}} args
 * @returns {Promise<{status: number, payload: object}>}
 */
export async function getDecisionDetail({ id, workspaceId }) {
  const row = await prisma.decision.findFirst({ where: { id, workspaceId }, select: DETAIL_SELECT });

  if (!row) {
    return {
      status: 404,
      payload: { error: 'DecisionNotFound', message: 'No such decision in this workspace' },
    };
  }

  // UNCLASSIFIED. A row written before C-10 whose `rootCause` names an enum
  // value since deleted from the code. It cannot be interpreted, and serving it
  // under a destination that promises class-scoped meaning would be exactly the
  // inference C-10 abolished. Kept apart from the refusal below on purpose.
  if (row.decisionClass == null) {
    return {
      status: 409,
      payload: {
        error: 'DecisionUnclassified',
        message: 'This decision has no class, so it cannot be interpreted',
      },
    };
  }

  // R-3. The row exists, in this workspace, and the caller is entitled to it —
  // what it is not is a destination. 404 here would be a false statement about
  // the account, which is the defect class C-03 and C-07 exist to end.
  if (!hasDestination(row.decisionClass)) {
    return {
      status: 409,
      payload: {
        error: 'NotADecisionDestination',
        decisionClass: row.decisionClass,
        message: 'This row is a plan artifact, not a Decision with a destination',
      },
    };
  }

  return { status: 200, payload: { decision: detailBody(row) } };
}
