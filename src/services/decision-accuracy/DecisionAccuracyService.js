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
