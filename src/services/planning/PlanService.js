// ============================================================
// PlanService — the planning surface (owns all DB I/O)
// ============================================================
// Assembly delegates to the deterministic engines/services; this file only
// reads/writes the DB.
//   buildPlan():      channel mix (P3) + testing agenda (P4) + scenario
//                     (ranges) + unit economics + goal landing + memoryBasis
//                     → persist ONE Plan (+ ONE NorthStarGoal) in a txn.
//   getPlan/listPlans/trackPlan(): live actuals-vs-plan, READ-ONLY.
//   promotePlanMix(): the APPROVED mix, read back from the plan's own snapshot
//                     → PROPOSED REALLOCATE Decisions riding the existing
//                     Phase-3 governance. No new exec code, and (C-18) no
//                     recomputation: nothing on that path reads live truth.
//
// THE HONESTY RULE rides through: every projection persisted in `projections`
// is a range + assumptions; `memoryBasis` records what the plan leaned on.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { previewAllocation, persistAllocation } from '../allocation-engine/AllocationService.js';
import { GOAL_TYPE } from '../allocation-engine/allocationEngine.js';
import { getWeeklyAgenda } from '../test-generator/TestGeneratorService.js';
import { runScenario, gatherLeadingSignals } from '../scenario-engine/ScenarioService.js';
import { assessSustainability } from '../unit-economics/EconomicsService.js';
import { estimateLanding } from '../goal-tracker/goalTrackerEngine.js';
import { TEMPORAL } from '../../config/temporal.js';
import { ENTITY_LEVEL } from '../connectors/connectorTypes.js';
import { selectOperationalSnapshots } from '../evidence/index.js';
import { PROMOTION_OUTCOME } from '@marcom/runtime-contracts';
import { periodBetween } from '../budget-period/spendPeriod.js';
import { MONETARY_STATUS, MONETARY_REASON } from '../../lib/operationalMonetary.js';
import { evaluatePlanningActual, PLANNING_EVIDENCE, PLANNING_REASON } from './planningActuals.js';
import {
  captureMixSnapshot, planToAllocationCommit, hasBudgetMoves, budgetMovesAreMeasured,
  refusePromotion, PROMOTION_REFUSAL,
} from './planPromotionSnapshot.js';

const AGENDA_LIMIT = Number(process.env.PLAN_AGENDA_LIMIT || 5);
// Bounds MetricSnapshot.date — the SYNC/OBSERVATION timestamp, never a delivery
// date. R3.6 moved the read behind the Evidence layer and deliberately left the
// arithmetic sitting on top of it alone; R4 repaired that arithmetic (see
// buildActualsSeries). The bound itself is unchanged in value (60) and unchanged
// in meaning: how recently a row was OBSERVED, not what period it measures.
const ACTUALS_SYNC_RECENCY_DAYS = TEMPORAL.planActualsSyncRecencyDays;

/** A missing/unparseable date sorts oldest — it must never win a comparison. */
function stampOf(d) {
  const t = d == null ? NaN : new Date(d).getTime();
  return Number.isFinite(t) ? t : -Infinity;
}

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

// C-18 removed `planToAllocationInput` here. It returned the budget and a
// hardcoded goal, and `commitAllocation` recomputed the whole mix from live
// blended truth — so a plan approved on Tuesday executed Friday's arithmetic.
// The approved mix is now rebuilt from the stored snapshot by
// `planToAllocationCommit`, and no path from promotion reaches
// `previewAllocation` at all.

