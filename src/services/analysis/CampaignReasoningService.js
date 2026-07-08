// ============================================================
// CampaignReasoningService — on-demand LLM reasoning for a verdict
// ============================================================
// Explains ONE connector campaign's verdict in plain language via the AI
// gateway (EXPLAIN_VERDICT → Claude). Ephemeral — nothing is persisted.
//
// TRACEABILITY: every signal in the prompt is re-derived HERE, server-side, from
// real MetricSnapshot rows (getConnectorCampaigns + getConnectorVerdicts +
// computeAccountHealth) — the client sends only the entityId and a language hint,
// never numbers. A campaign not in this workspace's graph → NOT_FOUND (this is
// also the workspace-isolation guarantee: you can only reason about your own
// campaigns).
//
// Only `dialect` (onboarding language preference) comes from the caller — a
// harmless presentation hint, not a figure the model could fabricate around.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { getConnectorCampaigns } from '../entity-graph/index.js';
import { getConnectorVerdicts } from '../verdict-engine/index.js';
import { computeAccountHealth } from './AccountHealthService.js';
import { execute, CAPABILITY } from '../ai-gateway/index.js';

/**
 * @param {{ workspaceId: string, entityId: string, dialect?: string }} args
 * @returns {Promise<{ status: 'OK'|'NO_WORKSPACE'|'NOT_FOUND'|'AI_FAILED', reasoning?: string }>}
 */
export async function generateCampaignReasoning({ workspaceId, entityId, dialect } = {}) {
  if (!workspaceId) return { status: 'NO_WORKSPACE' };

  const [campaigns, verdictResult] = await Promise.all([
    getConnectorCampaigns(workspaceId),
    getConnectorVerdicts(workspaceId),
  ]);

  const campaign = campaigns.find((c) => c.entityId === entityId);
  if (!campaign) return { status: 'NOT_FOUND' }; // not this workspace's campaign

  const verdictMap = Object.fromEntries(verdictResult.verdicts.map((v) => [v.id, v]));
  const health = computeAccountHealth(campaigns, verdictMap);

  const v = verdictMap[entityId] ?? null;
  const impactScore = health?.campaigns.find((c) => c.entityId === entityId)?.impactScore ?? null;

  const accountSpendMinor = campaigns.reduce((s, c) => s + (c.spendMinor ?? 0), 0);
  const spendSharePct = accountSpendMinor > 0 && campaign.spendMinor != null
    ? (campaign.spendMinor / accountSpendMinor) * 100
    : null;

  // Account-level objective is a promoted Workspace column (onboarding goal id).
  const ws = await prisma.workspace
    .findUnique({ where: { id: workspaceId }, select: { objective: true } })
    .catch(() => null);

  const input = {
    name:            campaign.name,
    channel:         campaign.channel,
    objective:       campaign.objective ?? null,
    verdict:         v?.verdict ?? null,
    impactScore,
    ctrPct:          campaign.ctr != null ? campaign.ctr * 100 : null, // fraction → percent
    frequency:       campaign.frequency ?? null,
    roas:            campaign.roas ?? null,
    spendSharePct,
    rationale:       v?.rationale ?? null,
    accountObjective: ws?.objective ?? null,
    dialect:         dialect ?? null,
  };

  const result = await execute({ capability: CAPABILITY.EXPLAIN_VERDICT, input, workspaceId });

  if (!result.success || !result.output?.reasoning) {
    logger.warn({ workspaceId, entityId, err: result.error?.message }, '[CampaignReasoning] gateway failed');
    return { status: 'AI_FAILED' };
  }

  logger.info({ workspaceId, entityId, verdict: input.verdict }, '[CampaignReasoning] generated');
  return { status: 'OK', reasoning: result.output.reasoning };
}
