// ============================================================
// MARCOM / Lumi — Collaboration & Reporting OS (Phase 8)
//   GET  /api/lumi/roles/me            — resolved collab role + visibleStates
//   GET  /api/lumi/narratives          — list persisted stakeholder narratives
//   GET  /api/lumi/narratives/:id      — one narrative
//   POST /api/lumi/narratives/generate — author one (STRATEGIST)
//   GET  /api/lumi/approvals           — list approval requests
//   POST /api/lumi/approvals           — open an approval gate on a plan
//   POST /api/lumi/approvals/:id/decide — approve/reject (STRATEGIST)
//   POST /api/lumi/handoff             — hand a verdict/plan to another role
//   GET  /api/lumi/inbox               — role+severity routed inbox
//
// Reporting here is a REASONED NARRATIVE, never a chart dump. Roles gate the
// surface; approvals + handoffs all write the CollaborationEvent audit log.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { scopeFor } from '../../services/decisions/decisionClassScope.js';
import { logger } from '../../utils/logger.js';
import { requireCollabRole, resolveCollabRoleForDisplay, resolveCollabRoleContext } from '../../middleware/requireCollabRole.js';
import { requirePlan } from '../../middleware/requirePlan.js';
import { WORKSPACE_ROLE, visibleStates, normalizeRole } from '../../services/collaboration/roleScope.js';
import { generateNarrative, listNarratives, getNarrative } from '../../services/narrative-engine/NarrativeService.js';
import { NARRATIVE_PERIOD, NARRATIVE_AUDIENCE } from '../../services/narrative-engine/narrativeTypes.js';
import { requestApproval, decideApproval, handoff, listApprovals, APPROVAL_STATE } from '../../services/collaboration/ApprovalService.js';
import { inboxFor, readInboxSource } from '../../services/collaboration/InboxService.js';
import { ALERT_KIND, radarSeverity } from '../../services/collaboration/notificationRouter.js';
import { resolveActorId } from './actorId.js';

export const collaborationRouter = Router();

// ── Plan gate (GROWTH) ───────────────────────────────────────
// Approvals render on the Intelligence → Growth Strategy surface (GROWTH). The
// '/approvals' prefix covers list + open + /:id/decide. Narratives (read AND
// generate), inbox, roles/me, and handoff stay ungated — Reports/Leadership is
// a FREE surface end to end (every role + every plan reads the narrative).
collaborationRouter.use('/approvals', requirePlan('GROWTH'));

// Resolve workspaceId — mirrors lumi/measurement.js. Never fabricate a uuid.
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi/collaboration] workspaceId fallback failed');
    return null;
  }
}

async function need(req, res) {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) { res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' }); return null; }
  return wsId;
}

// ─────────────────────────────────────────────────────────────
// GET /roles/me — the client gates its FSM nav from this
//
// ── R-14.a (Phase 5.14) — THIS ENDPOINT REPORTS A SEAT ─────────────────────
// It used to answer `resolveCollabRoleForDisplay`, which maps every failure to
// DEFAULT_ROLE. So a database blip, or a row with no collabRole, was published
// as `{role:'STRATEGIST'}` with a 200, and the client — seeing a role it
// recognises — recorded a CONFIRMED seat and rendered the full operator
// surface. That is "unknown → permitted", and no amount of refusal copy can fix
// it, because the client was never told anything had failed.
//
// WHY THIS IS STILL A 200, and not a 503 or a 403:
//
//   · A 403 would be false. This endpoint has no gate — asking about your own
//     seat is never refused — and the client maps 403 to NOT_PERMITTED, which
//     would turn an outage into a refusal. That is the inversion R-14 exists to
//     prevent, pointed the other way.
//   · A 503 would couple two orthogonal axes. `userRole` (ADMIN | VIEWER) is
//     resolved by firebaseAuth and is independent of the collaboration role;
//     useUserRole reads it from THIS response to gate /admin. Failing the whole
//     response would take a genuine ADMIN's panel away because an unrelated
//     store was unavailable.
//   · The request succeeded. What could not be established is one FIELD of the
//     answer, and the body says so explicitly. This mirrors
//     GET /api/user/workspace, which answers 200 {workspace:null,
//     hasWorkspace:false} rather than erroring when there is nothing to report.
//
// The enforcement gate is unchanged and still fails closed: requireCollabRole
// answers 503 RoleUnavailable on an unresolvable role and 403 RoleForbidden on
// an unassigned one. This endpoint reports; that one enforces.
// ─────────────────────────────────────────────────────────────
collaborationRouter.get('/roles/me', async (req, res) => {
  const ctx = await resolveCollabRoleContext(req);
  const resolved = ctx.status === 'RESOLVED';
  return res.json({
    // null, never a guess. A client that only knows the old shape still reads
    // this correctly, because null is not a role it recognises.
    role: resolved ? ctx.role : null,
    // The explicit discriminator, so the client branches on a stated fact
    // rather than inferring one from a missing field.
    roleStatus: ctx.status,
    // WHY it could not be established: ROLE_UNSET (a Strategist must assign a
    // seat — a retry changes nothing) vs ROLE_LOOKUP_FAILED (a retry is honest).
    // Two reasons because they have two different next steps.
    roleReason: ctx.reason,
    // Withheld when the seat is unknown: visibleStates(null) resolves through
    // normalizeRole to the STRATEGIST list, which is the same leak one field
    // over.
    visibleStates: resolved ? visibleStates(ctx.role) : null,
    // userRole is the SYSTEM axis (ADMIN | VIEWER), orthogonal to the collab
    // role. The admin panel reads it to decide whether to surface the /admin
    // link+route. firebaseAuth sets req.userRole; default VIEWER so the field
    // is never null — and it stays truthful even when the collab seat does not.
    userRole: req.userRole ?? 'VIEWER',
  });
});

