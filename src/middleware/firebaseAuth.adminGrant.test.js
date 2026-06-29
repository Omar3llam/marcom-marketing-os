// ============================================================
// firebaseAuth — ADMIN_EMAILS grant path
// ------------------------------------------------------------
// The ONLY way a real user becomes UserRole.ADMIN. ADMIN_EMAILS is read once at
// module load, so we set it in vi.hoisted (runs before the import) and mock the
// Firebase token verifier + Prisma. Each case uses a distinct uid so the
// middleware's per-uid workspace cache never short-circuits the next.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  process.env.ADMIN_EMAILS = 'boss@marcom.ai, ops@marcom.ai';
  return { verifyIdToken: vi.fn() };
});

vi.mock('../utils/firebaseAdmin.js', () => ({
  default: { auth: () => ({ verifyIdToken: h.verifyIdToken }) },
  getFirebaseAdminReadiness: () => ({ ok: true }),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    invitation: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { firebaseAuthMiddleware } from './firebaseAuth.js';
import { prisma } from '../lib/prisma.js';

function runMiddleware(uid, email) {
  h.verifyIdToken.mockResolvedValue({ uid, email, name: email.split('@')[0] });
  const req = { headers: { authorization: 'Bearer tok' }, path: '/api/admin/status', method: 'GET' };
  return new Promise((resolve) => firebaseAuthMiddleware(req, {}, () => resolve(req)));
}

beforeEach(() => vi.clearAllMocks());

describe('ADMIN_EMAILS grant path', () => {
  it('auto-provisions a listed email directly as ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue(null); // no row → provision branch
    prisma.user.create.mockResolvedValue({ id: 'u1', workspaceId: 'w1', role: 'ADMIN', collabRole: null });

    const req = await runMiddleware('uid-prov', 'boss@marcom.ai');

    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.create.mock.calls[0][0].data.role).toBe('ADMIN');
    expect(req.userRole).toBe('ADMIN');
  });

  it('upgrades a previously-provisioned VIEWER whose email is now listed', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u2', workspaceId: 'w2', role: 'VIEWER', collabRole: null });
    prisma.user.update.mockResolvedValue({});

    const req = await runMiddleware('uid-upg', 'ops@marcom.ai');

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u2' }, data: { role: 'ADMIN' } });
    expect(req.userRole).toBe('ADMIN');
  });

  it('leaves a non-listed email as VIEWER (no upgrade write)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u3', workspaceId: 'w3', role: 'VIEWER', collabRole: null });

    const req = await runMiddleware('uid-plain', 'someone@else.com');

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(req.userRole).toBe('VIEWER');
  });

  it('is case-insensitive on the allowlist match', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u4', workspaceId: 'w4', role: 'VIEWER', collabRole: null });
    prisma.user.update.mockResolvedValue({});

    const req = await runMiddleware('uid-case', 'BOSS@MARCOM.AI');

    expect(req.userRole).toBe('ADMIN');
  });
});

describe('THE INVITE SEAM — first sign-in with a pending invitation', () => {
  it('joins the inviting workspace, applies the invited role, and consumes the invite', async () => {
    prisma.user.findUnique.mockResolvedValue(null); // no row → provision branch
    prisma.invitation.findFirst.mockResolvedValue({ id: 'inv-1', workspaceId: 'ws-host', collabRole: 'BUYER' });
    prisma.user.create.mockResolvedValue({ id: 'u-join', workspaceId: 'ws-host', role: 'VIEWER', collabRole: 'BUYER' });
    prisma.invitation.update.mockResolvedValue({});

    const req = await runMiddleware('uid-invitee', 'invitee@brand.com');

    // Joined the host workspace — did NOT mint a new one.
    const createArg = prisma.user.create.mock.calls[0][0].data;
    expect(createArg.workspaceId).toBe('ws-host');
    expect(createArg.workspace).toBeUndefined(); // no nested workspace.create
    expect(createArg.collabRole).toBe('BUYER');
    // Invite consumed (single-use).
    expect(prisma.invitation.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: 'ACCEPTED' } });
    // Session resolves to the host workspace + invited role.
    expect(req.workspaceId).toBe('ws-host');
    expect(req.collabRole).toBe('BUYER');
    expect(req.authSource).toBe('firebase-invite-join');
  });

  it('falls back to a fresh workspace when there is no pending invite', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.invitation.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'u-solo', workspaceId: 'ws-new', role: 'VIEWER', collabRole: null });

    const req = await runMiddleware('uid-solo', 'solo@brand.com');

    const createArg = prisma.user.create.mock.calls[0][0].data;
    expect(createArg.workspace).toEqual({ create: { name: expect.any(String) } });
    expect(prisma.invitation.update).not.toHaveBeenCalled();
    expect(req.authSource).toBe('firebase-auto-provisioned');
    expect(req.workspaceId).toBe('ws-new');
  });
});
