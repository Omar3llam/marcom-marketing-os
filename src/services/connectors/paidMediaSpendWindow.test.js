import { describe, expect, it, vi } from 'vitest';
import { sourceLocalDayWindow } from '../../lib/sourceLocalDayWindow.js';
import {
  compareRevenueWindows, exactRevenueWindow, PERIOD_COMPATIBILITY, spendWindowOfSnapshot,
  revenueWindowOfSnapshot,
} from '../../lib/revenueMeasurementWindow.js';
import { metaNormalize } from './normalize/metaNormalize.js';
import { metaDailyNormalize } from './normalize/metaDailyNormalize.js';
import { googleNormalize } from './normalize/googleNormalize.js';
import { toSnapshotRows } from './snapshotSink.js';
import { buildChannelInputs } from '../blended-truth/BlendedTruthService.js';
import { reconcile } from '../blended-truth/blendedTruthEngine.js';
import { resolvePeriodSpend, PERIOD_COVERAGE } from '../budget-period/spendPeriod.js';
import { fetchAccountTimezone } from '../metaAdsService.js';
import { fetchGoogleCampaignMetrics, fetchGoogleCustomerTimezone } from './google/googleAdsClient.js';

const day = (value) => new Date(`${value}T00:00:00.000Z`);
const metaRaw = (over = {}) => ({
  campaign_id: 'm1', campaign_name: 'M', spend: '100.00', impressions: '1000', clicks: '10',
  date_start: '2026-09-01', date_stop: '2026-09-30', ...over,
});
const metaCampaign = (over = {}, accountTimeZone = null) => metaNormalize({
  accountExternalId: 'act_1', currency: 'USD', currencyProvenance: 'PLATFORM_REPORTED',
  date: day('2026-10-01'), accountTimeZone, rows: [metaRaw(over)],
}).find((r) => r.entityLevel === 'CAMPAIGN');