// ─────────────────────────────────────────────────────────────
// Narratives
// ─────────────────────────────────────────────────────────────
collaborationRouter.get('/narratives', async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  const audience = Object.values(NARRATIVE_AUDIENCE).includes(req.query.audience) ? req.query.audience : undefined;
  try {
    return res.json({ workspaceId: wsId, narratives: await listNarratives(wsId, { audience }) });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/collaboration] list narratives failed');
    return res.status(500).json({ error: 'NarrativesUnavailable', message: 'Request failed' });
  }
});

collaborationRouter.get('/narratives/:id', async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  try {
    const n = await getNarrative(wsId, req.params.id);
    if (!n) return res.status(404).json({ error: 'NarrativeNotFound' });
    return res.json({ workspaceId: wsId, narrative: n });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/collaboration] get narrative failed');
    return res.status(500).json({ error: 'NarrativesUnavailable', message: 'Request failed' });
  }
});

// Authoring a narrative is a strategist action.
collaborationRouter.post('/narratives/generate', requireCollabRole(WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  const b = req.body ?? {};
  const period = Object.values(NARRATIVE_PERIOD).includes(b.period) ? b.period : NARRATIVE_PERIOD.WEEKLY;
  const audience = Object.values(NARRATIVE_AUDIENCE).includes(b.audience) ? b.audience : NARRATIVE_AUDIENCE.LEADERSHIP;
  try {
    const actorId = await resolveActorId(req);
    if (!actorId) return res.status(409).json({ error: 'ActorUnresolved', message: 'Could not identify the authoring seat.' });
    const narrative = await generateNarrative(wsId, { period, audience, actorId });
    return res.status(201).json({ workspaceId: wsId, narrative });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/collaboration] generate narrative failed');
    return res.status(500).json({ error: 'NarrativeGenerationFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// Approvals
// ─────────────────────────────────────────────────────────────
collaborationRouter.get('/approvals', async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  const state = Object.values(APPROVAL_STATE).includes(req.query.state) ? req.query.state : undefined;
  try {
    return res.json({ workspaceId: wsId, approvals: await listApprovals(wsId, { state }) });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/collaboration] list approvals failed');
    return res.status(500).json({ error: 'ApprovalsUnavailable', message: 'Request failed' });
  }
});

// Opening an approval gate is a buyer/strategist workflow action (a CLIENT seat
// is read-only). The DECIDE step below stays STRATEGIST-only.
collaborationRouter.post('/approvals', requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  const b = req.body ?? {};
  if (!b.planId && !b.subjectId) return res.status(400).json({ error: 'BadApproval', message: 'planId or subjectId required.' });
  const requestedById = await resolveActorId(req);
  if (!requestedById) return res.status(409).json({ error: 'ActorUnresolved', message: 'Could not identify the requesting seat.' });
  try {
    const request = await requestApproval(wsId, { planId: b.planId, subjectType: b.subjectType, subjectId: b.subjectId, requestedById });
    return res.status(201).json({ workspaceId: wsId, request });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/collaboration] request approval failed');
    return res.status(500).json({ error: 'ApprovalRequestFailed', message: 'Request failed' });
  }
});

