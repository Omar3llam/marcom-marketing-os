// ============================================================
// PortfolioAnalysisService — the ADVISORY portfolio layer
// ============================================================
// Runs ANALYZE_PORTFOLIO over the live connector substrate and stores the
// resulting prose on the sweep's LoopRun (aiInsight) for the Overview AI Insight
// card. Also returns the deterministic "needs revenue" list.
//
// ADVISE, NEVER OVERRIDE — the load-bearing contract:
//   The deterministic verdict engine (verdictEngine → persistConnectorVerdicts)
//   remains the ONLY writer of Decision rows. This service writes NO verdicts and
//   touches NO Decision. It reads the verdicts the engine already produced and
//   asks the model to narrate them. An LLM cannot introduce, upgrade or reverse a
//   KILL/HOLD/SCALE here — by construction, not by prompt discipline alone.
//
// The `revenueNeeded` list is computed DETERMINISTICALLY (needsRevenueData over
// real rows), never parsed out of the model's answer — so a hallucinated or
// misspelled campaign name can never reach the UI.
//
// Best-effort by contract: every failure path returns null and the caller (the
// sweep) proceeds. An AI outage must never cost a sweep audit or a verdict.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { execute } from '../ai-gateway/ProviderGateway.js';
import { CAPABILITY } from '../ai-gateway/providerTypes.js';
import { buildPortfolioAnalysisPrompt, CAMPAIGN_LIMIT } from '../ai-gateway/prompts/portfolioAnalysisPrompt.js';
import { getConnectorVerdicts, evaluateConnectorVerdicts, needsRevenueData } from '../verdict-engine/index.js';
import { computeAccountHealth } from './AccountHealthService.js';

/**
 * PURE: enrich connector rows with the deterministic verdict + needs-revenue flag,
 * keeping only campaigns that actually spent (a roster row has nothing to narrate).
 * Sorted by spend desc so the prompt's top-N slice is the meaningful one.
 */
export function enrichCampaigns(campaigns = [], verdictMap = {}) {
  return campaigns
    .filter((c) => Number.isFinite(c?.spendMinor) && c.spendMinor > 0)
    .map((c) => ({
      ...c,
      verdict: verdictMap[c.entityId]?.verdict ?? null,
      needsRevenue: needsRevenueData(c),
    }))
    .sort((a, b) => (b.spendMinor ?? 0) - (a.spendMinor ?? 0));
}

/** PURE: count the deterministic verdicts by name (absent ⇒ 0, never fabricated). */
export function countVerdicts(enriched = []) {
  const counts = {};
  for (const c of enriched) {
    if (c.verdict) counts[c.verdict] = (counts[c.verdict] ?? 0) + 1;
  }
  return counts;
}

/**
 * Generate the advisory portfolio note for a workspace.
 *
 * @param {string} workspaceId
 * @param {{ loopRunId?: string|null, evaluation?: object }} [opts] — when
 *   loopRunId is given, the insight is stored on that LoopRun (the Overview card
 *   reads the latest run's aiInsight). `evaluation` is the sweep's one
 *   connector-verdict evaluation (R8): this service narrates the verdicts the
 *   sweep stored, so it must be handed them rather than recomputing a set that
 *   may already disagree with the agenda beside it.
 * @returns {Promise<{ insight: string|null, revenueNeeded: Array<{entityId:string,name:string}> }|null>}
 *   null when there is nothing honest to say (no workspace / no spending campaigns
 *   / the gateway produced nothing / the verdicts could not be computed).
 */
