// ============================================================
// PlanService — the planning surface (owns all DB I/O)
// ============================================================
// Assembly delegates to the deterministic engines/services; this file only
// reads/writes the DB.
//   buildPlan():      channel mix (P3) + testing agenda (P4) + scenario
//                     (ranges) + unit economics + goal landing + memoryBasis
//                     → persist ONE Plan (+ ONE NorthStarGoal) in a txn.
//   getPlan/listPlans/trackPlan(): live actuals-vs-plan, READ-ONLY.
//   promotePlanMix(): reuse commitAllocation → PROPOSED REALLOCATE Decisions
//                     ride the existing Phase-3 governance. No new exec code.
//
// THE HONESTY RULE rides through: every projection persisted in `projections`
// is a range + assumptions; `memoryBasis` records what the plan leaned on.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { previewAllocation, commitAllocation } from '../allocation-engine/AllocationService.js';
import { GOAL_TYPE } from '../allocation-engine/allocationEngine.js';
import { getWeeklyAgenda } from '../test-generator/TestGeneratorService.js';
import { runScenario, gatherLeadingSignals } from '../scenario-engine/ScenarioService.js';
import { assessSustainability } from '../unit-economics/EconomicsService.js';
import { estimateLanding } from '../goal-tracker/goalTrackerEngine.js';

const AGENDA_LIMIT     = Number(process.env.PLAN_AGENDA_LIMIT || 5);
const ACTUALS_LOOKBACK = Number(process.env.PLAN_ACTUALS_LOOKBACK_DAYS || 60);

/**
 * Pure: is this plan's approval gate UNSATISFIED, so it must not be promoted?
 * Role-agnostic ON PURPOSE (Phase 6B decision) — an OPEN approval gate blocks
 * promotion for ANY role, including the strategist who opened it: "you asked
 * for a sign-off, get it before the mix becomes budget moves." This is distinct
 * from ApprovalService.isExecutionBlocked (which is role-aware and exempts a
 * strategist); that answers "can this ROLE execute", this answers "is this
 * PLAN's gate satisfied". Exported for unit testing without a DB.
 */
export function isPromotionApprovalBlocked(plan) {
  return !!plan && plan.requiresApproval === true && plan.approvalState !== 'APPROVED';
}

/**
 * Pure: derive the Phase-3 allocation input from a stored plan, so promoting
 * a plan's mix rides the existing commit path. Exported for testing.
 */
export function planToAllocationInput(plan) {
  if (!plan || typeof plan.totalBudgetMinor !== 'number') {
    throw new Error('planToAllocationInput: plan.totalBudgetMinor required');
  }
  return { totalBudgetMinor: plan.totalBudgetMinor, goal: { type: GOAL_TYPE.GROWTH_CEILING } };
}

/**
 * Aggregate platform MetricSnapshots into a daily actuals series for a metric.
 * Used to feed the goal-tracker's trend estimate. READ-ONLY.
 */
async function buildActualsSeries(workspaceId, metric, sinceDays = ACTUALS_LOOKBACK) {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await prisma.metricSnapshot.findMany({
    where:   { workspaceId, date: { gte: since } },
    select:  { date: true, spendMinor: true, revenueMinor: true, conversions: true, source: true },
    orderBy: { date: 'asc' },
  }).catch(() => []);

  const PLATFORM = new Set(['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN']);
  const byDay = new Map();
  for (const r of rows) {
    if (!PLATFORM.has(r.source)) continue;
    const key = r.date.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, { spendMinor: 0, revenueMinor: 0, conversions: 0 });
    const d = byDay.get(key);
    d.spendMinor   += r.spendMinor ?? 0;
    d.revenueMinor += r.revenueMinor ?? 0;
    d.conversions  += r.conversions ?? 0;
  }

  const series = [];
  for (const [date, d] of byDay) {
    let value = null;
    if (metric === 'blendedCac')       value = d.conversions > 0 ? d.spendMinor / d.conversions : null;
    else if (metric === 'blendedRoas') value = d.spendMinor > 0 ? d.revenueMinor / d.spendMinor : null;
    else if (metric === 'mer')         value = d.spendMinor > 0 ? d.revenueMinor / d.spendMinor : null;
    if (value != null && Number.isFinite(value)) series.push({ date, value });
  }
  return series;
}

