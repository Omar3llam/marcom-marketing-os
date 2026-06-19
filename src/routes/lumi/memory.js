// ============================================================
// MARCOM / Lumi — Memory Moat (per-account learning + gated network)
// GET  /api/lumi/briefing            — what Lumi has learned (JWT)
// POST /api/lumi/patterns/:id/promote — one-tap → GuardrailRule
// POST /api/lumi/network/consent     — opt in/out of the network
// GET  /api/lumi/network             — gated, anonymized cohort insights
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { getBriefing }     from '../../services/pattern-engine/PatternService.js';
import { promotePattern }  from '../../services/pattern-engine/PlaybookService.js';
import { setConsent, getNetworkInsights } from '../../services/network-engine/NetworkService.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE }     from '../../services/collaboration/roleScope.js';

export const memoryRouter = Router();

// Resolve workspaceId — mirrors lumi/feed.js + portfolio.js. Never
// fabricate a synthetic id (workspaceId columns are @db.Uuid).
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi/memory] workspaceId fallback failed');
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/briefing — account learnings (patterns + conflicts)
// ─────────────────────────────────────────────────────────────
memoryRouter.get('/briefing', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) {
    return res.json({ workspaceId: null, generatedAt: new Date().toISOString(), patterns: [], promotableCount: 0, conflicts: [], network: { status: 'NOT_CONSENTED' } });
  }
  try {
    const briefing = await getBriefing(wsId);
    const network  = await getNetworkInsights(wsId).catch(() => ({ status: 'NOT_CONSENTED' }));
    return res.json({ workspaceId: wsId, generatedAt: new Date().toISOString(), ...briefing, network });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/memory] briefing failed');
    return res.status(500).json({ error: 'BriefingUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/patterns/:id/promote — one-tap "make it a rule"
// Creates a GuardrailRule from a proven pattern; it then rides the
// existing Phase-2 sweep → confirm → execute governance. Rejects
// unproven / conflicted patterns (never ships a contradictory rule).
// ─────────────────────────────────────────────────────────────
memoryRouter.post('/patterns/:id/promote', requireCollabRole(WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  try {
    const { ruleId } = await promotePattern(wsId, req.params.id);
    logger.info({ wsId, patternId: req.params.id, ruleId }, '[lumi/memory] pattern promoted');
    return res.status(201).json({ workspaceId: wsId, ruleId });
  } catch (err) {
    // Governance rejections are client errors, not server faults.
    const governance = /ESTABLISHED|accuracy|CONFLICTED|SUPERSEDED|informational|spec|already|not found/i.test(err.message);
    if (governance) return res.status(409).json({ error: 'NotPromotable', message: err.message });
    logger.error({ err: err.message, wsId }, '[lumi/memory] promote failed');
    return res.status(500).json({ error: 'PromoteFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/network/consent — opt in/out + set cohort
// STRATEGIST-only: consenting to contribute this workspace's learned
// patterns into the shared cross-account pool is an outward-facing,
// not-cleanly-reversible governance decision (once aggregated, peers
// have already seen it) — it belongs to the account owner, not a CLIENT
// or BUYER seat. Mirrors the STRATEGIST gate on narratives/approvals.
// The k-anonymity-gated READ stays open to the war-room audience; it is
// the consent WRITE that is the cross-tenant boundary, so only it is gated.
// ─────────────────────────────────────────────────────────────
memoryRouter.post('/network/consent', requireCollabRole(WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  try {
    const result = await setConsent(wsId, { optIn: !!req.body?.optIn, cohortTag: req.body?.cohortTag });
    return res.json({ workspaceId: wsId, ...result });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/memory] consent failed');
    return res.status(500).json({ error: 'ConsentFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/network — gated, anonymized cohort insights
// ─────────────────────────────────────────────────────────────
memoryRouter.get('/network', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.json({ status: 'NOT_CONSENTED' });
  try {
    return res.json(await getNetworkInsights(wsId));
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/memory] network failed');
    return res.status(500).json({ error: 'NetworkUnavailable', message: 'Request failed' });
  }
});
