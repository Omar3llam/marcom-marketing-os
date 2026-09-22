// ============================================================
// CampaignReasoningService — LLM reasoning for a verdict
// ============================================================
// Explains a connector campaign's verdict in plain language via the AI gateway
// (EXPLAIN_VERDICT → Claude). Two entry points share ONE traceable path:
//
//   generateCampaignReasoning() — single campaign, ephemeral (returns text).
//   generateReasoningForSweep()  — top-N by impact, PERSISTED (CampaignReasoning
//                                  upsert), called best-effort from the sweep so
//                                  the drill-down shows an instant read.
//
// TRACEABILITY: every signal in the prompt is re-derived HERE, server-side, from
// real MetricSnapshot rows (the canonical evaluation + getConnectorVerdicts +
// computeAccountHealth) — callers never supply numbers, only an entityId and an
// optional language hint. A campaign not in this workspace's graph is unknown
// (NOT_FOUND / skipped) — the workspace-isolation guarantee.
//
// COST CONTROL (sweep): capped at REASONING_SWEEP_TOP_N campaigns, and a fresh,
// unchanged row (same verdict, younger than REASONING_REFRESH_MS) is skipped —
// so a quiet account is not re-billed an LLM call on every 15-minute sweep.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { getConnectorVerdicts, evaluateConnectorVerdicts } from '../verdict-engine/index.js';
import { computeAccountHealth } from './AccountHealthService.js';
import { execute, CAPABILITY } from '../ai-gateway/index.js';
import { CURRENCY_HOMOGENEITY, classifyCurrencyHomogeneity } from '../../lib/currencyHomogeneity.js';

// How many campaigns (ranked by impact) a sweep pre-generates reasoning for.
// 0 disables sweep pre-generation entirely (a no-deploy kill switch).
const SWEEP_TOP_N = Number(process.env.REASONING_SWEEP_TOP_N ?? 10);
// A persisted row younger than this AND on the same verdict is left untouched by
// the sweep (matches the 24h "stale" the reader shows).
const REFRESH_MS = Number(process.env.REASONING_REFRESH_MS ?? 24 * 60 * 60 * 1000);

/**
 * Load the shared reasoning context for a workspace ONCE (campaigns + verdicts +
 * derived health + account totals). Both entry points read from this so the
 * sweep never re-fetches per campaign.
 */
async function loadReasoningContext(workspaceId, evaluation) {
  // ── R13-D / B2 — one population for the whole reasoning context ────────────
  // `campaigns` was read separately from `getConnectorCampaigns` (operational).
  // Two numbers below depend on it and both reach a human: `health` (see
  // PortfolioAnalysisService for the full account of that defect) and
  // `accountSpendMinor`, which becomes the `spendSharePct` in every campaign's
  // "Lumi's Read" — a canonical 30-day campaign spend divided by a
  // possibly-lifetime account total, published as a percentage of the account.
  //
  // Now taken from the evaluation, so the rows being explained, the rows being
  // scored and the rows the verdicts came from are one set (R8 / I25).
  //
  // R8: when the sweep hands us its evaluation, we explain THOSE verdicts — the
  // ones it just stored — rather than recomputing a set that may already have
  // moved. Absent (the on-demand entry point), this is the request's own single
  // evaluation.
  const ev = evaluation ?? await evaluateConnectorVerdicts(workspaceId);
  const verdictResult = await getConnectorVerdicts(workspaceId, { evaluation: ev });
  const campaigns = ev.campaigns ?? [];
  const verdictMap = Object.fromEntries((verdictResult?.verdicts ?? []).map((v) => [v.id, v]));
  const health = computeAccountHealth(campaigns, verdictMap);
  const currencyTruth = classifyCurrencyHomogeneity(campaigns);
  const accountSpendMinor = currencyTruth.status === CURRENCY_HOMOGENEITY.HOMOGENEOUS_KNOWN
    ? campaigns.reduce((s, c) => s + (c.spendMinor ?? 0), 0)
    : null;

  // Account-level objective is a promoted Workspace column (onboarding goal id).
  const ws = await prisma.workspace
    .findUnique({ where: { id: workspaceId }, select: { objective: true } })
    .catch(() => null);

  return {
    campaigns,
    verdictMap,
    health,
    accountSpendMinor,
    currencyStatus: currencyTruth.status,
    accountObjective: ws?.objective ?? null,
  };
}

/**
 * Build the gateway input for ONE campaign from already-loaded context. PURE.
 * Every figure is server-resolved; `dialect` is the only presentation hint.
 */
export function buildReasoningInput({ campaign, verdictMap, health, accountSpendMinor, accountObjective, dialect } = {}) {
  const v = verdictMap?.[campaign.entityId] ?? null;
  const impactScore = health?.campaigns.find((c) => c.entityId === campaign.entityId)?.impactScore ?? null;
  const spendSharePct = accountSpendMinor > 0 && campaign.spendMinor != null
    ? (campaign.spendMinor / accountSpendMinor) * 100
    : null;

  return {
    name:             campaign.name,
    channel:          campaign.channel,
    objective:        campaign.objective ?? null,
    verdict:          v?.verdict ?? null,
    impactScore,
    ctrPct:           campaign.ctr != null ? campaign.ctr * 100 : null, // fraction → percent
    frequency:        campaign.frequency ?? null,
    roas:             campaign.roas ?? null,
    spendSharePct,
    rationale:        v?.rationale ?? null,
    accountObjective: accountObjective ?? null,
    dialect:          dialect ?? null,
  };
}

