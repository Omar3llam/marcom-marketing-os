// ============================================================
// MARCOM / Lumi — Campaign feed + demo feed
// GET  /api/lumi/feed        (JWT)
// GET  /api/lumi/demo-feed   (PUBLIC)
// Extracted from lumi.js for architecture size compliance.
// ============================================================
import { Router }  from 'express';
import { prisma }  from '../../lib/prisma.js';
import { logger }  from '../../utils/logger.js';
import { getPortfolio } from '../../services/portfolio/PortfolioService.js';
import { getWeeklyAgenda } from '../../services/test-generator/TestGeneratorService.js';
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
    return res.json({
      workspaceId: null,
      generatedAt: new Date().toISOString(),
      campaigns:   [],
    });
  }

  try {
    logger.debug({ workspaceId: wsId }, '[lumi/feed] fetching data');

    const [campaignStates, pendingActions, fatiguePredictions, guardrailVerdicts, allocationPlans] = await Promise.all([
      prisma.campaignState.findMany({
        where:   { workspaceId: wsId },
        orderBy: { lastAnalysis: 'desc' },
      }),
      prisma.action.findMany({
        where:   { workspaceId: wsId, status: { in: ['PENDING', 'QUEUED'] } },
        orderBy: { createdAt: 'desc' },
        take:    200,
      }),
      // Phase 2: forward-looking fatigue forecasts (unresolved).
      prisma.fatiguePrediction.findMany({
        where:   { workspaceId: wsId, resolvedAt: null },
        orderBy: { projectedBreachDate: 'asc' },
        take:    100,
      }).catch(() => []),
      // Phase 2: guardrail radar verdicts. `select` = exactly what the map below reads.
      prisma.decision.findMany({
        where:   { workspaceId: wsId, status: 'PROPOSED', rootCause: { startsWith: 'guardrail:' } },
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
        orderBy: [{ status: 'asc' }, { confidence: 'desc' }],
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
        planning = {
          activePlan: {
            id: plan.id, name: plan.name, status: plan.status,
            totalBudgetMinor: plan.totalBudgetMinor, currency: plan.currency,
            sustainabilityBand: plan.projections?.economics?.sustainabilityBand ?? null,
            memoryBasisCount: Array.isArray(plan.memoryBasis) ? plan.memoryBasis.length : 0,
          },
          goal: g ? {
            id: g.id, metric: g.metric, comparator: g.comparator,
            targetValue: g.targetValue, status: g.status,
            landing: plan.projections?.goalLanding?.trendBasedLandingEstimate ?? null,
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

    logger.debug({
      campaignStatesFound: campaignStates.length,
      pendingActionsFound: pendingActions.length,
    }, '[lumi/feed] db query results');

    // Build the same campaign-grouped / alert-flattened shape as
    // /demo-feed so the client adapter works without changes.
    const byCampaign = new Map();
    const ensure = (state) => {
      if (!byCampaign.has(state.campaignId)) {
        byCampaign.set(state.campaignId, {
          campaign_id:  state.campaignName || state.campaignId,
          stage:        state.stage,
          // Real persisted health (computeHealthScore, 0.00–1.00); client scales ×100. Never inferred.
          health_score: Number.isFinite(state.healthScore) ? state.healthScore : null,
          alerts:       [],
        });
      }
      return byCampaign.get(state.campaignId);
    };
    for (const cs of campaignStates) {
      ensure({ ...cs, campaignName: cs.campaignName || pendingActions.find(a => a.campaignId === cs.campaignId)?.payload?.campaignName || cs.campaignId });
    }

    for (const a of pendingActions) {
      const stateRow = campaignStates.find(s => s.campaignId === a.campaignId);
      if (!stateRow) continue;
      const slot = ensure({ ...stateRow, campaignName: stateRow.campaignName || a.payload?.campaignName || stateRow.campaignId });
      const p    = a.payload || {};
      const m    = p.metrics || {};

      slot.alerts.push({
        action_id:        a.id,
        idempotency_key:  a.idempotencyKey,
        priority:         p.priority || 'LOW',
        analysis: {
          verdict:    p.verdict   || p.strategicAnalysis?.verdict   || 'HOLD',
          root_cause: p.rootCause || p.strategicAnalysis?.rootCause || 'UNKNOWN',
        },
        historical_insight:
          p.strategicAnalysis?.diagnosis ||
          p.rationale ||
          null,
        action_plan: {
          action:           p.strategicAnalysis?.actionPlan?.action || p.rationale || '(awaiting orchestration)',
          status:           a.status,
          imageUrl:         null,
          reference_prompt: p.creativeAssets?.variants?.[0]?.visual_direction || null,
        },
        // Synthesize the structured signal rows the UI expects from
        // the raw metric block stored at upload time.
        metrics: signalsFromMetrics(m, slot.stage),
        // R7 (F7) — a `memory: [...]` array was built here from DecisionMemory
        // rows. The QUERY was valid, so nothing ever threw; the FIELD ACCESS was
        // not. It filtered on `mem.campaignId`, and DecisionMemory has no
        // campaignId column — so the predicate compared undefined to a real id,
        // matched nothing, and every campaign in every feed carried an empty
        // memory array. Dead in effect, not merely unused. Removed rather than
        // repointed: nothing downstream reads it, and manufacturing a canonical
        // replacement for a field no surface consumes would be inventing a
        // feature under cover of a migration.
        creative_assets: p.creativeAssets || null,
        // Phase 2: multi-level drill-down + forward-looking forecast +
        // provenance (reactive analysis vs a user guardrail rule).
        source:          p.source === 'guardrail' ? 'guardrail' : 'reactive',
        platform:        p.platform || null,   // real channel from payload; drives client filter (null = absent)
        levelVerdicts:   p.levelVerdicts || p.strategicAnalysis?.levelVerdicts || [],
        fatigueForecast: p.fatigueForecast || p.strategicAnalysis?.fatigueForecast || null,
      });
    }

    const stageRank = { DYING: 0, FATIGUED: 1, TESTING: 2, SCALING: 3, STABLE: 4 };
    const campaigns = [...byCampaign.values()]
      .filter(c => c.alerts.length > 0)
      .sort((a, b) => (stageRank[a.stage] ?? 99) - (stageRank[b.stage] ?? 99));

    const stageBreakdown = campaigns.reduce((acc, c) => {
      acc[c.stage] = (acc[c.stage] || 0) + 1;
      return acc;
    }, {});

    logger.debug({
      campaignsFound: campaigns.length,
      stageBreakdown,
    }, '[lumi/feed] feed calculated');

    return res.json({
      workspaceId: wsId,
      generatedAt: new Date().toISOString(),
      campaigns,
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

// Structured-signal rows for DecisionTheater. CRITICAL: useCampaignFeed.summarize()
// reads these for dashboard stats — a missing metric here = $0 in the dashboard.
function signalsFromMetrics(m = {}, _stage = 'TESTING') {
  const rows = [];
  const fmtPct  = (v) => `${(Number(v) || 0).toFixed(2)}%`;
  const fmtRoas = (v) => `${(Number(v) || 0).toFixed(2)}x`;
  const fmtFreq = (v) => `${(Number(v) || 0).toFixed(2)}`;
  const fmtUsd  = (v) => `$${(Number(v) || 0).toFixed(2)}`;
  const fmtNum  = (v) => Number(v || 0).toLocaleString('en-US');
  // Typed numeric beside the formatted string (null = absent, distinct from 0 → client renders "—").
  const num     = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

  const ctrStatus  = m.ctr  >= 2 ? 'positive' : m.ctr  >= 1 ? 'warning' : 'danger';
  const roasStatus = m.roas >= 3 ? 'positive' : m.roas >= 1 ? 'warning' : 'danger';
  const freqStatus = m.frequency <= 2 ? 'positive' : m.frequency <= 3 ? 'warning' : 'danger';
  const cprStatus  = m.costPerResult > 0 && m.costPerResult <= 20 ? 'positive'
                   : m.costPerResult <= 50 ? 'warning' : 'danger';

  rows.push({ metric: 'CTR',       trend: ctrStatus  === 'danger' ? 'down' : 'up',   value: fmtPct(m.ctr),       raw: num(m.ctr),           delta: '',  context: 'Per CSV upload', status: ctrStatus  });
  rows.push({ metric: 'ROAS',      trend: roasStatus === 'danger' ? 'down' : 'up',   value: fmtRoas(m.roas),     raw: num(m.roas),          delta: '',  context: 'Per CSV upload', status: roasStatus });
  rows.push({ metric: 'Frequency', trend: freqStatus === 'danger' ? 'up'   : 'flat', value: fmtFreq(m.frequency), raw: num(m.frequency),    delta: '',  context: 'Per CSV upload', status: freqStatus });
  rows.push({ metric: 'CPA',       trend: cprStatus  === 'danger' ? 'up'   : 'flat', value: fmtUsd(m.costPerResult), raw: num(m.costPerResult), delta: '', context: 'Cost per result', status: cprStatus  });

  // Essential totals the dashboard summary reads (omitting any → $0 in dashboard).
  rows.push({ metric: 'Spend',       trend: 'neutral', value: fmtUsd(m.spend),       raw: num(m.spend),       delta: '', context: 'Total', status: 'neutral' });
  rows.push({ metric: 'Impressions', trend: 'neutral', value: fmtNum(m.impressions), raw: num(m.impressions), delta: '', context: 'Total', status: 'neutral' });
  rows.push({ metric: 'Results',     trend: 'neutral', value: fmtNum(m.results),     raw: num(m.results),     delta: '', context: 'Total', status: 'neutral' });
  rows.push({ metric: 'Reach',       trend: 'neutral', value: fmtNum(m.reach),       raw: num(m.reach),       delta: '', context: 'Unique', status: 'neutral' });

  return rows;
}
