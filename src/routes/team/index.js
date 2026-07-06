// ============================================================
// MARCOM / Lumi — Team & Roles
//   GET    /api/team/members            — members + pending invites (any member)
//   POST   /api/team/invite             — invite by email           (STRATEGIST)
//   PUT    /api/team/:userId/role       — change a member's role     (STRATEGIST)
//   DELETE /api/team/:userId            — remove a member            (STRATEGIST)
//   DELETE /api/team/invitations/:id    — cancel a pending invite    (STRATEGIST)
//   GET    /api/team/invite/accept      — email link → /signup       (PUBLIC)
//
// The actual JOIN is NOT here — it happens in the firebaseAuth auto-provision
// seam, email-matched on first sign-in. These routes manage the roster + invites.
// Every query is workspace-scoped (workspaceId: req.workspaceId). Self-identity
// is `clerkId === req.userId` (req.userId is the Firebase uid, never User.id).
// ============================================================
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { requireAuth } from '../../middleware/firebaseAuth.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { validate, teamInviteSchema } from '../../middleware/validate.js';
import { sendInviteEmail } from '../../utils/email.js';

export const teamRouter = Router();

const VALID_ROLES = ['STRATEGIST', 'BUYER', 'CLIENT'];
const INVITE_TTL_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function appBaseUrl() {
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/** Count members whose EFFECTIVE role is STRATEGIST (collabRole null ⇒ STRATEGIST). */
function countEffectiveStrategists(workspaceId, where = {}) {
  return prisma.user.count({
    where: { workspaceId, OR: [{ collabRole: 'STRATEGIST' }, { collabRole: null }], ...where },
  });
}

// ─────────────────────────────────────────────────────────────
// PUBLIC — the link the invited user clicks in their email.
// Validates the token, then hands off to the signup form. The JOIN itself is
// email-matched in the firebaseAuth seam on first login, so the token is just a
// validate-and-prefill handle here.
// ─────────────────────────────────────────────────────────────
teamRouter.get('/invite/accept', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'MissingToken', message: 'No invitation token provided.' });
  }
  try {
    const invite = await prisma.invitation.findUnique({
      where: { token },
      select: { email: true, status: true, expiresAt: true },
    });
    if (!invite) return res.status(404).json({ error: 'InvalidInvite', message: 'This invitation link is not valid.' });
    if (invite.status !== 'PENDING' || invite.expiresAt <= new Date()) {
      return res.status(410).json({ error: 'InviteExpired', message: 'This invitation has expired or was already used.' });
    }
    const url = `${appBaseUrl()}/signup?inviteToken=${encodeURIComponent(token)}&email=${encodeURIComponent(invite.email)}`;
    return res.redirect(302, url);
  } catch (err) {
    logger.error({ err: err.message }, '[team] invite accept failed');
    return res.status(500).json({ error: 'InternalError', message: 'Could not process this invitation.' });
  }
});

// Everything below requires authentication.
teamRouter.use(requireAuth);

function noWorkspace(res) {
  return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
}

