// ============================================================
// firebaseAuth — identity boundary  (R11 · I56 / I57 / I58 / I71 / I73)
// ------------------------------------------------------------
// This file is the negative-control suite for the identity layer. Every case
// here fails if the corresponding guard is removed — that is the point of it.
//
// ADMIN_EMAILS is read once at module load, so it is set in vi.hoisted (runs
// before the import) alongside the Firebase verifier + Prisma mocks. Each case
// uses a distinct uid so the middleware's per-uid workspace cache never
// short-circuits the next.
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
    user:       { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    invitation: { updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { firebaseAuthMiddleware, requireAuth, hasVerifiedEmail } from './firebaseAuth.js';
import { prisma } from '../lib/prisma.js';

/**
 * Run the middleware for one token. `verified` defaults to TRUE so the ADMIN
 * cases read as "a legitimately verified operator"; the unverified cases pass
 * it explicitly, which is what makes the difference visible in the test names.
 */
function runMiddleware(uid, email, { verified = true, inviteToken = null, name } = {}) {
  h.verifyIdToken.mockResolvedValue({
    uid,
    email,
    email_verified: verified,
    name: name ?? email.split('@')[0],
  });
  const headers = { authorization: 'Bearer tok' };
  if (inviteToken) headers['x-invitation-token'] = inviteToken;
  const req = { headers, path: '/api/admin/status', method: 'GET' };
  return new Promise((resolve) => firebaseAuthMiddleware(req, {}, () => resolve(req)));
}

/** Drive requireAuth over a req and capture what it answered. */
function runRequireAuth(req) {
  let captured = { status: 200, body: null, passed: false };
  const res = {
    status(code) { captured.status = code; return this; },
    json(body)   { captured.body = body; return this; },
  };
  requireAuth(req, res, () => { captured.passed = true; });
  return captured;
}

/** Make prisma.$transaction execute the callback against the mocked client. */
function transactionRunsCallback() {
  prisma.$transaction.mockImplementation((fn) => fn(prisma));
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionRunsCallback();
});

// ─────────────────────────────────────────────────────────────
describe('hasVerifiedEmail (I56)', () => {
  it('accepts ONLY a literal true', () => {
    expect(hasVerifiedEmail({ email: 'a@b.com', email_verified: true })).toBe(true);
  });

  it('rejects false, undefined, and truthy non-booleans', () => {
    // A truthy check would let `undefined` through the moment a provider
    // stopped emitting the claim — which is why the guard is `=== true`.
    expect(hasVerifiedEmail({ email: 'a@b.com', email_verified: false })).toBe(false);
    expect(hasVerifiedEmail({ email: 'a@b.com' })).toBe(false);
    expect(hasVerifiedEmail({ email: 'a@b.com', email_verified: 'true' })).toBe(false);
    expect(hasVerifiedEmail({ email: 'a@b.com', email_verified: 1 })).toBe(false);
  });

  it('rejects a verified flag with no email to verify', () => {
    expect(hasVerifiedEmail({ email_verified: true })).toBe(false);
    expect(hasVerifiedEmail({ email: '', email_verified: true })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('ADMIN_EMAILS grant path (I56)', () => {
  it('auto-provisions a listed VERIFIED email directly as ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue(null); // no row → provision branch
    prisma.user.create.mockResolvedValue({ id: 'u1', workspaceId: 'w1', role: 'ADMIN', collabRole: null });

    const req = await runMiddleware('uid-prov', 'boss@marcom.ai');

    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.create.mock.calls[0][0].data.role).toBe('ADMIN');
    expect(req.userRole).toBe('ADMIN');
  });

  it('upgrades a previously-provisioned VIEWER whose VERIFIED email is now listed', async () => {
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

  // ── NC-A7 · the control ────────────────────────────────────
  // Remove the email_verified guard and these two go green again, which is
  // exactly the escalation R11 closed: anyone could type an ADMIN_EMAILS
  // address into the app's own signup form and receive the admin panel.
  it('REFUSES ADMIN at provisioning when the listed email is UNVERIFIED', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'u5', workspaceId: 'w5', role: 'VIEWER', collabRole: null });

    const req = await runMiddleware('uid-unverified-prov', 'boss@marcom.ai', { verified: false });

    expect(prisma.user.create.mock.calls[0][0].data.role).toBe('VIEWER');
    expect(req.userRole).not.toBe('ADMIN');
  });

  it('REFUSES the ADMIN upgrade on login when the listed email is UNVERIFIED', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u6', workspaceId: 'w6', role: 'VIEWER', collabRole: null });

    const req = await runMiddleware('uid-unverified-upg', 'ops@marcom.ai', { verified: false });

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(req.userRole).toBe('VIEWER');
  });
});

// ─────────────────────────────────────────────────────────────
describe('THE INVITE SEAM — token is the membership credential (I58)', () => {
  it('joins the inviting workspace when a valid token is presented, and consumes it atomically', async () => {
    prisma.user.findUnique.mockResolvedValue(null); // no row → provision branch
    prisma.invitation.updateMany.mockResolvedValue({ count: 1 });
    prisma.invitation.findUnique.mockResolvedValue({ id: 'inv-1', workspaceId: 'ws-host', collabRole: 'BUYER' });
    prisma.user.create.mockResolvedValue({ id: 'u-join', workspaceId: 'ws-host', role: 'VIEWER', collabRole: 'BUYER' });

    const req = await runMiddleware('uid-invitee', 'invitee@brand.com', { inviteToken: 'tok-abc' });

    // The claim is the atomic single-use gate: only a PENDING, unexpired row
    // matching THIS token can be moved, and only one caller can move it.
    expect(prisma.invitation.updateMany).toHaveBeenCalledWith({
      where: { token: 'tok-abc', status: 'PENDING', expiresAt: { gt: expect.any(Date) } },
      data:  { status: 'ACCEPTED' },
    });
    // Claim + membership share one transaction, so a failed create cannot
    // leave a burnt invitation behind.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    const createArg = prisma.user.create.mock.calls[0][0].data;
    expect(createArg.workspaceId).toBe('ws-host');
    expect(createArg.workspace).toBeUndefined(); // no nested workspace.create
    expect(createArg.collabRole).toBe('BUYER');

    expect(req.workspaceId).toBe('ws-host');
    expect(req.collabRole).toBe('BUYER');
    expect(req.authSource).toBe('firebase-invite-join');
  });

  it('joins on the TOKEN even when the email is unverified — the token is the proof', async () => {
    // An invited teammate signing up with email/password has an unverified
    // address on their first request. The token, not the address, is what
    // grants membership, so the flow must still work.
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.invitation.updateMany.mockResolvedValue({ count: 1 });
    prisma.invitation.findUnique.mockResolvedValue({ id: 'inv-2', workspaceId: 'ws-host2', collabRole: 'CLIENT' });
    prisma.user.create.mockResolvedValue({ id: 'u-j2', workspaceId: 'ws-host2', role: 'VIEWER', collabRole: 'CLIENT' });

    const req = await runMiddleware('uid-invitee-unver', 'invitee2@brand.com', { verified: false, inviteToken: 'tok-def' });

    expect(req.workspaceId).toBe('ws-host2');
    expect(req.collabRole).toBe('CLIENT');
  });

  // ── NC-A8 / NC-A10 · the control ───────────────────────────
  it('an EMAIL MATCH ALONE grants nothing — no token means a fresh island workspace', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'u-solo', workspaceId: 'ws-new', role: 'VIEWER', collabRole: null });

    const req = await runMiddleware('uid-no-token', 'invitee@brand.com');

    // The invitation table is not consulted at all: there is no email lookup
    // left to hijack.
    expect(prisma.invitation.findFirst).not.toHaveBeenCalled();
    expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
    const createArg = prisma.user.create.mock.calls[0][0].data;
    expect(createArg.workspace).toEqual({ create: { name: expect.any(String) } });
    expect(req.authSource).toBe('firebase-auto-provisioned');
    expect(req.workspaceId).toBe('ws-new');
  });

  it('REFUSES with 403 when the token is expired or already consumed — never falls back to fresh provisioning', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.invitation.updateMany.mockResolvedValue({ count: 0 }); // nothing claimable

    const req = await runMiddleware('uid-bad-token', 'invitee@brand.com', { inviteToken: 'tok-stale' });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(req.workspaceId).toBeNull();
    expect(req.authError).toMatchObject({ status: 403, code: 'INVITATION_INVALID' });
    expect(runRequireAuth(req)).toMatchObject({ status: 403, passed: false });
  });

  it('REFUSES with 503 when the invitation claim fails — an outage is not "no invitation" (I71)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValue(new Error('deadlock detected'));

    const req = await runMiddleware('uid-claim-down', 'invitee@brand.com', { inviteToken: 'tok-xyz' });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(req.authError).toMatchObject({ status: 503, code: 'INVITATION_UNAVAILABLE' });
    expect(runRequireAuth(req)).toMatchObject({ status: 503, passed: false });
  });
});

