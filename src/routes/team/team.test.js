// ============================================================
// Team & Roles — route behaviour + STRATEGIST gate + safety guards
// ------------------------------------------------------------
// Supertest against the assembled teamRouter with a fake auth middleware that
// injects req.user/req.userId/req.collabRole/req.workspaceId (mirrors
// admin.test.js). prisma + email + firebaseAdmin are mocked, so nothing touches
// a real DB or sends real mail. requireCollabRole runs for real off req.collabRole.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user:       { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn(), delete: vi.fn() },
    invitation: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    workspace:  { findUnique: vi.fn() },
  },
}));

vi.mock('../../utils/email.js', () => ({ sendInviteEmail: vi.fn().mockResolvedValue({ sent: true }) }));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../utils/firebaseAdmin.js', () => ({
  default: { auth: () => ({ verifyIdToken: vi.fn() }) },
  getFirebaseAdminReadiness: () => ({ ok: true }),
}));

import { prisma } from '../../lib/prisma.js';
import { sendInviteEmail } from '../../utils/email.js';
import { teamRouter } from './index.js';

const SELF_UID = 'fb-self';

function makeApp({ role = 'STRATEGIST', workspaceId = 'ws-1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: SELF_UID, email: 'self@ws.com', name: 'Self' };
    req.userId = SELF_UID;
    req.collabRole = role;
    req.workspaceId = workspaceId;
    next();
  });
  app.use('/api/team', teamRouter);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('GET /members', () => {
  it('returns the roster (isSelf computed) + pending invites, never leaking clerkId', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u-self', email: 'self@ws.com', collabRole: null,        createdAt: new Date(), clerkId: SELF_UID },
      { id: 'u-b',    email: 'buyer@ws.com', collabRole: 'BUYER',    createdAt: new Date(), clerkId: 'fb-b' },
    ]);
    prisma.invitation.findMany.mockResolvedValue([
      { id: 'inv-1', email: 'pending@ws.com', collabRole: 'CLIENT', expiresAt: new Date() },
    ]);

    const res = await request(makeApp()).get('/api/team/members');

    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(2);
    expect(res.body.members[0]).toMatchObject({ id: 'u-self', collabRole: 'STRATEGIST', isSelf: true }); // null ⇒ STRATEGIST
    expect(res.body.members[1]).toMatchObject({ collabRole: 'BUYER', isSelf: false });
    expect(JSON.stringify(res.body)).not.toContain('clerkId');
    expect(res.body.pendingInvitations[0]).toMatchObject({ email: 'pending@ws.com', collabRole: 'CLIENT' });
  });
});

describe('POST /invite', () => {
  it('403s a non-STRATEGIST', async () => {
    const res = await request(makeApp({ role: 'BUYER' })).post('/api/team/invite').send({ email: 'x@y.com', collabRole: 'BUYER' });
    expect(res.status).toBe(403);
    expect(prisma.invitation.create).not.toHaveBeenCalled();
  });

  it('400s an invalid email', async () => {
    const res = await request(makeApp()).post('/api/team/invite').send({ email: 'not-an-email', collabRole: 'BUYER' });
    expect(res.status).toBe(400);
  });

  it('400s an invalid role', async () => {
    const res = await request(makeApp()).post('/api/team/invite').send({ email: 'x@y.com', collabRole: 'OWNER' });
    expect(res.status).toBe(400);
  });

  it('409s when the email is already a member', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-x' });
    const res = await request(makeApp()).post('/api/team/invite').send({ email: 'x@y.com', collabRole: 'BUYER' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('AlreadyMember');
  });

  it('409s when a live invite already exists', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.invitation.findUnique.mockResolvedValue({ id: 'inv', status: 'PENDING', expiresAt: new Date(Date.now() + 1e6) });
    const res = await request(makeApp()).post('/api/team/invite').send({ email: 'x@y.com', collabRole: 'BUYER' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('InviteExists');
  });

  it('creates an invite, sends the email, and lowercases the address', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.invitation.findUnique.mockResolvedValue(null);
    prisma.invitation.create.mockResolvedValue({ id: 'inv-9', email: 'new@ws.com', collabRole: 'BUYER', token: 'tok-9', expiresAt: new Date() });
    prisma.workspace.findUnique.mockResolvedValue({ name: 'Acme' });

    const res = await request(makeApp()).post('/api/team/invite').send({ email: 'NEW@WS.com', collabRole: 'BUYER' });

    expect(res.status).toBe(201);
    expect(prisma.invitation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: 'new@ws.com', collabRole: 'BUYER', workspaceId: 'ws-1' }) }));
    expect(sendInviteEmail).toHaveBeenCalledTimes(1);
    expect(res.body.emailSent).toBe(true);
  });

  it('still 201s when the invite email fails (invite stays valid)', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.invitation.findUnique.mockResolvedValue(null);
    prisma.invitation.create.mockResolvedValue({ id: 'inv-9', email: 'new@ws.com', collabRole: 'BUYER', token: 'tok-9', expiresAt: new Date() });
    prisma.workspace.findUnique.mockResolvedValue({ name: 'Acme' });
    sendInviteEmail.mockRejectedValueOnce(new Error('smtp down'));

    const res = await request(makeApp()).post('/api/team/invite').send({ email: 'new@ws.com', collabRole: 'BUYER' });
    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);
  });
});

