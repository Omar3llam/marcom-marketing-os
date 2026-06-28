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
import { logger } from '../../utils/logger.js';
import { requireCollabRole, resolveCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE, visibleStates, normalizeRole } from '../../services/collaboration/roleScope.js';
import { generateNarrative, listNarratives, getNarrative } from '../../services/narrative-engine/NarrativeService.js';
import { NARRATIVE_PERIOD, NARRATIVE_AUDIENCE } from '../../services/narrative-engine/narrativeTypes.js';
import { requestApproval, decideApproval, handoff, listApprovals, APPROVAL_STATE } from '../../services/collaboration/ApprovalService.js';
import { inboxFor } from '../../services/collaboration/InboxService.js';
import { ALERT_KIND } from '../../services/collaboration/notificationRouter.js';

export const collaborationRouter = Router();

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
// ─────────────────────────────────────────────────────────────
collaborationRouter.get('/roles/me', async (req, res) => {
  const role = await resolveCollabRole(req);
  // userRole is the SYSTEM axis (ADMIN | VIEWER), orthogonal to the collab role.
  // The admin panel reads it to decide whether to surface the /admin link+route.
  // firebaseAuth sets req.userRole; default VIEWER so the field is never null.
  return res.json({ role, visibleStates: visibleStates(role), userRole: req.userRole ?? 'VIEWER' });
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
    const narrative = await generateNarrative(wsId, { period, audience, actorId: req.userId ?? null });
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
  try {
    const request = await requestApproval(wsId, { planId: b.planId, subjectType: b.subjectType, subjectId: b.subjectId, requestedById: req.userId ?? null });
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
  try {
    const updated = await decideApproval(wsId, { requestId: req.params.id, decision: b.decision, approverId: req.userId ?? null, approverRole: req.collabRole, reason: b.reason });
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
  const fromRole = b.fromRole ?? req.collabRole;
  try {
    const event = await handoff(wsId, { subjectType: b.subjectType, subjectId: b.subjectId, fromRole, toRole: b.toRole, actorId: req.userId ?? null, note: b.note });
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
  const role = normalizeRole(req.collabRole ?? (await resolveCollabRole(req)));
  try {
    // Live alert stream: recent PROPOSED radar verdicts (no new table).
    const proposed = await prisma.decision.findMany({
      where: { workspaceId: wsId, status: 'PROPOSED' },
      orderBy: { createdAt: 'desc' }, take: 20,
      select: { id: true, verdict: true, diagnosis: true, confidence: true },
    }).catch(() => []);
    const alerts = proposed.map((d) => ({
      kind: ALERT_KIND.RADAR, id: d.id, verdict: d.verdict, headline: d.diagnosis,
      severity: d.confidence >= 0.85 ? 'HIGH' : d.confidence >= 0.6 ? 'MEDIUM' : 'LOW',
    }));
    const inbox = await inboxFor(wsId, role, { alerts });
    return res.json({ workspaceId: wsId, ...inbox });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/collaboration] inbox failed');
    return res.status(500).json({ error: 'InboxUnavailable', message: 'Request failed' });
  }
});
