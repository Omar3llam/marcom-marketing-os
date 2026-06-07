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

export const feedRouter = Router();

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/demo-feed     (PUBLIC — stakeholder demo)
// ─────────────────────────────────────────────────────────────
// Returns a static demo feed for stakeholders to preview the UI
// without needing real ad account data or authentication.
// ─────────────────────────────────────────────────────────────
export function demoFeedHandler(_req, res) {
  res.json({
    workspaceId: 'demo-workspace',
    generatedAt: new Date().toISOString(),
    campaigns: [
      // ── DYING / HIGH priority ─────────────────────────────
      {
        campaign_id: 'Summer Promo — Broad Lookalike',
        stage:       'DYING',
        alerts: [
          {
            action_id:        'demo-act-001',
            idempotency_key:  'demo-key-001',
            priority:         'HIGH',
            analysis: {
              verdict:    'PAUSE_AND_RELAUNCH',
              root_cause: 'Creative fatigue compounded by audience saturation; CPA has tripled in 7 days while ROAS collapsed below break-even.',
            },
            historical_insight:
              'The last two budget-scale actions on this campaign regressed within 24h. Audience tightening also under-performed.',
            action_plan: {
              action:           'Pause the Broad Lookalike ad set immediately and re-launch with a fresh UGC creative against a 1-3% lookalike seeded from the last 30-day purchaser list.',
              status:           'PENDING',
              imageUrl:         null,
              reference_prompt: 'Reference visual: 9:16 UGC-style hand-held shot, natural lighting, model holding product mid-frame, captions burned-in.',
            },
            metrics: [
              { metric: 'CTR',       trend: 'down', value: '0.42%',  delta: '-58% vs last week',         context: 'Last 48h',                  status: 'danger'  },
              { metric: 'ROAS',      trend: 'down', value: '0.71x',  delta: '-1.4x vs target',           context: '7-day avg',                 status: 'danger'  },
              { metric: 'Frequency', trend: 'up',   value: '8.6',    delta: '+4.1 vs healthy ceiling',   context: 'Lifetime, active audience', status: 'danger'  },
              { metric: 'CPA',       trend: 'up',   value: '$84.20', delta: '+312% vs week 1',           context: 'Last 7 days',               status: 'warning' },
            ],
            memory: [
              { actionType: 'meta.scale_budget',     decisionRationale: 'Doubled daily budget after 3 days of >3x ROAS',  isSustainable: false, impactDurationHrs: 24 },
              { actionType: 'meta.swap_creative',    decisionRationale: 'Replaced static carousel with UGC reel',          isSustainable: true,  impactDurationHrs: 24 },
              { actionType: 'meta.tighten_audience', decisionRationale: 'Narrowed lookalike from 5% to 1%',                isSustainable: false, impactDurationHrs: 24 },
            ],
          },
        ],
      },

      // ── FATIGUED / MEDIUM priority ────────────────────────
      {
        campaign_id: 'Brand Awareness — IG Reels Q2',
        stage:       'FATIGUED',
        alerts: [
          {
            action_id:        'demo-act-002',
            idempotency_key:  'demo-key-002',
            priority:         'MEDIUM',
            analysis: {
              verdict:    'REFRESH_CREATIVE',
              root_cause: 'Audience overlap with the hero campaign is suppressing reach; engagement is decaying slowly but recoverable with a creative refresh.',
            },
            historical_insight:
              'Creative refreshes on similar reels lifted CTR by ~18% on average over the last 60 days.',
            action_plan: {
              action:           'Refresh the top-3 fatigued reels with a new hook frame and shift 30% of the budget into a fresh interest-based audience to break the overlap.',
              status:           'PENDING',
              imageUrl:         null,
              reference_prompt: 'Reference visual: bold first-frame text overlay ("Wait — watch this"), product in motion, branded colour wash on transition.',
            },
            metrics: [
              { metric: 'CTR',             trend: 'down', value: '1.18%', delta: '-22% vs last week', context: 'Last 7 days',           status: 'warning' },
              { metric: 'ROAS',            trend: 'down', value: '1.82x', delta: '-0.18x vs target',  context: '7-day avg',             status: 'warning' },
              { metric: 'Engagement Rate', trend: 'flat', value: '3.4%',  delta: '~0% vs last week',  context: 'Reels, last 14 days',   status: 'neutral' },
              { metric: 'Impressions',     trend: 'down', value: '142k',  delta: '-31% vs last week', context: 'Last 7 days',           status: 'warning' },
            ],
            memory: [
              { actionType: 'meta.refresh_creative', decisionRationale: 'Swapped first-frame hook on top reel',          isSustainable: true,  impactDurationHrs: 48 },
              { actionType: 'meta.shift_budget',    decisionRationale: 'Moved 20% spend into interest stack',            isSustainable: null,  impactDurationHrs: null },
            ],
          },
        ],
      },

      // ── STABLE / LOW priority ─────────────────────────────
      {
        campaign_id: 'Brand Search — Always-On',
        stage:       'STABLE',
        alerts: [
          {
            action_id:        'demo-act-003',
            idempotency_key:  'demo-key-003',
            priority:         'LOW',
            analysis: {
              verdict:    'HOUSEKEEPING',
              root_cause: 'Performing within tolerance. Optional housekeeping only.',
            },
            historical_insight: 'No regressions on this campaign in the last 30 days.',
            action_plan: {
              action:           'Add three negative keywords flagged by last week\'s search-term report; no creative or bid change required.',
              status:           'PENDING',
              imageUrl:         null,
              reference_prompt: null,
            },
            metrics: [
              { metric: 'CTR',  trend: 'up',   value: '12.4%', delta: '+0.8% vs last week', context: 'Last 7 days', status: 'positive' },
              { metric: 'ROAS', trend: 'flat', value: '4.6x',  delta: '+0.1x vs target',    context: '7-day avg',   status: 'positive' },
            ],
            memory: [],
          },
        ],
      },
    ],
  });
}

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

    const [campaignStates, pendingActions, recentMemory, fatiguePredictions, guardrailVerdicts, allocationPlans] = await Promise.all([
      prisma.campaignState.findMany({
        where:   { workspaceId: wsId },
        orderBy: { lastAnalysis: 'desc' },
      }),
      prisma.action.findMany({
        where:   { workspaceId: wsId, status: { in: ['PENDING', 'QUEUED'] } },
        orderBy: { createdAt: 'desc' },
        take:    200,
      }),
      prisma.decisionMemory.findMany({
        where:   { workspaceId: wsId },
        orderBy: { createdAt: 'desc' },
        take:    200,
      }),
      // Phase 2: forward-looking fatigue forecasts (unresolved).
      prisma.fatiguePrediction.findMany({
        where:   { workspaceId: wsId, resolvedAt: null },
        orderBy: { projectedBreachDate: 'asc' },
        take:    100,
      }).catch(() => []),
      // Phase 2: guardrail-sourced radar verdicts awaiting human confirm.
      prisma.decision.findMany({
        where:   { workspaceId: wsId, status: 'PROPOSED', rootCause: { startsWith: 'guardrail:' } },
        orderBy: { createdAt: 'desc' },
        take:    100,
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

    logger.debug({
      campaignStatesFound: campaignStates.length,
      pendingActionsFound: pendingActions.length,
      recentMemoryFound:   recentMemory.length,
    }, '[lumi/feed] db query results');

    // Build the same campaign-grouped / alert-flattened shape as
    // /demo-feed so the client adapter works without changes.
    const byCampaign = new Map();
    const ensure = (state) => {
      if (!byCampaign.has(state.campaignId)) {
        byCampaign.set(state.campaignId, {
          campaign_id: state.campaignName || state.campaignId,
          stage:       state.stage,
          alerts:      [],
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
        memory:  recentMemory
          .filter(mem => mem.campaignId === a.campaignId)
          .slice(0, 3)
          .map(mem => ({
            actionType:        mem.actionType,
            decisionRationale: mem.decisionRationale,
            isSustainable:     mem.isSustainable,
            impactDurationHrs: mem.impactDurationHrs,
          })),
        creative_assets: p.creativeAssets || null,
        // Phase 2: multi-level drill-down + forward-looking forecast +
        // provenance (reactive analysis vs a user guardrail rule).
        source:          p.source === 'guardrail' ? 'guardrail' : 'reactive',
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
    });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/feed] failed');
    return res.status(500).json({ error: 'FeedUnavailable', message: err.message });
  }
});

// Build the structured-signal rows the DecisionTheater renders.
// CRITICAL: These metrics are extracted by useCampaignFeed.summarize() for dashboard stats.
// Missing metrics here = $0 values in dashboard.
function signalsFromMetrics(m = {}, _stage = 'TESTING') {
  const rows = [];
  const fmtPct  = (v) => `${(Number(v) || 0).toFixed(2)}%`;
  const fmtRoas = (v) => `${(Number(v) || 0).toFixed(2)}x`;
  const fmtFreq = (v) => `${(Number(v) || 0).toFixed(2)}`;
  const fmtUsd  = (v) => `$${(Number(v) || 0).toFixed(2)}`;
  const fmtNum  = (v) => Number(v || 0).toLocaleString('en-US');

  const ctrStatus  = m.ctr  >= 2 ? 'positive' : m.ctr  >= 1 ? 'warning' : 'danger';
  const roasStatus = m.roas >= 3 ? 'positive' : m.roas >= 1 ? 'warning' : 'danger';
  const freqStatus = m.frequency <= 2 ? 'positive' : m.frequency <= 3 ? 'warning' : 'danger';
  const cprStatus  = m.costPerResult > 0 && m.costPerResult <= 20 ? 'positive'
                   : m.costPerResult <= 50 ? 'warning' : 'danger';

  // Core performance signals (visible in DecisionTheater)
  rows.push({ metric: 'CTR',       trend: ctrStatus  === 'danger' ? 'down' : 'up',   value: fmtPct(m.ctr),       delta: '',  context: 'Per CSV upload', status: ctrStatus  });
  rows.push({ metric: 'ROAS',      trend: roasStatus === 'danger' ? 'down' : 'up',   value: fmtRoas(m.roas),     delta: '',  context: 'Per CSV upload', status: roasStatus });
  rows.push({ metric: 'Frequency', trend: freqStatus === 'danger' ? 'up'   : 'flat', value: fmtFreq(m.frequency), delta: '',  context: 'Per CSV upload', status: freqStatus });
  rows.push({ metric: 'CPA',       trend: cprStatus  === 'danger' ? 'up'   : 'flat', value: fmtUsd(m.costPerResult), delta: '', context: 'Cost per result', status: cprStatus  });

  // Essential metrics for dashboard summary (useCampaignFeed.summarize extracts these)
  // Without these, dashboard shows $0 spend, 0 impressions, etc.
  rows.push({ metric: 'Spend',       trend: 'neutral', value: fmtUsd(m.spend),       delta: '', context: 'Total', status: 'neutral' });
  rows.push({ metric: 'Impressions', trend: 'neutral', value: fmtNum(m.impressions), delta: '', context: 'Total', status: 'neutral' });
  rows.push({ metric: 'Results',     trend: 'neutral', value: fmtNum(m.results),     delta: '', context: 'Total', status: 'neutral' });
  rows.push({ metric: 'Reach',       trend: 'neutral', value: fmtNum(m.reach),       delta: '', context: 'Unique', status: 'neutral' });

  return rows;
}
