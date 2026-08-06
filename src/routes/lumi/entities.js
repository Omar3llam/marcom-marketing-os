// ============================================================
// MARCOM / Lumi — Entity-graph surface (connector campaigns + ad-set drill-down)
// GET /api/lumi/entities/campaigns          → connector-synced campaigns
// GET /api/lumi/entities/:campaignId/adsets → that campaign's ad-sets
// GET /api/lumi/entities/:adSetId/ads       → that ad-set's ads (creative level)
// GET /api/lumi/entities/:adSetId/evidence  → those ads ranked against the ad-set
// ------------------------------------------------------------
// The Campaigns table renders the legacy CampaignState feed; this sibling
// surface exposes the DISJOINT connector entity graph (the only substrate that
// carries ad-set detail) so connector campaigns become drillable. Thin
// handlers — all graph logic lives in EntityGraphService (PR#15+ rule).
// req.workspaceId is resolved by the auth middleware; null → honest empty.
// ============================================================
import { Router } from 'express';
import { getConnectorCampaigns, getCampaignAdSets, getAdSetAds } from '../../services/entity-graph/index.js';
import { getConnectorVerdicts, needsRevenueData, analyzeEvidence, isRankable } from '../../services/verdict-engine/index.js';
import { ENTITY_LEVEL } from '../../services/connectors/connectorTypes.js';
import { computeAccountHealth } from '../../services/analysis/AccountHealthService.js';
import { computeFatigueForecast } from '../../services/analysis/FatigueForecastService.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

export const entitiesRouter = Router();

// A persisted reasoning row older than this reads as "stale" (signals may have
// drifted since it was generated). Env-tunable; matches the sweep refresh window.
const REASONING_STALE_MS = Number(process.env.REASONING_STALE_MS ?? 24 * 60 * 60 * 1000);