/**
 * Aggregate platform MetricSnapshots into an OBSERVATION-DAY actuals series for
 * a metric. Used to feed the goal-tracker's trend estimate. READ-ONLY.
 *
 * NOT A DAILY ACTIVITY SERIES, and the wording is deliberate. The stored `date`
 * is the sync/observation timestamp, and current ingestion stores TRAILING-WINDOW
 * OBSERVATIONS — the cron asks the platform for its last 90 days, a manual Sync
 * asks for the account's whole retention — never a single day's activity. One
 * point here therefore means:
 *
 *     the latest trailing-window observation per (entity, source), at one
 *     entity level, on the UTC day it was observed.
 *
 * R4 repairs two arithmetic defects that were wrong under ANY reading of these
 * rows. It does not, and cannot, turn them into daily activity — that needs
 * daily ingestion (Phase E / time_increment=1) and is not reconstructible from
 * what is already stored:
 *
 *   1. CROSS-LEVEL DOUBLE COUNT. A platform sync lands ACCOUNT, CAMPAIGN, ADSET
 *      and AD rows for the SAME delivery, and the ACCOUNT row is the sum of the
 *      campaigns beneath it. Adding the levels together counted one account's
 *      spend about four times. The read is now scoped to ONE level, CAMPAIGN —
 *      the grain both platform normalizers emit and the natural unit for a plan.
 *
 *   2. REPEATED OBSERVATIONS. Two syncs on one day are the same period measured
 *      twice, not twice the activity. They were ADDED — a 90-day aggregate on
 *      top of a lifetime one, called a day. Only the newest reading of a stream
 *      survives now.
 *
 * The reduction rule is the one already established for this data in
 * blended-truth (latestPerStream): a stream is (entityId, source), the newest
 * row supersedes older ones WITHIN a stream, and rows from DIFFERENT streams are
 * independent measurements that may legitimately be summed. It is applied here
 * rather than imported so this repair stays local and Plan does not take a
 * dependency on that service's DB/credential graph for a pure fold.
 */
async function buildActualsSeries(workspaceId, metric, targetCurrency, sinceDays = ACTUALS_SYNC_RECENCY_DAYS) {
  if (metric === 'mer') {
    return { status: PLANNING_EVIDENCE.INSUFFICIENT, reason: PLANNING_REASON.BUSINESS_REVENUE_SOURCE_UNAVAILABLE, currency: null, series: [] };
  }
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  // R3: this read no longer states where its evidence lives. The operational
  // population — workspace scope and the window allow-list Phase G introduced —
  // is declared once, in the Evidence layer, and asked for here.
  //
  // WHY THE POPULATION MATTERS HERE SPECIFICALLY: this SUMS platform rows into a
  // per-day bucket, and Phase F's canonical row falls in the SAME bucket as the
  // operational one — so goal actuals double-counted spend and revenue on every
  // sync date. Same class as the over-count PR #357 removed, reached by a
  // different route. The seam is now what keeps the two apart.
  //
  // R4 — `entityLevel`, the seam's second narrowing, is what stops the OTHER
  // double count. This is a narrower QUESTION, not a narrower population: the
  // levels overlap by construction, so a plan's actuals have to pick one, and
  // CAMPAIGN is the only grain both platform normalizers emit. Asked of the
  // seam rather than filtered in memory because it is a property of WHICH ROWS
  // this consumer's question is about, exactly like RevenueCsv's use of it.
  //
  // `entityId` joins the projection for the same reason: the reduction below
  // keys on it, and the seam refuses an unprojected read. A consumer declares
  // the fields it needs; nothing about the population moved.
  //
  // NO orderBy PASSED, and that is the faithful reproduction rather than a
  // shortcut: this query asked for `{ date: 'asc' }`, which is exactly what the
  // Evidence layer publishes as OPERATIONAL_ORDER_BY and applies by default.
  // Every consumer migrated before this one passed `orderBy: null` because it
  // had no ORDER BY to reproduce; this is the first that wanted the default, so
  // it takes it. The Prisma arguments are identical either way, and the test
  // asserts `{ date: 'asc' }` against a hand-written literal, so a change to the
  // shared constant still fails here. The reduction below does NOT lean on it.
  //
  // THE SOURCE FILTER STAYS BELOW, in memory, where it has always been. The
  // Evidence layer owns operational eligibility; which sources count as a
  // PLATFORM contribution to a goal is Plan's own semantics, and moving it into
  // the seam would apply it to consumers that read GA4 and MANUAL rows on
  // purpose.
  //
  // THE CATCH STAYS HERE. A failed read has always produced an empty series,
  // and therefore a null landing rather than a fabricated one; the seam must
  // keep propagating so an outage never reads as "no actuals" for everyone.
  const rows = await selectOperationalSnapshots(workspaceId, {
    since,
    entityLevel: ENTITY_LEVEL.CAMPAIGN,
    select: { date: true, entityId: true, spendMinor: true, revenueMinor: true, conversions: true, source: true, currency: true, currencyProvenance: true, measurementWindow: true, windowStart: true, windowEnd: true },
  }).catch(() => []);

  const PLATFORM = new Set(['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN']);
  // One winner per (entityId, source) per observation day. Nothing is added
  // until the winners are known, so a re-measurement can never be mistaken for
  // more activity. Order-INDEPENDENT on purpose: the seam's default ordering is
  // reproduced above because the old query had it, and this must not quietly
  // become a second thing that depends on it.
  //
  // No window precedence rule is invented here. A day can hold a 90-day reading
  // and a full-retention one for the same stream and nothing stored says which
  // is "better" — so the only existing selection rule applies, and the newest
  // observation wins. That the basis can differ between a cron run and a manual
  // Sync is a limitation of what ingestion records, not something to paper over.
  const byDay = new Map();
  for (const r of rows) {
    if (!PLATFORM.has(r.source)) continue;
    const key = r.date.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, new Map());
    const streams = byDay.get(key);
    const stream = `${r.entityId}|${r.source}`;
    const prev = streams.get(stream);
    if (prev === undefined || stampOf(r.date) > stampOf(prev.date)) streams.set(stream, r);
  }

  const series = [];
  let currency = null;
  for (const [date, streams] of byDay) {
    const point = evaluatePlanningActual([...streams.values()], metric, targetCurrency);
    if (point.status !== PLANNING_EVIDENCE.VALID) return { ...point, series: [] };
    if (currency && currency !== point.currency) {
      return { status: PLANNING_EVIDENCE.INSUFFICIENT, reason: PLANNING_REASON.ACTUAL_CURRENCY_MIXED, currency: null, series: [] };
    }
    currency = point.currency;
    series.push({ date, value: point.value });
  }
  return series.length > 0
    ? { status: PLANNING_EVIDENCE.VALID, reason: null, currency, series }
    : { status: PLANNING_EVIDENCE.INSUFFICIENT, reason: PLANNING_REASON.INSUFFICIENT_MEASUREMENT_EVIDENCE, currency: null, series: [] };
}

