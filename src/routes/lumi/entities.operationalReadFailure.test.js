import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/prisma.js', () => ({ prisma: {
  campaign: { findMany: vi.fn(), findFirst: vi.fn() },
  adSet: { findMany: vi.fn(), findFirst: vi.fn() }, ad: { findMany: vi.fn() },
  metricSnapshot: { findMany: vi.fn() },
} }));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/entity-graph/index.js', async (original) => ({
  ...await original(), getCanonicalVerdictCampaigns: vi.fn(async () => ({ campaigns: [], noCanonicalWindow: [], staleEvidence: [] })),
}));
vi.mock('../../services/verdict-engine/index.js', () => ({
  getConnectorVerdicts: vi.fn(async () => ({ verdicts: [] })), needsRevenueData: vi.fn(() => false),
  analyzeEvidence: vi.fn(), isRankable: vi.fn(),
}));
vi.mock('../../services/entity-graph/drillBasis.js', () => ({ drillBasisFor: vi.fn(async () => ({})) }));
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { entitiesRouter } from './entities.js';
import { FATIGUE_FREQ } from '../../services/verdict-engine/benchmarkProvider.js';

const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const campaign = { id: C, name: 'Campaign', channel: 'META', _count: { adSets: 1 } };
const adSet = { id: AS, name: 'Ad set', channel: 'META', _count: { ads: 1 } };
const setsPath = `/entities/${C}/adsets`; const adsPath = `/entities/${AS}/ads`;
const app = express();
app.use((req, _res, next) => { req.workspaceId = WS; req.collabRole = 'STRATEGIST'; next(); });
app.use(entitiesRouter);
beforeEach(() => {
  vi.clearAllMocks();
  prisma.campaign.findMany.mockResolvedValue([campaign]); prisma.campaign.findFirst.mockResolvedValue(campaign);
  prisma.adSet.findMany.mockResolvedValue([adSet]); prisma.adSet.findFirst.mockResolvedValue(adSet);
  prisma.ad.findMany.mockResolvedValue([{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', channel: 'META' }]);
  prisma.metricSnapshot.findMany.mockResolvedValue([]);
});
const snapshotFailure = (level, error) => prisma.metricSnapshot.findMany.mockImplementation(({ where }) =>
  where.entityLevel === level ? Promise.reject(error) : Promise.resolve([]));

describe('Y9 DB failures through real EntityGraphService and real entity routes', () => {
  it.each([false, true])('successful fatigue publishes canonical ceiling, empty=%s', async (empty) => {
    if (!empty) prisma.metricSnapshot.findMany.mockResolvedValue([{
      entityId: C, entityLevel: 'CAMPAIGN', date: new Date().toISOString(),
      frequency: FATIGUE_FREQ, ctr: 0.02, reach: 5000,
    }]);
    const res = await request(app).get('/entities/fatigue').expect(200);
    expect(res.body.workspaceId).toBe(WS);
    expect(Number.isFinite(Date.parse(res.body.generatedAt))).toBe(true);
    expect(res.body.frequencyCeiling).toBe(FATIGUE_FREQ);
    expect(res.body.forecast).toHaveLength(empty ? 0 : 1);
    if (!empty) expect(res.body.forecast[0]).toMatchObject({
      entityId: C, status: 'SATURATED', exhaustionPct: 100,
    });
  });

  it.each([
    ['/entities/campaigns', 'EntitiesUnavailable', 'CAMPAIGN'],
    ['/entities/health', 'HealthUnavailable', 'CAMPAIGN'],
    ['/entities/fatigue', 'FatigueUnavailable', 'CAMPAIGN'],
    [setsPath, 'AdSetsUnavailable', 'CAMPAIGN'], [setsPath, 'AdSetsUnavailable', 'ADSET'],
    [adsPath, 'AdsUnavailable', 'ADSET'], [adsPath, 'AdsUnavailable', 'AD'],
  ])('%s maps %s snapshot failure to safe 500', async (path, code, level) => {
    snapshotFailure(level, new Error('Prisma secret database details'));
    const res = await request(app).get(path).expect(500);
    expect(res.body).toEqual({ error: code, message: 'Request failed' });
    expect(logger.error).toHaveBeenCalledTimes(1); expect(logger.debug).not.toHaveBeenCalled();
  });

  it.each([
    [setsPath, 'AdSetsUnavailable', () => prisma.campaign.findFirst],
    [setsPath, 'AdSetsUnavailable', () => prisma.adSet.findMany],
    [adsPath, 'AdsUnavailable', () => prisma.adSet.findFirst],
    [adsPath, 'AdsUnavailable', () => prisma.ad.findMany],
  ])('%s maps %s parent/population query failure to safe 500', async (path, code, query) => {
    query().mockRejectedValue(new Error('Prisma secret database details'));
    const res = await request(app).get(path).expect(500);
    expect(res.body).toEqual({ error: code, message: 'Request failed' });
    expect(logger.error).toHaveBeenCalledTimes(1); expect(logger.debug).not.toHaveBeenCalled();
  });

  it.each([[setsPath, 'CampaignNotFound', () => prisma.campaign.findFirst],
    [adsPath, 'AdSetNotFound', () => prisma.adSet.findFirst]])('real absent parent %s retains 404', async (path, code, query) => {
    query().mockResolvedValue(null);
    const res = await request(app).get(path).expect(404);
    expect(res.body.error).toBe(code); expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([[setsPath, 'adSets', C, () => prisma.adSet.findMany],
    [adsPath, 'children', AS, () => prisma.ad.findMany]])('real childless parent %s retains 200 empty', async (path, key, id, query) => {
    query().mockResolvedValue([]);
    const res = await request(app).get(path).expect(200);
    expect(res.body[key]).toEqual([]); expect(res.body.entity.entityId).toBe(id);
    expect(res.body.entity.spendMinor).toBeNull(); expect(logger.error).not.toHaveBeenCalled();
  });
});
