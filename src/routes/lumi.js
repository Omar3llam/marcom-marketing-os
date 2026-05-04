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
  // Workspace fallback supports both the new JWT path and the legacy
  // Clerk-only path during the auth cutover.
  const wsId = req.workspaceId || (req.userId ? `clerk:${req.userId}` : null);
  if (!wsId) return res.status(401).json({ error: 'Unauthenticated' });

  try {
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
function signalsFromMetrics(m = {}, stage = 'TESTING') {
  const rows = [];
  const fmtPct  = (v) => `${(Number(v) || 0).toFixed(2)}%`;
  const fmtRoas = (v) => `${(Number(v) || 0).toFixed(2)}x`;
  const fmtFreq = (v) => `${(Number(v) || 0).toFixed(2)}`;
  const fmtUsd  = (v) => `$${(Number(v) || 0).toFixed(2)}`;

  const ctrStatus  = m.ctr  >= 2 ? 'positive' : m.ctr  >= 1 ? 'warning' : 'danger';
  const roasStatus = m.roas >= 3 ? 'positive' : m.roas >= 1 ? 'warning' : 'danger';
  const freqStatus = m.frequency <= 2 ? 'positive' : m.frequency <= 3 ? 'warning' : 'danger';
  const cprStatus  = m.costPerResult > 0 && m.costPerResult <= 20 ? 'positive'
                   : m.costPerResult <= 50 ? 'warning' : 'danger';

  rows.push({ metric: 'CTR',       trend: ctrStatus  === 'danger' ? 'down' : 'up',   value: fmtPct(m.ctr),       delta: '',  context: 'Per CSV upload', status: ctrStatus  });
  rows.push({ metric: 'ROAS',      trend: roasStatus === 'danger' ? 'down' : 'up',   value: fmtRoas(m.roas),     delta: '',  context: 'Per CSV upload', status: roasStatus });
  rows.push({ metric: 'Frequency', trend: freqStatus === 'danger' ? 'up'   : 'flat', value: fmtFreq(m.frequency), delta: '',  context: 'Per CSV upload', status: freqStatus });
  rows.push({ metric: 'CPA',       trend: cprStatus  === 'danger' ? 'up'   : 'flat', value: fmtUsd(m.costPerResult), delta: '', context: 'Cost per result', status: cprStatus  });
  return rows;
}

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/orchestrate/:campaignId  (JWT-protected)
// ─────────────────────────────────────────────────────────────
// Runs the dual-agent pipeline (Claude analysis → conditional
// OpenAI creative) against the most recent PENDING action for
// the given campaignId. Persists the full output onto that
// Action.payload and returns it.
//
// Long-running: typically 5–30s end-to-end. The frontend must
// surface a loading state — see DecisionTheater.handleOrchestrate.
// ─────────────────────────────────────────────────────────────
lumiRouter.post('/orchestrate/:campaignId', async (req, res) => {
  const { campaignId } = req.params;
  const wsId   = req.workspaceId || (req.userId ? `clerk:${req.userId}` : null);
  const userId = req.userId;
  if (!wsId)        return res.status(401).json({ error: 'Unauthenticated' });
  if (!campaignId)  return res.status(400).json({ error: 'campaignId required' });

  try {
    // Pick the most recent PENDING action for this campaign as the
    // canonical row to write the orchestration output onto.
    const action = await prisma.action.findFirst({
      where:   { workspaceId: wsId, campaignId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!action) {
      return res.status(404).json({ error: 'No PENDING action for this campaign' });
    }

    // Lazy-import to keep the route module load-time light.
    const { runOrchestration } = await import('../agents/orchestrator.js');

    const result = await runOrchestration({
      campaignId,
      workspaceId: wsId,
      actionId:    action.id,
      userId,
    });

    return res.json({
      ok:        true,
      actionId:  action.id,
      campaignId,
      ...result,
    });
  } catch (err) {
    logger.error({ err: err.message, campaignId, wsId }, '[lumi/orchestrate] failed');
    return res.status(500).json({ error: 'OrchestrationFailed', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/analyze-content   (JWT — Mode 4 content scoring)
// ─────────────────────────────────────────────────────────────
// Body: { content: string, platform?: string, contextLock?: object }
// Returns: { score, issues[], rewrite, platformNotes, original }
//
// Thin Claude wrapper — strict JSON output. Used by the FSM
// `content` mode in the Decision OS. No DB writes.
// ─────────────────────────────────────────────────────────────
lumiRouter.post('/analyze-content', async (req, res) => {
  const { content, platform, contextLock } = req.body || {};
  if (!content || typeof content !== 'string' || content.trim().length < 20) {
    return res.status(400).json({ error: 'content required (min 20 chars)' });
  }

  try {
    const { runClaudeAgent } = await import('../agents/ClaudeAgent.js');
    const role = 'You are an expert direct-response copywriter and brand strategist.';
    const task = [
      'Score the content below using a 10-point MARCOM framework. Return ONLY JSON, no fences:',
      '{',
      '  "score": <0-100 integer>,',
      '  "issues": ["<issue 1>", "<issue 2>", ...],',
      '  "rewrite": "<rewritten copy>",',
      '  "platformNotes": "<one-line platform-specific note>"',
      '}',
      '',
      `PLATFORM: ${platform || 'generic'}`,
      contextLock ? `BRAND CONTEXT:\n${JSON.stringify(contextLock, null, 2)}` : '',
      '',
      'CONTENT TO SCORE:',
      content,
    ].filter(Boolean).join('\n');

    const { text } = await runClaudeAgent({
      campaignId: null, role, task, maxTokens: 1200,
    });
    const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { return res.status(502).json({ error: 'Claude returned invalid JSON', raw: cleaned.slice(0, 400) }); }

    return res.json({
      original:      content,
      score:         Number(parsed.score) || 0,
      issues:        Array.isArray(parsed.issues) ? parsed.issues : [],
      rewrite:       String(parsed.rewrite || ''),
      platformNotes: String(parsed.platformNotes || ''),
    });
  } catch (err) {
    logger.error({ err: err.message }, '[lumi/analyze-content] failed');
    return res.status(500).json({ error: 'Content scoring failed', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/strategy-brief    (JWT — Mode 2 strategy)
// ─────────────────────────────────────────────────────────────
// Body: { objective, audience, budget, timeline, contextLock? }
// Returns: { title, financialImpact, keyPoints[], markdown }
// ─────────────────────────────────────────────────────────────
lumiRouter.post('/strategy-brief', async (req, res) => {
  const { objective, audience, budget, timeline, contextLock } = req.body || {};
  if (!objective || !audience) {
    return res.status(400).json({ error: 'objective and audience required' });
  }

  try {
    const { runClaudeAgent } = await import('../agents/ClaudeAgent.js');
    const role = 'You are a senior CMO writing a tight, executable strategy brief — no fluff.';
    const task = [
      'Generate a strategy brief for the goal below. Return ONLY JSON, no fences:',
      '{',
      '  "title": "<short campaign name>",',
      '  "financialImpact": "<one sentence projecting commercial impact>",',
      '  "keyPoints": ["<bullet 1>", "<bullet 2>", "<bullet 3>", "<bullet 4>"],',
      '  "markdown": "<full brief in markdown — sections: Objective / Audience / Channels / Creative Angles / Budget Split / Success Metrics>"',
      '}',
      '',
      `OBJECTIVE: ${objective}`,
      `AUDIENCE:  ${audience}`,
      `BUDGET:    ${budget || 'unspecified'}`,
      `TIMELINE:  ${timeline || 'unspecified'}`,
      contextLock ? `BRAND CONTEXT:\n${JSON.stringify(contextLock, null, 2)}` : '',
    ].filter(Boolean).join('\n');

    const { text } = await runClaudeAgent({
      campaignId: null, role, task, maxTokens: 2500,
    });
    const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { return res.status(502).json({ error: 'Claude returned invalid JSON', raw: cleaned.slice(0, 400) }); }

    return res.json({
      title:           String(parsed.title || 'Strategy Brief'),
      financialImpact: String(parsed.financialImpact || ''),
      keyPoints:       Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      markdown:        String(parsed.markdown || ''),
    });
  } catch (err) {
    logger.error({ err: err.message }, '[lumi/strategy-brief] failed');
    return res.status(500).json({ error: 'Strategy generation failed', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Diagnostics (cheap) — handy during the cutover
// ─────────────────────────────────────────────────────────────
lumiRouter.get('/_health', async (_req, res) => {
  try {
    const actions = await prisma.action.count().catch(() => null);
    let queue = null;
    if (actionQueue) {
      try {
        queue = await actionQueue.getJobCounts('waiting', 'active', 'failed', 'completed');
      } catch (err) {
        queue = { error: err.message };
      }
    } else {
      queue = { disabled: true, reason: 'REDIS_URL not configured' };
    }
    res.json({ ok: true, actions, queue });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});