/** Run the gateway; returns reasoning text or null (logging the real error type). */
async function runReasoningGateway(workspaceId, entityId, input) {
  const result = await execute({ capability: CAPABILITY.EXPLAIN_VERDICT, input, workspaceId });
  if (!result.success || !result.output?.reasoning) {
    logger.warn(
      { workspaceId, entityId, errType: result.error?.type, err: result.error?.message },
      '[CampaignReasoning] gateway failed',
    );
    return null;
  }
  return result.output.reasoning;
}

/**
 * On-demand reasoning for a single campaign (ephemeral — nothing persisted).
 * @param {{ workspaceId: string, entityId: string, dialect?: string }} args
 * @returns {Promise<{ status: 'OK'|'NO_WORKSPACE'|'NOT_FOUND'|'AI_FAILED', reasoning?: string }>}
 */
export async function generateCampaignReasoning({ workspaceId, entityId, dialect } = {}) {
  if (!workspaceId) return { status: 'NO_WORKSPACE' };

  const ctx = await loadReasoningContext(workspaceId);
  const campaign = ctx.campaigns.find((c) => c.entityId === entityId);
  if (!campaign) return { status: 'NOT_FOUND' }; // not this workspace's campaign

  const input = buildReasoningInput({ campaign, ...ctx, dialect });
  const reasoning = await runReasoningGateway(workspaceId, entityId, input);
  if (!reasoning) return { status: 'AI_FAILED' };

  logger.info({ workspaceId, entityId, verdict: input.verdict }, '[CampaignReasoning] generated');
  return { status: 'OK', reasoning };
}

/**
 * Pre-generate + persist reasoning for the top-N campaigns by impact. Called
 * best-effort from the agentic sweep. Per-campaign failures never stop the batch;
 * fresh unchanged rows are skipped to control token spend. English only (no
 * dialect) — a background job has no single user's language preference.
 *
 * @param {{ workspaceId: string, loopRunId?: string|null, topN?: number,
 *   now?: number, evaluation?: object }} args — `evaluation` is the sweep's one
 *   connector-verdict evaluation (R8); a FAILED one re-raises here and the
 *   sweep's own catch records "reasoning pre-generation skipped".
 * @returns {Promise<{ attempted: number, generated: number, skipped: number }>}
 */
export async function generateReasoningForSweep({ workspaceId, loopRunId = null, topN = SWEEP_TOP_N, now = Date.now(), evaluation } = {}) {
  const empty = { attempted: 0, generated: 0, skipped: 0 };
  if (!workspaceId || topN <= 0) return empty;

  const ctx = await loadReasoningContext(workspaceId, evaluation);
  if (!ctx.health) return empty; // no honest data to reason about

  // Rank the actionable (verdict-bearing) campaigns by impact; take the top N.
  const ranked = ctx.health.campaigns
    .filter((c) => c.verdict && Number.isFinite(c.impactScore))
    .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0))
    .slice(0, topN);
  if (ranked.length === 0) return empty;

  // One query for the existing rows → skip fresh, unchanged reasoning.
  const existing = await prisma.campaignReasoning.findMany({
    where: { workspaceId, entityId: { in: ranked.map((c) => c.entityId) } },
    select: { entityId: true, verdict: true, generatedAt: true },
  }).catch(() => []);
  const prevByEntity = new Map(existing.map((r) => [r.entityId, r]));

  let generated = 0;
  let skipped = 0;
  for (const item of ranked) {
    const prev = prevByEntity.get(item.entityId);
    const isFresh = prev
      && item.verdict === prev.verdict
      && now - new Date(prev.generatedAt).getTime() < REFRESH_MS;
    if (isFresh) { skipped += 1; continue; }

    const campaign = ctx.campaigns.find((c) => c.entityId === item.entityId);
    if (!campaign) continue;

    try {
      const input = buildReasoningInput({ campaign, ...ctx }); // no dialect → English
      const reasoning = await runReasoningGateway(workspaceId, item.entityId, input);
      if (!reasoning) continue; // gateway failed for this one — never stops the batch

      await prisma.campaignReasoning.upsert({
        where: { workspaceId_entityId: { workspaceId, entityId: item.entityId } },
        create: {
          workspaceId, entityId: item.entityId, reasoning,
          verdict: item.verdict, impactScore: item.impactScore ?? null, sweepId: loopRunId,
        },
        update: {
          reasoning, verdict: item.verdict, impactScore: item.impactScore ?? null,
          sweepId: loopRunId, generatedAt: new Date(now),
        },
      });
      generated += 1;
    } catch (err) {
      logger.warn(
        { err: err.message, entityId: item.entityId, workspaceId },
        '[CampaignReasoning] sweep generation failed for campaign',
      );
    }
  }

  logger.info({ workspaceId, attempted: ranked.length, generated, skipped }, '[CampaignReasoning] sweep reasoning complete');
  return { attempted: ranked.length, generated, skipped };
}
