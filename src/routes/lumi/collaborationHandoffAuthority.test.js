import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    collaborationEvent: { create: vi.fn() },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { collaborationRouter } from './collaboration.js';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function makeApp({ collabRole } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.workspaceId = 'workspace-1';
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  app.use('/', collaborationRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({ id: USER_ID });
  prisma.collaborationEvent.create.mockImplementation(async ({ data }) => ({ id: 'event-1', ...data }));
});

describe('POST /handoff binds source authority to the authenticated role', () => {
  it.each([
    ['STRATEGIST'],
    ['UNKNOWN'],
  ])('does not authorize a BUYER as body fromRole %s', async (fromRole) => {
    const res = await request(makeApp({ collabRole: 'BUYER' }))
      .post('/handoff')
      .send({ subjectId: 'decision-1', fromRole, toRole: 'BUYER' })
      .expect(403);

    expect(res.body.error).toBe('RoleForbidden');
    expect(prisma.collaborationEvent.create).not.toHaveBeenCalled();
  });

  it('persists BUYER as the source even when the body claims a conflicting role', async () => {
    await request(makeApp({ collabRole: 'BUYER' }))
      .post('/handoff')
      .send({ subjectId: 'decision-1', fromRole: 'STRATEGIST', toRole: 'STRATEGIST' })
      .expect(201);

    expect(prisma.collaborationEvent.create).toHaveBeenCalledOnce();
    expect(prisma.collaborationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromRole: 'BUYER', toRole: 'STRATEGIST' }),
    });
  });

  it.each([
    ['STRATEGIST', 'BUYER'],
    ['BUYER', 'STRATEGIST'],
  ])('preserves legal %s→%s handoffs with truthful provenance', async (collabRole, toRole) => {
    await request(makeApp({ collabRole }))
      .post('/handoff')
      .send({ subjectId: 'decision-1', toRole })
      .expect(201);

    expect(prisma.collaborationEvent.create).toHaveBeenCalledOnce();
    expect(prisma.collaborationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromRole: collabRole, toRole }),
    });
  });

  it('refuses an unknown destination without persisting an event', async () => {
    const res = await request(makeApp({ collabRole: 'STRATEGIST' }))
      .post('/handoff')
      .send({ subjectId: 'decision-1', toRole: 'UNKNOWN' })
      .expect(403);

    expect(res.body.error).toBe('RoleForbidden');
    expect(prisma.collaborationEvent.create).not.toHaveBeenCalled();
  });
});

describe('POST /handoff preserves the Phase 5.14 role boundary', () => {
  it('refuses CLIENT with 403 before any event write', async () => {
    await request(makeApp({ collabRole: 'CLIENT' }))
      .post('/handoff')
      .send({ subjectId: 'decision-1', toRole: 'BUYER' })
      .expect(403);

    expect(prisma.collaborationEvent.create).not.toHaveBeenCalled();
  });

  it('refuses an unset role with 403 before any event write', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });

    const res = await request(makeApp())
      .post('/handoff')
      .send({ subjectId: 'decision-1', toRole: 'BUYER' })
      .expect(403);

    expect(res.body.error).toBe('RoleForbidden');
    expect(prisma.collaborationEvent.create).not.toHaveBeenCalled();
  });

  it('reports an unavailable role lookup as 503 before any event write', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('database unavailable'));

    const res = await request(makeApp())
      .post('/handoff')
      .send({ subjectId: 'decision-1', toRole: 'BUYER' })
      .expect(503);

    expect(res.body.error).toBe('RoleUnavailable');
    expect(prisma.collaborationEvent.create).not.toHaveBeenCalled();
  });
});
