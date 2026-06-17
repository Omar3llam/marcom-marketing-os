import { describe, it, expect } from 'vitest';
import { metaNormalize } from './normalize/metaNormalize.js';
import { csvNormalize } from './normalize/csvNormalize.js';
import { googleNormalize, microsToMinor } from './normalize/googleNormalize.js';
import { accountRollup } from './normalize/fieldUtils.js';
import { toSnapshotRows, toEntityOps } from './snapshotSink.js';
import { assertNormalized } from './ChannelConnector.js';
import { DEFAULT_MANUAL_SYNC_DATE_PRESET, DEFAULT_CRON_SYNC_DATE_PRESET, DEFAULT_CHAT_ANALYSIS_DATE_PRESET } from './connectorConfig.js';
import { nextHealth } from './connectorHealth.js';
import { isStale, detId } from './connectorTypes.js';
import { resolve } from './connectorRegistry.js';
import { buildChannelInputs } from '../blended-truth/BlendedTruthService.js';
import { reconcile } from '../blended-truth/blendedTruthEngine.js';
import { ga4Normalize, channelFromSourceMedium } from './normalize/ga4Normalize.js';
import { resolveAttachment, toActualSnapshotRow, assertActuals } from './actualsSink.js';
import { buildRunReportBody, mapGa4Response, presetToDateRange } from './google/ga4Client.js';

const DATE = new Date('2026-06-01T00:00:00.000Z');

describe('metaNormalize — real fields, never an estimate', () => {
  it('lands claimed purchase value as revenue (0 when absent), tagged META', () => {
    const out = metaNormalize({
      accountExternalId: 'act_1', currency: 'USD', date: DATE,
      rows: [{
        campaign_id: 'c1', campaign_name: 'Eid', spend: '100.00', impressions: '1000', clicks: '50',
        actions: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '10' }],
        action_values: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '500.00' }],
      }],
    });
    const [account, campaign] = out;
    expect(account.entityLevel).toBe('ACCOUNT');
    expect(account.channel).toBe('META');
    expect(account.source).toBe('META');
    expect(campaign).toMatchObject({ externalId: 'c1', entityLevel: 'CAMPAIGN', spendMinor: 10000, revenueMinor: 50000, conversions: 10, impressions: 1000, clicks: 50 });
    expect(account.spendMinor).toBe(10000); // rollup
    expect(assertNormalized(out)).toBe(out);
  });
});

describe('csvNormalize — tolerant column mapping', () => {
  it('maps a Meta-export CSV row to the unified shape', () => {
    const out = csvNormalize({
      accountExternalId: 'csv_1', currency: 'USD', date: DATE,
      rows: [{ rowData: { 'Campaign name': 'CSV Camp', 'Amount spent': '250.00', 'Purchases conversion value': '1000', Impressions: '5000', 'Link clicks': '120', Purchases: '8' } }],
    });
    expect(out[1]).toMatchObject({ name: 'CSV Camp', spendMinor: 25000, revenueMinor: 100000, conversions: 8, impressions: 5000, clicks: 120 });
    assertNormalized(out);
  });
});

describe('googleNormalize — the careful mapper', () => {
  it('converts micros→minor, preserves fractional conversions, nulls frequency', () => {
    expect(microsToMinor(1_000_000, 'USD')).toBe(100); // $1.00 → 100 cents
    const out = googleNormalize({
      accountExternalId: 'cust_1', currency: 'USD', date: DATE,
      rows: [{ campaign: { id: 'g1', name: 'G Camp' }, metrics: { cost_micros: 1_230_000, impressions: '2000', clicks: '40', conversions: 3.5, conversions_value: 200 } }],
    });
    const [account, campaign] = out;
    expect(campaign).toMatchObject({ channel: 'GOOGLE', source: 'GOOGLE', spendMinor: 123, revenueMinor: 20000, impressions: 2000, clicks: 40, frequency: null });
    expect(campaign.conversions).toBe(3.5); // fractional preserved, NOT corrected
    expect(account.spendMinor).toBe(123);
    assertNormalized(out);
  });
});

