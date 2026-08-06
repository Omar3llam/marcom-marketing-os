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

// getAdSetAds now reads snapshots at TWO levels (the ad-set baseline and the ad
// cohort) from the same mocked table, so the mock has to answer per level. A
// single mockResolvedValue would hand the AD rows back as the parent's baseline.
const snapsByLevel = { CAMPAIGN: [], ADSET: [], AD: [] };

beforeEach(() => {
  vi.clearAllMocks();
  snapsByLevel.CAMPAIGN = [];
  snapsByLevel.ADSET    = [];
  snapsByLevel.AD       = [];
  h.prisma.adSet.findFirst.mockResolvedValue({ id: AS, name: 'Broad', channel: 'META', status: 'ACTIVE', _count: { ads: 0 } });
  h.prisma.ad.findMany.mockResolvedValue([]);
  h.prisma.metricSnapshot.findMany.mockImplementation(({ where }) =>
    Promise.resolve(snapsByLevel[where.entityLevel] ?? []));
});

describe('getAdSetAds — null vs empty children', () => {
  it('returns null when the ad-set is not in this workspace', async () => {
    h.prisma.adSet.findFirst.mockResolvedValue(null);
    expect(await getAdSetAds(WS, AS)).toBeNull();
    expect(h.prisma.ad.findMany).not.toHaveBeenCalled(); // never reads children of a foreign parent
  });

  it('returns a real entity with empty children when the ad-set exists but has no ads', async () => {
    const out = await getAdSetAds(WS, AS);
    expect(out.children).toEqual([]);
    // The envelope is NOT null: the ad-set is real, it simply has nothing under
    // it. Collapsing this into null would 404 an ad-set the operator can see.
    expect(out.entity.entityId).toBe(AS);
  });

  it('returns null (not an envelope) for a non-UUID id — the @db.Uuid cast would otherwise throw a 500', async () => {
    expect(await getAdSetAds(WS, 'not-a-uuid')).toBeNull();
    expect(h.prisma.adSet.findFirst).not.toHaveBeenCalled();
  });

  it('returns null when there is no workspace', async () => {
    expect(await getAdSetAds(null, AS)).toBeNull();
  });

  it('degrades to empty children when the ad read itself fails — a broken child query is not a missing parent', async () => {
    h.prisma.ad.findMany.mockRejectedValue(new Error('db down'));
    const out = await getAdSetAds(WS, AS);
    expect(out.children).toEqual([]);
    expect(out.entity).not.toBeNull();
  });
});

describe('getAdSetAds — the ad-set baseline', () => {
  it('returns the ad-set as a real row, not an id stub — it is what the ads get ranked against', async () => {
    snapsByLevel.ADSET = [{ entityId: AS, source: 'META', date: '2026-06-05', ctr: 0.012, spendMinor: 90_000, impressions: 40_000 }];
    const { entity } = await getAdSetAds(WS, AS);
    expect(entity).toMatchObject({ entityId: AS, name: 'Broad', ctr: 0.012, spendMinor: 90_000 });
  });

  it('reads the baseline at ADSET level, scoped to the workspace, for this ad-set alone', async () => {
    await getAdSetAds(WS, AS);
    const levels = h.prisma.metricSnapshot.findMany.mock.calls.map((c) => c[0].where.entityLevel);
    expect(levels).toContain('ADSET');
    const adsetCall = h.prisma.metricSnapshot.findMany.mock.calls.find((c) => c[0].where.entityLevel === 'ADSET');
    expect(adsetCall[0].where).toMatchObject({ workspaceId: WS, entityId: { in: [AS] } });
  });

  it('keeps null metrics on an ad-set that has never been snapshotted — "—", never a fabricated 0', async () => {
    const { entity } = await getAdSetAds(WS, AS);
    expect(entity.ctr).toBeNull();
    expect(entity.spendMinor).toBeNull();
  });

  it('reports adCount from _count, not from the capped children array', async () => {
    h.prisma.adSet.findFirst.mockResolvedValue({ id: AS, name: 'Broad', channel: 'META', status: 'ACTIVE', _count: { ads: 140 } });
    h.prisma.ad.findMany.mockResolvedValue([ad('ad1'), ad('ad2')]);
    const { entity, children } = await getAdSetAds(WS, AS);
    // The cap truncates what we RETURN; it must not truncate what we REPORT.
    expect(entity.adCount).toBe(140);
    expect(children).toHaveLength(2);
  });

  it('defaults adCount to 0 when _count is absent rather than rendering a phantom chevron', async () => {
    h.prisma.adSet.findFirst.mockResolvedValue({ id: AS, name: 'Broad', channel: 'META', status: 'ACTIVE' });
    expect((await getAdSetAds(WS, AS)).entity.adCount).toBe(0);
  });

  it('counts ads inside the select — Prisma rejects select and include together', async () => {
    await getAdSetAds(WS, AS);
    const arg = h.prisma.adSet.findFirst.mock.calls[0][0];
    expect(arg.select).toMatchObject({ _count: { select: { ads: true } } });
    expect(arg.include).toBeUndefined();
  });
});

