// ============================================================
// GET /api/lumi/entities/:adSetId/ads — envelope + role gate + 404 contract
// ------------------------------------------------------------
// Thin handler over getAdSetAds (mocked; its read contract is covered in
// EntityGraphService.ads.test.js). What is pinned here is what only the route
// decides: that a service `null` becomes a 404 and a service `[]` becomes a 200
// with an empty drill-down — collapsing the two would render a foreign ad-set id
// exactly like a real one with no ads. Plus the generic { entity, children }
// envelope, and the operating-role gate that mirrors /health and /fatigue.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getAdSetAds } = vi.hoisted(() => ({ getAdSetAds: vi.fn() }));

vi.mock('../../services/entity-graph/index.js', () => ({
  getConnectorCampaigns: vi.fn(),
  getCampaignAdSets: vi.fn(),
  getAdSetAds,
}));
vi.mock('../../services/verdict-engine/index.js', () => ({
  getConnectorVerdicts: vi.fn(), needsRevenueData: vi.fn(),
}));
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

const AD_ROW = {
  entityId: 'ad1', channel: 'META', name: 'Carousel #4', status: 'ACTIVE',
  platformCreatedTime: '2026-05-01T00:00:00.000Z',
  spendMinor: 10000, roas: 2.4, ctr: 0.03, impressions: 10000, clicks: 250,
  actionMetrics: { videoView: 5000, video25: 3000, video95: 300 },
};

beforeEach(() => {
  vi.clearAllMocks();
  getAdSetAds.mockResolvedValue([AD_ROW]);
});

describe('GET /entities/:adSetId/ads', () => {
  it('returns the { entity, children } envelope', async () => {
    const res = await request(makeApp({ collabRole: 'BUYER' })).get('/entities/as1/ads').expect(200);
    expect(res.body.entity).toEqual({ id: 'as1' });
    expect(res.body.children).toHaveLength(1);
    expect(res.body.generatedAt).toEqual(expect.any(String));
    expect(getAdSetAds).toHaveBeenCalledWith('ws1', 'as1');
  });

  it('carries creative age and the video quartiles through untouched', async () => {
    const res = await request(makeApp({ collabRole: 'BUYER' })).get('/entities/as1/ads').expect(200);
    expect(res.body.children[0].platformCreatedTime).toBe('2026-05-01T00:00:00.000Z');
    expect(res.body.children[0].actionMetrics).toEqual({ videoView: 5000, video25: 3000, video95: 300 });
  });

  it('200s with an empty children array when the ad-set has no ads', async () => {
    getAdSetAds.mockResolvedValue([]);
    const res = await request(makeApp({ collabRole: 'BUYER' })).get('/entities/as1/ads').expect(200);
    expect(res.body.children).toEqual([]);
  });

  it('404s when the service reports null — a foreign ad-set is not an empty one', async () => {
    getAdSetAds.mockResolvedValue(null);
    const res = await request(makeApp({ collabRole: 'BUYER' })).get('/entities/as1/ads').expect(404);
    expect(res.body.error).toBe('AdSetNotFound');
  });

  it('500s without leaking the error message when the service throws', async () => {
    getAdSetAds.mockRejectedValue(new Error('connection terminated'));
    const res = await request(makeApp({ collabRole: 'BUYER' })).get('/entities/as1/ads').expect(500);
    expect(res.body).toEqual({ error: 'AdsUnavailable', message: 'Request failed' });
  });
});

describe('role gate — mirrors /entities/health', () => {
  it('403s a CLIENT (ad-level detail IS the efficiency critique)', async () => {
    const res = await request(makeApp({ collabRole: 'CLIENT' })).get('/entities/as1/ads').expect(403);
    expect(res.body.error).toBe('RoleForbidden');
    expect(getAdSetAds).not.toHaveBeenCalled();
  });

  it('lets a BUYER through', async () => {
    await request(makeApp({ collabRole: 'BUYER' })).get('/entities/as1/ads').expect(200);
  });

  // Gating on BUYER alone would 403 the STRATEGISTs who plan against this data.
  it('lets a STRATEGIST through', async () => {
    await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/as1/ads').expect(200);
  });

  it('null collabRole is treated as STRATEGIST (seed default)', async () => {
    await request(makeApp({ collabRole: null })).get('/entities/as1/ads').expect(200);
  });
});

// Both drill-down routes are /entities/:param/<suffix>. Express matches the
// literal last segment, so `ads` and `adsets` cannot capture each other — but
// only a test keeps that true as routes are added.
describe('route disambiguation', () => {
  it('does not swallow /entities/:campaignId/adsets', async () => {
    await request(makeApp({ collabRole: 'BUYER' })).get('/entities/c1/adsets');
    expect(getAdSetAds).not.toHaveBeenCalled();
  });
});
