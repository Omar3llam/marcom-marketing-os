import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../../lib/prisma.js', () => ({ prisma: { metricSnapshot: { findMany: vi.fn() }, campaign: { findMany: vi.fn() }, user: { findUnique: vi.fn() } } }));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/connectors/credentialStore.js', () => ({ listConnections: vi.fn(async () => []) }));
vi.mock('../../middleware/requirePlan.js', () => ({ requirePlan: () => (req, res, next) => next() }));
import { prisma } from '../../lib/prisma.js';
import { portfolioRouter } from './portfolio.js';
const app = (workspaceId = 'ws') => {
  const server = express(); server.use((req, res, next) => { req.workspaceId = workspaceId; next(); });
  server.use('/api/lumi', portfolioRouter); return server;
};
const row = (source, over = {}) => ({ entityId: 'a', source, date: new Date(), spendMinor: source === 'META' ? 25 : null,
  revenueMinor: source === 'META' ? 100 : 75, currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED', measurementWindow: 'ROLLING_WINDOW',
  spendWindowStartUtc: new Date('2026-08-01'), spendWindowEndUtc: new Date('2026-08-30'),
  windowStart: new Date('2026-08-01'), windowEnd: new Date('2026-08-30'), ...over });
let rows;
beforeEach(() => {
  vi.clearAllMocks(); rows = [row('META'), row('GA4')];
  prisma.campaign.findMany.mockResolvedValue([{ id: 'a', name: 'Summer', channel: 'META' }]);
  prisma.metricSnapshot.findMany.mockImplementation(async ({ select }) => rows.map(r => Object.fromEntries(Object.keys(select).map(k => [k, r[k] ?? null]))));
});
describe('raw operational snapshots → buildChannelInputs → engine → /blended', () => {
  it('publishes an exact common period and gap without query population changes', async () => {
    const result = await request(app()).get('/api/lumi/blended'); expect(result.status).toBe(200);
    expect(result.body.channels[0]).toMatchObject({ reconciliation: { status: 'AVAILABLE', currency: 'EGP', gapMinor: 25, gapPct: .25,
      window: { windowStatus: 'EXACT', windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z' } } });
    expect(prisma.metricSnapshot.findMany.mock.calls[0][0]).toMatchObject({ where: { workspaceId: 'ws' }, select: { currencyProvenance: true, spendWindowStartUtc: true } });
    expect(prisma.metricSnapshot.findMany.mock.calls[0][0].where.source).toBeUndefined();
  });
  it('actual revenue selection survives incompatible platform/actual periods', async () => {
    Object.assign(rows[0], { spendWindowStartUtc: new Date('2026-09-01'), spendWindowEndUtc: new Date('2026-09-30') });
    const result = await request(app()).get('/api/lumi/blended');
    expect(result.body.channels[0]).toMatchObject({ blendedRevenueMinor: 75, reconciliation: { status: 'UNAVAILABLE', reason: 'MEASUREMENT_WINDOW_MISMATCH' }, gapMinor: null });
  });
  it('legacy platform periods cannot become measurement authority', async () => {
    Object.assign(rows[0], { spendWindowStartUtc: null, spendWindowEndUtc: null });
    const result = await request(app()).get('/api/lumi/blended');
    expect(result.body.channels[0].reconciliation).toMatchObject({ status: 'UNAVAILABLE', reason: 'MEASUREMENT_WINDOW_UNKNOWN', gapMinor: null });
  });
  it('a platform-only population does not claim equality', async () => {
    rows = [rows[0]]; const result = await request(app()).get('/api/lumi/blended');
    expect(result.body.channels[0]).toMatchObject({ platformRoas: 4, gapMinor: null, reconciliation: { status: 'UNVERIFIED' } });
  });
  it.each([[0, 100, -100, null], [0, 0, 0, 0]])('measured zero is denominated from its own source row: %s / %s', async (platform, actual, gapMinor, gapPct) => {
    rows[0].revenueMinor = platform; rows[1].revenueMinor = actual;
    const result = await request(app()).get('/api/lumi/blended');
    expect(result.body.channels[0].reconciliation).toMatchObject({ status: 'AVAILABLE', currency: 'EGP', gapMinor, gapPct });
  });
  it('zero with legacy denomination remains unprovable', async () => {
    rows[0].revenueMinor = 0; rows[0].currencyProvenance = 'LEGACY_UNKNOWN';
    const result = await request(app()).get('/api/lumi/blended');
    expect(result.body.channels[0].reconciliation).toMatchObject({ status: 'UNAVAILABLE', reason: 'MONETARY_BASIS_UNAVAILABLE', gapMinor: null });
  });
  it('no-workspace response uses the engine empty contract, with no invented gap', async () => {
    const result = await request(app(null)).get('/api/lumi/blended'); expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ workspaceId: null, channels: [], portfolio: { gapMinor: null, gapPct: null,
      totalChannelCount: 0, reconciliation: { status: 'UNVERIFIED', gapMinor: null } } });
    expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
  });
});
