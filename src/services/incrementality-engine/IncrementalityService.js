// ============================================================
// IncrementalityService — persistence wrapper for holdout testing
// ============================================================
// Owns DB I/O (the deterministic incrementalityEngine never touches it).
//   designTest():        power calc → persist a DESIGNED IncrementalityTest.
//   listTests/getTest:   read.
//   concludeIncrementality(): THE LOOP — read counters → readIncrementality
//     → in ONE $transaction set CONCLUDED + lift/CI/confidence, write a
//     first-class DecisionMemoryEntry (actionType `incrementality:<channel>`),
//     and (only when conclusive + positive) an optional PROPOSED Decision.
//     Mirrors TestTrackerService.concludeTest — incrementality results feed
//     the Phase-5 memory exactly like Phase-4 tests do.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { designHoldout, readIncrementality } from './incrementalityEngine.js';
import { getEconomics } from '../unit-economics/EconomicsService.js';

const MEMORY_PREFIX = 'incrementality:';

/**
 * Pure: map a conclusive holdout readout to the DecisionMemoryEntry shape.
 * Exported for unit testing without a DB.
 */
export function incrementalityToMemory(test, readout) {
  if (!test?.workspaceId) throw new Error('incrementalityToMemory: test.workspaceId required');
  const rationale = readout.conclusive
    ? `Holdout on ${test.channel}: +${readout.liftPct}% incremental (CI [${readout.ci[0]}, ${readout.ci[1]}], ${readout.confidenceLabel}).`
    : `Holdout on ${test.channel}: ${readout.rationale}`;
  return {
    workspaceId:   test.workspaceId,
    entityId:      test.entityId ?? null,
    actionType:    `${MEMORY_PREFIX}${test.channel}`,
    rationale,
    // A causal, positive, confident lift is a sustainable learning.
    isSustainable: readout.conclusive && readout.confidenceLabel === 'HIGH',
  };
}

/** Design a holdout (power calc) and persist it as DESIGNED. */
export async function designTest(workspaceId, { name, channel, entityId, entityLevel, baselineCvr, mde, dailyEligible, holdoutPct } = {}) {
  if (!workspaceId) throw new Error('designTest: workspaceId required');
  if (!channel) throw new Error('designTest: channel required');

  const design = designHoldout({ baselineCvr, mde, dailyEligible, holdoutPct });
  const created = await prisma.incrementalityTest.create({
    data: {
      workspaceId,
      name: name ?? `${channel} holdout`,
      channel, entityId: entityId ?? null, entityLevel: entityLevel ?? null,
      holdoutPct: design.holdoutPct, mde,
      sampleSizePerArm: design.sampleSizePerArm, durationDays: design.durationDays,
      guardrails: { ...design.guardrails, assumptions: design.assumptions },
      status: 'DESIGNED',
    },
  });
  logger.info({ workspaceId, testId: created.id, channel }, '[IncrementalityService] holdout designed');
  return { ...created, design };
}

export async function listTests(workspaceId) {
  if (!workspaceId) throw new Error('listTests: workspaceId required');
  return prisma.incrementalityTest.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 50 });
}

/**
 * Record a holdout's OBSERVED counts — the missing write organ. A holdout's
 * exposed/holdout user+conversion counts come from an actually-run experiment;
 * the operator records what they observed (user-owned measurements, real the
 * way a guardrail rule or an asserted AOV is real). Moves DESIGNED → RUNNING
 * and stamps startedAt. Counts are validated and immutable once CONCLUDED.
 *
 * @returns {Promise<object>} the updated IncrementalityTest row
 */