describe('snapshotSink pure builders — deterministic + idempotent', () => {
  const normalized = metaNormalize({
    accountExternalId: 'act_1', currency: 'USD', date: DATE,
    rows: [{ campaign_id: 'c1', campaign_name: 'Eid', spend: '100.00', impressions: '1000', clicks: '50', actions: [], action_values: [] }],
  });
  it('toSnapshotRows derives ratios + a deterministic entityId (no DB lookup)', () => {
    const rows = toSnapshotRows('ws1', 'META', normalized);
    const acct = rows.find((r) => r.entityLevel === 'ACCOUNT');
    expect(acct.entityId).toBe(detId('ws1', 'META', 'ACCOUNT', 'act_1'));
    expect(acct.source).toBe('META');
    expect(acct.granularity).toBe('DAILY');
  });
  it('is idempotent — same input → byte-identical rows', () => {
    expect(toSnapshotRows('ws1', 'META', normalized)).toEqual(toSnapshotRows('ws1', 'META', normalized));
    expect(toEntityOps('ws1', 'META', normalized)).toEqual(toEntityOps('ws1', 'META', normalized));
  });
  it('toEntityOps orders parents before children', () => {
    const ops = toEntityOps('ws1', 'META', normalized);
    expect(ops[0].level).toBe('ACCOUNT'); // account upserted before its campaign
  });
});

describe('the payoff — a second channel lights up reconciliation (engine unchanged)', () => {
  it('META + GOOGLE account snapshots → a real 2-channel reconciliation, not the single-channel state', () => {
    const metaAcct = detId('ws1', 'META', 'ACCOUNT', 'act_meta');
    const googleAcct = detId('ws1', 'GOOGLE', 'ACCOUNT', 'cust_g');
    // platform-claimed rows + one GA4 actual sharing the Meta account's entityId.
    const snapshots = [
      { entityId: metaAcct, source: 'META', spendMinor: 100000, revenueMinor: 420000, currency: 'USD' },
      { entityId: metaAcct, source: 'GA4', spendMinor: 0, revenueMinor: 210000, currency: 'USD' },
      { entityId: googleAcct, source: 'GOOGLE', spendMinor: 80000, revenueMinor: 300000, currency: 'USD' },
    ];
    const labels = new Map([[metaAcct, { channel: 'META' }], [googleAcct, { channel: 'GOOGLE' }]]);
    const result = reconcile({ channels: buildChannelInputs(snapshots, labels) });
    expect(result.channels.length).toBe(2); // NOT the <2-channel honest state
    expect(result.portfolio.reconciledCount).toBeGreaterThanOrEqual(1); // the Meta channel reconciled vs GA4
  });
});

describe('rollup-on-empty — zero rows must land zero snapshots (no phantom account)', () => {
  const empty = { accountExternalId: 'act_1', currency: 'USD', date: DATE, rows: [] };

  it('accountRollup returns null for zero rows (never a fabricated summary row)', () => {
    expect(accountRollup([], { accountExternalId: 'act_1', channel: 'META', source: 'META', date: DATE, currency: 'USD' })).toBeNull();
  });

  it('metaNormalize on zero rows → [] (was the "1 snapshot" phantom)', () => {
    const out = metaNormalize(empty);
    expect(out).toEqual([]);
    expect(assertNormalized(out)).toEqual([]);          // empty is structurally valid
    expect(toSnapshotRows('ws1', 'META', out)).toEqual([]); // nothing lands
    expect(toEntityOps('ws1', 'META', out)).toEqual([]);
  });

  it('csvNormalize and googleNormalize share the same honesty on zero rows', () => {
    expect(csvNormalize(empty)).toEqual([]);
    expect(googleNormalize(empty)).toEqual([]);
  });

  it('one real row still lands account + campaign (the guard only suppresses the empty case)', () => {
    const out = metaNormalize({ accountExternalId: 'act_1', currency: 'USD', date: DATE, rows: [{ campaign_id: 'c1', campaign_name: 'X', spend: '1', impressions: '1', clicks: '1', actions: [], action_values: [] }] });
    expect(out.map((r) => r.entityLevel)).toEqual(['ACCOUNT', 'CAMPAIGN']);
  });
});