describe('PUT /:userId/role', () => {
  it('400s changing your own role', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-self', clerkId: SELF_UID, collabRole: null });
    const res = await request(makeApp()).put('/api/team/u-self/role').send({ collabRole: 'BUYER' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CannotChangeSelf');
  });

  it('404s a user outside the workspace', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const res = await request(makeApp()).put('/api/team/u-x/role').send({ collabRole: 'BUYER' });
    expect(res.status).toBe(404);
  });

  it('400s demoting the last STRATEGIST', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-b', clerkId: 'fb-b', collabRole: 'STRATEGIST' });
    prisma.user.count.mockResolvedValue(0); // no other effective strategists
    const res = await request(makeApp()).put('/api/team/u-b/role').send({ collabRole: 'BUYER' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LastStrategist');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('changes a role when safe', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-b', clerkId: 'fb-b', collabRole: 'BUYER' });
    prisma.user.update.mockResolvedValue({});
    const res = await request(makeApp()).put('/api/team/u-b/role').send({ collabRole: 'CLIENT' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'u-b', collabRole: 'CLIENT' });
  });
});

describe('DELETE /:userId', () => {
  it('400s removing yourself', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-self', clerkId: SELF_UID, collabRole: 'STRATEGIST' });
    const res = await request(makeApp()).delete('/api/team/u-self');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CannotRemoveSelf');
  });

  it('400s removing the last STRATEGIST', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-b', clerkId: 'fb-b', collabRole: 'STRATEGIST' });
    prisma.user.count.mockResolvedValue(0);
    const res = await request(makeApp()).delete('/api/team/u-b');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LastStrategist');
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('removes a member when safe', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-b', clerkId: 'fb-b', collabRole: 'BUYER' });
    prisma.user.delete.mockResolvedValue({});
    const res = await request(makeApp()).delete('/api/team/u-b');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: true });
  });
});

describe('DELETE /invitations/:id', () => {
  it('404s an invite from another workspace', async () => {
    prisma.invitation.findFirst.mockResolvedValue(null);
    const res = await request(makeApp()).delete('/api/team/invitations/inv-x');
    expect(res.status).toBe(404);
  });

  it('cancels a pending invite', async () => {
    prisma.invitation.findFirst.mockResolvedValue({ id: 'inv-1' });
    prisma.invitation.delete.mockResolvedValue({});
    const res = await request(makeApp()).delete('/api/team/invitations/inv-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: true });
  });
});

describe('GET /invite/accept (public)', () => {
  it('redirects a valid token to /signup with token + email prefilled', async () => {
    prisma.invitation.findUnique.mockResolvedValue({ email: 'invitee@brand.com', status: 'PENDING', expiresAt: new Date(Date.now() + 1e6) });
    const res = await request(makeApp()).get('/api/team/invite/accept?token=tok-1');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/signup?inviteToken=tok-1');
    expect(res.headers.location).toContain('email=invitee%40brand.com');
  });

  it('410s an expired/used invitation', async () => {
    prisma.invitation.findUnique.mockResolvedValue({ email: 'x@y.com', status: 'PENDING', expiresAt: new Date(Date.now() - 1) });
    const res = await request(makeApp()).get('/api/team/invite/accept?token=old');
    expect(res.status).toBe(410);
  });

  it('404s an unknown token', async () => {
    prisma.invitation.findUnique.mockResolvedValue(null);
    const res = await request(makeApp()).get('/api/team/invite/accept?token=nope');
    expect(res.status).toBe(404);
  });
});
