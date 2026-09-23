// ============================================================
// NarrativeService — persistence wrapper for the narrative engine
// ============================================================
// Owns DB I/O (the deterministic narrativeEngine never touches it).
//   generateNarrative(): pull the REAL rows in the window (decisions+outcomes,
//     allocation plans, blended truth, concluded holdouts, goals, memory
//     patterns) → composeNarrative → in ONE $transaction persist the
//     StakeholderNarrative + a CollaborationEvent (NARRATIVE_GENERATED).
//   listNarratives / getNarrative: read.
//
// Every figure the engine emits is evidence-bound to one of these rows — so
// the persisted narrative is, by construction, free of hallucinated numbers.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { scopeFor } from '../decisions/decisionClassScope.js';
import { logger } from '../../utils/logger.js';
import { composeNarrative } from './narrativeEngine.js';
import { NARRATIVE_PERIOD, NARRATIVE_AUDIENCE, confidenceLabel } from './narrativeTypes.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { MONETARY_REASON } from '../../lib/operationalMonetary.js';
import { evaluateGoalTracking } from '../planning/PlanService.js';

const PERIOD_DAYS = Object.freeze({ WEEKLY: 7, MONTHLY: 30 });
const TIER_ATTR_CONFIDENCE = Object.freeze({ NONE: 0.3, AGENCY: 0.6, ENTERPRISE: 0.8 });

/**
 * Pure: map a persisted StakeholderNarrative row (or a freshly-composed result)
 * to the ONE wire shape every endpoint returns — the contract the client's
 * StakeholderNarrativeSchema validates. A persisted row stores `body.sections`
 * + `confidenceScore` + `confidenceBasis` (no derived label); compose() carries
 * `sections` + `reportConfidence` directly. This collapses both into the same
 * `{ reportConfidence:{score,label,components}, sections, … }` so list/detail/
 * generate never diverge (the latent shape schism this fixes). Exported for tests.
 */
export function serializeNarrative(row) {
  if (!row) return null;
  const sections = row.sections ?? row.body?.sections ?? [];
  const reportConfidence = row.reportConfidence ?? {
    score: row.confidenceScore ?? 0,
    label: confidenceLabel(row.confidenceScore ?? 0),
    components: Array.isArray(row.confidenceBasis) ? row.confidenceBasis : [],
  };
  return {
    id: row.id,
    period: row.period,
    audience: row.audience,
    periodStart: row.periodStart ?? null,
    periodEnd: row.periodEnd ?? null,
    headline: row.headline,
    reportConfidence,
    sections,
    evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs : [],
  };
}

/**
 * Pure: fold the loaded rows into composeNarrative()'s inputs (incl. the four
 * coverage signals for the report-confidence score). Exported for unit tests
 * without a DB. `now` is injected; nothing here reads the clock.
 */