/** Project a goal's landing (best-effort; null if no actuals). READ-ONLY. */
async function projectGoalLanding(workspaceId, goal, { now } = {}) {
  if (!goal) return null;
  const actuals = await buildActualsSeries(workspaceId, goal.metric);
  if (actuals.length === 0) return null;

  // Leading signals across the entities that carry spend.
  const entityRows = await prisma.metricSnapshot.findMany({
    where:   { workspaceId },
    select:  { entityId: true },
    distinct: ['entityId'],
    take:    50,
  }).catch(() => []);
  const leadingSignals = await gatherLeadingSignals(workspaceId, {
    entityIds: entityRows.map((e) => e.entityId),
    now,
  });

  try {
    return estimateLanding({
      target: { metric: goal.metric, comparator: goal.comparator, targetValue: goal.targetValue, spendCeilingMinor: goal.spendCeilingMinor },
      actuals, leadingSignals,
      periodStart: goal.periodStart, periodEnd: goal.periodEnd, now: now ?? new Date().toISOString(),
    });
  } catch (err) {
    logger.debug({ err: err.message, workspaceId }, '[PlanService] goal landing skipped');
    return null;
  }
}

/**
 * Assemble + persist a forward-looking plan.
 * @returns {Promise<object>} the persisted plan, decorated with the assembled projections
 */
export async function buildPlan(workspaceId, { name, periodStart, periodEnd, totalBudgetMinor, change, goal, now } = {}) {
  if (!workspaceId) throw new Error('buildPlan: workspaceId required');
  if (typeof totalBudgetMinor !== 'number' || totalBudgetMinor <= 0) {
    throw new Error('buildPlan: totalBudgetMinor must be a positive number');
  }

  // ── Assemble (all reads, delegated to the engines/services) ──
  const [mix, agenda, scenario] = await Promise.all([
    previewAllocation(workspaceId, { totalBudgetMinor, goal: { type: GOAL_TYPE.GROWTH_CEILING } }),
    getWeeklyAgenda(workspaceId).then((a) => a.slice(0, AGENDA_LIMIT)).catch(() => []),
    change ? runScenario(workspaceId, { change, now }) : Promise.resolve(null),
  ]);

  // Sustainability of the projected CAC (scenario range if present, else the
  // allocation's projected CPA point).
  const cacMinor = scenario?.projections?.blendedCacMinor ?? mix?.projected?.projectedCpaMinor ?? null;
  const econ = cacMinor != null ? await assessSustainability(workspaceId, { cacMinor }) : null;

  // Goal landing (best-effort) before persistence, so the plan stores an
  // initial read alongside its target.
  const landing = goal ? await projectGoalLanding(workspaceId, { ...goal, periodStart, periodEnd }, { now }) : null;

  const memoryBasis = scenario?.memoryBasis ?? [];
  const currency = mix?.currency ?? scenario?.currency ?? 'USD';
  const projections = {
    scenario: scenario ? { scenarioType: scenario.scenarioType, projections: scenario.projections, assumptions: scenario.assumptions, confidence: scenario.confidence, basis: scenario.basis } : null,
    economics: econ ? { ltvToCac: econ.result.ltvToCac, sustainabilityBand: econ.result.sustainabilityBand, paybackOrders: econ.result.paybackOrders, ltvMinor: econ.result.ltvMinor, isDefault: econ.isDefault, assumptions: econ.result.assumptions } : null,
    goalLanding: landing,
  };

  // ── Persist ONE Plan (+ ONE NorthStarGoal) in a single transaction ──
  const writes = [
    prisma.plan.create({
      data: {
        workspaceId, name: name ?? 'Untitled plan',
        periodStart: new Date(periodStart), periodEnd: new Date(periodEnd),
        totalBudgetMinor, currency,
        status: 'DRAFT',
        channelMix:    mix?.allocations ?? [],
        testingAgenda: agenda,
        projections,
        memoryBasis,
      },
    }),
  ];
  const [plan] = await prisma.$transaction(writes);

  if (goal) {
    await prisma.northStarGoal.create({
      data: {
        workspaceId, planId: plan.id,
        name: goal.name ?? `${goal.metric} ${goal.comparator} ${goal.targetValue}`,
        metric: goal.metric, comparator: goal.comparator, targetValue: goal.targetValue,
        spendCeilingMinor: goal.spendCeilingMinor ?? null,
        currency,
        periodStart: new Date(periodStart), periodEnd: new Date(periodEnd),
        status: landing?.status ?? 'ON_TRACK',
      },
    });
  }

  logger.info({ workspaceId, planId: plan.id, hasScenario: !!scenario, hasGoal: !!goal, memoryBasis: memoryBasis.length }, '[PlanService] plan built');
  return getPlan(workspaceId, plan.id, { now });
}

