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
// getConnectorVerdicts is mocked (the scoring math is covered elsewhere), but
// needsRevenueData is the REAL deterministic helper — the route's needsRevenue
// decoration must be exercised, not stubbed into always-false.
vi.mock('../../services/verdict-engine/index.js', async () => {
  const real = await vi.importActual('../../services/verdict-engine/connectorVerdictService.js');
  return { getConnectorVerdicts, needsRevenueData: real.needsRevenueData };
});
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

  // The Overview alert list renders c.name straight off this payload — without it
  // every alert reads "Unnamed campaign".
  it('carries the campaign name onto the health rows', async () => {
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    expect(Object.fromEntries(res.body.campaigns.map((c) => [c.entityId, c.name])))
      .toEqual({ a: 'A', b: 'B' });
  });

  // The Overview "Revenue data needed" list reads these rows, so the flag has to
  // survive the health composition — and only for a real tracking gap.
  it('decorates needsRevenue: a spending CONVERSION campaign with no measured revenue', async () => {
    getConnectorCampaigns.mockResolvedValue([
      { entityId: 'a', name: 'Sales No Rev', objective: 'OUTCOME_SALES', spendMinor: 80000, revenueMinor: 0, ctr: 0.015, frequency: 1, roas: null },
      { entityId: 'b', name: 'Brand Reach', objective: 'OUTCOME_AWARENESS', spendMinor: 20000, revenueMinor: 0, ctr: 0.015, frequency: 1, roas: null },
    ]);
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    const byId = Object.fromEntries(res.body.campaigns.map((c) => [c.entityId, c.needsRevenue]));
    expect(byId.a).toBe(true);  // conversion + no revenue → a closable tracking gap
    expect(byId.b).toBe(false); // awareness → no revenue is EXPECTED, never flagged
  });

  // The Overview "Revenue data outdated" list reads these rows. The engine already
  // decided staleness — the route only carries the flag, so the two surfaces can
  // never disagree about whose revenue went stale.
  it('carries revenueStale onto the health rows, distinct from needsRevenue', async () => {
    getConnectorCampaigns.mockResolvedValue([
      { entityId: 'a', name: 'Went Stale', spendMinor: 80000, ctr: 0.015, frequency: 1, roas: 2, revenueStale: true },
      { entityId: 'b', name: 'Fresh', spendMinor: 20000, ctr: 0.015, frequency: 1, roas: 0.5 },
    ]);
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    const byId = Object.fromEntries(res.body.campaigns.map((c) => [c.entityId, c]));
    expect(byId.a.revenueStale).toBe(true);
    expect(byId.b.revenueStale).toBe(false); // absent flag → false, never undefined
    expect(byId.a.needsRevenue).toBe(false); // stale ≠ never uploaded
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