// `needsRevenue` is decorated here (not in the pure entityGraphEngine projection,
// which stays dependency-free): a CONVERSION campaign that spent real money and
// measured no revenue — its ROAS can't be scored until revenue data lands. Fully
// deterministic (real rows, no LLM), so the UI can invite an upload honestly
// instead of showing a fabricated 0.00x.
entitiesRouter.get('/entities/campaigns', async (req, res) => {
  try {
    const rows = await getConnectorCampaigns(req.workspaceId);
    const campaigns = rows.map((c) => ({ ...c, needsRevenue: needsRevenueData(c) }));
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

    // Carry the same deterministic needsRevenue flag onto the health rows the
    // Overview renders, so "needs revenue" reads identically on both surfaces
    // (one source of truth — computed from the raw rows, never the health score).
    // revenueStale rides along on the same terms: the engine already decided it
    // (entityGraphEngine's age bound), so the Overview and the Campaigns table
    // can never disagree about whose revenue went stale.
    const needsRevenueIds = new Set(campaigns.filter(needsRevenueData).map((c) => c.entityId));
    const staleRevenueIds = new Set(campaigns.filter((c) => c.revenueStale).map((c) => c.entityId));
    const decorated = (health.campaigns ?? []).map((c) => ({
      ...c,
      needsRevenue: needsRevenueIds.has(c.entityId),
      revenueStale: staleRevenueIds.has(c.entityId),
    }));

    return res.json({
      workspaceId: req.workspaceId ?? null,
      generatedAt: new Date().toISOString(),
      ...health,
      campaigns: decorated,
    });
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

// Per-campaign fatigue forecast: when each campaign's audience is projected to
// saturate (frequency → ceiling), NAMED. Reuses the least-squares forecaster over
// the connector substrate; persists nothing. Gated to the operating roles
// (mirrors /entities/health) — a CLIENT never sees the efficiency layer, and the
// Growth Strategy page that renders this is itself STRATEGIST/BUYER-only. No
// connector data / no rising frequency → honest empty array (never a fabricated
// breach).
entitiesRouter.get('/entities/fatigue', requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  try {
    const campaigns = await getConnectorCampaigns(req.workspaceId);
    const forecast = await computeFatigueForecast(req.workspaceId, campaigns);
    return res.json({ workspaceId: req.workspaceId ?? null, generatedAt: new Date().toISOString(), forecast });
  } catch (err) {
    logger.error({ err: err.message, workspaceId: req.workspaceId }, '[lumi/entities] fatigue failed');
    return res.status(500).json({ error: 'FatigueUnavailable', message: 'Request failed' });
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

// One level below the ad-sets route: the ads of an ad-set, with their latest AD
// snapshots and creative age. Gated to the operating roles like /health and
// /fatigue — ad-level detail IS the efficiency critique, and a CLIENT never sees
// it. Generic `{ entity, children }` envelope: this route says nothing about
// WHICH level it returned, so the next level down (creatives) can reuse the
// shape without minting a third response contract.
//
// `entity` is the ad-set's REAL row (it was an `{ id }` stub until the service
// started reading the parent). `objective` rides alongside because it belongs to
// the campaign, not to either row in the envelope.
entitiesRouter.get(
  '/entities/:adSetId/ads',
  requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST),
  async (req, res) => {
    try {
      const result = await getAdSetAds(req.workspaceId, req.params.adSetId);
      // null = ad-set not in this workspace → honest 404 (not a fake empty drill-down).
      if (result === null) {
        return res.status(404).json({ error: 'AdSetNotFound', message: 'No such ad set in this workspace' });
      }
      return res.json({
        entity: result.entity,
        objective: result.objective,
        generatedAt: new Date().toISOString(),
        children: result.children,
      });
    } catch (err) {
      logger.error({ err: err.message, workspaceId: req.workspaceId, adSetId: req.params.adSetId }, '[lumi/entities] ads failed');
      return res.status(500).json({ error: 'AdsUnavailable', message: 'Request failed' });
    }
  },
);

// ------------------------------------------------------------
// Ad-level evidence — analyzeEvidence()'s first production caller.
// ------------------------------------------------------------
// The engine ranks the ads of one ad-set against the AD-SET's own measured row
// and grades each gap. Everything it needs now comes off a single service read:
// baseline (entity), cohort (children), and the bar-selecting objective.
//
// WHY THERE IS NO FALLBACK: analyzeEvidence returns null when the data cannot
// support a ranking, and that null is a real answer. Quietly substituting a
// looser heuristic would put a "worst ad" on screen for an ad-set that has not
// earned one. So a null becomes an explicit reasonKey the client can render as a
// sentence — visibly less coverage than a guess, and true.

// Ranking metrics we expose. A deliberate whitelist rather than
// Object.keys(METRIC_THRESHOLDS): adding a threshold to the engine should not
// silently widen a public API surface. An unlisted metric would fall through to
// DEFAULT_THRESHOLD inside the engine and be ranked with a CTR-shaped floor.
export const VALID_EVIDENCE_METRICS = Object.freeze(['ctr', 'roas', 'frequency']);

// Reason keys, not prose: the client owns the wording (and its localisation).
// Each names WHICH input was missing, because "not enough data" pointed at the
// wrong half of the problem is worse than silence — an operator told their ads
// are too thin will go add ads when the real gap was an unsynced parent.
const EVIDENCE_REASON = Object.freeze({
  INVALID_METRIC:             'INVALID_METRIC',
  BASELINE_UNAVAILABLE:       'BASELINE_UNAVAILABLE',
  INSUFFICIENT_REPORTING_ADS: 'INSUFFICIENT_REPORTING_ADS',
  NO_MEANINGFUL_GAP:          'NO_MEANINGFUL_GAP',
});

entitiesRouter.get(
  '/entities/:adSetId/evidence',
  requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST),
  async (req, res) => {
    try {
      // A repeated query param arrives as an array, which fails the whitelist —
      // so `?metric=ctr&metric=roas` is rejected rather than coerced.
      const metric = req.query.metric ?? 'ctr';
      if (!VALID_EVIDENCE_METRICS.includes(metric)) {
        // 4xx shape, not the insufficient-data shape: the request was wrong, and
        // flagging `insufficientData` here would blame the account for a typo.
        return res.status(400).json({
          error: 'InvalidMetric',
          message: 'Unsupported ranking metric',
          reasonKey: EVIDENCE_REASON.INVALID_METRIC,
          allowed: VALID_EVIDENCE_METRICS,
        });
      }

      const result = await getAdSetAds(req.workspaceId, req.params.adSetId);
      if (result === null) {
        return res.status(404).json({ error: 'AdSetNotFound', message: 'No such ad set in this workspace' });
      }

      const { entity, objective, children } = result;
      const base = { entity, objective, metric, generatedAt: new Date().toISOString() };
      const refuse = (reasonKey) => res.json({ ...base, evidence: null, insufficientData: true, reasonKey });

      // The engine's three null causes, distinguished HERE because it cannot
      // report which one it hit. Order matters: a missing baseline is checked
      // first, since with nothing to divide by the children were never the issue.

      // 1. No parent figure to rank against. Reads the SAME metric being ranked
      //    — hard-coding `entity.ctr` would let a roas request fall through and
      //    be reported as thin children.
      if (!(entity?.[metric] > 0)) return refuse(EVIDENCE_REASON.BASELINE_UNAVAILABLE);

      // 2. Fewer than two ads delivering enough to compare. isRankable is the
      //    engine's own predicate, imported rather than re-typed.
      if (children.filter((c) => isRankable(c, metric)).length < 2) {
        return refuse(EVIDENCE_REASON.INSUFFICIENT_REPORTING_ADS);
      }

      const evidence = analyzeEvidence({
        dimension: ENTITY_LEVEL.AD,
        entities:  children,
        baseline:  entity,
        // null → getBenchmarks(null) → the DEFAULT band. Documented degradation,
        // not a failure: an unknown objective gets the general bar, never silence.
        objective,
        metric,
        // The engine takes `now` so it stays clock-free; a route is where a real
        // clock belongs. Milliseconds, matching its Date.now() default.
        now: Date.now(),
      });

      // Only one cause is left once 1 and 2 are excluded: every gap fell inside
      // the metric's floor. Ordinary variance between creatives is not a finding.
      if (evidence === null) return refuse(EVIDENCE_REASON.NO_MEANINGFUL_GAP);

      return res.json({ ...base, evidence, insufficientData: false, reasonKey: null });
    } catch (err) {
      logger.error({ err: err.message, workspaceId: req.workspaceId, adSetId: req.params.adSetId }, '[lumi/entities] evidence failed');
      return res.status(500).json({ error: 'EvidenceUnavailable', message: 'Request failed' });
    }
  },
);
