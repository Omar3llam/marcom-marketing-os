// ============================================================
// GET /api/lumi/entities/health — role gate + composition contract
// ------------------------------------------------------------
// Gated to BUYER/STRATEGIST (a CLIENT is 403'd). Composes getConnectorCampaigns
// + getConnectorVerdicts into the pure AccountHealthService, keying verdicts by
// id. Empty substrate → honest nulls. The engines are mocked — the scoring math
// is covered in AccountHealthService.test.js; this pins the wiring.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getConnectorCampaigns } = vi.hoisted(() => ({ getConnectorCampaigns: vi.fn() }));
const { getConnectorVerdicts } = vi.hoisted(() => ({ getConnectorVerdicts: vi.fn() }));

vi.mock('../../services/entity-graph/index.js', () => ({
  getConnectorCampaigns,
  getCampaignAdSets: vi.fn(),
}));
vi.mock('../../services/verdict-engine/index.js', () => ({ getConnectorVerdicts }));
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
    req.workspaceId = 'ws1';
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  app.use('/', entitiesRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  getConnectorCampaigns.mockResolvedValue([
    { entityId: 'a', name: 'A', spendMinor: 80000, ctr: 0.015, frequency: 1, roas: 2 },
    { entityId: 'b', name: 'B', spendMinor: 20000, ctr: 0.015, frequency: 1, roas: 0.5 },
  ]);
  getConnectorVerdicts.mockResolvedValue({
    verdicts: [
      { id: 'a', verdict: 'SCALE', roas: 2 },
      { id: 'b', verdict: 'KILL', roas: 0.5 },
    ],
    gatedOut: [], account: null, status: 'OK',
  });
});

describe('GET /entities/health', () => {
  it('403s a CLIENT (efficiency critique is an operator surface)', async () => {
    const res = await request(makeApp({ collabRole: 'CLIENT' })).get('/entities/health').expect(403);
    expect(res.body.error).toBe('RoleForbidden');
    expect(getConnectorCampaigns).not.toHaveBeenCalled();
  });

  it('lets a BUYER through and returns the composed analysis', async () => {
    const res = await request(makeApp({ collabRole: 'BUYER' })).get('/entities/health').expect(200);
    expect(res.body.score).toBe(70);                 // spend-weighted (85*.8 + 10*.2)
    expect(res.body.label).toBe('GOOD');
    expect(res.body.wastedSpend).toEqual({ minor: 20000, pct: 20 }); // KILL b
    expect(res.body.campaigns).toHaveLength(2);
    expect(res.body.workspaceId).toBe('ws1');
  });

  it('lets a STRATEGIST through', async () => {
    await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
  });

  it('null collabRole is treated as STRATEGIST (seed default)', async () => {
    await request(makeApp({ collabRole: null })).get('/entities/health').expect(200);
  });

  it('keys verdicts onto campaigns by id (verdict.id → campaign.entityId)', async () => {
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    const byId = Object.fromEntries(res.body.campaigns.map((c) => [c.entityId, c.verdict]));
    expect(byId).toEqual({ a: 'SCALE', b: 'KILL' });
  });

  it('no connector data → honest nulls, never a fabricated 0', async () => {
    getConnectorCampaigns.mockResolvedValue([]);
    getConnectorVerdicts.mockResolvedValue({ verdicts: [], gatedOut: [], account: null, status: 'NO_CAMPAIGNS' });
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    expect(res.body.score).toBeNull();
    expect(res.body.label).toBeNull();
    expect(res.body.wastedSpend).toEqual({ minor: null, pct: null });
    expect(res.body.campaigns).toEqual([]);
  });

  it('500s (never crashes) when an engine throws', async () => {
    getConnectorCampaigns.mockRejectedValue(new Error('db down'));
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(500);
    expect(res.body.error).toBe('HealthUnavailable');
  });
});