describe('getAdSetAds — objective', () => {
  it('threads the campaign objective through the relation — AdSet has no objective column of its own', async () => {
    h.prisma.adSet.findFirst.mockResolvedValue({
      id: AS, name: 'Broad', channel: 'META', status: 'ACTIVE',
      _count: { ads: 0 }, campaign: { objective: 'OUTCOME_SALES' },
    });
    expect((await getAdSetAds(WS, AS)).objective).toBe('OUTCOME_SALES');
  });

  it('selects the objective off the campaign relation instead of firing a second query', async () => {
    await getAdSetAds(WS, AS);
    expect(h.prisma.adSet.findFirst.mock.calls[0][0].select).toMatchObject({
      campaign: { select: { objective: true } },
    });
    expect(h.prisma.campaign.findFirst).not.toHaveBeenCalled();
  });

  it('reports null (never a guessed objective) when the campaign has none', async () => {
    h.prisma.adSet.findFirst.mockResolvedValue({
      id: AS, name: 'Broad', channel: 'META', status: 'ACTIVE',
      _count: { ads: 0 }, campaign: { objective: null },
    });
    expect((await getAdSetAds(WS, AS)).objective).toBeNull();
  });

  it('reports null when the campaign relation is missing entirely — no throw', async () => {
    expect((await getAdSetAds(WS, AS)).objective).toBeNull();
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
  it('hydrates every ad from ONE ad-level query (no N+1), whatever the child count', async () => {
    h.prisma.ad.findMany.mockResolvedValue([ad('ad1'), ad('ad2')]);
    snapsByLevel.AD = [
      { entityId: 'ad1', source: 'META', date: '2026-06-01', spendMinor: 100, roas: 1 },
      { entityId: 'ad1', source: 'META', date: '2026-06-05', spendMinor: 500, roas: 2.5 },
      { entityId: 'ad2', source: 'META', date: '2026-06-05', spendMinor: 300, roas: 0.4 },
    ];

    const { children } = await getAdSetAds(WS, AS);
    const adCalls = h.prisma.metricSnapshot.findMany.mock.calls.filter((c) => c[0].where.entityLevel === 'AD');
    expect(adCalls).toHaveLength(1);
    expect(adCalls[0][0].where).toMatchObject({
      workspaceId: WS, entityLevel: 'AD', entityId: { in: ['ad1', 'ad2'] },
    });
    expect(children.map((r) => r.roas)).toEqual([2.5, 0.4]); // latest per entity wins
  });

  it('an ad with no snapshot keeps null metrics beside a sibling that has them', async () => {
    h.prisma.ad.findMany.mockResolvedValue([ad('ad1'), ad('ad2')]);
    snapsByLevel.AD = [{ entityId: 'ad1', source: 'META', date: '2026-06-05', spendMinor: 500, roas: 2.5 }];
    const { children } = await getAdSetAds(WS, AS);
    expect(children[0].spendMinor).toBe(500);
    expect(children[1].spendMinor).toBeNull(); // "—", never 0
  });

  it('preserves the DB order — the service never re-sorts what the query ordered', async () => {
    h.prisma.ad.findMany.mockResolvedValue([ad('old'), ad('new'), ad('unknown', { platformCreatedTime: null })]);
    expect((await getAdSetAds(WS, AS)).children.map((r) => r.entityId)).toEqual(['old', 'new', 'unknown']);
  });

  it('skips the ad-level snapshot query entirely when the ad-set has no ads', async () => {
    await getAdSetAds(WS, AS);
    const adCalls = h.prisma.metricSnapshot.findMany.mock.calls.filter((c) => c[0].where.entityLevel === 'AD');
    expect(adCalls).toHaveLength(0);
  });

  it('carries the fields analyzeEvidence ranks on — impressions and creative age', async () => {
    h.prisma.ad.findMany.mockResolvedValue([ad('ad1')]);
    snapsByLevel.AD = [{ entityId: 'ad1', source: 'META', date: '2026-06-05', ctr: 0.004, impressions: 12_000 }];
    const { children } = await getAdSetAds(WS, AS);
    expect(children[0]).toMatchObject({ ctr: 0.004, impressions: 12_000 });
    expect(children[0].platformCreatedTime).toEqual(new Date('2026-05-01T00:00:00.000Z'));
  });
});

describe('getCampaignAdSets — adCount', () => {
  const CAMP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  beforeEach(() => {
    h.prisma.campaign.findFirst.mockResolvedValue({ id: CAMP, name: 'Q3 Sales', channel: 'META', objective: 'OUTCOME_SALES', _count: { adSets: 2 } });
  });

  it('reports the real ad count per ad-set', async () => {
    h.prisma.adSet.findMany.mockResolvedValue([
      { id: 'as1', name: 'Broad', channel: 'META', status: 'ACTIVE', _count: { ads: 3 } },
      { id: 'as2', name: 'LAL', channel: 'META', status: 'PAUSED', _count: { ads: 0 } },
    ]);
    const { adSets } = await getCampaignAdSets(WS, CAMP);
    expect(adSets.map((r) => r.adCount)).toEqual([3, 0]);
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
    expect((await getCampaignAdSets(WS, CAMP)).adSets[0].adCount).toBe(0);
  });

  it('caps the ad-set read and keeps the workspace scope on BOTH queries', async () => {
    h.prisma.adSet.findMany.mockResolvedValue([]);
    await getCampaignAdSets(WS, CAMP);
    expect(h.prisma.campaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CAMP, workspaceId: WS } }),
    );
    const arg = h.prisma.adSet.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ campaignId: CAMP, workspaceId: WS });
    expect(arg.take).toBe(500);
  });
});