// ─────────────────────────────────────────────────────────────
// GET /members — roster + pending invitations for the caller's workspace.
// ─────────────────────────────────────────────────────────────
teamRouter.get('/members', async (req, res) => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) return noWorkspace(res);
  try {
    const [users, invitations] = await Promise.all([
      prisma.user.findMany({
        where: { workspaceId },
        select: { id: true, email: true, collabRole: true, createdAt: true, clerkId: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.invitation.findMany({
        where: { workspaceId, status: 'PENDING', expiresAt: { gt: new Date() } },
        select: { id: true, email: true, collabRole: true, expiresAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const members = users.map((u) => ({
      id: u.id,
      email: u.email,
      // null collabRole presents as STRATEGIST (the product-wide default).
      collabRole: u.collabRole ?? 'STRATEGIST',
      joinedAt: u.createdAt,
      isSelf: u.clerkId === req.userId, // clerkId never leaves the server
    }));

    return res.json({
      members,
      pendingInvitations: invitations.map((i) => ({
        id: i.id, email: i.email, collabRole: i.collabRole, expiresAt: i.expiresAt,
      })),
    });
  } catch (err) {
    logger.error({ err: err.message, workspaceId }, '[team] members list failed');
    return res.status(500).json({ error: 'InternalError', message: 'Could not load team members.' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /invite — STRATEGIST only.  body: { email, collabRole }
// ─────────────────────────────────────────────────────────────
teamRouter.post('/invite', requireCollabRole('STRATEGIST'), validate(teamInviteSchema), async (req, res) => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) return noWorkspace(res);

  const email = String(req.body?.email || '').trim().toLowerCase();
  const collabRole = req.body?.collabRole || 'BUYER';

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'InvalidEmail', message: 'Enter a valid email address.' });
  }
  if (!VALID_ROLES.includes(collabRole)) {
    return res.status(400).json({ error: 'InvalidRole', message: `Role must be one of: ${VALID_ROLES.join(', ')}.` });
  }

  try {
    // Already a member of THIS workspace?
    const existingMember = await prisma.user.findFirst({ where: { workspaceId, email }, select: { id: true } });
    if (existingMember) {
      return res.status(409).json({ error: 'AlreadyMember', message: 'That person is already a member of this workspace.' });
    }

    // Existing invite row for (workspace, email)? Revive a stale one; block a live one.
    const existing = await prisma.invitation.findUnique({
      where: { workspaceId_email: { workspaceId, email } },
      select: { id: true, status: true, expiresAt: true },
    });
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    let invitation;
    if (existing && existing.status === 'PENDING' && existing.expiresAt > new Date()) {
      return res.status(409).json({ error: 'InviteExists', message: 'An invitation is already pending for that email.' });
    } else if (existing) {
      invitation = await prisma.invitation.update({
        where: { id: existing.id },
        data: { collabRole, status: 'PENDING', token: randomUUID(), expiresAt },
        select: { id: true, email: true, collabRole: true, token: true, expiresAt: true },
      });
    } else {
      invitation = await prisma.invitation.create({
        data: { workspaceId, email, collabRole, expiresAt },
        select: { id: true, email: true, collabRole: true, token: true, expiresAt: true },
      });
    }

    // Best-effort email — the invite already works (join is email-matched in the
    // seam), so a mail failure must not fail the request. Report whether it sent.
    let emailSent = false;
    try {
      const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
      const result = await sendInviteEmail({
        to: email,
        workspaceName: ws?.name || 'your workspace',
        inviterName: req.user?.name || req.user?.email || 'A teammate',
        role: collabRole,
        acceptUrl: `${appBaseUrl()}/api/team/invite/accept?token=${encodeURIComponent(invitation.token)}`,
        expiresInDays: INVITE_TTL_DAYS,
      });
      emailSent = !!result?.sent;
    } catch (mailErr) {
      logger.warn({ err: mailErr.message, workspaceId }, '[team] invite email send failed (invite still valid)');
    }

    return res.status(201).json({
      invitation: { id: invitation.id, email: invitation.email, collabRole: invitation.collabRole, expiresAt: invitation.expiresAt },
      emailSent,
    });
  } catch (err) {
    logger.error({ err: err.message, workspaceId }, '[team] invite failed');
    return res.status(500).json({ error: 'InternalError', message: 'Could not send the invitation.' });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /:userId/role — STRATEGIST only.  body: { collabRole }
// ─────────────────────────────────────────────────────────────
teamRouter.put('/:userId/role', requireCollabRole('STRATEGIST'), async (req, res) => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) return noWorkspace(res);
  const { userId } = req.params;
  const collabRole = req.body?.collabRole;

  if (!VALID_ROLES.includes(collabRole)) {
    return res.status(400).json({ error: 'InvalidRole', message: `Role must be one of: ${VALID_ROLES.join(', ')}.` });
  }
  try {
    const target = await prisma.user.findFirst({
      where: { id: userId, workspaceId },
      select: { id: true, clerkId: true, collabRole: true },
    });
    if (!target) return res.status(404).json({ error: 'NotFound', message: 'That member is not in this workspace.' });
    if (target.clerkId === req.userId) {
      return res.status(400).json({ error: 'CannotChangeSelf', message: 'You cannot change your own role.' });
    }

    // Don't strand the workspace: refuse to demote the last effective STRATEGIST.
    const targetIsStrategist = (target.collabRole ?? 'STRATEGIST') === 'STRATEGIST';
    if (targetIsStrategist && collabRole !== 'STRATEGIST') {
      const remaining = await countEffectiveStrategists(workspaceId, { id: { not: userId } });
      if (remaining === 0) {
        return res.status(400).json({ error: 'LastStrategist', message: 'Cannot demote the last Strategist in the workspace.' });
      }
    }

    await prisma.user.update({ where: { id: userId }, data: { collabRole } });
    return res.json({ userId, collabRole });
  } catch (err) {
    logger.error({ err: err.message, workspaceId, userId }, '[team] role change failed');
    return res.status(500).json({ error: 'InternalError', message: 'Could not change the role.' });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /invitations/:id — STRATEGIST only. Cancel a pending invite.
// (Declared before /:userId so the two-segment path matches first.)
// ─────────────────────────────────────────────────────────────
teamRouter.delete('/invitations/:id', requireCollabRole('STRATEGIST'), async (req, res) => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) return noWorkspace(res);
  const { id } = req.params;
  try {
    const invite = await prisma.invitation.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!invite) return res.status(404).json({ error: 'NotFound', message: 'Invitation not found in this workspace.' });
    await prisma.invitation.delete({ where: { id } });
    return res.json({ cancelled: true });
  } catch (err) {
    logger.error({ err: err.message, workspaceId, id }, '[team] cancel invite failed');
    return res.status(500).json({ error: 'InternalError', message: 'Could not cancel the invitation.' });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /:userId — STRATEGIST only. Remove a member.
// ─────────────────────────────────────────────────────────────
teamRouter.delete('/:userId', requireCollabRole('STRATEGIST'), async (req, res) => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) return noWorkspace(res);
  const { userId } = req.params;
  try {
    const target = await prisma.user.findFirst({
      where: { id: userId, workspaceId },
      select: { id: true, clerkId: true, collabRole: true },
    });
    if (!target) return res.status(404).json({ error: 'NotFound', message: 'That member is not in this workspace.' });
    if (target.clerkId === req.userId) {
      return res.status(400).json({ error: 'CannotRemoveSelf', message: 'You cannot remove yourself.' });
    }

    const targetIsStrategist = (target.collabRole ?? 'STRATEGIST') === 'STRATEGIST';
    if (targetIsStrategist) {
      const remaining = await countEffectiveStrategists(workspaceId, { id: { not: userId } });
      if (remaining === 0) {
        return res.status(400).json({ error: 'LastStrategist', message: 'Cannot remove the last Strategist in the workspace.' });
      }
    }

    await prisma.user.delete({ where: { id: userId } });
    return res.json({ removed: true });
  } catch (err) {
    logger.error({ err: err.message, workspaceId, userId }, '[team] remove member failed');
    return res.status(500).json({ error: 'InternalError', message: 'Could not remove the member.' });
  }
});
