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
import { DECISION_CLASS } from '@marcom/runtime-contracts';
import { projectIncrementalityTest, projectIncrementalityReadout } from './incrementalityProjection.js';

const MEMORY_PREFIX = 'incrementality:';
const COUNT_FIELDS = ['exposedUsers', 'exposedConversions', 'holdoutUsers', 'holdoutConversions'];
const MAX_STORED_INT = 2147483647;
const COUNT_BASIS = 'Operator-reported counts; randomization and measurement are not independently verified. Causal interpretation assumes a valid holdout design.';

function holdoutError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validateCounts(counts) {
  for (const field of COUNT_FIELDS) {
    const value = counts[field];
    if (!Number.isInteger(value) || value < 0 || value > MAX_STORED_INT) {
      throw holdoutError('INVALID_HOLDOUT_COUNTS', `${field} must be a non-negative integer no greater than ${MAX_STORED_INT}`);
    }
  }
  if (counts.exposedConversions > counts.exposedUsers) throw holdoutError('INVALID_HOLDOUT_COUNTS', 'exposedConversions cannot exceed exposedUsers');
  if (counts.holdoutConversions > counts.holdoutUsers) throw holdoutError('INVALID_HOLDOUT_COUNTS', 'holdoutConversions cannot exceed holdoutUsers');
}

function assertConcludable(test) {
  if (test.status !== 'RUNNING') throw holdoutError('HOLDOUT_CONFLICT', 'Holdout must be RUNNING to conclude; terminal results are immutable.');
  validateCounts(test);
  if (!(test.exposedUsers > 0) || !(test.holdoutUsers > 0)) {
    throw holdoutError('NO_OBSERVED_COUNTS', 'No observed counts recorded — record holdout results before concluding');
  }
}

// Both lifecycle writers lock the SAME workspace-owned parent before reading
// authoritative counts. A foreign ID cannot acquire another workspace's lock.
async function withLockedHoldout(workspaceId, testId, operation) {
  return prisma.$transaction(async (tx) => {
    const owned = await tx.$queryRaw`
      SELECT id FROM public.incrementality_tests
      WHERE id = ${testId}::uuid AND "workspaceId" = ${workspaceId}::uuid FOR UPDATE`;
    if (!owned.length) throw new Error('Holdout test not found');
    const test = await tx.incrementalityTest.findFirst({ where: { id: testId, workspaceId } });
    if (!test) throw new Error('Holdout test not found');
    return operation(tx, test);
  }, { isolationLevel: 'ReadCommitted' });
}

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
    rationale: `${COUNT_BASIS} ${rationale}`,
    // Lift and confidence do not measure outcome durability.
    isSustainable: null,
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
  return { ...projectIncrementalityTest(created), design };
}

export async function listTests(workspaceId) {
  if (!workspaceId) throw new Error('listTests: workspaceId required');
  const rows = await prisma.incrementalityTest.findMany({
    where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 50,
    // Provenance (Phase 7C): surface the A/B test a holdout was promoted from
    // so the panel can show "From A/B test". Null for directly-designed holdouts.
    include: { sourceTest: { select: { id: true, dimension: true, hypothesis: true } } },
  });
  return rows.map(projectIncrementalityTest);
}

/**
 * Record a holdout's OBSERVED counts — the missing write organ. A holdout's
 * exposed/holdout user+conversion counts are reported by the operator, without
 * independent verification of randomization or measurement. Moves DESIGNED → RUNNING
 * and stamps startedAt. Counts are validated and immutable once CONCLUDED.
 *
 * @returns {Promise<object>} the updated IncrementalityTest row
 */
export async function recordCounts(workspaceId, testId, counts = {}) {
  if (!workspaceId) throw new Error('recordCounts: workspaceId required');
  if (!testId) throw new Error('recordCounts: testId required');

  const { exposedUsers, exposedConversions, holdoutUsers, holdoutConversions } = counts;
  const updated = await withLockedHoldout(workspaceId, testId, async (tx, test) => {
    if (test.status !== 'DESIGNED' && test.status !== 'RUNNING') {
      throw holdoutError('HOLDOUT_CONFLICT', 'Holdout observed counts are immutable after conclusion or abandonment.');
    }
    validateCounts(counts);

    // Retain the non-terminal write predicate as an additional refusal guard,
    // alongside the shared lifecycle lock and authoritative read above.
    const res = await tx.incrementalityTest.updateMany({
      where: { id: test.id, workspaceId, status: { in: ['DESIGNED', 'RUNNING'] } },
      data: {
        exposedUsers, exposedConversions, holdoutUsers, holdoutConversions,
        status: 'RUNNING',
        startedAt: test.startedAt ?? new Date(),
      },
    });
    if (res.count === 0) throw holdoutError('HOLDOUT_CONFLICT', 'Holdout is no longer editable — observed counts are immutable');

    return tx.incrementalityTest.findFirst({ where: { id: test.id, workspaceId } });
  });
  logger.info({ workspaceId, testId }, '[IncrementalityService] observed counts recorded');
  return projectIncrementalityTest(updated);
}

