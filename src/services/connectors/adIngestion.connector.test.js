// ============================================================
// MetaConnector — ad edges are SECONDARY (PR #310)
// ============================================================
// Six edges now, three levels. Only campaign /insights is PRIMARY. The rule
// these pin: losing ad-level detail must never cost the campaign substrate that
// every engine already reads — a failing ad edge degrades, it does not throw.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const h = vi.hoisted(() => ({
  fetchCampaignInsights: vi.fn(), fetchAllCampaigns: vi.fn(), fetchAccountCurrency: vi.fn(),
  fetchAdSetInsights: vi.fn(), fetchAllAdSets: vi.fn(),
  fetchAdInsights: vi.fn(), fetchAllAds: vi.fn(),
}));

vi.mock('../metaAdsService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ...h }; // real merge* + field constants, mocked network
});

import { MetaConnector } from './MetaConnector.js';

const auth = { accessToken: 't', accountExternalId: 'act_1', currency: 'EGP' };
const connector = new MetaConnector();

const campaignRow = { campaign_id: 'c1', campaign_name: 'Eid', spend: '500', impressions: '90000', clicks: '2000' };
const adSetRow = { adset_id: 'as1', adset_name: 'Broad', campaign_id: 'c1', spend: '300', impressions: '50000', clicks: '1200' };
const adRow = { ad_id: 'a1', ad_name: 'Carousel #4', adset_id: 'as1', spend: '100', impressions: '10000', clicks: '250' };

beforeEach(() => {
  vi.clearAllMocks();
  h.fetchAccountCurrency.mockResolvedValue('EGP');
  h.fetchCampaignInsights.mockResolvedValue([campaignRow]);
  h.fetchAllCampaigns.mockResolvedValue([]);
  h.fetchAdSetInsights.mockResolvedValue({ rows: [adSetRow], truncated: false });
  h.fetchAllAdSets.mockResolvedValue({ rows: [], truncated: false });
  h.fetchAdInsights.mockResolvedValue({ rows: [adRow], truncated: false });
  h.fetchAllAds.mockResolvedValue({ rows: [], truncated: false });
});

const ids = (rows) => rows.map((r) => r.ad_id ?? r.adset_id ?? r.campaign_id);

describe('all six edges healthy', () => {
  it('returns all three levels in one array', async () => {
    const rows = await connector.fetchRaw(auth);
    expect(ids(rows)).toEqual(expect.arrayContaining(['c1', 'as1', 'a1']));
  });

  it('reports ad counts in fetchMeta', async () => {
    const rows = await connector.fetchRaw(auth);
    expect(rows.fetchMeta).toMatchObject({ adsFetched: 1, adsMerged: 1, truncated: false });
  });

  it('fetchMeta stays non-enumerable — spread and JSON must be unaffected', async () => {
    const rows = await connector.fetchRaw(auth);
    expect(Object.keys([...rows])).toEqual(['0', '1', '2']);
    expect(JSON.parse(JSON.stringify(rows))).toHaveLength(3);
  });
});

describe('ad edges are SECONDARY', () => {
  it('fetchAdInsights failing still returns campaigns AND ad-sets', async () => {
    h.fetchAdInsights.mockRejectedValue(new Error('meta 500'));
    const rows = await connector.fetchRaw(auth);
    expect(ids(rows)).toEqual(expect.arrayContaining(['c1', 'as1']));
  });

  it('fetchAllAds failing still returns campaigns AND ad-sets', async () => {
    h.fetchAllAds.mockRejectedValue(new Error('meta 500'));
    const rows = await connector.fetchRaw(auth);
    expect(ids(rows)).toEqual(expect.arrayContaining(['c1', 'as1']));
  });

  it('BOTH ad edges failing leaves campaigns + ad-sets intact and does not throw', async () => {
    h.fetchAdInsights.mockRejectedValue(new Error('boom'));
    h.fetchAllAds.mockRejectedValue(new Error('boom'));
    const rows = await connector.fetchRaw(auth);
    expect(ids(rows)).toEqual(['c1', 'as1']);
    expect(rows.fetchMeta).toMatchObject({ adsFetched: 0, adsMerged: 0 });
  });

  it('campaign /insights is still PRIMARY — its failure IS a sync failure', async () => {
    h.fetchCampaignInsights.mockRejectedValue(new Error('token expired'));
    await expect(connector.fetchRaw(auth)).rejects.toThrow('token expired');
  });
});

describe('truncation', () => {
  it('ad-level truncation reaches fetchMeta — ads are the level most likely to hit the cap', async () => {
    h.fetchAdInsights.mockResolvedValue({ rows: [adRow], truncated: true });
    const rows = await connector.fetchRaw(auth);
    expect(rows.fetchMeta.truncated).toBe(true);
  });

  it('ad ROSTER truncation counts too', async () => {
    h.fetchAllAds.mockResolvedValue({ rows: [], truncated: true });
    const rows = await connector.fetchRaw(auth);
    expect(rows.fetchMeta.truncated).toBe(true);
  });
});

describe('normalize over the full three-level array', () => {
  it('produces ACCOUNT + CAMPAIGN + ADSET + AD', async () => {
    const rows = await connector.fetchRaw(auth);
    const out = connector.normalize({ accountExternalId: 'act_1', currency: 'EGP', date: new Date('2026-08-01'), rows });
    expect(new Set(out.map((r) => r.entityLevel))).toEqual(new Set(['ACCOUNT', 'CAMPAIGN', 'ADSET', 'AD']));
    expect(out).toHaveLength(4); // exactly one of each — no level duplicated by a bad partition
  });

  it('the ad is parented to its ad-set, not its campaign', async () => {
    const rows = await connector.fetchRaw(auth);
    const out = connector.normalize({ accountExternalId: 'act_1', currency: 'EGP', date: new Date('2026-08-01'), rows });
    expect(out.find((r) => r.entityLevel === 'AD').parentExternalId).toBe('as1');
  });
});
