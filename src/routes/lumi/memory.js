// ============================================================
// MARCOM / Lumi — Memory Moat (per-account learning + gated network)
// GET  /api/lumi/briefing                        — what Lumi has learned (JWT)
// POST /api/lumi/patterns/:id/promotion-request  — propose that it become a rule
// POST /api/lumi/promotions/:requestId/decision  — grant or refuse the authority
// POST /api/lumi/guardrails/:ruleId/revoke       — take the authority back
// POST /api/lumi/network/consent                 — opt in/out of the network
// GET  /api/lumi/network                         — gated, anonymized cohort insights
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { readBriefing }    from '../../services/pattern-engine/PatternService.js';
import { requestPromotion, decidePromotion, revokePromotion, PROMOTION_STATE }
  from '../../services/pattern-engine/PromotionService.js';
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

// ═════════════════════════════════════════════════════════════
// C-05 · PROMOTION IS AN AUTHORIZATION
// ─────────────────────────────────────────────────────────────
// `POST /patterns/:id/promote` used to stand here: one call, one person,
// creating a rule that judges the account from then on. R-13 replaced it with a
// proposal and a decision, and R-14 gave it a way back. The old route is GONE
// rather than aliased — a surviving one-call path would be an ungated route to
// the same standing authority.
//
// All three are STRATEGIST-only. Withdrawing autonomy is the same tier of act
// as granting it; a seat that cannot grant must not be able to revoke either,
// or the guarantee runs one way only.
// ─────────────────────────────────────────────────────────────

/**
 * The actor as the AUDIT COLUMNS mean it: a `User.id` uuid.
 *
 * `req.userId` is the Firebase uid, and `ApprovalRequest.requestedById` /
 * `CollaborationEvent.actorId` are `@db.Uuid`. Writing the one into the other
 * does not produce a wrong name — it produces a failed insert, or a column that
 * cannot be joined back to a person. R-13 requires this trail to prove WHO, so
 * an unresolvable actor is a refusal, never a null in the actor column.
 */
async function resolveActorId(req) {
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { id: true } });
    return u?.id ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi/memory] actor resolution failed');
    return null;
  }
}

/** Typed service refusals → the status that describes them. Never a blanket 500. */
const PROMOTION_STATUS = Object.freeze({
  NotFound: 404, RoleForbidden: 403,
  NotPromotable: 409, AlreadyPending: 409, AlreadyDecided: 409,
  AlreadyRevoked: 409, BeliefDegraded: 409, ActorUnresolved: 409,
});

function sendPromotionError(res, err, wsId, where) {
  // The governance gate throws plain Errors from patternToGuardrailData; they
  // are client errors, not faults, exactly as the removed route treated them.
  const governance = /ESTABLISHED|accuracy|CONFLICTED|SUPERSEDED|informational|spec|already|not found/i.test(err.message);
  const code   = err.code ?? (governance ? 'NotPromotable' : null);
  const status = PROMOTION_STATUS[code];
  if (status) {
    return res.status(status).json({
      error: code, message: err.message,
      // A degraded belief carries BOTH readings to the caller. The person
      // deciding is owed the divergence, not just the refusal.
      ...(err.beliefAtRequest  ? { beliefAtRequest:  err.beliefAtRequest }  : {}),
      ...(err.beliefAtDecision ? { beliefAtDecision: err.beliefAtDecision } : {}),
    });
  }
  logger.error({ err: err.message, wsId }, `[lumi/memory] ${where} failed`);
  return res.status(500).json({ error: 'PromotionFailed', message: 'Request failed' });
}

// ── Propose ──────────────────────────────────────────────────
memoryRouter.post('/patterns/:id/promotion-request', requireCollabRole(WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  const requestedById = await resolveActorId(req);
  if (!requestedById) {
    return res.status(409).json({ error: 'ActorUnresolved', message: 'Could not identify the requesting seat.' });
  }
  try {
    const out = await requestPromotion(wsId, { patternId: req.params.id, requestedById });
    logger.info({ wsId, patternId: req.params.id, requestId: out.requestId }, '[lumi/memory] promotion requested');
    return res.status(201).json({ workspaceId: wsId, ...out });
  } catch (err) {
    return sendPromotionError(res, err, wsId, 'promotion request');
  }
});

// ── Decide ───────────────────────────────────────────────────
memoryRouter.post('/promotions/:requestId/decision', requireCollabRole(WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const decision = req.body?.decision;
  if (decision !== PROMOTION_STATE.APPROVED && decision !== PROMOTION_STATE.REJECTED) {
    return res.status(400).json({ error: 'BadDecision', message: "decision must be 'APPROVED' or 'REJECTED'." });
  }
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  const approverId = await resolveActorId(req);
  if (!approverId) {
    return res.status(409).json({ error: 'ActorUnresolved', message: 'Could not identify the deciding seat.' });
  }
  try {
    const out = await decidePromotion(wsId, {
      requestId: req.params.requestId, decision, approverId, approverRole: req.collabRole,
    });
    logger.info({ wsId, requestId: req.params.requestId, decision, ruleId: out.ruleId },
      '[lumi/memory] promotion decided');
    return res.json({ workspaceId: wsId, ...out });
  } catch (err) {
    return sendPromotionError(res, err, wsId, 'promotion decision');
  }
});

// ── Revoke ───────────────────────────────────────────────────
memoryRouter.post('/guardrails/:ruleId/revoke', requireCollabRole(WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  const actorId = await resolveActorId(req);
  if (!actorId) {
    return res.status(409).json({ error: 'ActorUnresolved', message: 'Could not identify the revoking seat.' });
  }
  try {
    const out = await revokePromotion(wsId, { ruleId: req.params.ruleId, actorId });
    logger.info({ wsId, ...out }, '[lumi/memory] autonomy revoked');
    return res.json({ workspaceId: wsId, ...out });
  } catch (err) {
    return sendPromotionError(res, err, wsId, 'revocation');
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
