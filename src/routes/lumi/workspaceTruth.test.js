import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: {
  user: { findUnique: vi.fn() }, workspace: { findUnique: vi.fn() }, decision: { findMany: vi.fn() },
  stakeholderNarrative: { findFirst: vi.fn() }, approvalRequest: { findMany: vi.fn() },
} }));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/agentic-loop/AgentHomeService.js', () => ({ getHome: vi.fn() }));
vi.mock('../../services/agentic-loop/AgenticLoopService.js', () => ({ getLoopState: vi.fn(), runSweep: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import { getHome } from '../../services/agentic-loop/AgentHomeService.js';
import { requirePlan } from '../../middleware/requirePlan.js';
import { requireMeasurementTier } from '../../middleware/requireMeasurementTier.js';
import { agenticRouter } from './agentic.js';
import { collaborationRouter } from './collaboration.js';

function app(context = {}) {
  const server = express();
  server.use((req, _res, next) => { Object.assign(req, { userId: 'uid' }, context); next(); });
  server.get('/plan', requirePlan('GROWTH'), (_req, res) => res.json({ ok: true }));
  server.get('/measurement', requireMeasurementTier, (_req, res) => res.json({ ok: true }));
  server.use('/', agenticRouter, collaborationRouter);
  return server;
}
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PLAN_OVERRIDE;
  delete process.env.MEASUREMENT_TIER_OVERRIDE;
  prisma.user.findUnique.mockResolvedValue({ workspaceId: 'ws', collabRole: 'STRATEGIST' });
  prisma.workspace.findUnique.mockResolvedValue({ plan: 'GROWTH', measurementTier: 'AGENCY' });
  prisma.decision.findMany.mockResolvedValue([]);
  prisma.stakeholderNarrative.findFirst.mockResolvedValue(null);
  prisma.approvalRequest.findMany.mockResolvedValue([]);
  getHome.mockResolvedValue({ role: 'STRATEGIST', buyerBand: null, strategistBand: null });
});
describe('workspace truth precedes role-scoped composition and entitlement gates', () => {
  const paths = ['/home', '/inbox', '/roles/me', '/approvals', '/plan', '/measurement'];
  it.each(paths)('%s preserves success after a found workspace', async (path) => {
    await request(app()).get(path).expect(200);
  });
  it.each(paths)('%s reports proven absence as NoWorkspace', async (path) => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app()).get(path).expect(409);
    expect(res.body.error).toBe('NoWorkspace');
    expect(getHome).not.toHaveBeenCalled();
    expect(prisma.decision.findMany).not.toHaveBeenCalled();
  });
  it.each(paths)('%s reports failed lookup as unavailable, without role/setup/empty truth', async (path) => {
    prisma.user.findUnique.mockRejectedValue(new Error('private SQL password stack'));
    const res = await request(app()).get(path).expect(503);
    expect(res.body.error).toBe('WorkspaceUnavailable');
    expect(JSON.stringify(res.body)).not.toMatch(/NoWorkspace|ROLE_UNSET|STRATEGIST|private|SQL|password|stack/);
    expect(res.body).not.toHaveProperty('pendingApprovals');
    expect(getHome).not.toHaveBeenCalled();
    expect(prisma.decision.findMany).not.toHaveBeenCalled();
    expect(prisma.approvalRequest.findMany).not.toHaveBeenCalled();
  });
  it.each(['/home', '/inbox', '/roles/me'])('%s preserves identity lookup failure before rereading a role', async (path) => {
    const res = await request(app({ authError: { status: 503, code: 'IDENTITY_UNAVAILABLE', message: 'Could not resolve this account right now.' } })).get(path).expect(503);
    expect(res.body.error).toBe('IDENTITY_UNAVAILABLE');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(res.body).not.toHaveProperty('roleReason', 'ROLE_UNSET');
  });
  it('permission denial cannot become workspace absence', async () => {
    const res = await request(app({ authError: { status: 403, code: 'INVITATION_INVALID', message: 'invitation invalid' } })).get('/inbox').expect(403);
    expect(res.body.error).toBe('INVITATION_INVALID');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it('resolved workspace still preserves SC-04 role-unset semantics', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });
    const res = await request(app({ workspaceId: 'ws' })).get('/roles/me').expect(200);
    expect(res.body).toMatchObject({ role: null, roleStatus: 'UNRESOLVED', roleReason: 'ROLE_UNSET' });
  });
});