describe('snapshotSink ROAS honesty — no fabricated 0.00x from unmeasured revenue', () => {
  const row = (over = {}) => ({
    externalId: 'c1', entityLevel: 'CAMPAIGN', channel: 'META', source: 'META', name: 'C',
    date: DATE, currency: 'USD', spendMinor: 10000, revenueMinor: 0,
    impressions: 100, clicks: 10, conversions: 0, frequency: null, ...over,
  });

  it('spend > 0 but revenue 0 (unmeasured) → roas null, NOT a fabricated 0', () => {
    const [r] = toSnapshotRows('ws1', 'META', [row()]);
    expect(r.roas).toBeNull();
  });
  it('spend > 0 and revenue > 0 → real derived roas', () => {
    const [r] = toSnapshotRows('ws1', 'META', [row({ revenueMinor: 30000 })]);
    expect(r.roas).toBe(3); // 30000 / 10000
  });
  it('spend 0 → roas null (unchanged from before)', () => {
    const [r] = toSnapshotRows('ws1', 'META', [row({ spendMinor: 0 })]);
    expect(r.roas).toBeNull();
  });
});

describe('connectorConfig — date-window defaults are tiered, not unified', () => {
  it('manual reaches maximum; cron stays bounded; chat is held separate', () => {
    expect(DEFAULT_MANUAL_SYNC_DATE_PRESET).toBe('maximum');
    expect(DEFAULT_CRON_SYNC_DATE_PRESET).toBe('last_90d');
    expect(DEFAULT_CHAT_ANALYSIS_DATE_PRESET).toBe('last_30d');
    // The whole point of the fix: an unattended cron tick must NOT pull the
    // manual "everything" window. If these ever collapse to one value, this trips.
    expect(DEFAULT_CRON_SYNC_DATE_PRESET).not.toBe(DEFAULT_MANUAL_SYNC_DATE_PRESET);
  });
});

describe('connector dumbness (the governing rule)', () => {
  it('assertNormalized rejects a connector that emits a derived verdict/blend', () => {
    const bad = [{ externalId: 'x', channel: 'META', source: 'META', spendMinor: 1, revenueMinor: 1, impressions: 0, clicks: 0, verdict: 'KILL' }];
    expect(() => assertNormalized(bad)).toThrow(/forbidden derived field/);
  });
  it('rejects non-integer money', () => {
    const bad = [{ externalId: 'x', channel: 'META', source: 'META', spendMinor: 1.5, revenueMinor: 1, impressions: 0, clicks: 0 }];
    expect(() => assertNormalized(bad)).toThrow(/integer/);
  });
});

describe('connectorHealth + staleness', () => {
  it('success advances lastSuccessfulSync + records, clears error', () => {
    const h = nextHealth({}, { platform: 'GOOGLE', ok: true, records: 42, now: DATE });
    expect(h).toMatchObject({ platform: 'GOOGLE', lastSuccessfulSync: DATE.toISOString(), recordsImported: 42, lastError: null });
  });
  it('failure preserves the prior lastSuccessfulSync (a failed attempt is not "fresh")', () => {
    const prev = { lastSuccessfulSync: '2026-05-01T00:00:00.000Z', recordsImported: 9 };
    const h = nextHealth(prev, { platform: 'GOOGLE', ok: false, error: 'boom', now: DATE });
    expect(h.lastSuccessfulSync).toBe('2026-05-01T00:00:00.000Z');
    expect(h.lastError).toBe('boom');
    expect(h.lastAttemptedSync).toBe(DATE.toISOString());
  });
  it('isStale: null → true; fresh → false; old → true', () => {
    const now = new Date('2026-06-10T00:00:00Z');
    expect(isStale(null, now)).toBe(true);
    expect(isStale('2026-06-09T18:00:00Z', now)).toBe(false); // 6h < 24h
    expect(isStale('2026-06-01T00:00:00Z', now)).toBe(true);  // 9 days
  });
});

