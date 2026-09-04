// ============================================================
// DecisionAccuracyService — persistence wrapper for the Proof Engine
// ============================================================
// Owns DB I/O (the deterministic decisionAccuracyEngine never touches it).
//   getAccuracy(): load this workspace's ACTIONED Decisions + their
//     OutcomeSnapshots → calculateDecisionAccuracy() → the §1 contract.
//
// "Actioned" means a signal landed — humanExecutedAt, platformExecutedAt or
// dismissedAt (B4-A: execution provenance is two facts) — NOT a
// DecisionStatus. The enum carries EXECUTED and DISMISSED and nothing writes
// them, so this surface used to query an empty set and report, quite honestly,
// on nothing at all. decisionAccuracyHelpers owns that definition; the engine
// still speaks the status vocabulary and is handed a derived one at the seam.
//
// READ-ONLY. The Proof Engine MEASURES; it never mutates a Decision or Outcome.
//
// SCOPING (IDOR discipline): every query is `where: { workspaceId }`. This phase
// is PER-ACCOUNT only — there is no cross-workspace read here. If cross-account
// accuracy is ever wanted it goes through the network-engine's k-anonymity +
// consent gate, NEVER a direct cross-workspace read. Stated here so no one wires
// a leak later.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { scopeFor } from '../decisions/decisionClassScope.js';
import { logger } from '../../utils/logger.js';
import { calculateDecisionAccuracy } from './decisionAccuracyEngine.js';
import { wasActedOn, deriveAccuracyStatus } from './decisionAccuracyHelpers.js';
import { CURRENT_OUTCOME_WHERE, CURRENT_OUTCOME_ORDER_BY } from './outcomeSelection.js';
import { projectOutcomeEvidence } from './outcomeEvidence.js';
import { interventionAt, PROVENANCE_SELECT, INTERVENED_WHERE } from '../execution/decisionProvenance.js';

// listPendingOutcomes fetches to this cap, sorts by the intervention instant in
// JS (no Prisma orderBy expresses LEAST of two columns), then returns a page.
const PENDING_FETCH_CAP = 500;
const PENDING_PAGE_SIZE = 100;

/**
 * The refusals this service makes, as CODES rather than message shapes. The
 * route used to sniff `/not EXECUTED/i` against a message reading "has not been
 * executed", which never matched — an unexecuted decision returned 500 where the
 * contract says 409. A code cannot drift out of agreement with its own wording.
 */
export const OUTCOME_ERROR = Object.freeze({
  DECISION_NOT_FOUND: 'DECISION_NOT_FOUND', // → 404
  NOT_EXECUTED:       'NOT_EXECUTED',       // → 409
  INVALID_WINDOW:     'INVALID_WINDOW',     // → 422
});

const outcomeError = (code, message) => Object.assign(new Error(message), { code });

// The population this surface reports on: decisions a human made a call about.
// Timestamps, not `status` — the DecisionStatus enum carries EXECUTED and
// DISMISSED but nothing ever writes them, so `status: { in: [...] }` matched an
// empty set and the whole surface reported honestly on zero rows.
//
// This DELIBERATELY includes SUPERSEDED rows. A decision executed while live and
// replaced by the next sweep is the common case, not an edge one — and the
// action still happened. Scoping on status would have excluded almost every
// decision anyone ever acted on.
// NOT the intervention union. This is a WIDER question — "did a human make any
// call about this verdict" — and the dismissal arm is what makes it wider: a
// decision the operator explicitly rejected is survivorship data the coverage
// report counts, even though nothing was done to the campaign.
//
// The intervention arms are spread from the canonical seam rather than spelled
// out again, so "somebody intervened" keeps ONE definition across the codebase
// and a later tightening of it reaches this population too. The dismissal arm is
// added here because it belongs to this question and to no other.
//
// B4-A — either execution provenance counts. The engine's subject is whether the
// RECOMMENDATION was right, and a call executed by hand tests that as well as
// one Lumi performed. Platform-only claims use wasPlatformExecuted; this is not
// one of them.
const ACTIONED = Object.freeze({
  OR: [
    ...INTERVENED_WHERE.OR,
    { dismissedAt: { not: null } },
  ],
});

/**
 * Pure: fold loaded Decision rows (each with its outcomes) into the engine's
 * `decisions` input — each decision carries its freshest outcome. Exported so
 * the join can be unit-tested without a DB.
 */