/** Current tracking is always recomputed; a persisted legacy status is not evidence. */
export async function evaluateGoalTracking(workspaceId, goal, { now } = {}) {
  if (!goal) return { status: PLANNING_EVIDENCE.INSUFFICIENT, reason: PLANNING_REASON.INSUFFICIENT_MEASUREMENT_EVIDENCE, currency: null, landing: null };
  const measured = await buildActualsSeries(workspaceId, goal.metric, goal.currency);
  if (measured.status !== PLANNING_EVIDENCE.VALID) {
    return { status: PLANNING_EVIDENCE.INSUFFICIENT, reason: measured.reason, currency: null, landing: null };
  }

  // Leading signals across the entities that carry spend.
  //
  // R3.10 — THE LAST DIRECT OPERATIONAL READ IN THE CODEBASE. It asks a
  // different question from every other consumer: not "what did these entities
  // measure" but "which entities has this workspace synced anything for at all",
  // which is why it projects one column, collapses to one row per entity and
  // caps at 50 so a large account cannot make one goal projection unbounded.
  //
  // THE REDUCTION IS THE REASON THE SEAM GREW, and it is opt-in for a reason
  // worth repeating at the call site: six earlier R3 PRs used `distinct` at the
  // Evidence layer as a NEGATIVE CONTROL, because a reduction applied to a
  // consumer that never asked for one deletes rows it is counting — including
  // buildActualsSeries above, which SUMS a day's rows. Absent by default is what
  // keeps those controls failing; this is the one caller that names them.
  //
  // NO `since` — deliberately, and unchanged. This read has never had a recency
  // bound: an entity synced last quarter is still an entity this workspace has,
  // and gatherLeadingSignals applies its own fatigue window downstream. Adding
  // one here would quietly shrink the population a landing is projected over.
  //
  // NO entityLevel, NO entityIds, NO source filter — the population is every
  // operational row in the workspace, which is what "which entities exist" means.
  //
  // `orderBy: null` because the old query had no ORDER BY, so which 50 entities
  // come back is storage order. That is a property of the query being MIGRATED,
  // not one introduced here; R3 moves ownership without changing the plan.
  //
  // THE CATCH STAYS HERE. A failed scan has always meant "no leading signals",
  // never a thrown projection; the seam keeps propagating so an outage cannot
  // read as "this workspace has no entities" for every other consumer.
  const entityRows = await selectOperationalSnapshots(workspaceId, {
    select:   { entityId: true },
    orderBy:  null,
    distinct: ['entityId'],
    take:     50,
  }).catch(() => []);
  const leadingSignals = await gatherLeadingSignals(workspaceId, {
    entityIds: entityRows.map((e) => e.entityId),
    now,
  });

  try {
    const landing = estimateLanding({
      target: { metric: goal.metric, comparator: goal.comparator, targetValue: goal.targetValue, spendCeilingMinor: goal.spendCeilingMinor },
      actuals: measured.series, leadingSignals,
      measurementEligibility: { status: PLANNING_EVIDENCE.VALID, currency: measured.currency },
      periodStart: goal.periodStart, periodEnd: goal.periodEnd, now: now ?? new Date().toISOString(),
    });
    return { status: landing.status, reason: null, currency: measured.currency, landing };
  } catch (err) {
    logger.debug({ err: err.message, workspaceId }, '[PlanService] goal landing skipped');
    return { status: PLANNING_EVIDENCE.INSUFFICIENT, reason: PLANNING_REASON.INSUFFICIENT_MEASUREMENT_EVIDENCE, currency: null, landing: null };
  }
}