describe('paid-media source-local dates become UTC instants only with source timezone proof', () => {
  it('reads Meta timezone_name from the ad account, without a workspace fallback', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ timezone_name: 'America/New_York' }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await fetchAccountTimezone('token', '123')).toBe('America/New_York');
      expect(String(fetchMock.mock.calls[0][0])).toContain('act_123?fields=timezone_name');
    } finally { vi.unstubAllGlobals(); }
  });

  it('reads Google customer.time_zone and carries the completed report range', async () => {
    const keys = ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET'];
    const saved = keys.map((key) => process.env[key]);
    keys.forEach((key) => { process.env[key] = 'test-value'; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ results: [{ customer: { timeZone: 'Asia/Tokyo' } }] }]) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ results: [{
        campaign: { id: 'g1' }, metrics: { costMicros: '1000000' },
      }] }]) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const auth = { accountExternalId: '123', refreshToken: 'refresh' };
      expect(await fetchGoogleCustomerTimezone(auth)).toBe('Asia/Tokyo');
      expect(JSON.parse(fetchMock.mock.calls[1][1].body).query).toBe('SELECT customer.time_zone FROM customer');
      const rows = await fetchGoogleCampaignMetrics(auth, { since: '2026-09-01', until: '2026-09-30' });
      expect(rows.reportedRange).toEqual({ startDate: '2026-09-01', endDate: '2026-09-30' });
      expect(JSON.parse(fetchMock.mock.calls[3][1].body).query)
        .toContain("segments.date BETWEEN '2026-09-01' AND '2026-09-30'");
    } finally {
      vi.unstubAllGlobals();
      keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
    }
  });

  it('Meta uses its returned inclusive dates and account timezone, including a non-UTC zone', () => {
    const row = metaCampaign({}, 'America/New_York');
    expect(row.windowStart).toEqual(day('2026-09-01')); // legacy day-label representation
    expect(row.windowEnd).toEqual(day('2026-09-30'));
    expect(row.spendWindowStartUtc?.toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(row.spendWindowEndUtc?.toISOString()).toBe('2026-10-01T03:59:59.999Z');
  });

  it('Meta daily observations preserve their own exact local-day interval', () => {
    const { snapshots } = metaDailyNormalize({
      accountExternalId: 'act_1', currency: 'USD', accountTimeZone: 'America/New_York',
      date: day('2026-10-01'), rows: [metaRaw({ date_start: '2026-09-30' })],
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].spendWindowStartUtc?.toISOString()).toBe('2026-09-30T04:00:00.000Z');
    expect(snapshots[0].spendWindowEndUtc?.toISOString()).toBe('2026-10-01T03:59:59.999Z');
  });

  it('applies the offset on each boundary across DST, not one fixed offset', () => {
    const row = metaCampaign({ date_start: '2026-03-07', date_stop: '2026-03-09' }, 'America/New_York');
    expect(row.spendWindowStartUtc?.toISOString()).toBe('2026-03-07T05:00:00.000Z');
    expect(row.spendWindowEndUtc?.toISOString()).toBe('2026-03-10T03:59:59.999Z');
  });

  it('a date_stop without account timezone stays unknown; invalid or workspace zones cannot substitute', () => {
    const row = metaCampaign();
    expect(row.windowEnd).toEqual(day('2026-09-30'));
    expect(row.spendWindowStartUtc).toBeNull();
    expect(row.spendWindowEndUtc).toBeNull();
    expect(spendWindowOfSnapshot(row).windowStatus).toBe('UNKNOWN');
    expect(sourceLocalDayWindow('2026-09-01', '2026-09-30', 'bad-zone').windowStatus).toBe('UNKNOWN');
    const withWorkspaceZoneOnly = metaNormalize({
      accountExternalId: 'act_1', currency: 'USD', date: day('2026-10-01'),
      workspaceTimeZone: 'UTC', rows: [metaRaw()],
    });
    expect(withWorkspaceZoneOnly.find((r) => r.entityLevel === 'CAMPAIGN').spendWindowStartUtc).toBeNull();
  });

  it('Meta requested canonical bounds never replace missing source dates as instant proof', () => {
    const [row] = metaNormalize({
      accountExternalId: 'act_1', currency: 'USD', accountTimeZone: 'UTC',
      date: day('2026-10-01'), rows: [metaRaw({ date_start: null, date_stop: null })],
      requestedWindowStart: day('2026-09-01'), requestedWindowEnd: day('2026-09-30'),
    }).filter((r) => r.entityLevel === 'CAMPAIGN');
    expect(row.windowStart).toEqual(day('2026-09-01'));
    expect(row.spendWindowStartUtc).toBeNull();
  });

  it('Google completed report range and its own customer timezone establish the interval', () => {
    const row = googleNormalize({
      accountExternalId: 'g1', currency: 'USD', accountTimeZone: 'Asia/Tokyo',
      date: day('2026-10-01'), reportedRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
      rows: [{ campaign: { id: 'g-c1', name: 'G' }, metrics: { cost_micros: 1_000_000 } }],
    }).find((r) => r.entityLevel === 'CAMPAIGN');
    expect(row.spendWindowStartUtc?.toISOString()).toBe('2026-08-31T15:00:00.000Z');
    expect(row.spendWindowEndUtc?.toISOString()).toBe('2026-09-30T14:59:59.999Z');
    expect(row.windowStart).toEqual(day('2026-09-01'));
  });

  it('Google missing report range or customer timezone is unknown, even with workspace timezone', () => {
    const input = {
      accountExternalId: 'g1', currency: 'USD', date: day('2026-10-01'),
      rows: [{ campaign: { id: 'g-c1' }, metrics: { cost_micros: 1_000_000 } }],
    };
    const campaign = (args) => googleNormalize({ ...input, ...args }).find((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaign({ accountTimeZone: 'UTC' }).spendWindowStartUtc).toBeNull();
    expect(campaign({ reportedRange: { startDate: '2026-09-01', endDate: '2026-09-30' }, workspaceTimeZone: 'UTC' }).spendWindowStartUtc).toBeNull();
  });
});

