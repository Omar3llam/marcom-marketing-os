// ============================================================
// POST /api/lumi/entities/:id/reasoning — role gate + status mapping
// ------------------------------------------------------------
// Gated to BUYER/STRATEGIST. Thin handler over CampaignReasoningService (mocked):
// OK → 200 { entityId, reasoning }; NOT_FOUND → 404 (workspace isolation);
// AI_FAILED → 502; a throw → 500. Passes the body `dialect` through. The rate
// limiter itself is covered in middleware/rateLimit.test.js.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateCampaignReasoning } = vi.hoisted(() => ({ generateCampaignReasoning: vi.fn() }));

vi.mock('../../services/analysis/CampaignReasoningService.js', () => ({ generateCampaignReasoning }));
vi.mock('../../services/entity-graph/index.js', () => ({ getConnectorCampaigns: vi.fn(), getCampaignAdSets: vi.fn() }));
vi.mock('../../services/verdict-engine/index.js', () => ({ getConnectorVerdicts: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn().mockResolvedValue({ collabRole: null }) } },
}));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { entitiesRouter } from './entities.js';

function makeApp({ collabRole } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.workspaceId = 'ws-reasoning-route';
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  app.use('/', entitiesRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  generateCampaignReasoning.mockResolvedValue({ status: 'OK', reasoning: 'Refresh the creative.' });
});

describe('POST /entities/:id/reasoning', () => {
  it('403s a CLIENT', async () => {
    const res = await request(makeApp({ collabRole: 'CLIENT' })).post('/entities/c1/reasoning').send({}).expect(403);
    expect(res.body.error).toBe('RoleForbidden');
    expect(generateCampaignReasoning).not.toHaveBeenCalled();
  });

  it('BUYER → 200 with { entityId, reasoning }', async () => {
    const res = await request(makeApp({ collabRole: 'BUYER' })).post('/entities/c1/reasoning').send({ dialect: 'egy' }).expect(200);
    expect(res.body).toEqual({ entityId: 'c1', reasoning: 'Refresh the creative.' });
    expect(generateCampaignReasoning).toHaveBeenCalledWith({ workspaceId: 'ws-reasoning-route', entityId: 'c1', dialect: 'egy' });
  });

  it('null collabRole is treated as STRATEGIST (seed default)', async () => {
    await request(makeApp({ collabRole: null })).post('/entities/c1/reasoning').send({}).expect(200);
  });

  it('unknown campaign → 404 (workspace isolation)', async () => {
    generateCampaignReasoning.mockResolvedValue({ status: 'NOT_FOUND' });
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).post('/entities/nope/reasoning').send({}).expect(404);
    expect(res.body.error).toBe('CampaignNotFound');
  });

  it('AI failure → 502 (graceful, never a fabricated reasoning)', async () => {
    generateCampaignReasoning.mockResolvedValue({ status: 'AI_FAILED' });
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).post('/entities/c1/reasoning').send({}).expect(502);
    expect(res.body.error).toBe('ReasoningUnavailable');
  });

  it('a thrown error → 500, never crashes', async () => {
    generateCampaignReasoning.mockRejectedValue(new Error('boom'));
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).post('/entities/c1/reasoning').send({}).expect(500);
    expect(res.body.error).toBe('ReasoningUnavailable');
  });

  it('ignores a non-string dialect (no crash, undefined passed)', async () => {
    await request(makeApp({ collabRole: 'STRATEGIST' })).post('/entities/c1/reasoning').send({ dialect: 42 }).expect(200);
    expect(generateCampaignReasoning).toHaveBeenCalledWith({ workspaceId: 'ws-reasoning-route', entityId: 'c1', dialect: undefined });
  });
});
