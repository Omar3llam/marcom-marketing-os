// ============================================================
// MARCOM / Lumi — Core API Router  (Phases 5 + 6)
// ------------------------------------------------------------
// Endpoints:
//   POST /api/lumi/rollback/:actionId      (Phase 5, JWT)
//   POST /api/lumi/quick-action            (Phase 5, HMAC link)
//   GET  /api/lumi/feed                    (Phase 6, JWT)
//
// Mount in server.js as:
//   import { lumiRouter }   from './routes/lumi.js';
//   import { requireJwt }   from './middleware/jwtAuth.js';
//   app.use('/api/lumi', requireJwt, lumiRouter);   // /quick-action carves
//                                                   // its own auth path; see below
// ============================================================
import { Router }          from 'express';
import { prisma }          from '../lib/prisma.js';
import { actionQueue, enqueueAction } from '../queues/index.js';
import { verifyQuickAction } from '../utils/hmac.js';
import { logger }          from '../utils/logger.js';

export const lumiRouter = Router();

// Rollback window: an action becomes immutable after 24h.
const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/rollback/:actionId   (JWT-protected)
// ─────────────────────────────────────────────────────────────
// Reverts an action that was successfully executed within the
// last 24 hours by:
//   1. Loading the most recent AuditLog row → previousState
//   2. Building an inverse Action row (`payload.kind` flipped:
//      pause↔resume, scale_budget reversed, etc.)
//   3. Enqueuing it onto BullMQ with a fresh idempotencyKey.
//   4. Marking the original Action as ROLLED_BACK.
// ─────────────────────────────────────────────────────────────
lumiRouter.post('/rollback/:actionId', async (req, res) => {
  const { actionId } = req.params;

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  try {
    const action = await prisma.action.findUnique({
      where:   { id: actionId },
      include: {
        auditLogs: { orderBy: { performedAt: 'desc' }, take: 1 },
      },
    });

    if (!action) return res.status(404).json({ error: 'Action not found' });

    // Workspace isolation — request must come from the same workspace
    if (action.workspaceId !== req.workspaceId) {
      return res.status(403).json({ error: 'Forbidden — workspace mismatch' });
    }

    // ── Status & window enforcement ─────────────────────────
    if (action.status !== 'EXECUTED_SUCCESS') {
      return res.status(409).json({
        error: 'NotRollbackable',
        reason: `status is ${action.status}; only EXECUTED_SUCCESS can be rolled back`,
      });
    }
    if (!action.executedAt) {
      return res.status(409).json({ error: 'NotRollbackable', reason: 'no executedAt' });
    }
    const ageMs = Date.now() - new Date(action.executedAt).getTime();
    if (ageMs > ROLLBACK_WINDOW_MS) {
      return res.status(410).json({
        error:  'RollbackWindowExpired',
        reason: `executed ${Math.round(ageMs / 3_600_000)}h ago; window is 24h`,
      });
    }

    const lastAudit = action.auditLogs[0];
    const previousState = lastAudit?.previousState ?? {};

    // ── Build inverse payload ────────────────────────────────
    const inversePayload = invertPayload(action.payload, previousState);

    const inverse = await prisma.$transaction(async (tx) => {
      const created = await tx.action.create({
        data: {
          workspaceId:    action.workspaceId,
          campaignId:     action.campaignId,
          idempotencyKey: `rollback:${action.id}:${Date.now()}`,
          status:         'PENDING',
          payload:        inversePayload,
        },
      });
      await tx.action.update({
        where: { id: action.id },
        data:  { status: 'ROLLED_BACK' },
      });
      await tx.auditLog.create({
        data: {
          actionId:      action.id,
          previousState: { status: 'EXECUTED_SUCCESS' },
          newState:      { status: 'ROLLED_BACK', inverseActionId: created.id },
          performedBy:   `user:${req.userId}`,
        },
      });
      return created;
    });

    await enqueueAction(inverse);

    return res.json({
      ok:               true,
      rolledBackAction: action.id,
      inverseActionId:  inverse.id,
      enqueued:         true,
    });

  } catch (err) {
    logger.error({ err: err.message, actionId, userId: req.userId }, '[lumi/rollback] failed');
    return res.status(500).json({ error: 'RollbackFailed', message: err.message });
  }
});

