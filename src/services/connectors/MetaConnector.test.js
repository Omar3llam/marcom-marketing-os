// ============================================================
// MetaConnector.authenticate — real account currency from Meta
// ============================================================
// The severed ingestion head: before this, authenticate() hardcoded 'USD', so
// every non-USD account stored the right NUMBERS with a wrong label + scale.
// These prove the fix:
//   1. Meta returns 'EGP' → the connector propagates 'EGP' AND corrects the
//      workspace's default-USD currency (one-time, fire-and-forget);
//   2. an INVALID currency falls back to the workspace currency (not USD);
//   3. workspace currency also missing → 'USD';
//   4. the sync NEVER fails when Meta omits the currency (graceful null);
//   5. the write-back is scoped — a workspace already on a real currency is
//      never overwritten, and a failed write never breaks authenticate.
// The pure resolveSyncCurrency precedence is asserted directly.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { workspace: { findUnique: vi.fn(), update: vi.fn() } },
}));
// Keep the REAL module (so the pure mergeMetaCampaigns drives fetchRaw) but stub
// the three network-touching functions.
vi.mock('../metaAdsService.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    fetchAccountCurrency: vi.fn(),
    fetchAccountTimezone: vi.fn(async () => null),
    fetchCampaignInsights: vi.fn(),
    fetchAllCampaigns: vi.fn(),
    // The ad-set edges MUST be stubbed too. Left real they call initSdk and hit
    // the network — fetchRaw's soft-fail would swallow the rejection, so the
    // suite would still pass while making live HTTP calls on every run.
    fetchAdSetInsights: vi.fn(),
    fetchAllAdSets: vi.fn(),
    // B5-01P″′ — and the AD edges, which is the warning above coming true. They
    // were added to fetchRaw after this comment was written, the stub list was
    // not extended, and both stayed real: every run of this file opened live
    // connections to graph.facebook.com, softFail ate the rejection, and the
    // suite reported green while depending on the public internet. The only
    // visible symptom was the occasional 5000ms timeout that B5-01P″ traced.
    fetchAdInsights: vi.fn(),
    fetchAllAds: vi.fn(),
    // Not reached by the tests below — this file exercises authenticate and
    // fetchRaw only — but stubbed anyway. The whole defect was a function
    // becoming reachable without its stub following, and "no test calls it yet"
    // is the assumption that failed last time.
    fetchCanonicalAllLevels: vi.fn(async () => ({ rows: [], windowStart: new Date(0), windowEnd: new Date(0) })),
    fetchDailyInsights: vi.fn(async () => ({ rows: [], days: 0, truncated: false })),
  };
});
vi.mock('./credentialStore.js', () => ({ resolveCredential: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import {
  fetchAccountCurrency, fetchCampaignInsights, fetchAllCampaigns,
  fetchAdSetInsights, fetchAllAdSets, fetchAdInsights, fetchAllAds,
} from '../metaAdsService.js';
import { resolveCredential } from './credentialStore.js';
import { MetaConnector } from './MetaConnector.js';
import { resolveSyncCurrency } from '../../lib/currencyDetector.js';

const connector = new MetaConnector();
const CRED = { accessToken: 'tok', accountId: 'act_123' };

const campaignFetch = (rows, truncated = false) => {
  Object.defineProperty(rows, 'fetchMeta', { value: Object.freeze({ pages: 1, truncated }), enumerable: false });
  return rows;
};

describe('MetaConnector campaign completeness', () => {
  const auth = { accessToken: 'tok', accountExternalId: 'act_123' };
  const insight = { campaign_id: 'c1', campaign_name: 'Delivered', spend: '12.34' };
  beforeEach(() => {
    fetchCampaignInsights.mockResolvedValue(campaignFetch([{ ...insight }]));
    fetchAllCampaigns.mockResolvedValue(campaignFetch([{ id: 'c2', name: 'Roster only' }]));
  });

  it.each([
    ['campaignInsights', () => fetchCampaignInsights.mockResolvedValue(campaignFetch([{ ...insight }], true))],
    ['campaignRoster', () => fetchAllCampaigns.mockResolvedValue(campaignFetch([{ id: 'c2', name: 'Roster only' }], true))],
  ])('%s truncation reaches fetchMeta without changing row values', async (edge, setup) => {
    const complete = await connector.fetchRaw(auth);
    setup();
    const partial = await connector.fetchRaw(auth);
    expect(partial).toEqual(complete);
    expect(partial.fetchMeta).toMatchObject({ truncated: true, incomplete: true, truncatedEdges: [edge], failedEdges: [] });
    expect(partial[0]).toEqual(insight);
    expect(partial[1]._rosterOnly).toBe(true);
    expect(JSON.parse(JSON.stringify(partial))).toEqual([...complete]);
  });

  it('roster failure is identifiable after successful primary insights', async () => {
    fetchAllCampaigns.mockRejectedValue(new Error('permissions'));
    const rows = await connector.fetchRaw(auth);
    expect(rows).toEqual([insight]);
    expect(rows.fetchMeta).toMatchObject({ incomplete: true, truncated: false, truncatedEdges: [], failedEdges: ['campaignRoster'] });
  });

  it('primary insights still throw', async () => {
    fetchCampaignInsights.mockRejectedValue(new Error('primary unavailable'));
    await expect(connector.fetchRaw(auth)).rejects.toThrow('primary unavailable');
  });

  it('complete empty stays distinct from a failed empty roster', async () => {
    fetchCampaignInsights.mockResolvedValue(campaignFetch([]));
    fetchAllCampaigns.mockResolvedValue(campaignFetch([]));
    const empty = await connector.fetchRaw(auth);
    expect(empty).toEqual([]);
    expect(empty.fetchMeta).toMatchObject({ incomplete: false, truncated: false, failedEdges: [], truncatedEdges: [] });
    fetchAllCampaigns.mockRejectedValue(new Error('roster unavailable'));
    const failedEmpty = await connector.fetchRaw(auth);
    expect(failedEmpty).toEqual([]);
    expect(failedEmpty.fetchMeta).toMatchObject({ incomplete: true, failedEdges: ['campaignRoster'] });
  });

  it.each([
    ['adSetInsights', fetchAdSetInsights], ['adSetRoster', fetchAllAdSets],
    ['adInsights', fetchAdInsights], ['adRoster', fetchAllAds],
  ])('%s retains truncation and identifies secondary failure', async (edge, provider) => {
    provider.mockResolvedValue({ rows: [], truncated: true });
    expect((await connector.fetchRaw(auth)).fetchMeta).toMatchObject({ truncated: true, truncatedEdges: [edge] });
    provider.mockRejectedValue(new Error('secondary unavailable'));
    expect((await connector.fetchRaw(auth)).fetchMeta).toMatchObject({ incomplete: true, failedEdges: [edge] });
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveCredential.mockResolvedValue(CRED);
  prisma.workspace.update.mockResolvedValue({});
  // Ad-sets default to "none" so the pre-existing campaign assertions keep
  // describing campaign behaviour alone.
  fetchAdSetInsights.mockResolvedValue({ rows: [], truncated: false });
  fetchAllAdSets.mockResolvedValue({ rows: [], truncated: false });
  // Ads default to "none" for the same reason. The shape is the one fetchRaw's
  // own softFail fallback declares — `{ rows, truncated }`, not a bare array —
  // so a mock that is merely quiet cannot pass for a mock that is correct.
  fetchAdInsights.mockResolvedValue({ rows: [], truncated: false });
  fetchAllAds.mockResolvedValue({ rows: [], truncated: false });
});

describe('MetaConnector.authenticate — currency resolution', () => {
  it('Meta returns EGP → propagates EGP and corrects the default-USD workspace', async () => {
    fetchAccountCurrency.mockResolvedValue('EGP');
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });

    const auth = await connector.authenticate('ws-1');

    expect(auth.ok).toBe(true);
    expect(auth.currency).toBe('EGP');
    expect(fetchAccountCurrency).toHaveBeenCalledWith('tok', 'act_123');
    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: 'ws-1' }, data: { currency: 'EGP' },
    });
  });

  it('invalid currency from Meta → falls back to the workspace currency (not USD), no write-back', async () => {
    fetchAccountCurrency.mockResolvedValue('XYZ'); // not a supported ISO code
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'SAR' });

    const auth = await connector.authenticate('ws-1');

    expect(auth.currency).toBe('SAR');
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it('no Meta currency AND no workspace currency → USD fallback', async () => {
    fetchAccountCurrency.mockResolvedValue(null);
    prisma.workspace.findUnique.mockResolvedValue(null);

    const auth = await connector.authenticate('ws-1');

    expect(auth.currency).toBe('USD');
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it('Meta omits the currency field → sync still succeeds, falls back gracefully', async () => {
    fetchAccountCurrency.mockResolvedValue(null); // fetch returns null, never throws
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'AED' });

    const auth = await connector.authenticate('ws-1');

    expect(auth.ok).toBe(true);
    expect(auth.currency).toBe('AED');
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it('does NOT overwrite a workspace already on a real (non-USD) currency', async () => {
    fetchAccountCurrency.mockResolvedValue('EGP');
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'EGP' });

    const auth = await connector.authenticate('ws-1');

    expect(auth.currency).toBe('EGP');
    expect(prisma.workspace.update).not.toHaveBeenCalled(); // already correct
  });

  it('a failed currency write-back never breaks authenticate (fire-and-forget)', async () => {
    fetchAccountCurrency.mockResolvedValue('EGP');
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
    prisma.workspace.update.mockRejectedValue(new Error('db down'));

    const auth = await connector.authenticate('ws-1');

    expect(auth.ok).toBe(true);
    expect(auth.currency).toBe('EGP');
  });

  it('missing credential still short-circuits before any currency work', async () => {
    resolveCredential.mockResolvedValue(null);
    const auth = await connector.authenticate('ws-1');
    expect(auth.ok).toBe(false);
    expect(fetchAccountCurrency).not.toHaveBeenCalled();
  });
});