collaborationRouter.post('/approvals/:id/decide', requireCollabRole(WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  const b = req.body ?? {};
  if (b.decision !== APPROVAL_STATE.APPROVED && b.decision !== APPROVAL_STATE.REJECTED) {
    return res.status(400).json({ error: 'BadDecision', message: "decision must be 'APPROVED' or 'REJECTED'." });
  }
  const approverId = await resolveActorId(req);
  if (!approverId) return res.status(409).json({ error: 'ActorUnresolved', message: 'Could not identify the deciding seat.' });
  try {
    const updated = await decideApproval(wsId, { requestId: req.params.id, decision: b.decision, approverId, approverRole: req.collabRole, reason: b.reason });
    return res.status(201).json({ workspaceId: wsId, request: updated });
  } catch (err) {
    if (err.code === 'RoleForbidden') return res.status(403).json({ error: 'RoleForbidden', message: err.message });
    if (/not found/i.test(err.message)) return res.status(404).json({ error: 'ApprovalNotFound', message: err.message });
    if (/already/i.test(err.message)) return res.status(409).json({ error: 'AlreadyDecided', message: err.message });
    logger.error({ err: err.message, wsId }, '[lumi/collaboration] decide approval failed');
    return res.status(500).json({ error: 'ApprovalDecisionFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /handoff — strategist ⇄ buyer, audited
// ─────────────────────────────────────────────────────────────
collaborationRouter.post('/handoff', requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  const b = req.body ?? {};
  if (!b.subjectId) return res.status(400).json({ error: 'BadHandoff', message: 'subjectId required.' });
  const actorId = await resolveActorId(req);
  if (!actorId) return res.status(409).json({ error: 'ActorUnresolved', message: 'Could not identify the handing-off seat.' });
  try {
    // The gate above is the authority boundary. Keep accepting legacy payloads
    // that include fromRole, but never let caller-controlled data name the
    // actor's role or widen the transition it may perform.
    const event = await handoff(wsId, { subjectType: b.subjectType, subjectId: b.subjectId, fromRole: req.collabRole, toRole: b.toRole, actorId, note: b.note });
    return res.status(201).json({ workspaceId: wsId, event });
  } catch (err) {
    if (err.code === 'RoleForbidden') return res.status(403).json({ error: 'RoleForbidden', message: err.message });
    logger.error({ err: err.message, wsId }, '[lumi/collaboration] handoff failed');
    return res.status(500).json({ error: 'HandoffFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /inbox — role+severity routed (narrative + approvals + radar)
// ─────────────────────────────────────────────────────────────
collaborationRouter.get('/inbox', async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  const role = normalizeRole(req.collabRole ?? (await resolveCollabRoleForDisplay(req)));
  try {
    // Live alert stream: recent PROPOSED radar verdicts (no new table).
    const proposed = await readInboxSource('RADAR', () => prisma.decision.findMany({
      // C-10 — SIGNAL only. Every row here is published as ALERT_KIND.RADAR with
      // a severity derived from `confidence`; unscoped, a guardrail episode
      // (constant confidence 0.9) arrived as a HIGH-severity radar verdict, and
      // an allocation move arrived as one too.
      where: { workspaceId: wsId, status: 'PROPOSED', ...scopeFor('collaboration/inbox') },
      orderBy: { createdAt: 'desc' }, take: 20,
      select: { id: true, verdict: true, diagnosis: true, confidence: true },
    }));
    const alerts = proposed.map((d) => ({
      kind: ALERT_KIND.RADAR, id: d.id, verdict: d.verdict, headline: d.diagnosis,
      // C-16 — null when the confidence was never measured, rather than the
      // real-looking LOW that `null >= 0.6` would have produced silently.
      severity: radarSeverity(d.confidence),
    }));
    const inbox = await inboxFor(wsId, role, { alerts });
    return res.json({ workspaceId: wsId, ...inbox });
  } catch (err) {
    logger.error({ err: err.message, source: err.source ?? null, wsId }, '[lumi/collaboration] inbox failed');
    return res.status(500).json({ error: 'InboxUnavailable', message: 'Request failed' });
  }
});