describe('getCampaignAdSets — the campaign baseline', () => {
  const CAMP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  beforeEach(() => {
    h.prisma.campaign.findFirst.mockResolvedValue({
      id: CAMP, name: 'Q3 Sales', channel: 'META', objective: 'OUTCOME_SALES',
      externalId: '23851', platformCreatedTime: new Date('2026-04-01T00:00:00.000Z'),
      _count: { adSets: 2 },
    });
    h.prisma.adSet.findMany.mockResolvedValue([]);
  });

  it('returns { entity, objective, adSets } — the campaign is what ad-sets get ranked against', async () => {
    snapsByLevel.CAMPAIGN = [{ entityId: CAMP, source: 'META', date: '2026-06-05', ctr: 0.019, spendMinor: 400_000, impressions: 900_000 }];
    const out = await getCampaignAdSets(WS, CAMP);
    expect(out.entity).toMatchObject({ entityId: CAMP, name: 'Q3 Sales', ctr: 0.019, spendMinor: 400_000 });
    expect(out.objective).toBe('OUTCOME_SALES');
    expect(out.adSets).toEqual([]);
  });

  it('reads objective straight off the Campaign column — no relation select, no second query', async () => {
    await getCampaignAdSets(WS, CAMP);
    expect(h.prisma.campaign.findFirst.mock.calls[0][0].select).toMatchObject({ objective: true });
    expect(h.prisma.campaign.findFirst).toHaveBeenCalledTimes(1);
  });

  it('keeps externalId and platformCreatedTime — the same campaign must not lose its deep-link or its age depending on the route', async () => {
    const { entity } = await getCampaignAdSets(WS, CAMP);
    expect(entity.externalId).toBe('23851');
    expect(entity.platformCreatedTime).toEqual(new Date('2026-04-01T00:00:00.000Z'));
  });

  it('carries adSetCount from _count', async () => {
    expect((await getCampaignAdSets(WS, CAMP)).entity.adSetCount).toBe(2);
  });

  it('reads the baseline at CAMPAIGN level for this campaign alone', async () => {
    await getCampaignAdSets(WS, CAMP);
    const call = h.prisma.metricSnapshot.findMany.mock.calls.find((c) => c[0].where.entityLevel === 'CAMPAIGN');
    expect(call[0].where).toMatchObject({ workspaceId: WS, entityId: { in: [CAMP] } });
  });

  it('keeps null metrics on a campaign that has never been snapshotted', async () => {
    const { entity } = await getCampaignAdSets(WS, CAMP);
    expect(entity.ctr).toBeNull();
    expect(entity.spendMinor).toBeNull();
  });

  it('returns null (not an envelope) when the campaign is not in this workspace', async () => {
    h.prisma.campaign.findFirst.mockResolvedValue(null);
    expect(await getCampaignAdSets(WS, CAMP)).toBeNull();
    expect(h.prisma.adSet.findMany).not.toHaveBeenCalled();
  });

  it('returns a real entity with empty adSets when the campaign has none', async () => {
    const out = await getCampaignAdSets(WS, CAMP);
    expect(out.adSets).toEqual([]);
    expect(out.entity.entityId).toBe(CAMP);
  });

  it('degrades to empty adSets when the child read fails — a broken query is not a missing campaign', async () => {
    h.prisma.adSet.findMany.mockRejectedValue(new Error('db down'));
    const out = await getCampaignAdSets(WS, CAMP);
    expect(out.adSets).toEqual([]);
    expect(out.entity).not.toBeNull();
  });
});