describe('resolveSyncCurrency — pure precedence', () => {
  it('a valid reported code wins', () => {
    expect(resolveSyncCurrency('EGP', 'USD')).toEqual({ currency: 'EGP', source: 'reported' });
  });
  it('an invalid reported code defers to a valid workspace currency', () => {
    expect(resolveSyncCurrency('???', 'SAR')).toEqual({ currency: 'SAR', source: 'workspace' });
  });
  it('both invalid/missing → USD fallback', () => {
    expect(resolveSyncCurrency(null, null)).toEqual({ currency: 'USD', source: 'fallback' });
  });
  it('normalises case + whitespace', () => {
    expect(resolveSyncCurrency(' egp ', null)).toEqual({ currency: 'EGP', source: 'reported' });
  });
});

describe('MetaConnector.fetchRaw — every campaign lands, zero-spend included', () => {
  const auth = { accessToken: 'tok', accountExternalId: 'act_123' };

  it('merges the roster into insights: delivered keep data, zero-spend appended with 0', async () => {
    fetchCampaignInsights.mockResolvedValue([
      { campaign_id: 'c1', campaign_name: 'Delivered', spend: '100', impressions: '1000', clicks: '50' },
    ]);
    fetchAllCampaigns.mockResolvedValue([
      { id: 'c1', name: 'Delivered' },   // already in insights → not duplicated
      { id: 'c2', name: 'Never spent' }, // absent from insights → appended at 0
    ]);

    const rows = await connector.fetchRaw(auth);

    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.campaign_id === 'c1')).toHaveLength(1); // no dup
    expect(rows.find((r) => r.campaign_id === 'c1').spend).toBe('100'); // real data kept
    expect(rows.find((r) => r.campaign_id === 'c2')).toMatchObject({
      campaign_name: 'Never spent', spend: '0', impressions: '0', clicks: '0',
    });
    expect(fetchCampaignInsights).toHaveBeenCalledWith('tok', 'act_123', expect.any(String));
    expect(fetchAllCampaigns).toHaveBeenCalledWith('tok', 'act_123');
  });

  it('a /campaigns failure degrades to insights-only — never breaks the sync', async () => {
    fetchCampaignInsights.mockResolvedValue([{ campaign_id: 'c1', campaign_name: 'D', spend: '5' }]);
    fetchAllCampaigns.mockRejectedValue(new Error('permissions'));

    const rows = await connector.fetchRaw(auth);

    expect(rows).toEqual([{ campaign_id: 'c1', campaign_name: 'D', spend: '5' }]);
  });

  it('an /insights failure DOES throw — the primary edge IS the sync', async () => {
    fetchCampaignInsights.mockRejectedValue(new Error('token expired'));
    fetchAllCampaigns.mockResolvedValue([]);

    await expect(connector.fetchRaw(auth)).rejects.toThrow('token expired');
  });
});

