// ============================================================
// AllocationService — persistence wrapper for the allocation engine
// ============================================================
// Owns DB I/O (the deterministic allocationEngine never touches it).
//   preview(): blended-truth → allocate → return the plan (NO writes).
//   commit():  persist one AllocationPlan + one PROPOSED REALLOCATE
//              Decision per non-zero move, via a single createMany
//              (no N+1). Each Decision is a radar verdict the human
//              confirms → it then flows through the existing
//              /api/execute/meta REALLOCATE_BUDGET governance.
//
// A guardrail-style convention links moves to their plan:
//   Decision.rootCause = `allocation:${planId}`.
// ============================================================
import { prisma }   from '../../lib/prisma.js';
import { logger }   from '../../utils/logger.js';
import { allocate, GOAL_TYPE } from './allocationEngine.js';
import { getBlendedTruth }     from '../blended-truth/BlendedTruthService.js';

const ALLOC_ROOT_PREFIX = 'allocation:';

/**
 * Pure: map an allocation plan's moves to PROPOSED REALLOCATE Decision rows.
 * Only moves that actually shift budget become decisions. Channels are
 * account/campaign-level, so the REALLOCATE_BUDGET target level is CAMPAIGN.
 * Exported for unit testing without a DB.
 *
 * @param {object} plan — allocationEngine.allocate() output
 * @param {object} ctx — { workspaceId, planId }
 * @returns {Array<object>} Decision createMany rows
 */
export function planToDecisionRows(plan, { workspaceId, planId }) {
  if (!workspaceId) throw new Error('planToDecisionRows: workspaceId required');
  return plan.allocations
    .filter((a) => a.deltaMinor !== 0)
    .map((a) => ({
      workspaceId,
      entityId:    a.channelId,
      entityLevel: 'CAMPAIGN', // account/campaign-level budget move
      verdict:     'REALLOCATE',
      confidence:  0.8,
      diagnosis:   a.rationale,
      rootCause:   `${ALLOC_ROOT_PREFIX}${planId}`,
      status:      'PROPOSED',
    }));
}

/**
 * Build allocation channel inputs by combining blended-truth channel metrics with each channel's latest decision verdict (defaults to `'HOLD'` when none exists).
 * @param {string} workspaceId - Workspace identifier.
 * @returns {Promise<Array<object>>} An array of channel input objects containing: `channelId`, `channel`, `blendedRoas`, `currentSpendMinor`, `currentRevenueMinor`, `verdict`, and `currency`.
 */
async function buildChannels(workspaceId) {
  const { channels } = await getBlendedTruth(workspaceId);
  if (channels.length === 0) return [];

  // Latest verdict per channel entity (gates appetite).
  const decisions = await prisma.decision.findMany({
    where:   { workspaceId, entityId: { in: channels.map((c) => c.channelId) } },
    orderBy: { createdAt: 'desc' },
  });
  const verdictByEntity = new Map();
  for (const d of decisions) if (!verdictByEntity.has(d.entityId)) verdictByEntity.set(d.entityId, d.verdict);

  return channels.map((c) => ({
    channelId:           c.channelId,
    channel:             c.channel,
    blendedRoas:         c.blendedRoas,
    currentSpendMinor:   c.spendMinor,
    currentRevenueMinor: c.blendedRevenueMinor,
    verdict:             verdictByEntity.get(c.channelId) ?? 'HOLD',
    currency:            c.currency,
  }));
}

/**
 * Build allocation channel inputs using incremental (causal) efficiency while applying the latest stored decision verdicts.
 * @param {string} workspaceId - Workspace identifier used to load incremental channels and their latest decisions.
 * @returns {Array<Object>} An array of channel input objects augmented with incremental efficiency fields and a `verdict` property set to the most recent decision verdict for that channel, or `'HOLD'` if no decision exists. */
async function buildIncrementalChannels(workspaceId) {
  // Lazy import avoids a static cycle (Reconciliation → BlendedTruth only).
  const { incrementalChannels } = await import('../reconciliation/ReconciliationService.js');
  const { channels } = await incrementalChannels(workspaceId);
  if (channels.length === 0) return [];

  const decisions = await prisma.decision.findMany({
    where:   { workspaceId, entityId: { in: channels.map((c) => c.channelId) } },
    orderBy: { createdAt: 'desc' },
  });
  const verdictByEntity = new Map();
  for (const d of decisions) if (!verdictByEntity.has(d.entityId)) verdictByEntity.set(d.entityId, d.verdict);

  return channels.map((c) => ({ ...c, verdict: verdictByEntity.get(c.channelId) ?? 'HOLD' }));
}

/**
 * Produce an allocation scenario and projected impact without persisting any data.
 * @param {string} workspaceId - Workspace identifier for which to build the scenario.
 * @param {object} [opts] - Preview options.
 * @param {number} [opts.totalBudgetMinor] - Total budget in minor currency units to pass to the allocator.
 * @param {object} [opts.goal] - Allocation goal object (if omitted, a default growth-ceiling goal is used).
 * @param {'blended'|'incremental'} [opts.basis='blended'] - Which channel efficiency basis to use when building inputs.
 * @returns {object|null} The allocation plan (augmented with the selected `basis`) or `null` when there are no channels to allocate.
 * @throws {Error} When `workspaceId` is not provided.
 */
export async function previewAllocation(workspaceId, { totalBudgetMinor, goal, basis = 'blended' } = {}) {
  if (!workspaceId) throw new Error('previewAllocation: workspaceId required');
  const channels = basis === 'incremental'
    ? await buildIncrementalChannels(workspaceId)
    : await buildChannels(workspaceId);
  if (channels.length === 0) return null;
  const plan = allocate({ totalBudgetMinor, goal: goal ?? { type: GOAL_TYPE.GROWTH_CEILING }, channels });
  return { ...plan, basis };
}

/**
 * Commit — persist the AllocationPlan + PROPOSED REALLOCATE Decisions.
 * @returns {Promise<{ planId, decisionsCreated }>}
 */
export async function commitAllocation(workspaceId, { totalBudgetMinor, goal } = {}) {
  if (!workspaceId) throw new Error('commitAllocation: workspaceId required');
  const plan = await previewAllocation(workspaceId, { totalBudgetMinor, goal });
  if (!plan) throw new Error('commitAllocation: no channels to allocate');

  const created = await prisma.allocationPlan.create({
    data: {
      workspaceId,
      goalType:          plan.goal.type,
      goalValue:         typeof plan.goal.value === 'number' ? plan.goal.value : null,
      totalBudgetMinor:  plan.totalBudgetMinor,
      currency:          plan.currency,
      projectedRoas:     plan.projected.merAfter,
      projectedCpaMinor: plan.projected.projectedCpaMinor,
      merBefore:         plan.projected.merBefore,
      merAfter:          plan.projected.merAfter,
      reasoning:         plan.reasoningTrail.join('\n'),
      status:            'PROPOSED',
    },
  });

  const rows = planToDecisionRows(plan, { workspaceId, planId: created.id });
  if (rows.length > 0) await prisma.decision.createMany({ data: rows });

  logger.info({ workspaceId, planId: created.id, decisionsCreated: rows.length }, '[AllocationService] committed');
  return { planId: created.id, decisionsCreated: rows.length, plan };
}
