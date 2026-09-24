import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
    decision: { findMany: vi.fn() },
    stakeholderNarrative: { findFirst: vi.fn() },
    approvalRequest: { findMany: vi.fn() },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/agentic-loop/AgentHomeService.js', () => ({ getHome: vi.fn() }));
vi.mock('../../services/agentic-loop/AgenticLoopService.js', () => ({ runSweep: vi.fn(), getLoopState: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import { getHome } from '../../services/agentic-loop/AgentHomeService.js';
import { agenticRouter } from './agentic.js';
import { collaborationRouter } from './collaboration.js';

function app(collabRole) {
  const server = express();
  server.use((req, _res, next) => {
    req.userId = 'firebase-user';
    req.workspaceId = 'workspace-1';
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  server.use('/', agenticRouter, collaborationRouter);
  return server;
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({ collabRole: 'STRATEGIST' });
  prisma.workspace.findUnique.mockResolvedValue({ plan: 'GROWTH' });
  prisma.decision.findMany.mockResolvedValue([]);
  prisma.stakeholderNarrative.findFirst.mockResolvedValue(null);
  prisma.approvalRequest.findMany.mockResolvedValue([]);
  getHome.mockImplementation(async (_workspaceId, role) => ({ role, buyerBand: null, strategistBand: null }));
});

describe('role-scoped read routes refuse unresolved seats before content reads', () => {
  const endpoints = ['/home', '/inbox', '/approvals'];

  it.each(['STRATEGIST', 'BUYER', 'CLIENT'])('preserves resolved %s role on Home and Inbox', async (role) => {
    expect((await request(app(role)).get('/home').expect(200)).body.role).toBe(role);
    expect((await request(app(role)).get('/inbox').expect(200)).body.role).toBe(role);
  });

  it.each(endpoints)('%s reports role unset as not configured, without reading role content', async (endpoint) => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });
    const res = await request(app()).get(endpoint).expect(409);
    expect(res.body).toMatchObject({ error: 'RoleNotConfigured', roleStatus: 'UNRESOLVED', roleReason: 'ROLE_UNSET' });
    expect(res.body).not.toHaveProperty('role', 'STRATEGIST');
    expect(getHome).not.toHaveBeenCalled();
    expect(prisma.decision.findMany).not.toHaveBeenCalled();
    expect(prisma.approvalRequest.findMany).not.toHaveBeenCalled();
  });

  it.each(endpoints)('%s reports lookup failure as an error, without successful empty content', async (endpoint) => {
    prisma.user.findUnique.mockRejectedValue(new Error('private DB failure'));
    const res = await request(app()).get(endpoint).expect(503);
    expect(res.body).toMatchObject({ error: 'RoleUnavailable', roleStatus: 'UNRESOLVED', roleReason: 'ROLE_LOOKUP_FAILED' });
    expect(JSON.stringify(res.body)).not.toContain('private DB failure');
    expect(res.body).not.toHaveProperty('pendingApprovals');
    expect(getHome).not.toHaveBeenCalled();
    expect(prisma.decision.findMany).not.toHaveBeenCalled();
    expect(prisma.approvalRequest.findMany).not.toHaveBeenCalled();
  });

  it.each(endpoints)('%s rejects an unrecognized future role', async (endpoint) => {
    const res = await request(app('FUTURE_ROLE')).get(endpoint).expect(503);
    expect(res.body.roleReason).toBe('ROLE_UNKNOWN');
    expect(getHome).not.toHaveBeenCalled();
    expect(prisma.decision.findMany).not.toHaveBeenCalled();
    expect(prisma.approvalRequest.findMany).not.toHaveBeenCalled();
  });

  it('rejects a future role loaded from storage before Home composition', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: 'FUTURE_ROLE' });
    const res = await request(app()).get('/home').expect(503);
    expect(res.body.roleReason).toBe('ROLE_UNKNOWN');
    expect(getHome).not.toHaveBeenCalled();
  });
});