export function buildNarrativeInputs({
  decisions = [], blended = null, concludedTests = [],
  goals = [], patterns = [], labelsById = new Map(), measurementTier = 'NONE',
} = {}) {
  // What we did — decisions with their realized outcome.
  const decisionInputs = decisions.map((d) => {
    const outcome = (d.outcomes && d.outcomes[0]) || null;
    return {
      id: d.id, verdict: d.verdict, entityId: d.entityId,
      entityLabel: labelsById.get(d.entityId) ?? null,
      outcomeId: outcome?.id ?? null,
      spendDeltaMinor: null,
      revenueDeltaMinor: null,
      currency: null,
      monetaryReason: outcome ? MONETARY_REASON.OUTCOME_MONETARY_BASIS_UNPROVEN : null,
      monetaryStatus: outcome ? 'MONETARY_UNAVAILABLE_UNTRUSTED' : null,
    };
  });

  // Where it went — ALLOCATION decisions whose rootCause names a real plan.
  //
  // C-10 — the CLASS decides whether this is an allocation move; `rootCause`
  // still carries WHICH plan. This module's own regex was the proof the old
  // encoding had outlived itself: a consumer running a parser to learn what
  // kind of row it holds was never given the identity. Reading the plan id out
  // of the subtype payload stays legitimate and is unchanged.
  //
  // The verdict check goes with it. `REALLOCATE` was standing in for "this is
  // an allocation row", which is what the class now says; keeping both would
  // silently drop any future allocation move that carried another verdict.
  // OutcomeSnapshot has no currency or provenance for its human-reported
  // delta. A matching AllocationPlan cannot establish the outcome's unit.
  const allocationDeltas = [];

  // What it changed — blended truth (cite the top channel's real Account id).
  let blendedInput = null;
  if (blended && blended.channels && blended.channels.length > 0) {
    const top = blended.channels.find((c) => c.monetaryStatus === 'MONETARY_VALID') ?? blended.channels[0];
    blendedInput = {
      evidenceRef: top.channelId,
      blendedRoas: blended.portfolio?.blendedRoas ?? null,
      gapPct: blended.portfolio?.gapPct ?? null,
      monetaryStatus: blended.portfolio?.monetaryStatus ?? 'MONETARY_UNAVAILABLE_UNTRUSTED',
    };
  }

  // What we proved — concluded holdouts.
  const incrementality = concludedTests
    .filter((t) => typeof t.liftPct === 'number')
    .map((t) => ({
      testId: t.id, channel: t.channel, liftPct: t.liftPct,
      ciLow: t.ciLow, ciHigh: t.ciHigh,
      ciExcludesZero: typeof t.ciLow === 'number' && typeof t.ciHigh === 'number'
        ? (t.ciLow > 0 || t.ciHigh < 0) : false,
    }));

  // Against the goal.
  const goalInputs = goals.map((g) => ({
    goalId: g.id, name: g.name, status: g.status, targetValue: g.targetValue,
    unit: g.metric, landingEstimate: null, unavailableReason: g.trackingUnavailableReason ?? null,
  }));

  // Coverage signals — each a 0..1 ratio from real rows (drives confidence).
  const established = patterns.filter((p) => p.status === 'ESTABLISHED').length;
  const memoryCoverage = patterns.length > 0 ? established / patterns.length : 0;

  const totalChannels = blended?.channels?.length ?? 0;
  const testedChannels = new Set(incrementality.map((t) => t.channel)).size;
  const incrementalityCoverage = totalChannels > 0 ? Math.min(1, testedChannels / totalChannels) : 0;

  const reconciled = blended?.portfolio?.reconciledCount ?? 0;
  const unverified = blended?.portfolio?.unverifiedCount ?? 0;
  const blendedConfidence = (reconciled + unverified) > 0 ? reconciled / (reconciled + unverified) : 0;

  const attributionConfidence = (TIER_ATTR_CONFIDENCE[measurementTier] ?? 0.3) * (incrementality.length > 0 ? 1 : 0.6);

  return {
    decisions: decisionInputs,
    allocationDeltas,
    blended: blendedInput,
    incrementality,
    goals: goalInputs,
    coverage: { memoryCoverage, incrementalityCoverage, blendedConfidence, attributionConfidence },
  };
}

/** Build an id→name label map for the entities a narrative might mention. */
async function loadLabels(workspaceId) {
  const [accounts, campaigns, adSets] = await Promise.all([
    prisma.account.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.campaign.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.adSet.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
  ]);
  const map = new Map();
  for (const row of [...accounts, ...campaigns, ...adSets]) map.set(row.id, row.name);
  return map;
}

/**
 * Generate and persist a stakeholder narrative for a period+audience.
 * @returns {Promise<object>} the persisted StakeholderNarrative
 */