/**
 * Assemble + persist a forward-looking plan.
 * @returns {Promise<object>} the persisted plan, decorated with the assembled projections
 */
export async function buildPlan(workspaceId, { name, periodStart, periodEnd, totalBudgetMinor, totalBudgetCurrency, change, goal, now } = {}) {
  if (!workspaceId) throw new Error('buildPlan: workspaceId required');
  if (typeof totalBudgetMinor !== 'number' || totalBudgetMinor <= 0) {
    throw new Error('buildPlan: totalBudgetMinor must be a positive number');
  }

  // ── Assemble (all reads, delegated to the engines/services) ──
  const [mix, agenda, scenario] = await Promise.all([
    // The plan's OWN period is the one its budget governs — so it is the only
    // period its moves may be sized against (spendPeriod.js).
    previewAllocation(workspaceId, {
      totalBudgetMinor, totalBudgetCurrency, goal: { type: GOAL_TYPE.GROWTH_CEILING },
      period: periodBetween(periodStart, periodEnd), now,
    }),
    getWeeklyAgenda(workspaceId).then((a) => a.slice(0, AGENDA_LIMIT)).catch(() => []),
    change ? runScenario(workspaceId, { change, now }) : Promise.resolve(null),
  ]);

  // Plan and Goal currency columns are required. Refuse before either write if
  // allocation cannot prove the budget's denomination; scenario cannot repair it.
  if (mix?.monetaryStatus !== MONETARY_STATUS.VALID || !mix.currency) {
    throw Object.assign(new Error('Plan monetary eligibility is unavailable'), {
      code: 'PlanMonetaryUnavailable',
      monetaryStatus: mix?.monetaryStatus ?? MONETARY_STATUS.UNAVAILABLE_UNTRUSTED,
      reason: mix?.monetaryReason ?? MONETARY_REASON.SPEND_CURRENCY_UNTRUSTED,
    });
  }

  // Sustainability of the projected CAC (scenario range if present, else the
  // allocation's projected CPA point).
  const cacMinor = scenario?.projections?.blendedCacMinor ?? mix?.projected?.projectedCpaMinor ?? null;
  const econ = cacMinor != null ? await assessSustainability(workspaceId, { cacMinor, currency: mix.currency }) : null;

  // Goal landing (best-effort) before persistence, so the plan stores an
  // initial read alongside its target.
  const goalCurrency = goal?.currency ?? mix.currency;
  const tracking = goal ? await evaluateGoalTracking(workspaceId, { ...goal, currency: goalCurrency, periodStart, periodEnd }, { now }) : null;
  const landing = tracking?.landing ?? null;

  const memoryBasis = scenario?.memoryBasis ?? [];
  const currency = mix.currency;
  const projections = {
    scenario: scenario ? { scenarioType: scenario.scenarioType, projections: scenario.projections, assumptions: scenario.assumptions, confidence: scenario.confidence, basis: scenario.basis } : null,
    economics: econ?.result ? { ltvToCac: econ.result.ltvToCac, sustainabilityBand: econ.result.sustainabilityBand, paybackOrders: econ.result.paybackOrders, ltvMinor: econ.result.ltvMinor, isDefault: econ.isDefault, assumptions: econ.result.assumptions } : null,
    goalLanding: landing,
    goalTracking: tracking ? { contractVersion: 1, status: tracking.status, unavailableReason: tracking.reason, measuredCurrency: tracking.currency } : null,
    // C-18 — the rest of the preview, so promotion can execute the mix that was
    // approved instead of recomputing one. `channelMix` keeps the allocations;
    // this keeps everything else `persistAllocation` needs and cannot derive
    // (goalType and reasoning are NOT NULL columns on AllocationPlan).
    mix: captureMixSnapshot(mix),
  };

  // ── Persist ONE Plan (+ ONE NorthStarGoal) in a single transaction ──
  const plan = await prisma.$transaction(async (tx) => {
    const saved = await tx.plan.create({
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
    });
    if (goal) await tx.northStarGoal.create({
      data: {
        workspaceId, planId: saved.id,
        name: goal.name ?? `${goal.metric} ${goal.comparator} ${goal.targetValue}`,
        metric: goal.metric, comparator: goal.comparator, targetValue: goal.targetValue,
        spendCeilingMinor: goal.spendCeilingMinor ?? null,
        currency: goalCurrency,
        periodStart: new Date(periodStart), periodEnd: new Date(periodEnd),
        status: tracking.status,
        trackingUnavailableReason: tracking.reason,
      },
    });
    return saved;
  });

  logger.info({ workspaceId, planId: plan.id, hasScenario: !!scenario, hasGoal: !!goal, memoryBasis: memoryBasis.length }, '[PlanService] plan built');
  return getPlan(workspaceId, plan.id, { now });
}

