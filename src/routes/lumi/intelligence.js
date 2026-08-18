// ============================================================
// MARCOM / Lumi — AI intelligence routes
// POST /api/lumi/orchestrate/:campaignId
// POST /api/lumi/analyze-content
// POST /api/lumi/strategy-brief
// Extracted from lumi.js for architecture size compliance.
// ============================================================
import { Router }  from 'express';
import { prisma }  from '../../lib/prisma.js';
import { logger }  from '../../utils/logger.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { validate, strategyBriefSchema } from '../../middleware/validate.js';
import { WORKSPACE_ROLE }     from '../../services/collaboration/roleScope.js';

export const intelligenceRouter = Router();

// ─────────────────────────────────────────────────────────────
// Orchestration runs the dual-agent and writes its output onto an Action row —
// a state mutation a read-only CLIENT seat must not trigger.
intelligenceRouter.post('/orchestrate/:campaignId', requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const { campaignId } = req.params;
  let wsId = req.workspaceId;
  if (!wsId && req.userId) {
    try {
      const u = await prisma.user.findUnique({
        where:  { clerkId: req.userId },
        select: { workspaceId: true },
      });
      wsId = u?.workspaceId ?? null;
    } catch (fallbackErr) {
      logger.error(
        { err: fallbackErr.message, userId: req.userId },
        '[lumi/orchestrate] workspaceId fallback lookup failed'
      );
    }
  }
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

    // Use circuit breaker wrapper for resilience (Phase 11B)
    const { executeOrchestration } = await import('../../resilience/orchestratorCircuit.js');

    const result = await executeOrchestration({
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
    return res.status(500).json({ error: 'OrchestrationFailed', detail: 'Request failed' });
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
// R11 (I63): spends real AI budget on the workspace's behalf. A CLIENT seat is
// read-only narrative and has no business drawing on that budget.
intelligenceRouter.post('/analyze-content', requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const { content, platform, contextLock } = req.body || {};
  if (!content || typeof content !== 'string' || content.trim().length < 20) {
    return res.status(400).json({ error: 'content required (min 20 chars)' });
  }

  try {
    const { runClaudeAgent } = await import('../../agents/ClaudeAgent.js');
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
    return res.status(500).json({ error: 'Content scoring failed', detail: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/strategy-brief    (JWT — Mode 2 strategy)
// ─────────────────────────────────────────────────────────────
// Body: { objective, audience, budget, timeline, contextLock? }
// Returns: { title, financialImpact, keyPoints[], markdown }
// ─────────────────────────────────────────────────────────────
// R11 (I63): AI spend — see /analyze-content.
intelligenceRouter.post('/strategy-brief', requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), validate(strategyBriefSchema), async (req, res) => {
  const { objective, audience, budget, timeline, contextLock } = req.body || {};
  if (!objective || !audience) {
    return res.status(400).json({ error: 'objective and audience required' });
  }

  try {
    const { runClaudeAgent } = await import('../../agents/ClaudeAgent.js');
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
    return res.status(500).json({ error: 'Strategy generation failed', detail: 'Request failed' });
  }
});
