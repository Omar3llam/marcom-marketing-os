// ============================================================
// EntityGraphService.getAdSetAds — the ad drill-down read contract
// ------------------------------------------------------------
// Mirrors getCampaignAdSets one level down, and the contract that matters is the
// same one: null means "not in this workspace" (→ honest 404), [] means "exists,
// no children". Collapsing those two into [] would render a real ad-set and a
// foreign id identically. Also pins the query shape callers can't see: the UUID
// guard, the creative-age ordering, the cap, and workspace scoping on BOTH the
// parent lookup and the child read.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const h = vi.hoisted(() => ({
  prisma: {
    adSet: { findFirst: vi.fn(), findMany: vi.fn() },
    ad: { findMany: vi.fn() },
    campaign: { findFirst: vi.fn(), findMany: vi.fn() },
    metricSnapshot: { findMany: vi.fn() },
  },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: h.prisma }));

import { getAdSetAds, getCampaignAdSets, MAX_ADS_PER_ADSET } from './EntityGraphService.js';

const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ad = (id, over = {}) => ({
  id, name: `Ad ${id}`, channel: 'META', status: 'ACTIVE',
  platformCreatedTime: new Date('2026-05-01T00:00:00.000Z'), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.adSet.findFirst.mockResolvedValue({ id: AS });
  h.prisma.ad.findMany.mockResolvedValue([]);
  h.prisma.metricSnapshot.findMany.mockResolvedValue([]);
});

describe('getAdSetAds — null vs []', () => {
  it('returns null when the ad-set is not in this workspace', async () => {
    h.prisma.adSet.findFirst.mockResolvedValue(null);
    expect(await getAdSetAds(WS, AS)).toBeNull();
    expect(h.prisma.ad.findMany).not.toHaveBeenCalled(); // never reads children of a foreign parent
  });

  it('returns [] when the ad-set exists but has no ads', async () => {
    expect(await getAdSetAds(WS, AS)).toEqual([]);
  });

  it('returns null (not []) for a non-UUID id — the @db.Uuid cast would otherwise throw a 500', async () => {
    expect(await getAdSetAds(WS, 'not-a-uuid')).toBeNull();
    expect(h.prisma.adSet.findFirst).not.toHaveBeenCalled();
  });

  it('returns null when there is no workspace', async () => {
    expect(await getAdSetAds(null, AS)).toBeNull();
  });

  it('degrades to [] when the ad read itself fails — a broken child query is not a missing parent', async () => {
    h.prisma.ad.findMany.mockRejectedValue(new Error('db down'));
    expect(await getAdSetAds(WS, AS)).toEqual([]);
  });
});

describe('getAdSetAds — query shape', () => {
  it('scopes the parent lookup AND the child read to the workspace', async () => {
    await getAdSetAds(WS, AS);
    expect(h.prisma.adSet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: AS, workspaceId: WS } }),
    );
    expect(h.prisma.ad.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { adSetId: AS, workspaceId: WS } }),
    );
  });

  it('orders by creative age ascending with nulls last, then createdAt as tie-break', async () => {
    await getAdSetAds(WS, AS);
    expect(h.prisma.ad.findMany.mock.calls[0][0].orderBy).toEqual([
      { platformCreatedTime: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'asc' },
    ]);
  });

  it('caps at MAX_ADS_PER_ADSET', async () => {
    await getAdSetAds(WS, AS);
    expect(h.prisma.ad.findMany.mock.calls[0][0].take).toBe(MAX_ADS_PER_ADSET);
    expect(MAX_ADS_PER_ADSET).toBe(100);
  });

  it('selects platformCreatedTime — without it toAdRow could not report creative age', async () => {
    await getAdSetAds(WS, AS);
    expect(h.prisma.ad.findMany.mock.calls[0][0].select).toMatchObject({ platformCreatedTime: true });
  });
});

describe('getAdSetAds — hydration', () => {
  it('hydrates each ad with its latest AD snapshot in ONE query (no N+1)', async () => {
    h.prisma.ad.findMany.mockResolvedValue([ad('ad1'), ad('ad2')]);
    h.prisma.metricSnapshot.findMany.mockResolvedValue([
      { entityId: 'ad1', source: 'META', date: '2026-06-01', spendMinor: 100, roas: 1 },
      { entityId: 'ad1', source: 'META', date: '2026-06-05', spendMinor: 500, roas: 2.5 },
      { entityId: 'ad2', source: 'META', date: '2026-06-05', spendMinor: 300, roas: 0.4 },
    ]);

    const rows = await getAdSetAds(WS, AS);
    expect(h.prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
    expect(h.prisma.metricSnapshot.findMany.mock.calls[0][0].where).toMatchObject({
      workspaceId: WS, entityLevel: 'AD', entityId: { in: ['ad1', 'ad2'] },
    });
    expect(rows.map((r) => r.roas)).toEqual([2.5, 0.4]); // latest per entity wins
  });

  it('an ad with no snapshot keeps null metrics beside a sibling that has them', async () => {
    h.prisma.ad.findMany.mockResolvedValue([ad('ad1'), ad('ad2')]);
    h.prisma.metricSnapshot.findMany.mockResolvedValue([
      { entityId: 'ad1', source: 'META', date: '2026-06-05', spendMinor: 500, roas: 2.5 },
    ]);
    const rows = await getAdSetAds(WS, AS);
    expect(rows[0].spendMinor).toBe(500);
    expect(rows[1].spendMinor).toBeNull(); // "—", never 0
  });

  it('preserves the DB order — the service never re-sorts what the query ordered', async () => {
    h.prisma.ad.findMany.mockResolvedValue([ad('old'), ad('new'), ad('unknown', { platformCreatedTime: null })]);
    expect((await getAdSetAds(WS, AS)).map((r) => r.entityId)).toEqual(['old', 'new', 'unknown']);
  });
});

describe('getCampaignAdSets — adCount', () => {
  const CAMP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  beforeEach(() => {
    h.prisma.campaign.findFirst.mockResolvedValue({ id: CAMP });
  });

  it('reports the real ad count per ad-set', async () => {
    h.prisma.adSet.findMany.mockResolvedValue([
      { id: 'as1', name: 'Broad', channel: 'META', status: 'ACTIVE', _count: { ads: 3 } },
      { id: 'as2', name: 'LAL', channel: 'META', status: 'PAUSED', _count: { ads: 0 } },
    ]);
    const rows = await getCampaignAdSets(WS, CAMP);
    expect(rows.map((r) => r.adCount)).toEqual([3, 0]);
  });

  it('counts ads inside the select — Prisma rejects select and include together', async () => {
    h.prisma.adSet.findMany.mockResolvedValue([]);
    await getCampaignAdSets(WS, CAMP);
    const arg = h.prisma.adSet.findMany.mock.calls[0][0];
    expect(arg.select).toMatchObject({ _count: { select: { ads: true } } });
    expect(arg.include).toBeUndefined();
  });

  it('defaults to 0 when _count is absent rather than rendering a phantom chevron', async () => {
    h.prisma.adSet.findMany.mockResolvedValue([{ id: 'as1', name: 'Broad', channel: 'META', status: 'ACTIVE' }]);
    expect((await getCampaignAdSets(WS, CAMP))[0].adCount).toBe(0);
  });
});