describe('spend population and compatibility', () => {
  const exact = sourceLocalDayWindow('2026-09-01', '2026-09-30', 'UTC');
  const snapshot = (entityId, over = {}) => ({
    entityId, source: 'META', date: day('2026-10-01'), measurementWindow: 'ROLLING_WINDOW',
    windowStart: day('2026-09-01'), windowEnd: day('2026-09-30'),
    spendWindowStartUtc: exact.windowStart, spendWindowEndUtc: exact.windowEnd,
    spendMinor: 10000, revenueMinor: 20000, currency: 'USD',
    currencyProvenance: 'PLATFORM_REPORTED', ...over,
  });

  it('aggregate remains exact only when every contributor has the same proven interval', () => {
    const same = reconcile({ channels: buildChannelInputs([snapshot('a'), snapshot('b')]) });
    expect(same.portfolio.spendWindow).toEqual(exact);
    expect(same.portfolio.spendMinor).toBe(20000);
    const mismatch = reconcile({ channels: buildChannelInputs([
      snapshot('a'), snapshot('b', { spendWindowStartUtc: day('2026-09-02') }),
    ]) });
    expect(mismatch.portfolio.spendWindow.windowStatus).toBe('UNKNOWN');
    expect(mismatch.portfolio.spendMinor).toBe(20000); // no contributor dropped
    const unknown = reconcile({ channels: buildChannelInputs([
      snapshot('a'), snapshot('b', { spendWindowStartUtc: null, spendWindowEndUtc: null }),
    ]) });
    expect(unknown.portfolio.spendWindow.windowStatus).toBe('UNKNOWN');
    expect(unknown.portfolio.spendMinor).toBe(20000);
  });

  it('revenue-only channels do not erase spend evidence, while zero-spend platform rows still participate', () => {
    const actualOnly = {
      entityId: 'actual-only', source: 'GA4', date: day('2026-10-01'),
      measurementWindow: 'ROLLING_WINDOW', windowStart: exact.windowStart, windowEnd: exact.windowEnd,
      spendMinor: 0, revenueMinor: 500, currency: 'USD', currencyProvenance: 'PLATFORM_REPORTED',
    };
    const withActual = reconcile({ channels: buildChannelInputs([snapshot('a'), actualOnly]) });
    expect(withActual.portfolio.spendWindow).toEqual(exact);
    const withZeroPlatform = reconcile({ channels: buildChannelInputs([
      snapshot('a'), snapshot('b', { spendMinor: 0, spendWindowStartUtc: null, spendWindowEndUtc: null }),
    ]) });
    expect(withZeroPlatform.portfolio.spendWindow.windowStatus).toBe('UNKNOWN');
  });

  it('spendPeriod preserves amount and currency while publishing independent exact or unknown UTC evidence', () => {
    const period = { start: '2026-09-01', end: '2026-09-30' };
    const resolved = resolvePeriodSpend([snapshot('a')], period, { coverage: PERIOD_COVERAGE.COMPLETE });
    expect(resolved.portfolio).toMatchObject({ spendMinor: 10000, currency: 'USD', spendWindow: exact });
    const legacy = resolvePeriodSpend([snapshot('a', { spendWindowStartUtc: null, spendWindowEndUtc: null })],
      period, { coverage: PERIOD_COVERAGE.COMPLETE });
    expect(legacy.portfolio.spendMinor).toBe(10000);
    expect(legacy.portfolio.spendWindow.windowStatus).toBe('UNKNOWN');
  });

  it('legacy date labels cannot become proven platform revenue or spend windows', () => {
    const legacy = snapshot('a', { spendWindowStartUtc: null, spendWindowEndUtc: null });
    expect(revenueWindowOfSnapshot(legacy).windowStatus).toBe('UNKNOWN');
    expect(spendWindowOfSnapshot(legacy).windowStatus).toBe('UNKNOWN');
    const row = toSnapshotRows('ws', 'META', [metaCampaign()])[0];
    expect(row.spendWindowStartUtc).toBeNull();
    expect(row.spendWindowEndUtc).toBeNull();
  });

  it('compares exact UTC bounds, not same labels, observation date, or overlap', () => {
    const ga4 = exactRevenueWindow(exact.windowStart, exact.windowEnd);
    expect(compareRevenueWindows(exact, ga4)).toBe(PERIOD_COMPATIBILITY.COMPATIBLE);
    const tokyo = sourceLocalDayWindow('2026-09-01', '2026-09-30', 'Asia/Tokyo');
    expect(compareRevenueWindows(exact, tokyo)).toBe(PERIOD_COMPATIBILITY.INCOMPATIBLE);
    expect(compareRevenueWindows(exact, sourceLocalDayWindow('2026-09-02', '2026-09-30', 'UTC')))
      .toBe(PERIOD_COMPATIBILITY.INCOMPATIBLE);
    expect(compareRevenueWindows(exact, exactRevenueWindow(null, null))).toBe(PERIOD_COMPATIBILITY.UNKNOWN);
  });
});
