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
import { readBriefing }    from '../../services/pattern-engine/PatternService.js';
import { promotePattern }  from '../../services/pattern-engine/PlaybookService.js';
import { setConsent, getNetworkInsights } from '../../services/network-engine/NetworkService.js';
import { NETWORK_STATUS }  from '../../services/network-engine/networkTypes.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { requirePlan }        from '../../middleware/requirePlan.js';
import { WORKSPACE_ROLE }     from '../../services/collaboration/roleScope.js';

export const memoryRouter = Router();

// ── Plan gate (GROWTH) ───────────────────────────────────────
// The account briefing (Memory Moat) renders on the Intelligence → Growth
// Strategy surface (GROWTH). The /patterns + /network routes stay ungated
// (strategist-only network governance, not a plan surface).
memoryRouter.use('/briefing', requirePlan('GROWTH'));

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
  // R10 (F-audit) — an unresolvable workspace is a 409, not a 200 with an empty
  // briefing. The old shape answered "this account has learned nothing" to a
  // request we could not even attribute to an account, and an empty patterns
  // array is indistinguishable from a real one.
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

  try {
    // R10 (Phase C) — READS the persisted learnings. It no longer runs the
    // extraction: that is the scheduled sweep's job, so a workspace learns
    // whether or not anyone opens this page, and a page view no longer triggers
    // a 365-day read and a multi-table write inside a GET.
    const briefing = await readBriefing(wsId);

    // R10 (F4) — a failed network read is an ERROR, not a consent state. This
    // was `.catch(() => ({ status: 'NOT_CONSENTED' }))`, which told a user who
    // HAD opted in that they had not, because the database blipped. Governance
    // facts must come from the governance columns or not at all.
    const network = await getNetworkInsights(wsId).catch((err) => {
      logger.error({ err: err.message, wsId }, '[lumi/memory] network read failed inside briefing');
      return { status: NETWORK_STATUS.UNAVAILABLE };
    });

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
// POST /api/lumi/network/consent — opt in/out (cohort is server-assigned)
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
  // R11 (F12 · RU-5): cohort membership is server-assigned. A caller-supplied
  // cohortTag is REFUSED rather than ignored — an ignored parameter looks
  // identical to an accepted one from the outside, so silently dropping it
  // would leave every client believing it still chose its own cohort.
  if (req.body?.cohortTag !== undefined) {
    return res.status(400).json({
      error: 'CohortNotSettable',
      message: 'Cohort membership is assigned by the server and cannot be set by the caller.',
    });
  }
  try {
    const result = await setConsent(wsId, { optIn: !!req.body?.optIn });
    return res.json({ workspaceId: wsId, ...result });
  } catch (err) {
    // No cohort can be established for this workspace — a refusal, not a fault.
    if (err.code === 'COHORT_UNAVAILABLE') {
      return res.status(409).json({
        error: 'CohortUnavailable',
        message: 'This workspace has no cohort yet. Connect an ad account first.',
      });
    }
    logger.error({ err: err.message, wsId }, '[lumi/memory] consent failed');
    return res.status(500).json({ error: 'ConsentFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/network — gated, anonymized cohort insights
// ─────────────────────────────────────────────────────────────
memoryRouter.get('/network', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  // R10 (F4) — same correction as /briefing: "we could not resolve your
  // workspace" is not "you have not opted in".
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  try {
    return res.json(await getNetworkInsights(wsId));
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/memory] network failed');
    return res.status(500).json({ error: 'NetworkUnavailable', message: 'Request failed' });
  }
});
