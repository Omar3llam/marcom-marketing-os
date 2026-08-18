// ============================================================
// GET /api/lumi/entities/:id/reasoning — pre-generated read + role gate
// ------------------------------------------------------------
// Gated to BUYER/STRATEGIST. Reads the persisted CampaignReasoning row (written
// by the sweep) — a cheap DB read, never an LLM call. Present → 200 with the
// reasoning + a `stale` flag (row older than 24h); absent → 200 { reasoning:null }
// (the UI shows "after next sweep"); no workspace → same honest null; a throw →
// 500. Workspace-scoped by the unique (workspaceId, entityId) lookup.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('../../services/entity-graph/index.js', () => ({ getConnectorCampaigns: vi.fn(), getCampaignAdSets: vi.fn(), getAdSetAds: vi.fn() }));
vi.mock('../../services/verdict-engine/index.js', () => ({ getConnectorVerdicts: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue({ collabRole: null }) },
    campaignReasoning: { findUnique },
  },
}));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { entitiesRouter } from './entities.js';

const HOUR = 60 * 60 * 1000;
const ROW = (over = {}) => ({
  reasoning: 'Frequency is too high — refresh the creative.',
  verdict: 'REFRESH', impactScore: 7, generatedAt: new Date(Date.now() - HOUR), ...over,
});

function makeApp({ collabRole = 'STRATEGIST', workspaceId = 'ws-reasoning-route' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.workspaceId = workspaceId;
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  app.use('/', entitiesRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(ROW());
});

describe('GET /entities/:id/reasoning', () => {
  it('403s a CLIENT (never sees the efficiency read)', async () => {
    const res = await request(makeApp({ collabRole: 'CLIENT' })).get('/entities/c1/reasoning').expect(403);
    expect(res.body.error).toBe('RoleForbidden');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('BUYER → 200 with the pre-generated reasoning, scoped to the workspace', async () => {
    const res = await request(makeApp({ collabRole: 'BUYER' })).get('/entities/c1/reasoning').expect(200);
    expect(res.body).toMatchObject({ entityId: 'c1', reasoning: expect.stringContaining('Frequency'), verdict: 'REFRESH', impactScore: 7, stale: false });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId_entityId: { workspaceId: 'ws-reasoning-route', entityId: 'c1' } },
    }));
  });

  it('null collabRole is REFUSED — R11 (I61) removed the fail-open default', async () => {
    await request(makeApp({ collabRole: null })).get('/entities/c1/reasoning').expect(403);
  });

  it('no row yet → 200 { reasoning: null } (honest "after next sweep")', async () => {
    findUnique.mockResolvedValue(null);
    const res = await request(makeApp()).get('/entities/nope/reasoning').expect(200);
    expect(res.body).toEqual({ entityId: 'nope', reasoning: null, stale: false });
  });

  it('a row older than 24h is flagged stale: true', async () => {
    findUnique.mockResolvedValue(ROW({ generatedAt: new Date(Date.now() - 25 * HOUR) }));
    const res = await request(makeApp()).get('/entities/c1/reasoning').expect(200);
    expect(res.body.stale).toBe(true);
  });

  it('no resolvable workspace → honest null, never a throw', async () => {
    const res = await request(makeApp({ workspaceId: null })).get('/entities/c1/reasoning').expect(200);
    expect(res.body).toEqual({ entityId: 'c1', reasoning: null, stale: false });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('a thrown DB error → 500, never crashes', async () => {
    findUnique.mockRejectedValue(new Error('boom'));
    const res = await request(makeApp()).get('/entities/c1/reasoning').expect(500);
    expect(res.body.error).toBe('ReasoningUnavailable');
  });
});
