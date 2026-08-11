// ============================================================
// AttributionService — conversions come from the newest snapshot, not all of them
// ------------------------------------------------------------
// A MetricSnapshot row is a TRAILING-WINDOW AGGREGATE stamped with its sync
// date: the Meta connector asks for `date_preset: last_90d` with no
// `time_increment` and stamps the result `new Date()`. Day 2's row therefore
// already contains day 1's conversions.
//
// This service's conversion query has NO date filter, so before the fix it
// added up every window total a channel had ever written. The engine then
// divides revenue by that count, so an over-counted denominator quietly makes
// per-conversion value look WORSE and CAC look BETTER at the same time.
//
// The engine runs for real; only the DB and the two upstream services are
// stubbed. latestPerStream is deliberately NOT stubbed — proving Attribution
// and Economics reduce identically is half the point of this file.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../blended-truth/BlendedTruthService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getBlendedTruth: vi.fn(),
}));
vi.mock('../unit-economics/EconomicsService.js', () => ({ getEconomics: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    metricSnapshot:      { findMany: vi.fn() },
    incrementalityTest:  { findMany: vi.fn() },
    pathTouch:           { findMany: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { getEconomics } from '../unit-economics/EconomicsService.js';
import { getAttribution } from './AttributionService.js';
import { ATTRIBUTION_MODEL } from './attributionTypes.js';

const channel = (channelId, over = {}) => ({
  channelId, channel: 'META', currency: 'USD',
  spendMinor: 100000, platformRevenueMinor: 200000, blendedRevenueMinor: 200000, ...over,
});
// One trailing-window conversion total, as actually stored.
const convOn = (n, entityId, conversions, source = 'META') =>
  ({ entityId, conversions, source, date: new Date(`2026-08-0${n}T09:00:00Z`) });

// Read the count back out of the engine's Attributed wrapper. LAST_TOUCH is the
// model chosen throughout because it passes each channel's platform-reported
// conversions straight through — so what these tests observe IS the number this
// PR changes, with no model arithmetic in between to mask it.
const conversionsOf = (result, channelId) =>
  result.channels?.find((r) => r.channelId === channelId)?.creditedConversions?.value ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  getEconomics.mockResolvedValue({ economics: { aovMinor: 10000 }, isDefault: false });
  prisma.incrementalityTest.findMany.mockResolvedValue([]);
  prisma.pathTouch.findMany.mockResolvedValue([]);
});

describe('getAttribution — overlapping window snapshots are superseded, not summed', () => {
  it('C · three overlapping conversion totals collapse to the newest', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta')], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([
      convOn(1, 'meta', 80), convOn(2, 'meta', 83), convOn(3, 'meta', 91),
    ]);

    const result = await getAttribution('ws-1', { model: ATTRIBUTION_MODEL.LAST_TOUCH });
    const n = conversionsOf(result, 'meta');
    expect(n).toBe(91);
    expect(n).not.toBe(254); // 80+83+91 — the defect
  });

  it('D · one channel\'s snapshots cannot contaminate another', async () => {
    getBlendedTruth.mockResolvedValue({
      channels: [channel('meta'), channel('google', { channel: 'GOOGLE' })], portfolio: {},
    });
    prisma.metricSnapshot.findMany.mockResolvedValue([
      convOn(1, 'meta', 100),            convOn(2, 'meta', 120),
      convOn(1, 'google', 200, 'GOOGLE'), convOn(2, 'google', 240, 'GOOGLE'),
    ]);

    const result = await getAttribution('ws-1', { model: ATTRIBUTION_MODEL.LAST_TOUCH });
    expect(conversionsOf(result, 'meta')).toBe(120);
    expect(conversionsOf(result, 'google')).toBe(240);
  });

  // §9 cross-service fixture — the same rows, the same 140, in all three services.
  it('G · a stale historical row is superseded, never added to the current one', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta')], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([
      convOn(1, 'meta', 100), convOn(2, 'meta', 120), convOn(3, 'meta', 140),
    ]);
    const result = await getAttribution('ws-1', { model: ATTRIBUTION_MODEL.LAST_TOUCH });
    expect(conversionsOf(result, 'meta')).toBe(140);
    expect(conversionsOf(result, 'meta')).not.toBe(360);
  });

  it('E · a channel with no snapshots reports 0 conversions, and no channels at all is INSUFFICIENT_DATA', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta')], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    expect(conversionsOf(await getAttribution('ws-1', { model: ATTRIBUTION_MODEL.LAST_TOUCH }), 'meta')).toBe(0);

    getBlendedTruth.mockResolvedValue({ channels: [], portfolio: {} });
    const empty = await getAttribution('ws-1', { model: ATTRIBUTION_MODEL.LAST_TOUCH });
    expect(empty.status).toBe('INSUFFICIENT_DATA');
  });

  it('F · conversions absent from the newest row are not inherited from an older one', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta')], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([
      convOn(1, 'meta', 100),
      { entityId: 'meta', source: 'META', date: new Date('2026-08-02T09:00:00Z') }, // no `conversions`
    ]);
    const result = await getAttribution('ws-1', { model: ATTRIBUTION_MODEL.LAST_TOUCH });
    expect(conversionsOf(result, 'meta')).not.toBe(100);
  });

  it('still excludes non-platform sources after the reduction', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta')], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([
      convOn(1, 'meta', 30), convOn(2, 'meta', 40),
      convOn(3, 'meta', 999, 'MANUAL'), // newest overall, still ignored
    ]);
    const result = await getAttribution('ws-1', { model: ATTRIBUTION_MODEL.LAST_TOUCH });
    expect(conversionsOf(result, 'meta')).toBe(40);
  });

  it('selects `date` — the reduction cannot identify the newest row without it', async () => {
    getBlendedTruth.mockResolvedValue({ channels: [channel('meta')], portfolio: {} });
    prisma.metricSnapshot.findMany.mockResolvedValue([convOn(1, 'meta', 40)]);
    await getAttribution('ws-1', { model: ATTRIBUTION_MODEL.LAST_TOUCH });
    expect(prisma.metricSnapshot.findMany.mock.calls[0][0].select).toMatchObject({
      entityId: true, date: true, conversions: true, source: true,
    });
  });
});