/**
 * One holdout, by its own id — the read behind `GET /incrementality/:id`.
 *
 * B8-05 · R-E2 — A DETAIL READ MAY NOT BE WEAKER THAN ITS OWN LIST. This
 * carried no `include`, so a holdout PROMOTED from a concluded A/B test came
 * back without the `sourceTest` that `listTests` shows in the panel. That is
 * not a missing decoration: `IncrementalityTestSchema` declares `sourceTest` as
 * nullish, so the row parsed cleanly and the surface read "designed directly"
 * for a holdout that was promoted. `undefined` (we did not ask) and `null`
 * (there is no source) are the same value, and nothing travelled beside them to
 * say which — the defect B8-04b named one layer up.
 *
 * The projection is deliberately IDENTICAL to `listTests`, and
 * `incrementalityDetail.test.js` derives its expectation from that function
 * rather than restating it, so the two cannot drift apart again in silence.
 */
export async function getTest(workspaceId, testId) {
  if (!workspaceId) throw new Error('getTest: workspaceId required');
  const row = await prisma.incrementalityTest.findFirst({
    where: { id: testId, workspaceId },
    include: { sourceTest: { select: { id: true, dimension: true, hypothesis: true } } },
  });
  return projectIncrementalityTest(row);
}

/**
 * Conclude a holdout: read out the causal lift (with CI) and close the loop
 * into memory. Mirrors TestTrackerService.concludeTest.
 * @returns {Promise<{ readout, memoryId, decisionId }>}
 */
export async function concludeIncrementality(workspaceId, testId) {
  if (!workspaceId) throw new Error('concludeIncrementality: workspaceId required');
  if (!testId) throw new Error('concludeIncrementality: testId required');
  const candidate = await prisma.incrementalityTest.findFirst({ where: { id: testId, workspaceId } });
  if (!candidate) throw new Error('concludeIncrementality: test not found');
  assertConcludable(candidate);

  // Economics may read through the shared Prisma pool. Fetch it BEFORE taking
  // the transaction connection so contending conclusions cannot exhaust the
  // pool waiting for nested reads. This is not an authoritative count snapshot;
  // status and counts are re-read/revalidated under the lock below. Existing
  // publication still marks the monetary valuation basis unproven.
  const { economics } = await getEconomics(workspaceId);
  const result = await withLockedHoldout(workspaceId, testId, async (tx, test) => {
    assertConcludable(test);
    const readout = readIncrementality({
      exposed: { users: test.exposedUsers, conversions: test.exposedConversions },
      holdout: { users: test.holdoutUsers, conversions: test.holdoutConversions },
      aovMinor: economics.aovMinor,
    });

    const mem = incrementalityToMemory(test, readout);

    let decisionId = null;
    // Only a CONFIDENT positive causal lift becomes a proposed action.
    if (readout.conclusive && (readout.confidenceLabel === 'HIGH' || readout.confidenceLabel === 'MEDIUM') && test.entityId) {
      const decision = await tx.decision.create({
        data: {
          workspaceId, entityId: test.entityId, entityLevel: test.entityLevel ?? 'CAMPAIGN',
          verdict: 'SCALE', confidence: readout.confidenceLabel === 'HIGH' ? 0.9 : 0.7,
          diagnosis: mem.rationale, rootCause: `${MEMORY_PREFIX}${test.id}`, status: 'PROPOSED',
          // C-10 — EXPERIMENT covers both test producers; `incrementality:` vs
          // `test:` stays a SUBTYPE on rootCause, where it has always been.
          decisionClass: DECISION_CLASS.EXPERIMENT,
        },
      });
      decisionId = decision.id;
    }

    await tx.incrementalityTest.update({
      where: { id: test.id, workspaceId },
      data: {
        status: 'CONCLUDED', concludedAt: new Date(),
        liftPct: readout.liftPct, ciLow: readout.ci[0], ciHigh: readout.ci[1],
        confidenceLabel: readout.conclusive ? readout.confidenceLabel : null,
        incrementalRevenueMinor: readout.incrementalRevenueMinor.value,
        decisionId,
      },
    });

    const memory = await tx.decisionMemoryEntry.create({ data: { ...mem, decisionId } });
    return {
      decisionId, memoryId: memory.id,
      readout: projectIncrementalityReadout({ ...readout, rationale: `${COUNT_BASIS} ${readout.rationale}` }),
    };
  });

  logger.info({ workspaceId, testId, conclusive: result.readout.conclusive, decisionId: result.decisionId }, '[IncrementalityService] concluded — loop closed');
  return result;
}