export async function generateNarrative(workspaceId, { period = NARRATIVE_PERIOD.WEEKLY, audience = NARRATIVE_AUDIENCE.LEADERSHIP, actorId = null, now = new Date() } = {}) {
  if (!workspaceId) throw new Error('generateNarrative: workspaceId required');
  const days = PERIOD_DAYS[period] ?? 7;
  const periodStart = new Date(now.getTime() - days * 86_400_000);
  const periodEnd = now;

  const [workspace, decisions, blended, concludedTests, goals, patterns, labelsById] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { measurementTier: true } }),
    // `select` rather than `include`: an include is SELECT * plus the relation,
    // and this read runs in the NARRATIVE WORKER — the one service whose Render
    // build does `prisma generate` without `migrate deploy` (render.yaml). A
    // worker booting on a client that knows a column the database has not got
    // yet is precisely how #209 took getLoopState down. buildNarrativeInputs
    // reads exactly these four fields plus the newest outcome.
    prisma.decision.findMany({
      // C-10 — ALL classes, declared. The leadership report narrates the whole
      // account, and it needs ALLOCATION in particular for the section below.
      where:  { workspaceId, ...scopeFor('narrative/report'), createdAt: { gte: periodStart } },
      select: {
        // C-10 — the class rides along because the allocation section now
        // branches on it. An unselected column is `undefined`, which would make
        // every row fail the check and empty the section silently.
        id: true, verdict: true, entityId: true, rootCause: true, decisionClass: true,
        // R6 left this query alone, deliberately. `newest` and `current` are the
        // same row for every chain the writer produces — a supersession always
        // creates the new outcome last — and this read runs in the worker
        // described above, the one that generates a client without running
        // migrate deploy. Naming `supersededAt` here would make a narrative
        // build depend on a column its own deploy may not have yet, to change a
        // result it cannot change. The correctness readers filter explicitly;
        // this one takes the newest row and cites the row it actually used.
        outcomes: {
          orderBy: { createdAt: 'desc' }, take: 1,
          select: { id: true, spendDeltaMinor: true, revenueDeltaMinor: true },
        },
      },
      orderBy: { createdAt: 'desc' }, take: 100,
    }),
    getBlendedTruth(workspaceId).catch(() => null),
    prisma.incrementalityTest.findMany({ where: { workspaceId, status: 'CONCLUDED' } }),
    // Explicit old columns keep the narrative worker read compatible while the
    // additive Goal migration is rolling out; current status is recomputed below.
    prisma.northStarGoal.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 10,
      select: { id: true, name: true, metric: true, comparator: true, targetValue: true,
        spendCeilingMinor: true, currency: true, periodStart: true, periodEnd: true } }),
    prisma.accountPattern.findMany({ where: { workspaceId }, select: { status: true } }),
    loadLabels(workspaceId),
  ]);

  const currentGoals = await Promise.all(goals.map(async (g) => {
    const tracking = await evaluateGoalTracking(workspaceId, g, { now });
    return { ...g, status: tracking.status, trackingUnavailableReason: tracking.reason };
  }));
  const inputs = buildNarrativeInputs({
    decisions,
    blended, concludedTests, goals: currentGoals, patterns, labelsById,
    measurementTier: workspace?.measurementTier ?? 'NONE',
  });

  const narrative = composeNarrative({ period, audience, periodStart, periodEnd, ...inputs, now });

  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.stakeholderNarrative.create({
      data: {
        workspaceId, period, audience, periodStart, periodEnd,
        headline: narrative.headline,
        body: { sections: narrative.sections },
        evidenceRefs: narrative.evidenceRefs,
        confidenceScore: narrative.reportConfidence.score,
        confidenceBasis: narrative.reportConfidence.components,
      },
    });
    await tx.collaborationEvent.create({
      data: {
        workspaceId, actorId, type: 'NARRATIVE_GENERATED',
        subjectType: 'NARRATIVE', subjectId: row.id,
        detail: { period, audience, confidence: narrative.reportConfidence.score },
      },
    });
    return row;
  });

  logger.info({ workspaceId, period, audience, confidence: narrative.reportConfidence.score, refs: narrative.evidenceRefs.length }, '[NarrativeService] narrative generated');
  return serializeNarrative({ ...saved, reportConfidence: narrative.reportConfidence, sections: narrative.sections });
}

export async function listNarratives(workspaceId, { audience } = {}) {
  if (!workspaceId) throw new Error('listNarratives: workspaceId required');
  const rows = await prisma.stakeholderNarrative.findMany({
    where: { workspaceId, ...(audience ? { audience } : {}) },
    orderBy: { createdAt: 'desc' }, take: 50,
  });
  return rows.map(serializeNarrative);
}

export async function getNarrative(workspaceId, narrativeId) {
  if (!workspaceId) throw new Error('getNarrative: workspaceId required');
  return serializeNarrative(await prisma.stakeholderNarrative.findFirst({ where: { id: narrativeId, workspaceId } }));
}