/** List plans (lightweight). READ-ONLY. */
export async function listPlans(workspaceId) {
  if (!workspaceId) throw new Error('listPlans: workspaceId required');
  return prisma.plan.findMany({
    where:   { workspaceId },
    orderBy: { createdAt: 'desc' },
    include: { goals: true },
    take:    50,
  });
}

/** One plan + live actuals-vs-plan tracking. READ-ONLY. */
export async function getPlan(workspaceId, planId, { now } = {}) {
  if (!workspaceId) throw new Error('getPlan: workspaceId required');
  const plan = await prisma.plan.findFirst({
    where: { id: planId, workspaceId },
    include: { goals: true, approvals: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!plan) return null;
  const { approvals, ...rest } = plan;
  // The plan row already carries the reflected requiresApproval/approvalState;
  // surface the latest request so the owner can read WHY (the reviewer's note)
  // when a revision was requested. Null when no gate was ever opened.
  const a = approvals?.[0] ?? null;
  const latestApproval = a
    ? { id: a.id, state: a.state, reason: a.reason ?? null, decidedAt: a.decidedAt, createdAt: a.createdAt }
    : null;
  return { ...rest, latestApproval, tracking: await trackPlan(workspaceId, plan, { now }) };
}

/**
 * Recompute live tracking for a plan: goal landing(s) with fresh leading
 * signals + channel-mix drift vs the snapshot. READ-ONLY.
 */
export async function trackPlan(workspaceId, planOrId, { now } = {}) {
  const plan = typeof planOrId === 'string'
    ? await prisma.plan.findFirst({ where: { id: planOrId, workspaceId }, include: { goals: true } })
    : planOrId;
  if (!plan) return null;

  const goals = [];
  for (const g of plan.goals ?? []) {
    goals.push({ goalId: g.id, metric: g.metric, landing: await projectGoalLanding(workspaceId, g, { now }) });
  }
  return { goals, refreshedAt: new Date().toISOString() };
}

/**
 * Promote the plan's channel mix → PROPOSED REALLOCATE Decisions via the
 * existing Phase-3 governance. Sets Plan.allocationPlanId. The ONLY write
 * that touches execution.
 * @returns {Promise<{ planId, allocationPlanId, decisionsCreated }>}
 */
export async function promotePlanMix(workspaceId, planId) {
  if (!workspaceId) throw new Error('promotePlanMix: workspaceId required');
  const plan = await prisma.plan.findFirst({ where: { id: planId, workspaceId } });
  if (!plan) throw new Error('promotePlanMix: plan not found');
  // Approval gate (Phase 6B): an unapproved plan with an open gate cannot become
  // budget moves. Backend is the real arbiter — rejects regardless of caller.
  if (isPromotionApprovalBlocked(plan)) {
    const err = new Error('Plan requires STRATEGIST approval before execution');
    err.code = 'ApprovalRequired';
    err.approvalState = plan.approvalState ?? null;
    throw err;
  }
  if (plan.allocationPlanId) {
    return { planId: plan.id, allocationPlanId: plan.allocationPlanId, decisionsCreated: 0, alreadyPromoted: true };
  }

  const input = planToAllocationInput(plan);
  const { planId: allocationPlanId, decisionsCreated } = await commitAllocation(workspaceId, input);
  await prisma.plan.update({ where: { id: plan.id }, data: { allocationPlanId, status: 'ACTIVE' } });

  logger.info({ workspaceId, planId: plan.id, allocationPlanId, decisionsCreated }, '[PlanService] mix promoted');
  return { planId: plan.id, allocationPlanId, decisionsCreated };
}
