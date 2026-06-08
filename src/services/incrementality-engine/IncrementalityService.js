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
 * Convert an incrementality readout into a DecisionMemoryEntry-shaped object.
 *
 * @param {Object} test - Persisted test metadata; must include `workspaceId` and `channel`. `entityId` is optional and will be set to `null` in the returned object when absent.
 * @param {Object} readout - Result of incrementality analysis. When `readout.conclusive` is true the function uses `liftPct`, `ci` (array with [low, high]) and `confidenceLabel` to format the rationale; otherwise it uses `readout.rationale`.
 * @returns {Object} A DecisionMemoryEntry-shaped object containing:
 *   - `workspaceId` (string)
 *   - `entityId` (string|null)
 *   - `actionType` (string) — prefixed with `incrementality:`
 *   - `rationale` (string)
 *   - `isSustainable` (boolean) — true only when the readout is conclusive and `confidenceLabel` is `"HIGH"`.
 * @throws {Error} If `test.workspaceId` is missing.
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

/**
 * Compute a holdout test design (sample, duration, guardrails) and persist it with status `DESIGNED`.
 *
 * @param {string} workspaceId - Workspace identifier; required.
 * @param {Object} [opts] - Design inputs and metadata for the test.
 * @param {string} [opts.name] - Human-readable test name; defaults to `\${channel} holdout`.
 * @param {string} opts.channel - Channel for the holdout (e.g., "email", "paid"); required.
 * @param {string} [opts.entityId] - Optional entity id associated with the test.
 * @param {string} [opts.entityLevel] - Optional entity level (e.g., "CAMPAIGN").
 * @param {number} [opts.baselineCvr] - Baseline conversion rate used for power calculations.
 * @param {number} [opts.mde] - Minimum detectable effect (as a proportion) for the design.
 * @param {number} [opts.dailyEligible] - Estimated number of eligible users per day.
 * @param {number} [opts.holdoutPct] - Target holdout percentage to include in the design.
 * @returns {Object} The created `incrementalityTest` database record augmented with the computed `design` object.
 * @throws {Error} If `workspaceId` or `channel` is missing.
 */
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

/**
 * Retrieve up to 50 most-recent incrementality tests for a workspace.
 * @param {string} workspaceId - Workspace identifier to filter tests.
 * @returns {Array<Object>} An array of incrementalityTest records ordered by newest first (maximum 50).
 * @throws {Error} If `workspaceId` is not provided.
 */
export async function listTests(workspaceId) {
  if (!workspaceId) throw new Error('listTests: workspaceId required');
  return prisma.incrementalityTest.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 50 });
}

/**
 * Fetches a single incrementality test by id within the given workspace.
 * @param {string} workspaceId - Workspace identifier.
 * @param {string} testId - Incrementality test identifier.
 * @returns {Object|null} The incrementalityTest record if found, otherwise `null`.
 */
export async function getTest(workspaceId, testId) {
  if (!workspaceId) throw new Error('getTest: workspaceId required');
  return prisma.incrementalityTest.findFirst({ where: { id: testId, workspaceId } });
}

/**
 * Conclude a holdout test by computing causal lift with confidence intervals, persisting the conclusion, writing a decision memory entry, and optionally creating a proposed decision.
 * @param {string} workspaceId - Workspace identifier for the test.
 * @param {string} testId - Identifier of the incrementality test to conclude.
 * @returns {{ readout: Object, memoryId: string, decisionId: string | null }} An object containing:
 *   - `readout`: the computed incrementality readout (lift, CI, confidence label, incremental revenue, and related metrics);
 *   - `memoryId`: the id of the created DecisionMemoryEntry;
 *   - `decisionId`: the id of the created Decision when one was created, or `null` otherwise.
 */
export async function concludeIncrementality(workspaceId, testId) {
  if (!workspaceId) throw new Error('concludeIncrementality: workspaceId required');
  const test = await prisma.incrementalityTest.findFirst({ where: { id: testId, workspaceId } });
  if (!test) throw new Error('concludeIncrementality: test not found');

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
