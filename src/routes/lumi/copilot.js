// ============================================================
// MARCOM / Lumi — Copilot Q&A
//   POST /api/lumi/copilot — account-aware chat answer (stateless)
//
// The client owns the conversation (client-side memory); each request carries
// the recent transcript. The server assembles LIVE account context (workspace +
// top campaigns by spend + latest portfolio briefing) into the system prompt and
// routes ANSWER_QUESTION through the AI gateway. Read-only: it answers, it never
// executes. BUYER/STRATEGIST only (a CLIENT seat is read-only leadership).
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { execute } from '../../services/ai-gateway/ProviderGateway.js';
import { CAPABILITY } from '../../services/ai-gateway/providerTypes.js';
import { getConnectorCampaigns } from '../../services/entity-graph/index.js';
import { getConnectorVerdicts } from '../../services/verdict-engine/index.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';
import { copilotLimiter } from '../../middleware/rateLimit.js';
import { buildCopilotSystemPrompt, buildCopilotUserPrompt } from '../../services/ai-gateway/prompts/copilotPrompt.js';

export const copilotRouter = Router();

const MAX_QUESTION_LEN = 500;   // backend-enforced (matches the UI hint)
const MAX_HISTORY = 20;         // reject over-long client histories
const HISTORY_CONTEXT = 10;     // turns actually sent to the model
const TOP_CAMPAIGNS = 8;        // portfolio slice injected into the prompt

// Resolve workspaceId — mirrors agentic.js. Never fabricate a uuid.
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi/copilot] workspaceId fallback failed');
    return null;
  }
}

copilotRouter.post(
  '/copilot',
  copilotLimiter,
  requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST),
  async (req, res) => {
    const wsId = await resolveWorkspaceId(req);
    if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

    const { question, history = [] } = req.body ?? {};

    if (!question || typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION_LEN) {
      return res.status(400).json({ error: 'InvalidQuestion', message: `Question must be 1–${MAX_QUESTION_LEN} characters.` });
    }
    if (!Array.isArray(history) || history.length > MAX_HISTORY) {
      return res.status(400).json({ error: 'InvalidHistory', message: `History must be an array of at most ${MAX_HISTORY} turns.` });
    }

    try {
      // Live account context — all best-effort reads (a missing connector or the
      // un-migrated aiInsight column must degrade the answer, never 500 it).
      const [workspace, campaigns, verdictResult] = await Promise.all([
        prisma.workspace
          .findUnique({ where: { id: wsId }, select: { name: true, currency: true, objective: true, industry: true, market: true } })
          .catch(() => null),
        getConnectorCampaigns(wsId).catch(() => []),
        getConnectorVerdicts(wsId).catch(() => ({ verdicts: [] })),
      ]);

      const verdictMap = Object.fromEntries((verdictResult?.verdicts ?? []).map((v) => [v.id, v]));

      const topCampaigns = (campaigns ?? [])
        .filter((c) => (c.spendMinor ?? 0) > 0)
        .sort((a, b) => (b.spendMinor ?? 0) - (a.spendMinor ?? 0))
        .slice(0, TOP_CAMPAIGNS)
        .map((c) => ({
          name: c.name,
          channel: c.channel,
          objective: c.objective,
          verdict: verdictMap[c.entityId]?.verdict ?? null,
          rationale: verdictMap[c.entityId]?.rationale ?? null,
          roas: c.roas,
          ctr: c.ctr,
          frequency: c.frequency,
          spendMinor: c.spendMinor,
          currency: c.currency,
        }));

      const latestRun = await prisma.loopRun
        .findFirst({ where: { workspaceId: wsId }, orderBy: { createdAt: 'desc' }, select: { aiInsight: true } })
        .catch(() => null);

      const system = buildCopilotSystemPrompt(workspace ?? {}, topCampaigns, latestRun?.aiInsight ?? null);
      const user = buildCopilotUserPrompt(history.slice(-HISTORY_CONTEXT), question.trim());

      const result = await execute({ capability: CAPABILITY.ANSWER_QUESTION, input: { system, user }, workspaceId: wsId });

      if (!result.success || !result.output?.answer) {
        logger.warn({ wsId, err: result.error?.message }, '[lumi/copilot] gateway returned no answer');
        return res.status(502).json({ error: 'CopilotUnavailable', message: "Couldn't answer that right now." });
      }

      return res.json({ answer: result.output.answer });
    } catch (err) {
      logger.error({ err: err.message, wsId }, '[lumi/copilot] failed');
      return res.status(500).json({ error: 'CopilotError', message: 'Request failed.' });
    }
  },
);
