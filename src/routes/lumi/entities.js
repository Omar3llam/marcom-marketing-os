// ============================================================
// MARCOM / Lumi — Entity-graph surface (connector campaigns + ad-set drill-down)
// GET /api/lumi/entities/campaigns          → connector-synced campaigns
// GET /api/lumi/entities/:campaignId/adsets → that campaign's ad-sets
// ------------------------------------------------------------
// The Campaigns table renders the legacy CampaignState feed; this sibling
// surface exposes the DISJOINT connector entity graph (the only substrate that
// carries ad-set detail) so connector campaigns become drillable. Thin
// handlers — all graph logic lives in EntityGraphService (PR#15+ rule).
// req.workspaceId is resolved by the auth middleware; null → honest empty.
// ============================================================
import { Router } from 'express';
import { getConnectorCampaigns, getCampaignAdSets } from '../../services/entity-graph/index.js';
import { getConnectorVerdicts } from '../../services/verdict-engine/index.js';
import { computeAccountHealth } from '../../services/analysis/AccountHealthService.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

export const entitiesRouter = Router();

// A persisted reasoning row older than this reads as "stale" (signals may have
// drifted since it was generated). Env-tunable; matches the sweep refresh window.
const REASONING_STALE_MS = Number(process.env.REASONING_STALE_MS ?? 24 * 60 * 60 * 1000);

entitiesRouter.get('/entities/campaigns', async (req, res) => {
  try {
    const campaigns = await getConnectorCampaigns(req.workspaceId);
    return res.json({ workspaceId: req.workspaceId ?? null, generatedAt: new Date().toISOString(), campaigns });
  } catch (err) {
    logger.error({ err: err.message, workspaceId: req.workspaceId }, '[lumi/entities] campaigns failed');
    return res.status(500).json({ error: 'EntitiesUnavailable', message: 'Request failed' });
  }
});

// Verdicts for the connector campaigns. Read-only — runs the pure verdict engine
// over campaigns WITH measured revenue and reports the rest as gatedOut (never a
// fabricated KILL from unmeasured revenue). Persists nothing.
entitiesRouter.get('/entities/verdicts', async (req, res) => {
  try {
    const result = await getConnectorVerdicts(req.workspaceId);
    return res.json({ workspaceId: req.workspaceId ?? null, generatedAt: new Date().toISOString(), ...result });
  } catch (err) {
    logger.error({ err: err.message, workspaceId: req.workspaceId }, '[lumi/entities] verdicts failed');
    return res.status(500).json({ error: 'VerdictsUnavailable', message: 'Request failed' });
  }
});

// Deterministic account analysis: Wasted Spend + Account Health + per-campaign
// Impact scores. Composes the pure AccountHealthService over the same connector
// substrate the verdicts route reads. Persists nothing. Gated to the operating
// roles (BUYER/STRATEGIST) — a CLIENT never sees the efficiency critique.
// No connector data → honest nulls (never a fabricated 0 or health score).
entitiesRouter.get('/entities/health', requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  try {
    const [campaigns, { verdicts }] = await Promise.all([
      getConnectorCampaigns(req.workspaceId),
      getConnectorVerdicts(req.workspaceId),
    ]);
    const verdictMap = Object.fromEntries(verdicts.map((v) => [v.id, v]));
    const health = computeAccountHealth(campaigns, verdictMap);

    if (!health) {
      return res.json({
        workspaceId: req.workspaceId ?? null,
        generatedAt: new Date().toISOString(),
        score: null, label: null, wastedSpend: { minor: null, pct: null }, campaigns: [],
      });
    }
    return res.json({ workspaceId: req.workspaceId ?? null, generatedAt: new Date().toISOString(), ...health });
  } catch (err) {
    logger.error({ err: err.message, workspaceId: req.workspaceId }, '[lumi/entities] health failed');
    return res.status(500).json({ error: 'HealthUnavailable', message: 'Request failed' });
  }
});

// Pre-generated "Lumi's Read" for a campaign's verdict. Read-only: the reasoning
// is written by the agentic sweep (top-N by impact), NOT on demand — so this is a
// cheap DB read, not an LLM call. Gated to the operating roles (a CLIENT never
// sees the efficiency read). Honest nulls: no row yet → { reasoning: null } (the
// UI shows "after the next sweep"); a row past the stale window → stale: true.
entitiesRouter.get(
  '/entities/:id/reasoning',
  requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST),
  async (req, res) => {
    const entityId = req.params.id;
    try {
      if (!req.workspaceId) return res.json({ entityId, reasoning: null, stale: false });

      const row = await prisma.campaignReasoning.findUnique({
        where: { workspaceId_entityId: { workspaceId: req.workspaceId, entityId } },
        select: { reasoning: true, verdict: true, impactScore: true, generatedAt: true },
      });
      if (!row) return res.json({ entityId, reasoning: null, stale: false });

      const stale = Date.now() - new Date(row.generatedAt).getTime() > REASONING_STALE_MS;
      return res.json({
        entityId,
        reasoning: row.reasoning,
        verdict: row.verdict,
        impactScore: row.impactScore,
        generatedAt: row.generatedAt.toISOString(),
        stale,
      });
    } catch (err) {
      logger.error({ err: err.message, workspaceId: req.workspaceId, entityId }, '[lumi/entities] reasoning read failed');
      return res.status(500).json({ error: 'ReasoningUnavailable', message: 'Request failed' });
    }
  },
);

entitiesRouter.get('/entities/:campaignId/adsets', async (req, res) => {
  try {
    const adSets = await getCampaignAdSets(req.workspaceId, req.params.campaignId);
    // null = campaign not in this workspace → honest 404 (not a fake empty drill-down).
    if (adSets === null) {
      return res.status(404).json({ error: 'CampaignNotFound', message: 'No such campaign in this workspace' });
    }
    return res.json({ campaignId: req.params.campaignId, generatedAt: new Date().toISOString(), adSets });
  } catch (err) {
    logger.error({ err: err.message, workspaceId: req.workspaceId, campaignId: req.params.campaignId }, '[lumi/entities] adsets failed');
    return res.status(500).json({ error: 'AdSetsUnavailable', message: 'Request failed' });
  }
});