/** List plans (lightweight). READ-ONLY. */
export async function listPlans(workspaceId) {
  if (!workspaceId) throw new Error('listPlans: workspaceId required');
  const plans = await prisma.plan.findMany({
    where:   { workspaceId },
    orderBy: { createdAt: 'desc' },
    include: { goals: true },
    take:    50,
  });
  return Promise.all(plans.map(async (plan) => ({
    ...plan,
    goals: await Promise.all((plan.goals ?? []).map(async (goal) => {
      const tracking = await evaluateGoalTracking(workspaceId, goal);
      return { ...goal, status: tracking.status, trackingUnavailableReason: tracking.reason, measuredCurrency: tracking.currency };
    })),
  })));
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
  const tracking = await trackPlan(workspaceId, plan, { now });
  const goals = (rest.goals ?? []).map((goal) => {
    const current = tracking.goals.find((g) => g.goalId === goal.id);
    return { ...goal, status: current?.status ?? PLANNING_EVIDENCE.INSUFFICIENT,
      trackingUnavailableReason: current ? current.unavailableReason : PLANNING_REASON.INSUFFICIENT_MEASUREMENT_EVIDENCE,
      measuredCurrency: current?.currency ?? null };
  });
  return { ...rest, goals, latestApproval, tracking };
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
    const tracking = await evaluateGoalTracking(workspaceId, g, { now });
    goals.push({ goalId: g.id, metric: g.metric, status: tracking.status, unavailableReason: tracking.reason, currency: tracking.currency, landing: tracking.landing });
  }
  return { goals, refreshedAt: new Date().toISOString() };
}

