// ============================================================
// PATCH /api/user/workspace — STRATEGIST-only role gate
// ------------------------------------------------------------
// Audit 2026-07: the rename route was auth-only. Since Team & Roles the
// workspace is SHARED, so an invited BUYER/CLIENT could rename it for
// everyone. requireCollabRole('STRATEGIST') now gates it; PATCH /profile
// (self-scoped) deliberately stays open to every role.
// Effective role rule: null collabRole ⇒ STRATEGIST (pre-Phase-8 seats).
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { updateUserMock } = vi.hoisted(() => ({ updateUserMock: vi.fn() }));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: { findFirst: vi.fn(), findUnique: vi.fn() },
    workspace: { update: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/firebaseAdmin.js', () => ({
  requireFirebaseAdminReady: () => ({
    auth: () => ({ updateUser: updateUserMock, deleteUser: vi.fn() }),
  }),
}));

vi.mock('./campaigns/context.js', () => ({
  workspaceColumnsFromContext: () => ({}),
}));

import { prisma } from '../lib/prisma.js';
import { userRouter } from './user.js';

const UID = 'fb-uid-1';
const WS  = 'ws-shared';

/** collabRole === undefined ⇒ leave req.collabRole unset so the middleware
 *  falls back to the DB lookup (the pre-Phase-8 null-role path). */
function buildApp({ collabRole } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: UID };
    req.userId = UID;
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  app.use('/api/user', userRouter);
  return app;
}

describe('PATCH /api/user/workspace — STRATEGIST gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COLLAB_ROLE_OVERRIDE; // the env override would bypass the gate
    prisma.user.findFirst.mockResolvedValue({ workspaceId: WS });
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });
    prisma.workspace.update.mockResolvedValue({ id: WS, name: 'Renamed' });
  });

  it('STRATEGIST → 200, workspace renamed', async () => {
    const res = await request(buildApp({ collabRole: 'STRATEGIST' }))
      .patch('/api/user/workspace')
      .send({ workspaceName: '  Renamed  ' })
      .expect(200);

    expect(res.body).toEqual({ success: true, workspaceName: 'Renamed' });
    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: WS },
      data:  { name: 'Renamed' },
    });
  });

  it('BUYER → 403 RoleForbidden, nothing written', async () => {
    const res = await request(buildApp({ collabRole: 'BUYER' }))
      .patch('/api/user/workspace')
      .send({ workspaceName: 'Hijacked' })
      .expect(403);

    expect(res.body.error).toBe('RoleForbidden');
    expect(res.body.role).toBe('BUYER');
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it('CLIENT → 403 RoleForbidden, nothing written', async () => {
    const res = await request(buildApp({ collabRole: 'CLIENT' }))
      .patch('/api/user/workspace')
      .send({ workspaceName: 'Hijacked' })
      .expect(403);

    expect(res.body.error).toBe('RoleForbidden');
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it('null collabRole is REFUSED — R11 (I61) removed the fail-open default', async () => {
    // req.collabRole unset → the middleware falls back to the DB row, whose
    // collabRole is null. That used to normalize to STRATEGIST; R11 backfilled
    // every real seat to an explicit role, so a null now means the row is
    // anomalous, and an anomaly is a denial rather than the top privilege.
    const res = await request(buildApp())
      .patch('/api/user/workspace')
      .send({ workspaceName: 'Renamed' })
      .expect(403);

    expect(res.body.error).toBe('RoleForbidden');
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it('PATCH /profile stays open: BUYER can still rename THEMSELVES', async () => {
    updateUserMock.mockResolvedValue(undefined);

    const res = await request(buildApp({ collabRole: 'BUYER' }))
      .patch('/api/user/profile')
      .send({ displayName: 'Buyer Bob' })
      .expect(200);

    expect(res.body).toEqual({ success: true, displayName: 'Buyer Bob' });
    expect(updateUserMock).toHaveBeenCalledWith(UID, { displayName: 'Buyer Bob' });
  });
});

// ============================================================
// GET /api/user/workspace — surfaces onboarding market + industry
// ------------------------------------------------------------
// market has no Workspace column (currency is derived from it at write time);
// like industry, it rides on User.context. The Sidebar reads workspace.market
// (else falls back to a hardcoded 'EG'), so the API must return it.
// ============================================================
describe('GET /api/user/workspace — market + industry from context', () => {
  const baseWorkspace = {
    id: WS, name: 'Acme', currency: 'SAR', createdAt: new Date('2026-01-01'),
    spendTier: 't2', objective: 'roas', adChannels: ['META'], plan: 'GROWTH',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.workspace.findUnique.mockResolvedValue(baseWorkspace);
  });

  it('returns the onboarding market (id) alongside industry', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', workspaceId: WS, email: 'a@b.co', context: { market: 'sa', industry: 'saas' },
    });

    const res = await request(buildApp({ collabRole: 'STRATEGIST' }))
      .get('/api/user/workspace')
      .expect(200);

    expect(res.body.workspace.market).toBe('sa');
    expect(res.body.workspace.industry).toBe('saas');
  });

  it('market is null (not fabricated) when onboarding never set it', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', workspaceId: WS, email: 'a@b.co', context: { industry: 'saas' },
    });

    const res = await request(buildApp({ collabRole: 'STRATEGIST' }))
      .get('/api/user/workspace')
      .expect(200);

    expect(res.body.workspace.market).toBeNull();
  });

  it('surfaces the feature-gating plan entitlement (drives usePlan/PlanGate)', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', workspaceId: WS, email: 'a@b.co', context: {},
    });

    const res = await request(buildApp({ collabRole: 'STRATEGIST' }))
      .get('/api/user/workspace')
      .expect(200);

    expect(res.body.workspace.plan).toBe('GROWTH');
  });

  it('defaults plan to FREE when the column is null (never fabricated as unlocked)', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ ...baseWorkspace, plan: null });
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', workspaceId: WS, email: 'a@b.co', context: {},
    });

    const res = await request(buildApp({ collabRole: 'STRATEGIST' }))
      .get('/api/user/workspace')
      .expect(200);

    expect(res.body.workspace.plan).toBe('FREE');
  });
});

describe('GET /api/user/workspace — absence versus read failure', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([null, { workspaceId: null }])('successful user lookup establishes absence: %j', async (user) => {
    prisma.user.findFirst.mockResolvedValue(user);
    const res = await request(buildApp()).get('/api/user/workspace').expect(200);
    expect(res.body).toEqual({ workspace: null, hasWorkspace: false });
    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
  });
  it('successful workspace lookup establishes a missing row', async () => {
    prisma.user.findFirst.mockResolvedValue({ workspaceId: WS });
    prisma.workspace.findUnique.mockResolvedValue(null);
    const res = await request(buildApp()).get('/api/user/workspace').expect(200);
    expect(res.body).toEqual({ workspace: null, hasWorkspace: false });
  });
  it.each(['user', 'workspace'])('%s read failure never returns absence or private details, even in development', async (source) => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      prisma.user.findFirst.mockResolvedValue({ workspaceId: WS });
      const failure = new Error('private SQL password stack');
      if (source === 'user') prisma.user.findFirst.mockRejectedValue(failure);
      else prisma.workspace.findUnique.mockRejectedValue(failure);
      const res = await request(buildApp()).get('/api/user/workspace').expect(500);
      expect(res.body).toEqual({ error: 'Failed to fetch workspace' });
      expect(res.body).not.toHaveProperty('hasWorkspace');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