export async function recordCounts(workspaceId, testId, counts = {}) {
  if (!workspaceId) throw new Error('recordCounts: workspaceId required');
  if (!testId) throw new Error('recordCounts: testId required');

  const { exposedUsers, exposedConversions, holdoutUsers, holdoutConversions } = counts;
  for (const [k, v] of Object.entries({ exposedUsers, exposedConversions, holdoutUsers, holdoutConversions })) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`recordCounts: ${k} must be a non-negative integer`);
  }
  if (exposedConversions > exposedUsers) throw new Error('recordCounts: exposedConversions cannot exceed exposedUsers');
  if (holdoutConversions > holdoutUsers) throw new Error('recordCounts: holdoutConversions cannot exceed holdoutUsers');

  const test = await prisma.incrementalityTest.findFirst({ where: { id: testId, workspaceId } });
  if (!test) throw new Error('recordCounts: test not found');
  if (test.status === 'CONCLUDED' || test.status === 'ABANDONED') {
    throw new Error(`recordCounts: test is ${test.status} — observed counts are immutable`);
  }

  const updated = await prisma.incrementalityTest.update({
    where: { id: test.id },
    data: {
      exposedUsers, exposedConversions, holdoutUsers, holdoutConversions,
      status: 'RUNNING',
      startedAt: test.startedAt ?? new Date(),
    },
  });
  logger.info({ workspaceId, testId }, '[IncrementalityService] observed counts recorded');
  return updated;
}

export async function getTest(workspaceId, testId) {
  if (!workspaceId) throw new Error('getTest: workspaceId required');
  return prisma.incrementalityTest.findFirst({ where: { id: testId, workspaceId } });
}

/**
 * Conclude a holdout: read out the causal lift (with CI) and close the loop
 * into memory. Mirrors TestTrackerService.concludeTest.
 * @returns {Promise<{ readout, memoryId, decisionId }>}
 */
export async function concludeIncrementality(workspaceId, testId) {
  if (!workspaceId) throw new Error('concludeIncrementality: workspaceId required');
  const test = await prisma.incrementalityTest.findFirst({ where: { id: testId, workspaceId } });
  if (!test) throw new Error('concludeIncrementality: test not found');
  // Honest-empty guard: a holdout with no observed counts cannot be read out.
  // Refuse cleanly here so the route returns a 409 — never a fabricated lift
  // computed off zero/empty arms.
  if (!(test.exposedUsers > 0) || !(test.holdoutUsers > 0)) {
    throw new Error('concludeIncrementality: no observed counts recorded — record holdout results before concluding');
  }

  const { economics } = await getEconomics(workspaceId);
  const readout = readIncrementality({
    exposed: { users: test.exposedUsers, conversions: test.exposedConversions },
    holdout: { users: test.holdoutUsers, conversions: test.holdoutConversions },
    aovMinor: economics.aovMinor,
  });

  const mem = incrementalityToMemory(test, readout);

  const result = await prisma.$transaction(async (tx) => {
    let decisionId = null;
    // Only a CONFIDENT positive causal lift becomes a proposed action.
    if (readout.conclusive && (readout.confidenceLabel === 'HIGH' || readout.confidenceLabel === 'MEDIUM') && test.entityId) {
      const decision = await tx.decision.create({
        data: {
          workspaceId, entityId: test.entityId, entityLevel: test.entityLevel ?? 'CAMPAIGN',
          verdict: 'SCALE', confidence: readout.confidenceLabel === 'HIGH' ? 0.9 : 0.7,
          diagnosis: mem.rationale, rootCause: `${MEMORY_PREFIX}${test.id}`, status: 'PROPOSED',
        },
      });
      decisionId = decision.id;
    }

    await tx.incrementalityTest.update({
      where: { id: test.id },
      data: {
        status: 'CONCLUDED', concludedAt: new Date(),
        liftPct: readout.liftPct, ciLow: readout.ci[0], ciHigh: readout.ci[1],
        confidenceLabel: readout.conclusive ? readout.confidenceLabel : null,
        incrementalRevenueMinor: readout.incrementalRevenueMinor.value,
        decisionId,
      },
    });

    const memory = await tx.decisionMemoryEntry.create({ data: { ...mem, decisionId } });
    return { decisionId, memoryId: memory.id };
  });

  logger.info({ workspaceId, testId, conclusive: readout.conclusive, decisionId: result.decisionId }, '[IncrementalityService] concluded — loop closed');
  return { readout, memoryId: result.memoryId, decisionId: result.decisionId };
}
