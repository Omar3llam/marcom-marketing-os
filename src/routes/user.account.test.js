// ============================================================
// DELETE /api/user/account — shared-workspace guard tests
// ------------------------------------------------------------
// Security regression (audit 2026-07): the handler used to cascade-delete the
// caller's ENTIRE workspace unconditionally. Since Team & Roles, invited
// members JOIN the host workspace — so any member (even an invited CLIENT)
// deleting their own account destroyed the shared workspace for everyone.
//
// Three paths now:
//   1. sole member       → workspace cascade (old behavior, still correct)
//   2. non-last member   → delete ONLY the User row; workspace intact
//   3. last strategist   → 409 LastStrategist, nothing deleted
//      (effective role: null collabRole ⇒ STRATEGIST)
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { deleteUserMock } = vi.hoisted(() => ({ deleteUserMock: vi.fn() }));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: { findFirst: vi.fn(), count: vi.fn(), delete: vi.fn() },
    workspace: { delete: vi.fn() },
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/firebaseAdmin.js', () => ({
  requireFirebaseAdminReady: () => ({ auth: () => ({ deleteUser: deleteUserMock }) }),
}));

vi.mock('./campaigns/context.js', () => ({
  workspaceColumnsFromContext: () => ({}),
}));

// R11 (F15): the sole-member path now purges the credential vault before the
// cascade — marcom_credentials is raw SQL with no FK, so Prisma never reached
// it and a deleted account left live OAuth tokens behind. Mocked here so the
// unit test does not need a raw Postgres pool.
vi.mock('../services/connectors/credentialStore.js', () => ({
  deleteWorkspaceCredentials: vi.fn().mockResolvedValue(0),
  deleteLegacyOwnerCredentials: vi.fn().mockResolvedValue(0),
  withWorkspaceCredentialTransaction: vi.fn(async (client, _id, operation) => operation(client)),
}));

import { deleteWorkspaceCredentials } from '../services/connectors/credentialStore.js';
import { prisma } from '../lib/prisma.js';
import { userRouter } from './user.js';

const UID = 'fb-uid-1';
const WS  = 'ws-shared';
const ME  = { id: 'u-me', workspaceId: WS, email: 'me@example.com' };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: UID };
    next();
  });
  app.use('/api/user', userRouter);
  return app;
}

/** Route the two prisma.user.count calls by query shape:
 *  the strategist count carries an OR clause, the member count does not. */
function mockCounts({ members, otherStrategists }) {
  prisma.user.count.mockImplementation(async ({ where }) =>
    where.OR ? otherStrategists : members,
  );
}

describe('DELETE /api/user/account — shared-workspace guard', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.user.findFirst.mockResolvedValue(ME);
    prisma.user.delete.mockResolvedValue(ME);
    prisma.workspace.delete.mockResolvedValue({ id: WS });
    deleteUserMock.mockResolvedValue(undefined);
    app = buildApp();
  });

  it('sole member → deletes the workspace (cascade) and the Firebase user', async () => {
    mockCounts({ members: 1, otherStrategists: 0 });

    const res = await request(app).delete('/api/user/account').expect(200);

    expect(res.body).toEqual({ success: true });
    expect(prisma.workspace.delete).toHaveBeenCalledWith({ where: { id: WS } });
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(deleteUserMock).toHaveBeenCalledWith(UID);
  });

  // ── NC-I4 · the control (R11 · F15) ──────────────────────
  it('purges the credential vault BEFORE the cascade — it does not cascade on its own', async () => {
    // marcom_credentials is a raw-SQL table with no foreign key to workspaces,
    // so Prisma's onDelete: Cascade never reached it. This handler's own
    // docblock claimed account deletion removed OAuth tokens; it did not, and
    // a deleted account left live encrypted Meta and Google tokens behind.
    mockCounts({ members: 1, otherStrategists: 0 });

    await request(app).delete('/api/user/account').expect(200);

    expect(deleteWorkspaceCredentials).toHaveBeenCalledWith(WS, prisma);
    // Ordered first: a failure to purge must refuse the deletion rather than
    // orphan the credentials it was meant to remove.
    expect(deleteWorkspaceCredentials.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.workspace.delete.mock.invocationCallOrder[0]);
  });

  it('non-last member → deletes ONLY the User row; workspace untouched', async () => {
    mockCounts({ members: 3, otherStrategists: 2 });

    const res = await request(app).delete('/api/user/account').expect(200);

    expect(res.body).toEqual({ success: true });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: ME.id } });
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
    expect(deleteUserMock).toHaveBeenCalledWith(UID);
  });

  it('last strategist with other members → 409, nothing deleted', async () => {
    mockCounts({ members: 3, otherStrategists: 0 });

    const res = await request(app).delete('/api/user/account').expect(409);

    expect(res.body.error).toBe('LastStrategist');
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('strategist count uses the effective-role rule: excludes self, null collabRole counts as STRATEGIST', async () => {
    mockCounts({ members: 3, otherStrategists: 1 });

    await request(app).delete('/api/user/account').expect(200);

    const strategistCall = prisma.user.count.mock.calls.find(([{ where }]) => where.OR);
    expect(strategistCall).toBeDefined();
    expect(strategistCall[0].where).toEqual({
      workspaceId: WS,
      id: { not: ME.id },
      OR: [{ collabRole: 'STRATEGIST' }, { collabRole: null }],
    });
  });

  it('user without a workspace → deletes the User row directly (pre-onboarding path unchanged)', async () => {
    prisma.user.findFirst.mockResolvedValue({ ...ME, workspaceId: null });

    const res = await request(app).delete('/api/user/account').expect(200);

    expect(res.body).toEqual({ success: true });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: ME.id } });
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(deleteUserMock).toHaveBeenCalledWith(UID);
  });
});
