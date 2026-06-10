import { describe, it, expect } from 'vitest';
import { metaNormalize } from './normalize/metaNormalize.js';
import { csvNormalize } from './normalize/csvNormalize.js';
import { googleNormalize, microsToMinor } from './normalize/googleNormalize.js';
import { toSnapshotRows, toEntityOps } from './snapshotSink.js';
import { assertNormalized } from './ChannelConnector.js';
import { nextHealth } from './connectorHealth.js';
import { isStale, detId } from './connectorTypes.js';
import { resolve } from './connectorRegistry.js';
import { buildChannelInputs } from '../blended-truth/BlendedTruthService.js';
import { reconcile } from '../blended-truth/blendedTruthEngine.js';

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
    expect(() => resolve('FOURSQUARE')).toThrow(/no connector registered/);
  });
});