export function buildAccuracyInputs(decisions = []) {
  return decisions.map((d) => ({
    id: d.id,
    verdict: d.verdict,
    confidence: d.confidence,
    // Derived from the timestamps, not copied. This is the seam that keeps the
    // pure engine — its two status reads, the survivorship counter, the coverage
    // note and every one of its fixtures — working untouched while the source of
    // truth moves underneath it. Explicit field list, NOT a spread of `d`: the
    // engine's input shape is a contract, and spreading would leak the raw
    // `outcomes` array and both timestamps into it.
    // NAMED `accuracyStatus`, not `status`. The stored Decision.status is a
    // different fact with a different value for the same row — the human-signal
    // routes deliberately leave it PROPOSED — and calling both `status` meant
    // one word carried two answers across a seam. The engine reads this one; the
    // database owns the other; `accountLift.status` in the engine's OUTPUT is a
    // third and unrelated thing.
    accuracyStatus: deriveAccuracyStatus(d),
    createdAt: d.createdAt,
    // The instant SOMEONE acted — the earliest of the two provenance columns.
    // The engine opens its outcome window here and falls back to createdAt, so
    // both columns MUST be in the findMany select below (PROVENANCE_SELECT
    // exists to make that impossible to forget): an absent field is undefined,
    // the fallback fires silently, and the window quietly reverts to issuance
    // with nothing to show that it did.
    humanExecutedAt:    d.humanExecutedAt    ?? null,
    platformExecutedAt: d.platformExecutedAt ?? null,
    outcome: (d.outcomes && d.outcomes[0]) || null,
  }));
}

/**
 * Compute decision-accuracy for one workspace.
 * @param {string} workspaceId
 * @param {{ now?: Date, config?: object }} [opts]
 * @returns {Promise<{ accountLift, calibration, velocity, coverage }>}
 */