describe('connectorRegistry', () => {
  it('resolves a connector by platform; throws on unknown', () => {
    expect(resolve('META').channel).toBe('META');
    expect(resolve('google').channel).toBe('GOOGLE');
    expect(resolve('GA4').channel).toBe('GA4'); // credential/registry identity (not a row channel)
    expect(() => resolve('FOURSQUARE')).toThrow(/no connector registered/);
  });
});

describe('ga4Normalize — paid-gated channel inference + per-campaign sum', () => {
  it('channelFromSourceMedium: paid ad source → channel; organic/unknown → null', () => {
    expect(channelFromSourceMedium('facebook', 'cpc')).toBe('META');
    expect(channelFromSourceMedium('IG', 'paid_social')).toBe('META');
    expect(channelFromSourceMedium('google', 'cpc')).toBe('GOOGLE');
    expect(channelFromSourceMedium('google', 'organic')).toBeNull(); // not a paid CLAIM
    expect(channelFromSourceMedium('newsletter', 'email')).toBeNull();
    expect(channelFromSourceMedium('facebook', 'referral')).toBeNull(); // organic social
  });

  it('sums rows that collapse to one (channel, campaign); drops organic; revenue→minor', () => {
    const out = ga4Normalize({
      currency: 'USD', date: DATE,
      rows: [
        { source: 'facebook', medium: 'cpc', campaignName: 'Eid Sale', revenue: '300.00', conversions: 6 },
        { source: 'instagram', medium: 'paid_social', campaignName: 'Eid Sale', revenue: '200.00', conversions: 4 }, // same META campaign
        { source: 'google', medium: 'organic', campaignName: 'Eid Sale', revenue: '999.00', conversions: 9 },        // dropped (organic)
      ],
    });
    expect(out).toHaveLength(1); // the two META rows summed, organic dropped
    expect(out[0]).toMatchObject({ source: 'GA4', channel: 'META', campaignName: 'Eid Sale', revenueMinor: 50000, conversions: 10 });
    expect(assertActuals(out)).toBe(out);
  });
});

describe('actualsSink resolution — attach to existing entity, never mint', () => {
  const metaCampaign = detId('ws1', 'META', 'CAMPAIGN', 'c1');
  const metaAccount = detId('ws1', 'META', 'ACCOUNT', 'act_meta');
  const graph = {
    campaignByKey: new Map([[`META|eid sale`, metaCampaign]]),
    accountByChannel: new Map([['META', metaAccount]]),
  };

  it('matches a campaign by channel+name (case-insensitive) → CAMPAIGN attachment', () => {
    expect(resolveAttachment({ channel: 'META', campaignName: 'Eid Sale' }, graph)).toEqual({ entityId: metaCampaign, entityLevel: 'CAMPAIGN' });
  });
  it('no campaign match → falls back to the channel ACCOUNT (honest coarsening)', () => {
    expect(resolveAttachment({ channel: 'META', campaignName: 'Unknown' }, graph)).toEqual({ entityId: metaAccount, entityLevel: 'ACCOUNT' });
  });
  it('no campaign and no account → null (DROP, never fabricate an entity)', () => {
    expect(resolveAttachment({ channel: 'GOOGLE', campaignName: 'X' }, graph)).toBeNull();
  });
  it('toActualSnapshotRow carries no spend → roas/cpa/ctr null, source GA4', () => {
    const row = toActualSnapshotRow('ws1', { entityId: metaCampaign, entityLevel: 'CAMPAIGN' }, { source: 'GA4', revenueMinor: 50000, conversions: 10, date: DATE, currency: 'USD' });
    expect(row).toMatchObject({ entityId: metaCampaign, source: 'GA4', spendMinor: 0, revenueMinor: 50000, conversions: 10, roas: null, cpaMinor: null, ctr: null });
  });
  it('assertActuals rejects a non-actual source and non-integer revenue', () => {
    expect(() => assertActuals([{ channel: 'META', source: 'META', revenueMinor: 1 }])).toThrow(/ACTUAL source/);
    expect(() => assertActuals([{ channel: 'META', source: 'GA4', revenueMinor: 1.5 }])).toThrow(/integer/);
  });
});

