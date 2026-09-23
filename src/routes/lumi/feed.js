// ============================================================
// MARCOM / Lumi — Campaign feed + demo feed
// GET  /api/lumi/feed        (JWT)
// GET  /api/lumi/demo-feed   (PUBLIC)
// Extracted from lumi.js for architecture size compliance.
// ============================================================
import { Router }  from 'express';
import { prisma }  from '../../lib/prisma.js';
import { scopeFor } from '../../services/decisions/decisionClassScope.js';
import { logger }  from '../../utils/logger.js';
import { getPortfolio } from '../../services/portfolio/PortfolioService.js';
import { getWeeklyAgenda } from '../../services/test-generator/TestGeneratorService.js';
import { evaluateGoalTracking } from '../../services/planning/PlanService.js';
import { surfaceCollaboration } from './feedSurfacing.js';

// The static public demo feed lives in its own module (route-file size).
export { demoFeedHandler } from './demoFeed.js';

export const feedRouter = Router();


// ─────────────────────────────────────────────────────────────
// GET /api/lumi/feed         (JWT-protected)
// ─────────────────────────────────────────────────────────────
feedRouter.get('/feed', async (req, res) => {
  // Resolve workspaceId. firebaseAuthMiddleware normally sets req.workspaceId,
  // but a transient DB lookup miss can leave it null even for a fully
  // authenticated user. Fall back to a direct lookup keyed on the Firebase uid
  // (stored in the clerkId column) rather than fabricating a synthetic id.
  //
  // CRITICAL: never fall back to `clerk:${uid}`. All workspaceId columns are
  // @db.Uuid — a non-UUID string makes Prisma throw on the cast, which is the
  // 500 this endpoint returned on every page load.
  let wsId = req.workspaceId;
  if (!wsId && req.userId) {
    try {
      const u = await prisma.user.findUnique({
        where:  { clerkId: req.userId },
        select: { workspaceId: true },
      });
      wsId = u?.workspaceId ?? null;
    } catch (fallbackErr) {
      logger.error({ err: fallbackErr.message, userId: req.userId }, '[lumi/feed] workspaceId fallback lookup failed');
    }
  }

  // No workspace → graceful empty feed (correct shape, never a 500/401 here).
  // The user is authenticated; they just have no resolvable workspace yet.
  if (!wsId) {
    // S1-B — no `campaigns: []` here either. It said "this account has none",
    // and the field no longer exists at all: see the note at the reads below.
    return res.json({
      workspaceId: null,
      generatedAt: new Date().toISOString(),
    });
  }

  try {
    logger.debug({ workspaceId: wsId }, '[lumi/feed] fetching data');

    // S1-B — the `campaigns` array is gone, and with it the two reads that fed
    // it. CampaignState has had no writer since R7 deleted temporalObserver, and
    // no Action row has been CREATED anywhere in this codebase since B3-C: the
    // one remaining `prisma.action` write is an `update` on a row nothing mints.
    // So this endpoint published `campaigns: []` on every poll for every
    // workspace — not "this account has no campaigns", but "the two tables this
    // was built from can no longer be written". The client could not tell those
    // apart, and rendered the first.
    //
    // Removed rather than repointed. The live campaign surface is the connector
    // entity graph (GET /lumi/entities/campaigns), which answers a different
    // question from a population that exists; making this field read from there
    // would be inventing a replacement for a retired capability under cover of a
    // cleanup. Everything else in this response reads a table with a live writer
    // and is untouched.
    const [fatiguePredictions, guardrailVerdicts, allocationPlans] = await Promise.all([
      // Phase 2: forward-looking fatigue forecasts (unresolved).
      prisma.fatiguePrediction.findMany({
        where:   { workspaceId: wsId, resolvedAt: null },
        orderBy: { projectedBreachDate: 'asc' },
        take:    100,
      }).catch(() => []),
      // Phase 2: guardrail radar verdicts. `select` = exactly what the map below reads.
      prisma.decision.findMany({
        // C-10 — the class, not a prefix match on a mutable display string.
        where:   { workspaceId: wsId, status: 'PROPOSED', ...scopeFor('feed/guardrail-verdicts') },
        orderBy: { createdAt: 'desc' }, take: 100,
        select: { entityId: true, entityLevel: true, verdict: true, diagnosis: true, rootCause: true, status: true },
      }).catch(() => []),
      // Phase 3: open (proposed) capital-allocation plans awaiting human confirm.
      prisma.allocationPlan.findMany({
        where:   { workspaceId: wsId, status: 'PROPOSED' },
        orderBy: { createdAt: 'desc' },
        take:    20,
      }).catch(() => []),
    ]);

    // Phase 3: pacing alerts (best-effort; never blocks the feed).
    let pacingAlerts = [];
    try {
      const portfolio = await getPortfolio(wsId);
      if (portfolio?.pacing && portfolio.pacing.status === 'OVER') {
        pacingAlerts.push({
          scope: 'portfolio',
          status: portfolio.pacing.status,
          daysEarly: portfolio.pacing.daysEarly,
          projectedSpendMinor: portfolio.pacing.projectedSpendMinor,
          monthlyBudgetMinor: portfolio.monthlyBudgetMinor,
        });
      }
      for (const ch of portfolio?.channels ?? []) {
        if (ch.pacing && ch.pacing.status === 'OVER') {
          pacingAlerts.push({ scope: 'channel', channelId: ch.channelId, channel: ch.channel, status: ch.pacing.status, daysEarly: ch.pacing.daysEarly });
        }
      }
    } catch (pacingErr) {
      logger.debug({ err: pacingErr.message, wsId }, '[lumi/feed] pacing best-effort skipped');
    }

    // Phase 4: weekly testing agenda + open (running) experiments
    // (best-effort; never blocks the feed).
    let testingAgenda = [];
    let openTests = [];
    try {
      [testingAgenda, openTests] = await Promise.all([
        getWeeklyAgenda(wsId).then((a) => a.slice(0, 5)),
        prisma.testExperiment.findMany({
          where:   { workspaceId: wsId, status: 'RUNNING' },
          orderBy: { startedAt: 'desc' },
          take:    20,
          include: { variants: true },
        }),
      ]);
    } catch (testErr) {
      logger.debug({ err: testErr.message, wsId }, '[lumi/feed] testing best-effort skipped');
    }

    // Phase 5: account learnings — top patterns + promotable count.
    // Reads persisted AccountPattern rows (cheap); the full extraction
    // runs on the dedicated /briefing route, not on every feed poll.
    let accountBriefing = { patterns: [], promotableCount: 0, conflictCount: 0 };
    try {
      const learned = await prisma.accountPattern.findMany({
        where:   { workspaceId: wsId, status: { in: ['ESTABLISHED', 'EMERGING', 'CONFLICTED'] } },
        // R10 — `nulls: 'last'`, and it is load-bearing. Confidence is now null
        // for a pattern with no measured outcome (I54), and PostgreSQL sorts
        // NULLS FIRST on DESC by default — so the plain `desc` this used to
        // carry would have promoted every UNMEASURED pattern to the top of the
        // briefing, ranking the account's least-proven learnings above its
        // best-proven ones.
        orderBy: [{ status: 'asc' }, { confidence: { sort: 'desc', nulls: 'last' } }],
        take:    50,
      });
      accountBriefing = {
        patterns: learned
          .filter((p) => p.status !== 'CONFLICTED')
          .slice(0, 5)
          .map((p) => ({ id: p.id, kind: p.kind, statement: p.statement, status: p.status, accuracy: p.accuracy, confidence: p.confidence })),
        promotableCount: learned.filter((p) =>
          p.status === 'ESTABLISHED' && p.emitVerdict && p.threshold != null &&
          p.accuracy != null && p.accuracy >= 0.6 && !p.promotedRuleId).length,
        conflictCount: learned.filter((p) => p.status === 'CONFLICTED').length,
      };
    } catch (briefErr) {
      logger.debug({ err: briefErr.message, wsId }, '[lumi/feed] briefing best-effort skipped');
    }

    // Phase 6: active plan's goal landing + sustainability (best-effort).
    // Reads persisted rows only — the full assembly runs on /plans, not here.
    let planning = { activePlan: null, goal: null };
    try {
      const plan = await prisma.plan.findFirst({
        where:   { workspaceId: wsId, status: { in: ['ACTIVE', 'DRAFT'] } },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: { goals: true },
      });
      if (plan) {
        const g = plan.goals?.[0] ?? null;
        const goalTracking = g ? await evaluateGoalTracking(wsId, g) : null;
        planning = {
          activePlan: {
            id: plan.id, name: plan.name, status: plan.status,
            totalBudgetMinor: plan.totalBudgetMinor, currency: plan.currency,
            sustainabilityBand: plan.projections?.economics?.sustainabilityBand ?? null,
            memoryBasisCount: Array.isArray(plan.memoryBasis) ? plan.memoryBasis.length : 0,
          },
          goal: g ? {
            id: g.id, metric: g.metric, comparator: g.comparator,
            targetValue: g.targetValue, status: goalTracking.status,
            unavailableReason: goalTracking.reason,
            currency: goalTracking.currency,
            landing: goalTracking.landing?.trendBasedLandingEstimate ?? null,
          } : null,
        };
      }
    } catch (planErr) {
      logger.debug({ err: planErr.message, wsId }, '[lumi/feed] planning best-effort skipped');
    }

    // Phase 7: measurement surfacing — ONLY when the workspace is tier-gated
    // ON (Agency/Enterprise). Top platform-vs-blended gap + any concluded
    // holdout. Best-effort; never blocks the feed.
    let measurement = null;
    try {
      const ws = await prisma.workspace.findUnique({ where: { id: wsId }, select: { measurementTier: true } });
      if (ws && ws.measurementTier && ws.measurementTier !== 'NONE') {
        const lastHoldout = await prisma.incrementalityTest.findFirst({
          where:   { workspaceId: wsId, status: 'CONCLUDED' },
          orderBy: { concludedAt: 'desc' },
          select:  { channel: true, liftPct: true, ciLow: true, ciHigh: true, confidenceLabel: true },
        });
        measurement = {
          tier: ws.measurementTier,
          lastHoldout: lastHoldout
            ? { channel: lastHoldout.channel, liftPct: lastHoldout.liftPct, ci: [lastHoldout.ciLow, lastHoldout.ciHigh], confidence: lastHoldout.confidenceLabel }
            : null,
        };
      }
    } catch (measErr) {
      logger.debug({ err: measErr.message, wsId }, '[lumi/feed] measurement best-effort skipped');
    }

    // Phase 8: collaboration surfacing — role-scoped narrative + approvals
    // (extracted to feedSurfacing.js; best-effort, never blocks the feed).
    const collaboration = await surfaceCollaboration(wsId, req.collabRole);


    return res.json({
      workspaceId: wsId,
      generatedAt: new Date().toISOString(),
      // Phase 2 — predictive + guardrail surfacing
      fatiguePredictions: fatiguePredictions.map(fp => ({
        entityId:            fp.entityId,
        entityLevel:         fp.entityLevel,
        metric:              fp.metric,
        ceiling:             fp.ceiling,
        projectedBreachDate: fp.projectedBreachDate,
        confidence:          fp.confidence,
        basis:               fp.basis,
      })),
      guardrailVerdicts: guardrailVerdicts.map(d => ({
        entityId:    d.entityId,
        entityLevel: d.entityLevel,
        verdict:     d.verdict,
        rationale:   d.diagnosis,
        rule:        d.rootCause?.replace(/^guardrail:/, '') ?? null,
        status:      d.status, // PROPOSED → awaits human confirm
      })),
      // Phase 3 — capital-allocation surfacing
      pacingAlerts,
      allocationPlans: allocationPlans.map(p => ({
        id:                p.id,
        goalType:          p.goalType,
        totalBudgetMinor:  p.totalBudgetMinor,
        currency:          p.currency,
        merBefore:         p.merBefore,
        merAfter:          p.merAfter,
        projectedCpaMinor: p.projectedCpaMinor,
        status:            p.status, // PROPOSED → awaits human confirm
      })),
      // Phase 4 — Testing OS surfacing
      testingAgenda: testingAgenda.map((s) => ({
        entityId:       s.entityId,
        entityLevel:    s.entityLevel,
        name:           s.name,
        dimension:      s.dimension,
        metric:         s.metric,
        hypothesis:     s.hypothesis,
        expectedSignal: s.expectedSignal,
        priority:       s.priority,
      })),
      openTests: openTests.map((t) => ({
        id:          t.id,
        dimension:   t.dimension,
        metric:      t.metric,
        status:      t.status,
        hypothesis:  t.hypothesis,
        startedAt:   t.startedAt,
        variants:    t.variants.map((v) => ({ label: v.label, isControl: v.isControl, isWinner: v.isWinner })),
      })),
      // Phase 5 — account memory surfacing
      accountBriefing,
      // Phase 6 — planning surfacing (active plan goal landing + sustainability)
      planning,
      // Phase 7 — measurement surfacing (gated; null unless tier ≠ NONE)
      measurement,
      // Phase 8 — collaboration surfacing (role-scoped narrative + approvals)
      collaboration,
    });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/feed] failed');
    return res.status(500).json({ error: 'FeedUnavailable', message: 'Request failed' });
  }
});