// ─────────────────────────────────────────────────────────────
describe('identity failure stays distinct from business state (I71 / I73)', () => {
  // ── NC-G2 · the control ────────────────────────────────────
  it('a DB failure resolving identity is 503, NOT an authenticated request with an empty workspace', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('connection pool timeout'));

    const req = await runMiddleware('uid-db-down', 'someone@brand.com');

    expect(req.user).toBeTruthy();          // the token itself verified fine
    expect(req.workspaceId).toBeNull();
    expect(req.authError).toMatchObject({ status: 503, code: 'IDENTITY_UNAVAILABLE' });

    const answered = runRequireAuth(req);
    expect(answered.passed).toBe(false);    // must NOT reach a handler
    expect(answered.status).toBe(503);
  });

  it('refuses with 409 when the email is already linked to a different identity (P2002)', async () => {
    // The takeover precondition: an attacker registers an address that already
    // has a Lumi row. The insert collides on User.email, the clerkId retry
    // finds nothing, and adopting the existing row is exactly what R11 forbids.
    prisma.user.findUnique.mockResolvedValue(null);
    const conflict = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['email'] },
    });
    prisma.user.create.mockRejectedValue(conflict);

    const req = await runMiddleware('uid-collide', 'victim@brand.com');

    expect(req.workspaceId).toBeNull();
    expect(req.authError).toMatchObject({ status: 409, code: 'EMAIL_ALREADY_LINKED' });
    expect(runRequireAuth(req)).toMatchObject({ status: 409, passed: false });
  });

  it('still recovers the genuine concurrent-first-request race', async () => {
    // Two simultaneous first requests: one wins the insert, the other collides
    // on clerkId and must find the row it lost to — not be refused.
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'u-race', workspaceId: 'ws-race', role: 'VIEWER', collabRole: null });
    prisma.user.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002', meta: { target: ['clerkId'] } }));

    const req = await runMiddleware('uid-race', 'racer@brand.com');

    expect(req.workspaceId).toBe('ws-race');
    expect(req.authError).toBeUndefined();
    expect(runRequireAuth(req)).toMatchObject({ passed: true });
  });

  it('an unauthenticated request is still a plain 401, not a 503', async () => {
    const req = { headers: {}, path: '/api/lumi/home', method: 'GET' };
    await new Promise((resolve) => firebaseAuthMiddleware(req, {}, resolve));
    expect(runRequireAuth(req)).toMatchObject({ status: 401, passed: false });
  });
});