describe('the GA4 payoff — actual revenue reconciles at CAMPAIGN level', () => {
  it('GA4 actual lands on the Meta campaign entityId → reconciliation, not platform-only', () => {
    const metaCampaign = detId('ws1', 'META', 'CAMPAIGN', 'c1');
    // The full pure chain: normalize → resolve → land-row.
    const [descriptor] = ga4Normalize({
      currency: 'USD', date: DATE,
      rows: [{ source: 'facebook', medium: 'cpc', campaignName: 'Eid Sale', revenue: '210.00', conversions: 5 }],
    });
    const graph = { campaignByKey: new Map([[`META|eid sale`, metaCampaign]]), accountByChannel: new Map() };
    const attachment = resolveAttachment(descriptor, graph);
    const actualRow = toActualSnapshotRow('ws1', attachment, descriptor);

    const snapshots = [
      { entityId: metaCampaign, source: 'META', spendMinor: 100000, revenueMinor: 420000, currency: 'USD' }, // platform claim
      { entityId: actualRow.entityId, source: actualRow.source, spendMinor: 0, revenueMinor: actualRow.revenueMinor, currency: 'USD' }, // GA4 actual, SAME entity
    ];
    const labels = new Map([[metaCampaign, { channel: 'META' }]]);
    const result = reconcile({ channels: buildChannelInputs(snapshots, labels) });
    expect(result.portfolio.reconciledCount).toBeGreaterThanOrEqual(1); // platform-vs-actual reconciled on one entity
  });
});

describe('ga4Client pure helpers — request/response shaping (no network)', () => {
  it('presetToDateRange maps shared presets to an explicit day-range', () => {
    const now = new Date('2026-06-17T00:00:00.000Z');
    expect(presetToDateRange('last_30d', now)).toEqual({ startDate: '2026-05-18', endDate: '2026-06-17' });
    expect(presetToDateRange('maximum', now).endDate).toBe('2026-06-17');
    expect(presetToDateRange('weird', now)).toEqual(presetToDateRange('last_90d', now)); // safe default
  });
  it('buildRunReportBody requests source/medium/campaign + purchase revenue', () => {
    const body = buildRunReportBody({ startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(body.dimensions.map((d) => d.name)).toEqual(['sessionSource', 'sessionMedium', 'sessionCampaignName']);
    expect(body.metrics.map((m) => m.name)).toContain('purchaseRevenue');
    expect(body.dateRanges[0]).toEqual({ startDate: '2026-01-01', endDate: '2026-01-31' });
  });
  it('mapGa4Response reads parallel dimension/metric arrays by position', () => {
    const mapped = mapGa4Response({ rows: [{ dimensionValues: [{ value: 'facebook' }, { value: 'cpc' }, { value: 'Eid Sale' }], metricValues: [{ value: '210.5' }, { value: '5' }] }] });
    expect(mapped).toEqual([{ source: 'facebook', medium: 'cpc', campaignName: 'Eid Sale', revenue: 210.5, conversions: 5 }]);
  });
});