export async function getAccuracy(workspaceId, { now = new Date(), config } = {}) {
  if (!workspaceId) throw new Error('getAccuracy: workspaceId required');

  // One scoped findMany (no N+1) — newest outcome first per decision.
  const decisions = await prisma.decision.findMany({
    // C-10 — SIGNAL only: 'was Lumi's call right' is a question about the
    // connector engine's own judgement. A guardrail episode states what a rule
    // says, and scoring it would calibrate the engine on someone else's policy.
    where: { workspaceId, ...scopeFor('accuracy/population'), ...ACTIONED },
    select: {
      id: true, verdict: true, confidence: true, status: true, createdAt: true,
      // Both timestamps, because deriveAccuracyStatus reads both. Omitting
      // dismissedAt would make every dismissal read as its raw status
      // (PROPOSED), fall through the engine's "not a realized prediction"
      // branch, and vanish from the survivorship count it exists to feed.
      ...PROVENANCE_SELECT, dismissedAt: true,
      outcomes: {
        // THE CURRENT OUTCOME, not the newest row (R6). A re-recorded result now
        // appends, so a decision can own several rows and only one of them is
        // still what the operator claims happened. Scoring the superseded one —
        // or scoring both — would let a correction contaminate the calibration
        // it was recorded to fix. The retired rows stay in the table; they are
        // simply not this question's answer.
        where: CURRENT_OUTCOME_WHERE,
        orderBy: CURRENT_OUTCOME_ORDER_BY,
        take: 1,
        select: {
          spendDeltaMinor: true, revenueDeltaMinor: true, roasDelta: true,
          windowEnd: true, sustained: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const result = calculateDecisionAccuracy({
    decisions: buildAccuracyInputs(decisions),
    now,
    config,
  });

  logger.info(
    { workspaceId, scored: result.coverage.scored, verdict: result.coverage.verdict },
    '[DecisionAccuracy] computed',
  );
  return result;
}

// ── Outcome recording: the Proof Engine's only real WRITE path ─────
// The engine MEASURES; this is the one place an OutcomeSnapshot is written
// outside the seed. It is HUMAN-ASSERTED — the operator records what actually
// happened, the same "user-owned measurement" pattern as recordCounts /
// recordVariantMetrics (real the way an asserted AOV is real). No auto-scoring
// off connector deltas here: a raw before/after delta is correlational, not the
// causal outcome a calibration engine should ingest (that's what holdouts are
// for), and the realized-metrics fetch is still the Phase-3 stub. Honest entry
// beats a fabricated one.
//
// R6 DOES NOT CHANGE THAT. The values stay human-reported; what gets added is
// the ability to say what they were measured against, when they were measured,
// and that they were not quietly rewritten afterwards. A platform-measured
// outcome remains a separate, unbuilt thing — see outcomeEvidence.js.

const isInt = (v) => Number.isInteger(v);
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Pure: validate a record-outcome request body. Returns an error string (→422)
 * or null when valid. Exported so the 422 cases are unit-testable without an
 * HTTP app. Negative spend/revenue deltas are VALID — a successful KILL reduces
 * both — so we check integer-ness, never sign.
 */
export function validateOutcomeBody(body = {}) {
  const {
    spendDeltaMinor, revenueDeltaMinor, roasDelta, windowStart, windowEnd, sustained, measuredAt,
  } = body;
  if (!isInt(spendDeltaMinor))   return 'spendDeltaMinor must be an integer in minor units (negative allowed)';
  if (!isInt(revenueDeltaMinor)) return 'revenueDeltaMinor must be an integer in minor units (negative allowed)';
  if (!isFiniteNum(roasDelta))   return 'roasDelta must be a finite number';
  if (typeof sustained !== 'boolean') return 'sustained must be a boolean';
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  if (Number.isNaN(startMs)) return 'windowStart must be a valid ISO date';
  if (Number.isNaN(endMs))   return 'windowEnd must be a valid ISO date';
  if (endMs <= startMs)      return 'windowEnd must be after windowStart';
  // R6 (I19): REQUIRED on every new recording, and required rather than
  // defaulted. A missing measuredAt has exactly one honest resolution — ask —
  // because every available substitute is a different fact: `now` would date the
  // measurement to the request, and createdAt would date it to the row. Legacy
  // rows keep their NULL; they were written before anyone was asked.
  if (Number.isNaN(Date.parse(measuredAt))) {
    return 'measuredAt must be a valid ISO date — when the outcome was measured, which is not when it is being recorded';
  }
  return null;
}

/**
 * Record the realized outcome of an EXECUTED decision.
 *
 * IDOR discipline: authorize by { id, workspaceId } — a cross-workspace id is
 * invisible (→404). Only an EXECUTED decision can carry an outcome (PROPOSED
 * hasn't happened; DISMISSED was never acted on) → 409 otherwise.
 *
 * entityId/entityLevel are REQUIRED on OutcomeSnapshot and are INHERITED from
 * the decision — never operator-entered (they aren't the operator's to set).
 * R6 adds the evidence reference to that list: the client sends what it
 * measured, never the provenance of it.
 *
 * APPEND, NEVER OVERWRITE (R6 · I19). This used to be an upsert-by-hand that
 * UPDATED the newest snapshot in place, so a recorded result could be replaced
 * with no version, no audit and nothing on the row to say it had happened. It
 * now writes a NEW row and marks the previous one superseded. The old result
 * keeps every value it was recorded with — its deltas, its window, its
 * provenance, its measuredAt — and gains only the two columns that say it is no
 * longer current. Nothing in this file deletes an outcome.
 *
 * ONE TRANSACTION, because "a new current outcome exists" and "the old one is
 * retired" are one fact. A half-applied write would leave two rows claiming to
 * be current, which the ordering would paper over for accuracy and which
 * patterns would read as two observations of the same decision.
 *
 * @param {string} workspaceId
 * @param {string} decisionId
 * @param {{spendDeltaMinor:number, revenueDeltaMinor:number, roasDelta:number,
 *          windowStart:string|Date, windowEnd:string|Date, sustained:boolean,
 *          measuredAt:string|Date}} input
 * @param {{ now?: Date }} [opts] — SERVER time, injected for the temporal
 *   guards. Never a client-supplied "now": the whole point of the future-window
 *   check is that the client does not get to say when now is.
 * @returns {Promise<{ workspaceId, decisionId, outcome, previousOutcomeId }>}
 */
export async function recordOutcome(workspaceId, decisionId, input = {}, { now = new Date() } = {}) {
  if (!workspaceId) throw new Error('recordOutcome: workspaceId required');
  if (!decisionId) throw new Error('recordOutcome: decisionId required');

  const decision = await prisma.decision.findFirst({
    where: { id: decisionId, workspaceId },
    // The provenance columns are what the guard below reads. Selecting `status` and testing a
    // field that was never selected is how this check silently inverted before:
    // an unselected column is undefined, and every decision would fail the guard.
    // dismissedAt rides along so the refusal can say WHICH call was made.
    select: {
      id: true, status: true, entityId: true, entityLevel: true,
      ...PROVENANCE_SELECT, dismissedAt: true,
    },
  });
  if (!decision) throw outcomeError(OUTCOME_ERROR.DECISION_NOT_FOUND, 'recordOutcome: decision not found');
  if (!wasActedOn(decision)) {

    // A dismissed decision has no outcome by construction — nothing was done, so
    // there is nothing that happened afterwards to attribute. Named separately
    // from "never actioned" because they are different states and the caller can
    // only fix one of them.
    const why = decision.dismissedAt ? 'was dismissed, not executed' : 'has not been executed';
    throw outcomeError(
      OUTCOME_ERROR.NOT_EXECUTED,
      `recordOutcome: decision ${decisionId} ${why} — cannot record an outcome`,
    );
  }

  const {
    spendDeltaMinor, revenueDeltaMinor, roasDelta, windowStart, windowEnd, sustained, measuredAt,
  } = input;
  const start = new Date(windowStart);
  const end = new Date(windowEnd);
  const measured = new Date(measuredAt);
  const nowMs = now.getTime();

  // ── The window is ANCHORED TO THE ACTION (R6 §10) ───────────────
  // Shape validation already proved the window is ordered and parseable. These
  // three are the temporal claims it can still get wrong, and each one would
  // corrupt a different thing:
  //
  //   • a window opening before the execution attributes to the decision a
  //     period in which nobody had acted on it yet;
  //   • a window closing in the future reports a result for time that has not
  //     happened, and the maturity check would then treat it as still open
  //     forever;
  //   • a measurement instant in the future is not a measurement.
  //
  // Server time, always. A client that could name `now` could clear the second
  // check by lying about it.
  // B4-A — anchored to the INTERVENTION, whichever route performed it. Using
  // one provenance column would let a window legitimately opened after a
  // self-report be refused because Lumi had not also executed it (or vice
  // versa), which is a refusal about bookkeeping rather than about time.
  const actedAt = interventionAt(decision);
  if (start.getTime() < new Date(actedAt).getTime()) {
    throw outcomeError(
      OUTCOME_ERROR.INVALID_WINDOW,
      `recordOutcome: the measurement window opens ${start.toISOString()}, before the decision was acted on `
      + `(${new Date(actedAt).toISOString()}) — an outcome cannot cover time before the action it follows`,
    );
  }
  if (end.getTime() > nowMs) {
    throw outcomeError(
      OUTCOME_ERROR.INVALID_WINDOW,
      `recordOutcome: the measurement window closes ${end.toISOString()}, in the future — an outcome cannot cover time that has not happened`,
    );
  }
  if (measured.getTime() > nowMs) {
    throw outcomeError(
      OUTCOME_ERROR.INVALID_WINDOW,
      `recordOutcome: measuredAt ${measured.toISOString()} is in the future — a measurement instant cannot be ahead of the server clock`,
    );
  }

  // ── Provenance, established from real rows (R6 · I19) ────────────
  // Read BEFORE the write and outside the transaction, and deliberately not
  // caught: if the evidence read fails we do not know what this outcome was
  // measured against, and I19 says that is a reason to refuse the recording, not
  // a reason to write `evidenceReference: null` and let a new row look like a
  // pre-R6 one. The operator's numbers are still in the form.
  const evidenceReference = await projectOutcomeEvidence(workspaceId, {
    entityId: decision.entityId,
    entityLevel: decision.entityLevel,
    windowStart: start,
    windowEnd: end,
  });

  const { outcome, previousOutcomeId } = await prisma.$transaction(async (tx) => {
    const previous = await tx.outcomeSnapshot.findFirst({
      where: { decisionId, workspaceId, ...CURRENT_OUTCOME_WHERE },
      orderBy: CURRENT_OUTCOME_ORDER_BY,
      select: { id: true },
    });

    const created = await tx.outcomeSnapshot.create({
      data: {
        workspaceId,
        decisionId,
        entityId: decision.entityId,
        entityLevel: decision.entityLevel,
        spendDeltaMinor,
        revenueDeltaMinor,
        roasDelta,
        windowStart: start,
        windowEnd: end,
        sustained,
        measuredAt: measured,
        evidenceReference,
      },
    });

    if (previous) {
      // The ONLY write this service ever makes to an existing outcome, and it
      // touches neither a value nor a provenance field. `supersededAt` is a
      // server instant because it records when the replacement happened here,
      // not when anything was measured.
      await tx.outcomeSnapshot.update({
        where: { id: previous.id },
        data: { supersededAt: now, supersededById: created.id },
      });
    }
    return { outcome: created, previousOutcomeId: previous?.id ?? null };
  });

  logger.info(
    { workspaceId, decisionId, outcomeId: outcome.id, previousOutcomeId, rowCount: evidenceReference.rowCount },
    '[DecisionAccuracy] outcome recorded',
  );
  return { workspaceId, decisionId, outcome, previousOutcomeId };
}

/**
 * List EXECUTED decisions in this workspace that still have NO outcome — the
 * manual-entry queue the Proof surface binds its "record what actually
 * happened" form to. Workspace-scoped; no N+1 (one relational `none` filter +
 * one currency read in parallel).
 *
 * @param {string} workspaceId
 * @returns {Promise<{ decisions: Array, currency: string }>}
 */
export async function listPendingOutcomes(workspaceId) {
  if (!workspaceId) throw new Error('listPendingOutcomes: workspaceId required');
  const [decisions, ws] = await Promise.all([
    prisma.decision.findMany({
      where: {
        workspaceId,
        // C-10 — SIGNAL only. You can owe an outcome for a call you were asked
        // to make; a breach episode closes itself when the condition clears.
        ...scopeFor('accuracy/pending-outcomes'),
        // B4-A — acted on by EITHER route. A self-reported action owes an
        // outcome exactly as much as one Lumi performed; the queue is about the
        // recommendation's result, not about who carried it out. The union is
        // spread from the canonical seam; this where clause owns no other `OR`.
        ...INTERVENED_WHERE,
        dismissedAt: null,          // …and not un-taken. A dismissal has no outcome
        //                             to record: nothing was done, so nothing
        //                             followed from it.
        // …and nobody has said what happened yet. `none` of the CURRENT ones
        // (R6): a decision whose outcomes have all been retired owes a fresh
        // recording, and `none: {}` would answer "it has rows" to a question
        // that is about whether any of them still stand.
        outcomes: { none: { ...CURRENT_OUTCOME_WHERE } },
      },
      select: {
        id: true, verdict: true, confidence: true, diagnosis: true,
        entityId: true, entityLevel: true, createdAt: true, ...PROVENANCE_SELECT,
      },
      // Oldest EXECUTION first, not newest issuance. This is a work queue, and
      // the decision most overdue for an outcome is the one acted on longest ago
      // — which is not the one issued longest ago once operators act out of
      // order. `desc` on createdAt also buried the oldest debt past the take:100.
      // Ordered in JS below, not here: the queue's key is the EARLIEST of the
      // two provenance columns, and no Prisma orderBy expresses LEAST(a, b).
      // Sorting on one column then the other would group all self-reported
      // decisions ahead of all Lumi-executed ones regardless of age.
      //
      // Fetched to a wider cap and sliced after sorting, so the cap truncates
      // the TAIL of a correctly ordered queue rather than deciding membership
      // by the wrong key.
      orderBy: { createdAt: 'asc' },
      take: PENDING_FETCH_CAP,
    }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { currency: true } }),
  ]);

  // Oldest DEBT first — the decision acted on longest ago, whichever route
  // acted on it. Every row here satisfies the OR above, so `interventionAt` is
  // non-null for all of them; the `?? 0` guard is only there so an impossible
  // null cannot silently reorder the queue.
  const ordered = [...decisions].sort((a, b) => {
    const at = interventionAt(a); const bt = interventionAt(b);
    return (at ? new Date(at).getTime() : 0) - (bt ? new Date(bt).getTime() : 0);
  }).slice(0, PENDING_PAGE_SIZE);

  return { decisions: ordered, currency: ws?.currency ?? 'USD' };
}
