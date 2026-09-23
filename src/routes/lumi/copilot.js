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
import { computeAccountHealth, WASTED_VERDICTS } from '../../services/analysis/AccountHealthService.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';
import { copilotLimiter } from '../../middleware/rateLimit.js';
import { buildCopilotSystemPrompt, buildCopilotUserPrompt } from '../../services/ai-gateway/prompts/copilotPrompt.js';
import { CURRENCY_HOMOGENEITY, classifyCurrencyHomogeneity } from '../../lib/currencyHomogeneity.js';

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
      //
      // R8 / I29 — the verdict read is best-effort but NOT silent. It used to
      // `.catch(() => ({ verdicts: [] }))`, and an empty verdict set is
      // indistinguishable downstream from a genuinely unjudged account: every
      // campaign printed "unscored", account health printed a score built from
      // no verdicts at all, and the model answered "nothing needs attention"
      // about an account it had simply failed to evaluate. Now the failure is
      // carried as a flag and SAID, in the one place the model can read it.
      //
      // B5-01D — THE CAMPAIGN READ IS NOT BEST-EFFORT, and it is the one read
      // here that cannot be. It used to `.catch(() => [])`, which made a
      // database failure arrive as a real answer: `totalCampaigns` became 0, the
      // prompt's campaign section became "No campaigns synced yet", and the
      // standing rule below it told the model that if asked how many campaigns
      // exist, "the answer is 0 campaigns". A marketer with a fully synced
      // account was told, in prose, that they had none.
      //
      // It PROPAGATES rather than carrying a `campaignsUnavailable` flag beside
      // `verdictsUnavailable`, and the asymmetry is deliberate. That flag works
      // because the campaign metrics survive: the prompt can say verdicts are
      // gone and still answer questions about real spend and ROAS. Campaigns are
      // the substrate those answers are made of — lose them and account health,
      // the portfolio totals and every per-campaign line go with them, leaving a
      // model with nothing to be honest ABOUT. So the request fails at the route
      // boundary below (500), which is what B5-01B and B5-01C do with the same
      // class of failure, and no prompt is built at all — the strongest possible
      // guarantee that none of it can be fabricated.
      let verdictsUnavailable = false;
      const [workspace, campaigns, verdictResult] = await Promise.all([
        prisma.workspace
          .findUnique({ where: { id: wsId }, select: { name: true, currency: true, objective: true, industry: true, market: true } })
          .catch(() => null),
        getConnectorCampaigns(wsId),
        getConnectorVerdicts(wsId).catch((err) => {
          logger.warn({ err: err.message, wsId }, '[lumi/copilot] verdicts unavailable — answering without them');
          verdictsUnavailable = true;
          return null;
        }),
      ]);

      const verdictMap = Object.fromEntries((verdictResult?.verdicts ?? []).map((v) => [v.id, v]));
      const allCampaigns = campaigns ?? [];
      const verdictOf = (c) => verdictMap[c.entityId]?.verdict ?? null;

      // Account health is PURE (no I/O) and BOTH its inputs are already in hand,
      // so grounding the answer in the same score the Overview shows costs nothing.
      // Computed over EVERY campaign — not the top-N slice — so wasted spend is
      // the account's real total, exactly as AccountHealthService intends.
      //
      // Skipped entirely when the verdicts failed: every one of its outputs is
      // verdict-derived, so computing it over an empty map yields a real-looking
      // score, a "0 campaigns to act on" and a "0 scaling well" — three numbers
      // that describe the outage, not the account.
      const accountHealth = verdictsUnavailable ? null : computeAccountHealth(allCampaigns, verdictMap);
      const currencyTruth = classifyCurrencyHomogeneity(allCampaigns, { requireAuthoritative: true });

      // Account-level facts the campaign slice can't carry. `totalCampaigns` is
      // the UNFILTERED count so the model can answer "how many campaigns do I
      // have?" without mistaking the top-N slice for the whole account.
      const portfolioContext = {
        totalCampaigns: allCampaigns.length,
        currency: currencyTruth.currency,
        currencyStatus: currencyTruth.status,
        monetaryStatus: currencyTruth.status === CURRENCY_HOMOGENEITY.HOMOGENEOUS_AUTHORITATIVE
          ? 'MONETARY_VALID'
          : currencyTruth.status === CURRENCY_HOMOGENEITY.MIXED
            ? 'MONETARY_UNAVAILABLE_MIXED' : 'MONETARY_UNAVAILABLE_UNTRUSTED',
        health: accountHealth
          ? {
            score: accountHealth.score,
            label: accountHealth.label,
            currencyUnavailable: accountHealth.currencyUnavailable,
            // wastedSpend is { minor, pct } — the minor units, not the object.
            wastedSpendMinor: accountHealth.wastedSpend?.minor ?? null,
            // Counted over every campaign (health.campaigns holds only the rows
            // above the 1%-of-spend scoring floor, which would undercount).
            criticalCampaigns: allCampaigns.filter((c) => WASTED_VERDICTS.has(verdictOf(c))).length,
            healthyCampaigns: allCampaigns.filter((c) => verdictOf(c) === 'SCALE').length,
          }
          : null,
        totals: null, // reserved — blended CPA/ROAS/spend land here without an API change
      };

      const campaignContext = currencyTruth.status === CURRENCY_HOMOGENEITY.HOMOGENEOUS_AUTHORITATIVE
        ? allCampaigns
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
          monetaryStatus: 'MONETARY_VALID',
          // Already on every connector row (entityGraphEngine.metricsOf) and
          // previously dropped right here — which is why no CPA question could
          // be answered: without conversions, CPA isn't even derivable.
          conversions: c.conversions ?? null,
          revenueMinor: c.revenueMinor ?? null,
          impressions: c.impressions ?? null,
          clicks: c.clicks ?? null,
          // lastDate is DELIBERATELY excluded: a connector row is a rolling
          // aggregate re-stamped every sync, so its date would imply a time
          // window the data cannot support.
          }))
        : [];

      const latestRun = await prisma.loopRun
        .findFirst({ where: { workspaceId: wsId }, orderBy: { createdAt: 'desc' }, select: { aiInsight: true } })
        .catch(() => null);

      const system = buildCopilotSystemPrompt({
        workspace: workspace ?? {},
        portfolio: portfolioContext,
        campaigns: campaignContext,
        // A stored briefing may predate this contract and may have been built
        // from a raw-spend ordering. Do not ground a mixed/unknown answer in it.
        briefing: currencyTruth.status === CURRENCY_HOMOGENEITY.HOMOGENEOUS_AUTHORITATIVE
          ? (latestRun?.aiInsight ?? null)
          : null,
        verdictsUnavailable,
      });
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
