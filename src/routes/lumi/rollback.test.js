import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rollbackRouter } from './rollback.js';
import { prisma } from '../../lib/prisma.js';
import { enqueueAction } from '../../queues/index.js';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    action: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../queues/index.js', () => ({
  enqueueAction: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeApp({ role = 'ADMIN' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.userRole = role;
    req.workspaceId = 'workspace-1';
    next();
  });
  app.use('/rollback', rollbackRouter);
  return app;
}

describe('rollbackRouter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects non-admin users before loading action details', async () => {
    await request(makeApp({ role: 'VIEWER' }))
      .post('/rollback/action-1')
      .expect(403);

    expect(prisma.action.findUnique).not.toHaveBeenCalled();
    expect(enqueueAction).not.toHaveBeenCalled();
  });

  it('rejects rollback attempts after the 24h window', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-1' });
    prisma.action.findUnique.mockResolvedValue({
      id: 'action-1',
      workspaceId: 'workspace-1',
      campaignId: 'campaign-1',
      status: 'EXECUTED_SUCCESS',
      executedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      payload: { kind: 'meta.pause_ad' },
      auditLogs: [],
    });

    await request(makeApp())
      .post('/rollback/action-1')
      .expect(410);

    expect(enqueueAction).not.toHaveBeenCalled();
  });

  it('allows admins to create and enqueue an inverse action', async () => {
    const inverse = { id: 'inverse-1' };
    prisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-1' });
    prisma.action.findUnique.mockResolvedValue({
      id: 'action-1',
      workspaceId: 'workspace-1',
      campaignId: 'campaign-1',
      status: 'EXECUTED_SUCCESS',
      executedAt: new Date(),
      payload: { kind: 'meta.pause_ad' },
      auditLogs: [],
    });
    prisma.$transaction.mockImplementation(async (fn) => fn({
      action: {
        create: vi.fn().mockResolvedValue(inverse),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    }));

    const response = await request(makeApp())
      .post('/rollback/action-1')
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      rolledBackAction: 'action-1',
      inverseActionId: 'inverse-1',
    });
    expect(enqueueAction).toHaveBeenCalledWith(inverse);
  });
});