// Build the inverse of a payload. Conservative: only known kinds
// are inverted; everything else uses `previousState` as the diff.
function invertPayload(payload, previousState) {
  const kind = payload?.kind;
  switch (kind) {
    case 'meta.pause_ad':    return { ...payload, kind: 'meta.resume_ad' };
    case 'meta.resume_ad':   return { ...payload, kind: 'meta.pause_ad' };
    case 'meta.scale_budget':
      return {
        ...payload,
        kind: 'meta.scale_budget',
        newBudget: previousState?.payload?.newBudget ?? payload?.previousBudget,
        previousBudget: payload?.newBudget,
      };
    case 'google.pause_keyword': return { ...payload, kind: 'google.resume_keyword' };
    case 'google.resume_keyword':return { ...payload, kind: 'google.pause_keyword' };
    default:
      return { kind: 'restore_state', restore: previousState, originalKind: kind };
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/quick-action     (HMAC-signed link, NO JWT)
// ─────────────────────────────────────────────────────────────
// Body: { token, sig }
// One-click triggers from email/Slack notifications. We push the
// referenced action straight onto BullMQ — the worker handles
// idempotency via Action.idempotencyKey.
//
// NOTE: server.js must mount this BEFORE the JWT middleware,
//       e.g. app.post('/api/lumi/quick-action', quickActionHandler)
// ─────────────────────────────────────────────────────────────
export async function quickActionHandler(req, res) {
  const { token, sig } = req.body || {};
  const v = verifyQuickAction({ token, sig });
  if (!v.ok) {
    return res.status(401).json({ error: 'InvalidQuickAction', reason: v.reason });
  }

  try {
    const action = await prisma.action.findUnique({ where: { id: v.actionId } });
    if (!action) return res.status(404).json({ error: 'Action not found' });

    // Quick actions can only push PENDING rows forward; everything
    // else requires a fully-authenticated session.
    if (action.status !== 'PENDING') {
      return res.status(409).json({
        error: 'NotEnqueueable',
        reason: `status is ${action.status}`,
      });
    }

    if (v.scope === 'rollback') {
      // Same window check as the JWT route
      if (!action.executedAt ||
          Date.now() - new Date(action.executedAt).getTime() > ROLLBACK_WINDOW_MS) {
        return res.status(410).json({ error: 'RollbackWindowExpired' });
      }
    }

    await enqueueAction(action);
    return res.json({ ok: true, enqueued: true, actionId: action.id });

  } catch (err) {
    logger.error({ err: err.message }, '[lumi/quick-action] failed');
    return res.status(500).json({ error: 'EnqueueFailed', message: err.message });
  }
}

lumiRouter.post('/quick-action', quickActionHandler);

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/demo-feed     (PUBLIC — NO JWT, NO HMAC)
// ─────────────────────────────────────────────────────────────
// Stakeholder-facing demo endpoint. Returns a deterministic,
// hand-crafted payload that mirrors the EXACT shape of
// GET /api/lumi/feed so the React `adaptFeedPayload` adapter
// works without modification.
//
// Mount in server.js BEFORE the JWT-protected /api/lumi block:
//   app.get('/api/lumi/demo-feed', demoFeedHandler);
//   app.use('/api/lumi', requireJwt, lumiRouter);
//
// Safe to keep enabled in production: read-only, no DB touch,
// no secrets, no side-effects.
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
// GET /api/lumi/feed                 (Phase 6 — JWT-protected)
// ─────────────────────────────────────────────────────────────
// Heavily structured, campaign-grouped JSON for the home feed.
// Designed for direct render-to-card consumption — no follow-up
// requests required. Workspace-scoped (req.workspaceId).
//
// Response shape:
// {
//   workspaceId, generatedAt,
//   summary: { campaigns, actionsPending, actionsExecuted24h, learningEvents24h },
//   campaigns: [
//     {
//       campaignId, stage, healthScore, lastAnalysis,
//       actions: {
//         pending:   [{ id, kind, payload, createdAt, hmacQuickActionUrl? }],
//         recent:    [{ id, kind, status, executedAt, audit: {...} }],
//       },
//       memory: [{ actionType, resultStatus, deltaCtr, deltaRoas,
//                  isSustainable, recordedAt }]   // last 3
//     }
//   ]
// }
// ─────────────────────────────────────────────────────────────
lumiRouter.get('/feed', async (req, res) => {
  if (!req.workspaceId) return res.status(401).json({ error: 'Unauthenticated' });
  const wsId = req.workspaceId;

  try {
    // ── Pull everything in parallel ──────────────────────────
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      campaignStates,
      pendingActions,
      recentActions,
      recentMemory,
      countersExecuted24h,
      countersLearned24h,
    ] = await Promise.all([
      prisma.campaignState.findMany({
        where:   { workspaceId: wsId },
        orderBy: { lastAnalysis: 'desc' },
      }),
      prisma.action.findMany({
        where:   { workspaceId: wsId, status: { in: ['PENDING', 'QUEUED'] } },
        orderBy: { createdAt: 'desc' },
        take:    200,
      }),
      prisma.action.findMany({
        where:   {
          workspaceId: wsId,
          status:      { in: ['EXECUTED_SUCCESS', 'FAILED', 'ROLLED_BACK'] },
          executedAt:  { gte: since24h },
        },
        orderBy: { executedAt: 'desc' },
        include: {
          auditLogs: { orderBy: { performedAt: 'desc' }, take: 1 },
        },
        take: 500,
      }),
      prisma.decisionMemory.findMany({
        where:   { workspaceId: wsId },
        orderBy: { recordedAt: 'desc' },
        take:    200,
      }),
      prisma.action.count({
        where: { workspaceId: wsId, executedAt: { gte: since24h } },
      }),
      prisma.decisionMemory.count({
        where: { workspaceId: wsId, recordedAt: { gte: since24h } },
      }),
    ]);

    // ── Group by campaignId ──────────────────────────────────
    const byCampaign = new Map();

    const ensure = (campaignId) => {
      if (!byCampaign.has(campaignId)) {
        byCampaign.set(campaignId, {
          campaignId,
          stage:        null,
          healthScore:  null,
          lastAnalysis: null,
          actions:      { pending: [], recent: [] },
          memory:       [],
        });
      }
      return byCampaign.get(campaignId);
    };

    for (const s of campaignStates) {
      const slot = ensure(s.campaignId);
      slot.stage        = s.stage;
      slot.healthScore  = s.healthScore;
      slot.lastAnalysis = s.lastAnalysis;
    }

    for (const a of pendingActions) {
      ensure(a.campaignId).actions.pending.push({
        id: a.id, kind: a.payload?.kind || 'unknown',
        payload: a.payload, createdAt: a.createdAt,
      });
    }

    for (const a of recentActions) {
      ensure(a.campaignId).actions.recent.push({
        id: a.id, kind: a.payload?.kind || 'unknown',
        status: a.status, executedAt: a.executedAt,
        audit: a.auditLogs[0]
          ? {
              previousState: a.auditLogs[0].previousState,
              newState:      a.auditLogs[0].newState,
              performedBy:   a.auditLogs[0].performedBy,
              performedAt:   a.auditLogs[0].performedAt,
            }
          : null,
      });
    }

    // Memory — keep last 3 per campaign (ordered desc by recordedAt)
    for (const m of recentMemory) {
      const slot = ensure(m.campaignId);
      if (slot.memory.length < 3) {
        slot.memory.push({
          actionType:        m.actionType,
          resultStatus:      m.resultStatus,
          deltaCtr:          m.deltaCtr,
          deltaRoas:         m.deltaRoas,
          isSustainable:     m.isSustainable,
          impactDurationHrs: m.impactDurationHrs,
          recordedAt:        m.recordedAt,
        });
      }
    }

    // Stable ordering: stage priority then healthScore desc
    const stageRank = {
      DYING: 0, FATIGUED: 1, TESTING: 2, SCALING: 3, STABLE: 4,
    };
    const campaigns = [...byCampaign.values()].sort((a, b) => {
      const ra = stageRank[a.stage] ?? 99;
      const rb = stageRank[b.stage] ?? 99;
      if (ra !== rb) return ra - rb;
      return (b.healthScore ?? 0) - (a.healthScore ?? 0);
    });

    return res.json({
      workspaceId: wsId,
      generatedAt: new Date().toISOString(),
      summary: {
        campaigns:           campaigns.length,
        actionsPending:      pendingActions.length,
        actionsExecuted24h:  countersExecuted24h,
        learningEvents24h:   countersLearned24h,
      },
      campaigns,
    });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/feed] failed');
    return res.status(500).json({ error: 'FeedUnavailable', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Diagnostics (cheap) — handy during the cutover
// ─────────────────────────────────────────────────────────────
lumiRouter.get('/_health', async (_req, res) => {
  try {
    const [actions, queue] = await Promise.all([
      prisma.action.count(),
      actionQueue.getJobCounts('waiting', 'active', 'failed', 'completed'),
    ]);
    res.json({ ok: true, actions, queue });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});
