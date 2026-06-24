// ============================================================
// DecisionAccuracyService — persistence wrapper for the Proof Engine
// ============================================================
// Owns DB I/O (the deterministic decisionAccuracyEngine never touches it).
//   getAccuracy(): load this workspace's EXECUTED|DISMISSED Decisions + their
//     OutcomeSnapshots → calculateDecisionAccuracy() → the §1 contract.
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
import { logger } from '../../utils/logger.js';
import { calculateDecisionAccuracy } from './decisionAccuracyEngine.js';

// Statuses that represent a realized prediction (EXECUTED) or a survivorship
// signal counted in coverage but never scored (DISMISSED). PROPOSED is excluded.
const ACCURACY_STATUSES = Object.freeze(['EXECUTED', 'DISMISSED']);

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
    status: d.status,
    createdAt: d.createdAt,
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
    where: { workspaceId, status: { in: ACCURACY_STATUSES } },
    select: {
      id: true, verdict: true, confidence: true, status: true, createdAt: true,
      outcomes: {
        orderBy: { createdAt: 'desc' },
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

const isInt = (v) => Number.isInteger(v);
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Pure: validate a record-outcome request body. Returns an error string (→422)
 * or null when valid. Exported so the 422 cases are unit-testable without an
 * HTTP app. Negative spend/revenue deltas are VALID — a successful KILL reduces
 * both — so we check integer-ness, never sign.
 */
export function validateOutcomeBody(body = {}) {
  const { spendDeltaMinor, revenueDeltaMinor, roasDelta, windowStart, windowEnd, sustained } = body;
  if (!isInt(spendDeltaMinor))   return 'spendDeltaMinor must be an integer in minor units (negative allowed)';
  if (!isInt(revenueDeltaMinor)) return 'revenueDeltaMinor must be an integer in minor units (negative allowed)';
  if (!isFiniteNum(roasDelta))   return 'roasDelta must be a finite number';
  if (typeof sustained !== 'boolean') return 'sustained must be a boolean';
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  if (Number.isNaN(startMs)) return 'windowStart must be a valid ISO date';
  if (Number.isNaN(endMs))   return 'windowEnd must be a valid ISO date';
  if (endMs <= startMs)      return 'windowEnd must be after windowStart';
  return null;
}

/**
 * Record the realized outcome of an EXECUTED decision (one per decision).
 *
 * IDOR discipline: authorize by { id, workspaceId } — a cross-workspace id is
 * invisible (→404). Only an EXECUTED decision can carry an outcome (PROPOSED
 * hasn't happened; DISMISSED was never acted on) → 409 otherwise.
 *
 * entityId/entityLevel are REQUIRED on OutcomeSnapshot and are INHERITED from
 * the decision — never operator-entered (they aren't the operator's to set).
 *
 * UPSERT-BY-HAND: decisionId is not a unique column (the schema permits a
 * history the read takes the latest of), so a real upsert({where:{decisionId}})
 * is impossible. We update the newest snapshot in place, else create — one
 * outcome per decision, no duplicate, idempotent on re-record.
 *
 * @param {string} workspaceId
 * @param {string} decisionId
 * @param {{spendDeltaMinor:number, revenueDeltaMinor:number, roasDelta:number,
 *          windowStart:string|Date, windowEnd:string|Date, sustained:boolean}} input
 * @returns {Promise<{ workspaceId, decisionId, outcome }>}
 */
export async function recordOutcome(workspaceId, decisionId, input = {}) {
  if (!workspaceId) throw new Error('recordOutcome: workspaceId required');
  if (!decisionId) throw new Error('recordOutcome: decisionId required');

  const decision = await prisma.decision.findFirst({
    where: { id: decisionId, workspaceId },
    select: { id: true, status: true, entityId: true, entityLevel: true },
  });
  if (!decision) throw new Error('recordOutcome: decision not found');
  if (decision.status !== 'EXECUTED') {
    throw new Error(`recordOutcome: decision is not EXECUTED (status ${decision.status}) — cannot record an outcome`);
  }

  const { spendDeltaMinor, revenueDeltaMinor, roasDelta, windowStart, windowEnd, sustained } = input;
  const data = {
    spendDeltaMinor, revenueDeltaMinor, roasDelta,
    windowStart: new Date(windowStart), windowEnd: new Date(windowEnd), sustained,
  };

  const existing = await prisma.outcomeSnapshot.findFirst({
    where: { decisionId, workspaceId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  const outcome = existing
    ? await prisma.outcomeSnapshot.update({ where: { id: existing.id }, data })
    : await prisma.outcomeSnapshot.create({
      data: { workspaceId, decisionId, entityId: decision.entityId, entityLevel: decision.entityLevel, ...data },
    });

  logger.info(
    { workspaceId, decisionId, outcomeId: outcome.id, updated: Boolean(existing) },
    '[DecisionAccuracy] outcome recorded',
  );
  return { workspaceId, decisionId, outcome };
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
      where: { workspaceId, status: 'EXECUTED', outcomes: { none: {} } },
      select: {
        id: true, verdict: true, confidence: true, diagnosis: true,
        entityId: true, entityLevel: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { currency: true } }),
  ]);
  return { decisions, currency: ws?.currency ?? 'USD' };
}
