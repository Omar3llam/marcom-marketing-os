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
 * Compose blended truth + current verdicts into allocation channel inputs.
 * @returns {Promise<Array<object>>}
 */
async function buildChannels(workspaceId) {
  const { channels } = await getBlendedTruth(workspaceId);
  if (channels.length === 0) return [];

  // Latest verdict per channel entity (gates appetite). Two fields, named: the
  // loop below reads entityId and verdict and nothing else, and a select-less
  // read here would pull both reasoning JSONB columns per row to discard them.
  const decisions = await prisma.decision.findMany({
    where:   { workspaceId, entityId: { in: channels.map((c) => c.channelId) } },
    orderBy: { createdAt: 'desc' },
    select:  { entityId: true, verdict: true },
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
 * Compose allocation inputs from INCREMENTAL (causal) efficiency instead of
 * claimed/blended — Phase 7 acceptance #3. Reuses ReconciliationService's
 * incrementality-adjusted marginalEfficiency; the allocation ENGINE is
 * unchanged (it already prefers marginalEfficiency when finite).
 */
async function buildIncrementalChannels(workspaceId) {
  // Lazy import avoids a static cycle (Reconciliation → BlendedTruth only).
  const { incrementalChannels } = await import('../reconciliation/ReconciliationService.js');
  const { channels } = await incrementalChannels(workspaceId);
  if (channels.length === 0) return [];

  const decisions = await prisma.decision.findMany({
    where:   { workspaceId, entityId: { in: channels.map((c) => c.channelId) } },
    orderBy: { createdAt: 'desc' },
    select:  { entityId: true, verdict: true },
  });
  const verdictByEntity = new Map();
  for (const d of decisions) if (!verdictByEntity.has(d.entityId)) verdictByEntity.set(d.entityId, d.verdict);

  return channels.map((c) => ({ ...c, verdict: verdictByEntity.get(c.channelId) ?? 'HOLD' }));
}

/**
 * Scenario preview — allocation + projected impact, NO writes.
 * @param {object} [opts] — { totalBudgetMinor, goal, basis: 'blended'|'incremental' }
 * @returns {Promise<object|null>} the plan, or null if no channels
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