export async function runPortfolioAnalysis(workspaceId, { loopRunId = null, evaluation } = {}) {
  if (!workspaceId) return null;

  try {
    // ── R13-D / B2 — the same population the verdicts came from ──────────────
    // `campaigns` was read separately here, from `getConnectorCampaigns` — the
    // OPERATIONAL population, covering whatever period the last sync requested
    // (`maximum` ≈ 37 months from the Sync button). The verdicts beside it were
    // canonical 30-day, so computeAccountHealth below was weighting a 30-day
    // judgement by a lifetime spend, and the score + wastedPct it produced went
    // into the prompt that writes the Overview AI Insight card.
    //
    // The route at /entities/health was corrected in R13-C; this caller and
    // CampaignReasoningService were not, so one account had two health scores
    // depending on which surface you looked at. AccountHealthService's own
    // header states the canonical population as an INPUT REQUIREMENT — pass it
    // operational rows and every threshold in it silently means something else.
    // All three callers now satisfy it.
    //
    // Taken from the EVALUATION rather than re-read (R8 / I25): those are the
    // very rows the verdicts were computed from, so the join below cannot
    // disagree with itself, and the sweep still performs exactly one canonical
    // read no matter how many consumers it feeds.
    //
    // Numbers MOVED as a result, usually downward: the spend behind them shrank
    // from lifetime to thirty days. Nothing was recalibrated to compensate, for
    // the same reason as last time — the old figures were not a baseline, they
    // were an unstated mixture.
    const ev = evaluation ?? await evaluateConnectorVerdicts(workspaceId);
    // NO `.catch(() => ({ verdicts: [] }))` (R8 / I29). That fallback turned
    // "the verdict computation failed" into "this account has no verdicts", and
    // the model then narrated a portfolio where nothing needed acting on — a
    // confident all-clear written over an outage. A throw here reaches the outer
    // catch and this service returns null, which is what its contract already
    // means: nothing honest to say.
    const verdictResult = await getConnectorVerdicts(workspaceId, { evaluation: ev });
    const campaigns = ev.campaigns ?? [];

    const verdictMap = Object.fromEntries((verdictResult?.verdicts ?? []).map((v) => [v.id, v]));
    const enriched = enrichCampaigns(campaigns, verdictMap);

    // Honest empty state: a cold or zero-spend account gets no narration at all
    // (rather than a generic "everything looks fine" written about nothing).
    if (enriched.length === 0) {
      logger.debug({ workspaceId }, '[portfolioAnalysis] no spending campaigns — nothing to narrate');
      return null;
    }

    // Deterministic — the model never sees this list, it only sees the COUNT.
    const revenueNeeded = enriched
      .filter((c) => c.needsRevenue)
      .map((c) => ({ entityId: c.entityId, name: c.name }));

    const health = computeAccountHealth(campaigns, verdictMap);
    const workspace = await prisma.workspace
      .findUnique({
        where: { id: workspaceId },
        select: { name: true, currency: true, objective: true, market: true, industry: true },
      })
      .catch(() => null);

    const stats = {
      total: enriched.length,
      verdictCounts: countVerdicts(enriched),
      healthScore: health?.score ?? null,
      healthLabel: health?.label ?? null,
      wastedPct: health?.wastedSpend?.pct ?? null,
      needsRevenueCount: revenueNeeded.length,
    };

    const { system, user } = buildPortfolioAnalysisPrompt(stats, enriched, workspace ?? {});
    const result = await execute({
      capability: CAPABILITY.ANALYZE_PORTFOLIO,
      input: { system, user },
      workspaceId,
    });

    const insight = result?.success ? (result.output?.insight ?? null) : null;
    if (!insight) {
      logger.warn({ workspaceId, err: result?.error?.message }, '[portfolioAnalysis] gateway returned no insight');
      // The deterministic revenueNeeded is still real and useful without the prose.
      return { insight: null, revenueNeeded };
    }

    if (loopRunId) {
      await prisma.loopRun
        .update({ where: { id: loopRunId }, data: { aiInsight: insight } })
        .catch((err) => logger.warn({ err: err.message, workspaceId, loopRunId }, '[portfolioAnalysis] aiInsight store failed'));
    }

    logger.info(
      {
        workspaceId,
        campaigns: enriched.length,
        narrated: Math.min(enriched.length, CAMPAIGN_LIMIT),
        needsRevenue: revenueNeeded.length,
      },
      '[portfolioAnalysis] advisory generated',
    );
    return { insight, revenueNeeded };
  } catch (err) {
    // Never fails the caller — the sweep's audit and verdicts stand on their own.
    logger.warn({ err: err.message, workspaceId }, '[portfolioAnalysis] failed — deterministic verdicts unaffected');
    return null;
  }
}
