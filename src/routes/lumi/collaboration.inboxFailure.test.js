import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    decision: { findMany: vi.fn() },
    stakeholderNarrative: { findFirst: vi.fn() },
    approvalRequest: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { collaborationRouter } from './collaboration.js';

const decision = { id: 'd1', verdict: 'KILL', diagnosis: 'Inspect this campaign', confidence: 0.9 };
const narrative = { id: 'n1', headline: 'Weekly report', period: 'WEEKLY', confidenceScore: 80, createdAt: new Date() };
const approval = { id: 'a1', planId: 'p1', subjectType: 'PLAN', subjectId: 'p1', state: 'PENDING', createdAt: new Date() };
const dbFailure = new Error('private database details must not reach the client');

function app(role = 'STRATEGIST') {
  const server = express();
  server.use((req, _res, next) => {
    req.workspaceId = 'ws1';
    req.collabRole = role;
    next();
  });
  server.use('/', collaborationRouter);
  return server;
}

beforeEach(() => {
  vi.resetAllMocks();
  prisma.decision.findMany.mockResolvedValue([]);
  prisma.stakeholderNarrative.findFirst.mockResolvedValue(null);
  prisma.approvalRequest.findMany.mockResolvedValue([]);
});

describe('GET /inbox publishes only complete successful reads', () => {
  it('returns populated radar, narrative, and approvals on successful reads', async () => {
    prisma.decision.findMany.mockResolvedValue([decision]);
    prisma.stakeholderNarrative.findFirst.mockResolvedValue(narrative);
    prisma.approvalRequest.findMany.mockResolvedValue([approval]);

    const response = await request(app()).get('/inbox').expect(200);
    expect(response.body).toMatchObject({
      workspaceId: 'ws1', role: 'STRATEGIST',
      latestNarrative: { id: 'n1' }, pendingApprovals: [{ id: 'a1' }],
    });
    expect(response.body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'RADAR', id: 'd1' }),
      expect.objectContaining({ kind: 'NARRATIVE', id: 'n1' }),
    ]));
  });

  it('returns genuine empty decisions, absent narrative, and zero approvals as success', async () => {
    const response = await request(app()).get('/inbox').expect(200);
    expect(response.body).toMatchObject({
      workspaceId: 'ws1', role: 'STRATEGIST', alerts: [],
      latestNarrative: null, pendingApprovals: [],
    });
  });

  it('does not read approvals for a buyer; its empty approvals list is inapplicable', async () => {
    const response = await request(app('BUYER')).get('/inbox').expect(200);
    expect(response.body.pendingApprovals).toEqual([]);
    expect(prisma.approvalRequest.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['RADAR', () => prisma.decision.findMany],
    ['NARRATIVE', () => prisma.stakeholderNarrative.findFirst],
    ['APPROVAL', () => prisma.approvalRequest.findMany],
  ])('%s read failure returns a safe non-200, even when other sources succeed', async (source, mockFor) => {
    prisma.decision.findMany.mockResolvedValue([decision]);
    prisma.stakeholderNarrative.findFirst.mockResolvedValue(narrative);
    prisma.approvalRequest.findMany.mockResolvedValue([approval]);
    mockFor().mockRejectedValue(dbFailure);

    const response = await request(app()).get('/inbox').expect(500);
    expect(response.body).toEqual({ error: 'InboxUnavailable', message: 'Request failed' });
    expect(JSON.stringify(response.body)).not.toContain(dbFailure.message);
    expect(response.body).not.toHaveProperty('alerts');
    expect(response.body).not.toHaveProperty('latestNarrative');
    expect(response.body).not.toHaveProperty('pendingApprovals');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ source, wsId: 'ws1' }),
      '[lumi/collaboration] inbox failed',
    );
  });
});
