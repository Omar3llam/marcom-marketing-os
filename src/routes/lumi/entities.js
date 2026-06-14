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
import { logger } from '../../utils/logger.js';

export const entitiesRouter = Router();

entitiesRouter.get('/entities/campaigns', async (req, res) => {
  try {
    const campaigns = await getConnectorCampaigns(req.workspaceId);
    return res.json({ workspaceId: req.workspaceId ?? null, generatedAt: new Date().toISOString(), campaigns });
  } catch (err) {
    logger.error({ err: err.message, workspaceId: req.workspaceId }, '[lumi/entities] campaigns failed');
    return res.status(500).json({ error: 'EntitiesUnavailable', message: 'Request failed' });
  }
});

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
