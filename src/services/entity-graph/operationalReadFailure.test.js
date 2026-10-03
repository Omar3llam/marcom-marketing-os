import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/prisma.js', () => ({ prisma: {
  campaign: { findMany: vi.fn(), findFirst: vi.fn() },
  adSet: { findMany: vi.fn(), findFirst: vi.fn() }, ad: { findMany: vi.fn() },
  metricSnapshot: { findMany: vi.fn() },
} }));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), error: vi.fn() } }));
import { prisma } from '../../lib/prisma.js';
import { getConnectorCampaigns, getCampaignAdSets, getAdSetAds } from './EntityGraphService.js';

const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const campaign = { id: C, name: 'Campaign', channel: 'META', objective: 'OUTCOME_SALES', _count: { adSets: 1 } };
const adSet = { id: AS, name: 'Ad set', channel: 'META', _count: { ads: 1 }, campaign: { objective: 'OUTCOME_SALES' } };
beforeEach(() => {
  vi.resetAllMocks();
  prisma.campaign.findMany.mockResolvedValue([campaign]); prisma.campaign.findFirst.mockResolvedValue(campaign);
  prisma.adSet.findMany.mockResolvedValue([adSet]); prisma.adSet.findFirst.mockResolvedValue(adSet);
  prisma.ad.findMany.mockResolvedValue([{ id: AD, name: 'Ad', channel: 'META' }]);
  prisma.metricSnapshot.findMany.mockResolvedValue([]);
});
const snapshotFailure = (level, error) => prisma.metricSnapshot.findMany.mockImplementation(({ where }) =>
  where.entityLevel === level ? Promise.reject(error) : Promise.resolve([]));

describe('Y9 operational reads propagate original failures through the real evidence selector', () => {
  it.each([
    ['connector snapshots', () => getConnectorCampaigns(WS), (e) => snapshotFailure('CAMPAIGN', e)],
    ['campaign parent identity', () => getCampaignAdSets(WS, C), (e) => prisma.campaign.findFirst.mockRejectedValue(e)],
    ['ad-set population', () => getCampaignAdSets(WS, C), (e) => prisma.adSet.findMany.mockRejectedValue(e)],
    ['campaign parent snapshots', () => getCampaignAdSets(WS, C), (e) => snapshotFailure('CAMPAIGN', e)],
    ['ad-set child snapshots', () => getCampaignAdSets(WS, C), (e) => snapshotFailure('ADSET', e)],
    ['ad-set parent identity', () => getAdSetAds(WS, AS), (e) => prisma.adSet.findFirst.mockRejectedValue(e)],
    ['ad population', () => getAdSetAds(WS, AS), (e) => prisma.ad.findMany.mockRejectedValue(e)],
    ['ad-set parent snapshots', () => getAdSetAds(WS, AS), (e) => snapshotFailure('ADSET', e)],
    ['ad child snapshots', () => getAdSetAds(WS, AS), (e) => snapshotFailure('AD', e)],
  ])('%s failure is not an absence answer', async (_name, read, fail) => {
    const error = new Error('database read unavailable'); fail(error);
    await expect(read()).rejects.toBe(error);
  });

  it('successful missing parents remain null without reading children or metrics', async () => {
    prisma.campaign.findFirst.mockResolvedValue(null); prisma.adSet.findFirst.mockResolvedValue(null);
    expect(await getCampaignAdSets(WS, C)).toBeNull(); expect(await getAdSetAds(WS, AS)).toBeNull();
    expect(prisma.adSet.findMany).not.toHaveBeenCalled(); expect(prisma.ad.findMany).not.toHaveBeenCalled();
    expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
  });

  it('successful childless parents preserve empty collections and skip empty-ID snapshot reads', async () => {
    prisma.adSet.findMany.mockResolvedValue([]); prisma.ad.findMany.mockResolvedValue([]);
    const sets = await getCampaignAdSets(WS, C); const ads = await getAdSetAds(WS, AS);
    expect(sets).toMatchObject({ entity: { entityId: C }, objective: 'OUTCOME_SALES', adSets: [] });
    expect(ads).toMatchObject({ entity: { entityId: AS }, objective: 'OUTCOME_SALES', children: [] });
    expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(2); // parents only, no empty-ID query
  });

  it('successful no-snapshot reads preserve existing identities with absent metrics', async () => {
    const rows = await getConnectorCampaigns(WS);
    const sets = await getCampaignAdSets(WS, C); const ads = await getAdSetAds(WS, AS);
    expect(rows[0]).toMatchObject({ entityId: C, spendMinor: null, adSetCount: 1 });
    expect(sets.adSets[0]).toMatchObject({ entityId: AS, spendMinor: null, adCount: 1 });
    expect(ads.children[0]).toMatchObject({ entityId: AD, spendMinor: null });
  });

  it.each([undefined, null, '', 'not-a-uuid'])('invalid parent id %s remains null without querying', async (id) => {
    expect(await getCampaignAdSets(WS, id)).toBeNull(); expect(await getAdSetAds(WS, id)).toBeNull();
    expect(prisma.campaign.findFirst).not.toHaveBeenCalled(); expect(prisma.adSet.findFirst).not.toHaveBeenCalled();
    expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
  });

  it('empty workspace/identity population short-circuits without snapshot queries', async () => {
    expect(await getConnectorCampaigns(null)).toEqual([]);
    expect(await getCampaignAdSets(null, C)).toBeNull(); expect(await getAdSetAds(null, AS)).toBeNull();
    expect(prisma.campaign.findMany).not.toHaveBeenCalled();
    prisma.campaign.findMany.mockResolvedValue([]);
    expect(await getConnectorCampaigns(WS)).toEqual([]);
    expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
  });
});