describe('MetaConnector.fetchRaw — ad-sets ride in the same flat array', () => {
  const auth = { accessToken: 'tok', accountExternalId: 'act_123' };
  const adSetInsight = { adset_id: 'as1', adset_name: 'LAL 1%', campaign_id: 'c1', spend: '60' };

  beforeEach(() => {
    fetchCampaignInsights.mockResolvedValue([{ campaign_id: 'c1', campaign_name: 'Spring', spend: '100' }]);
    fetchAllCampaigns.mockResolvedValue([]);
  });

  // The ChannelConnector contract is `fetchRaw -> RawRow[]`, and
  // ConnectorSyncService feeds the return straight into normalize({ rows }).
  // A { campaigns, adSets } wrapper would break Meta AND diverge from Google.
  it('returns ONE flat array, campaigns and ad-sets together', async () => {
    fetchAdSetInsights.mockResolvedValue({ rows: [adSetInsight], truncated: false });

    const rows = await connector.fetchRaw(auth);

    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.adset_id != null)).toHaveLength(1);
    expect(rows.filter((r) => r.adset_id == null)).toHaveLength(1);
  });

  it('asks Meta for ad-sets at the account level, once', async () => {
    fetchAdSetInsights.mockResolvedValue({ rows: [], truncated: false });
    await connector.fetchRaw(auth);

    expect(fetchAdSetInsights).toHaveBeenCalledTimes(1);
    expect(fetchAdSetInsights).toHaveBeenCalledWith('tok', 'act_123', expect.any(String));
    expect(fetchAllAdSets).toHaveBeenCalledWith('tok', 'act_123');
  });

  it('merges the ad-set roster so non-delivering ad-sets still land', async () => {
    fetchAdSetInsights.mockResolvedValue({ rows: [adSetInsight], truncated: false });
    fetchAllAdSets.mockResolvedValue({ rows: [{ id: 'as2', name: 'Broad', campaign_id: 'c1' }], truncated: false });

    const rows = await connector.fetchRaw(auth);

    expect(rows.find((r) => r.adset_id === 'as2')).toMatchObject({ _rosterOnly: true });
    expect(rows.find((r) => r.adset_id === 'as1')._rosterOnly).toBeUndefined();
  });

  // Campaign data is the substrate every engine already reads. Losing ad-sets
  // must never cost it.
  it.each([
    ['ad-set insights', () => fetchAdSetInsights.mockRejectedValue(new Error('rate limited'))],
    ['the ad-set roster', () => fetchAllAdSets.mockRejectedValue(new Error('permissions'))],
  ])('a %s failure degrades to campaigns-only — never breaks the sync', async (_label, fail) => {
    fail();

    const rows = await connector.fetchRaw(auth);

    expect(rows).toHaveLength(1);
    expect(rows[0].campaign_id).toBe('c1');
  });

  it('reports truncation without disturbing the rows', async () => {
    fetchAdSetInsights.mockResolvedValue({ rows: [adSetInsight], truncated: true });

    const rows = await connector.fetchRaw(auth);

    expect(rows.fetchMeta).toMatchObject({ truncated: true, adSetsFetched: 1, campaigns: 1 });
  });

  it('reports truncated: false on a complete fetch', async () => {
    fetchAdSetInsights.mockResolvedValue({ rows: [adSetInsight], truncated: false });
    const rows = await connector.fetchRaw(auth);
    expect(rows.fetchMeta.truncated).toBe(false);
  });

  it('a truncated ROSTER counts too, not just insights', async () => {
    fetchAllAdSets.mockResolvedValue({ rows: [], truncated: true });
    const rows = await connector.fetchRaw(auth);
    expect(rows.fetchMeta.truncated).toBe(true);
  });

  // fetchMeta is non-enumerable so the array stays deep-equal to a plain array —
  // otherwise every existing toEqual assertion on fetchRaw breaks, and
  // JSON.stringify would start emitting it.
  it('the metadata is invisible to iteration and serialization', async () => {
    fetchAdSetInsights.mockResolvedValue({ rows: [], truncated: true });

    const rows = await connector.fetchRaw(auth);

    expect(Object.keys(rows)).not.toContain('fetchMeta');
    expect(JSON.parse(JSON.stringify(rows))).toEqual([{ campaign_id: 'c1', campaign_name: 'Spring', spend: '100' }]);
    expect(rows.fetchMeta.truncated).toBe(true); // still readable by a caller that knows
  });
});