/**
 * Promote the plan's APPROVED channel mix → PROPOSED REALLOCATE Decisions.
 * The ONLY write here that touches execution.
 *
 * 🔒 C-18. Three things changed, and each closes a way this could lie:
 *
 *   1. The mix comes from the stored snapshot. Nothing on this path calls
 *      `previewAllocation`, so what executes is what was approved (Ruling A).
 *   2. Who and when are recorded, and an unresolvable actor REFUSES rather
 *      than writing a null into the column (R-13, as C-05 settled it).
 *   3. Every write shares one transaction, and `promotedAt` — not
 *      `allocationPlanId` — is what says this already happened. A promotion
 *      whose approved mix asks for no moves writes no AllocationPlan, so
 *      guarding on the id would let that plan be promoted twice.
 *
 * @returns {Promise<{ planId, allocationPlanId, decisionsCreated, outcome, promotedAt }>}
 */
export async function promotePlanMix(workspaceId, planId, { promotedById = null, now = new Date() } = {}) {
  if (!workspaceId) throw new Error('promotePlanMix: workspaceId required');
  const plan = await prisma.plan.findFirst({ where: { id: planId, workspaceId } });
  if (!plan) throw new Error('promotePlanMix: plan not found');

  // Approval gate (Phase 6B): an unapproved plan with an open gate cannot become
  // budget moves. Backend is the real arbiter — rejects regardless of caller.
  //
  // FIRST, and deliberately so: a blocked plan must hear "you need approval",
  // never "your snapshot is too old". The second would send a strategist off to
  // rebuild a plan they are not yet permitted to promote.
  if (isPromotionApprovalBlocked(plan)) {
    const err = new Error('Plan requires STRATEGIST approval before execution');
    err.code = 'ApprovalRequired';
    err.approvalState = plan.approvalState ?? null;
    throw err;
  }

  // `allocationPlanId` alongside `promotedAt` is not redundancy: a plan promoted
  // before C-18 has the id and no timestamp. Both mean promoted — one is the
  // record, the other is all that was left behind.
  if (plan.promotedAt || plan.allocationPlanId) {
    return {
      planId: plan.id,
      allocationPlanId: plan.allocationPlanId ?? null,
      decisionsCreated: 0,
      outcome: PROMOTION_OUTCOME.ALREADY_PROMOTED,
      promotedAt: plan.promotedAt ?? null,
    };
  }

  if (!promotedById) {
    throw refusePromotion(
      PROMOTION_REFUSAL.ACTOR_UNRESOLVED,
      'Could not establish who is promoting this plan.',
    );
  }

  const commit = planToAllocationCommit(plan);
  const moves = hasBudgetMoves(commit);

  const result = await prisma.$transaction(async (tx) => {
    // No moves ⇒ no AllocationPlan row. /lumi/feed publishes those as "open,
    // awaiting your confirm"; one containing nothing to confirm is a claim
    // about work that does not exist.
    const persisted = moves
      ? await persistAllocation(tx, workspaceId, commit)
      : { allocationPlanId: null, decisionsCreated: 0 };

    await tx.plan.update({
      where: { id: plan.id },
      data: {
        allocationPlanId: persisted.allocationPlanId,
        status: 'ACTIVE',
        promotedAt: now,
        promotedBy: promotedById,
      },
    });
    return persisted;
  });

  // Three outcomes, not two. "Nothing was asked for" and "nothing could be
  // sized" both stage zero moves; only the first may say the mix matches spend.
  const outcome = moves
    ? PROMOTION_OUTCOME.PROMOTED
    : budgetMovesAreMeasured(commit)
      ? PROMOTION_OUTCOME.PROMOTED_WITH_NO_MOVES
      : PROMOTION_OUTCOME.PROMOTED_MOVES_NOT_MEASURABLE;
  logger.info({ workspaceId, planId: plan.id, ...result, outcome }, '[PlanService] mix promoted');
  return { planId: plan.id, ...result, outcome, promotedAt: now };
}
