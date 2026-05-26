// ============================================================
// MARCOM / Lumi — Campaign feed + demo feed
// GET  /api/lumi/feed        (JWT)
// GET  /api/lumi/demo-feed   (PUBLIC)
// Extracted from lumi.js for architecture size compliance.
// ============================================================
import { Router }  from 'express';
import { prisma }  from '../../lib/prisma.js';
import { logger }  from '../../utils/logger.js';

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
  // Workspace fallback supports both the new JWT path and the legacy
  // Clerk-only path during the auth cutover.
  const wsId = req.workspaceId || (req.userId ? `clerk:${req.userId}` : null);
  if (!wsId) return res.status(401).json({ error: 'Unauthenticated' });

  try {
    // ── Enhanced Debug Logging (PR #44) ───────────────────────────
    console.log('\n========== FEED ENDPOINT DEBUG ==========');
    console.log('🔍 FETCHING DATA FOR:', { workspaceId: wsId });

    const [campaignStates, pendingActions, recentMemory] = await Promise.all([
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
        orderBy: { recordedAt: 'desc' },
        take:    200,
      }),
    ]);

    console.log('📦 DATABASE QUERY RESULTS:', {
      campaignStatesFound: campaignStates.length,
      pendingActionsFound: pendingActions.length,
      recentMemoryFound: recentMemory.length,
    });

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
      ensure({ ...cs, campaignName: pendingActions.find(a => a.campaignId === cs.campaignId)?.payload?.campaignName });
    }

    for (const a of pendingActions) {
      const stateRow = campaignStates.find(s => s.campaignId === a.campaignId);
      if (!stateRow) continue;
      const slot = ensure({ ...stateRow, campaignName: a.payload?.campaignName });
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
      });
    }

    const stageRank = { DYING: 0, FATIGUED: 1, TESTING: 2, SCALING: 3, STABLE: 4 };
    const campaigns = [...byCampaign.values()]
      .filter(c => c.alerts.length > 0)
      .sort((a, b) => (stageRank[a.stage] ?? 99) - (stageRank[b.stage] ?? 99));

    // ── Enhanced Debug Logging (PR #44) ───────────────────────────
    const totalSpend = campaigns.reduce((sum, c) => {
      return sum + c.alerts.reduce((alertSum, alert) => {
        const spend = alert.metrics?.find(m => m.metric === 'Spend')?.value || '$0';
        return alertSum + parseFloat(spend.replace(/[$,]/g, '')) || 0;
      }, 0);
    }, 0);

    console.log('📊 FEED CALCULATED:', {
      campaignsFound: campaigns.length,
      totalSpendCalculated: `$${totalSpend.toFixed(2)}`,
      stageBreakdown: campaigns.reduce((acc, c) => {
        acc[c.stage] = (acc[c.stage] || 0) + 1;
        return acc;
      }, {}),
    });
    console.log('==========================================\n');

    return res.json({
      workspaceId: wsId,
      generatedAt: new Date().toISOString(),
      campaigns,
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