// ── B5-01P″′ — the ad level, actually exercised ─────────────────────────────
// Until now these edges were unstubbed, so every call rejected on the network,
// softFail returned `{ rows: [] }`, and `mergeMetaAds([], [])` produced nothing.
// The ad path was not merely untested — it was tested against a population that
// could never be non-empty, and every assertion in this file passed BECAUSE the
// network failed. Closing the mock gap without adding these would have left the
// suite network-free and permanently empty, which is the same blind spot with a
// quieter symptom.
describe('MetaConnector.fetchRaw — ads ride in the same flat array', () => {
  const auth = { accessToken: 'tok', accountExternalId: 'act_123' };
  const adInsight = { ad_id: 'ad1', ad_name: 'Video A', adset_id: 'as1', campaign_id: 'c1', spend: '40', impressions: '400', clicks: '20' };

  beforeEach(() => {
    fetchCampaignInsights.mockResolvedValue([{ campaign_id: 'c1', campaign_name: 'Spring', spend: '100' }]);
    fetchAllCampaigns.mockResolvedValue([]);
  });

  it('delivered ads land alongside campaigns in the one flat array', async () => {
    fetchAdInsights.mockResolvedValue({ rows: [adInsight], truncated: false });

    const rows = await connector.fetchRaw(auth);

    expect(rows).toHaveLength(2);
    const ad = rows.find((r) => r.ad_id === 'ad1');
    expect(ad).toMatchObject({ ad_name: 'Video A', adset_id: 'as1', spend: '40' });
    expect(ad._rosterOnly).toBeUndefined(); // it delivered — real data, not a shell
  });

  it('merges the ad roster so non-delivering ads still land, without fabricated spend', async () => {
    fetchAdInsights.mockResolvedValue({ rows: [adInsight], truncated: false });
    fetchAllAds.mockResolvedValue({ rows: [{ id: 'ad2', name: 'Static B', adset_id: 'as1' }], truncated: false });

    const rows = await connector.fetchRaw(auth);

    // The roster-only ad is present as an ENTITY and flagged, so the sink writes
    // the ad but no zero snapshot that would read as "measured, and it was nil".
    expect(rows.find((r) => r.ad_id === 'ad2')).toMatchObject({ _rosterOnly: true });
    expect(rows.find((r) => r.ad_id === 'ad1')._rosterOnly).toBeUndefined();
  });

  it('asks Meta for ads at the account level, once', async () => {
    await connector.fetchRaw(auth);

    expect(fetchAdInsights).toHaveBeenCalledTimes(1);
    expect(fetchAdInsights).toHaveBeenCalledWith('tok', 'act_123', expect.any(String));
    expect(fetchAllAds).toHaveBeenCalledWith('tok', 'act_123');
  });

  it.each([
    ['ad insights', () => fetchAdInsights.mockRejectedValue(new Error('rate limited'))],
    ['the ad roster', () => fetchAllAds.mockRejectedValue(new Error('permissions'))],
  ])('a %s failure degrades to campaigns-only — never breaks the sync', async (_label, fail) => {
    fail();

    const rows = await connector.fetchRaw(auth);

    expect(rows).toHaveLength(1);
    expect(rows[0].campaign_id).toBe('c1');
  });
});
