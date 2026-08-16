// ============================================================
// R8 — a daily observation is one the PLATFORM says is one
// ============================================================
// The normalizer is pure, so this file can hold it to the whole contract without
// a network, a database or a clock. What it protects:
//
//   • the request asks for one day; only date_start/date_stop can confirm one,
//     and a row that does not confirm it is REFUSED rather than relabelled
//   • the measured day and the observation instant are different columns and
//     neither may stand in for the other
//   • the additive primitives land; the CUMULATIVE ones (reach, frequency) do
//     not, because a daily reach is a different quantity from a window reach
//   • a metric that cannot be stored honestly keeps the row out of the database
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { metaDailyNormalize, dailyEligibility, DAILY_REJECTION } from './metaDailyNormalize.js';
import { dailyInsightsParams, DAILY_INSIGHT_FIELDS } from '../../metaAdsService.js';

const OBSERVED = new Date('2026-08-16T09:00:00.000Z'); // the sync instant
const ACCOUNT = 'act_123';

// One raw Meta row as `time_increment=1` returns it: a single campaign, a single
// day, the day stated in the row's own dates.
const dayRow = (over = {}) => ({
  campaign_id: 'c1',
  campaign_name: 'Eid — Cold',
  spend: '420.50',
  impressions: '15000',
  clicks: '300',
  actions: [{ action_type: 'purchase', value: '12' }],
  action_values: [{ action_type: 'purchase', value: '2100' }],
  date_start: '2026-08-10',
  date_stop: '2026-08-10',
  ...over,
});

const run = (rows, over = {}) => metaDailyNormalize({
  accountExternalId: ACCOUNT, currency: 'EGP', date: OBSERVED, rows, ...over,
});

describe('R8 — the request that makes a response daily', () => {
  it('sends time_increment=1 — the one parameter the whole phase rests on', () => {
    expect(dailyInsightsParams(OBSERVED, 7).time_increment).toBe(1);
  });

  it('states an explicit inclusive time_range rather than trusting a preset', () => {
    // Phase F's argument, reused: a preset is Meta's definition of a period, and
    // we would then have to trust and validate what it meant. 7 days ending on
    // the 16th is the 10th through the 16th — seven days, not six or eight.
    const params = dailyInsightsParams(OBSERVED, 7);
    expect(params.time_range).toEqual({ since: '2026-08-10', until: '2026-08-16' });
    expect(params.date_preset).toBeUndefined();
  });

  it('asks at campaign level only — rows scale as campaigns × days', () => {
    expect(dailyInsightsParams(OBSERVED, 7).level).toBe('campaign');
  });

  it('does not request the CUMULATIVE metrics it must not carry', () => {
    // reach and frequency count unique people; they do not sum across days. Not
    // asking for them is stronger than asking and discarding.
    expect(DAILY_INSIGHT_FIELDS).not.toContain('reach');
    expect(DAILY_INSIGHT_FIELDS).not.toContain('frequency');
    expect(DAILY_INSIGHT_FIELDS).toContain('date_start');
    expect(DAILY_INSIGHT_FIELDS).toContain('date_stop');
  });

  it('refuses a zero-day request rather than ingesting nothing successfully', () => {
    expect(() => dailyInsightsParams(OBSERVED, 0)).toThrow(/positive integer/);
  });
});

describe('R8 — eligibility: only the platform can call a row daily', () => {
  it('accepts a row whose own dates say one day', () => {
    const v = dailyEligibility(dayRow());
    expect(v.ok).toBe(true);
    expect(v.windowStart).toEqual(new Date('2026-08-10T00:00:00.000Z'));
    expect(v.windowEnd).toEqual(new Date('2026-08-10T00:00:00.000Z'));
  });

  it('REFUSES a trailing 90-day response — a rolling row is never relabelled daily', () => {
    // THE control this module exists for. If Meta ignores time_increment, or a
    // preset leaks into the request, the response is an aggregate. Labelling it
    // DAILY would put 90 days of spend into a population whose whole contract is
    // that Σ across rows is exact.
    const v = dailyEligibility(dayRow({ date_start: '2026-05-13', date_stop: '2026-08-10' }));
    expect(v.ok).toBe(false);
    expect(v.reason).toBe(DAILY_REJECTION.NOT_ONE_DAY);
  });

  it('REFUSES a row that reports no period at all', () => {
    expect(dailyEligibility(dayRow({ date_start: null, date_stop: null })).reason)
      .toBe(DAILY_REJECTION.MISSING_PERIOD);
  });

  it('REFUSES an unparseable or inverted period', () => {
    expect(dailyEligibility(dayRow({ date_start: 'yesterday' })).reason).toBe(DAILY_REJECTION.MALFORMED_PERIOD);
    expect(dailyEligibility(dayRow({ date_start: '2026-08-11', date_stop: '2026-08-10' })).reason)
      .toBe(DAILY_REJECTION.MALFORMED_PERIOD);
  });

  it('REFUSES a row with no spend field — "unknown" is not a storable value', () => {
    // spendMinor is NOT NULL. Storing an absent measurement would mean inventing
    // a 0, and a fabricated zero in an additive daily population is the worst
    // possible lie: it sums.
    expect(dailyEligibility(dayRow({ spend: undefined })).reason).toBe(DAILY_REJECTION.MISSING_MEASURE);
    expect(dailyEligibility(dayRow({ spend: null })).reason).toBe(DAILY_REJECTION.MISSING_MEASURE);
    expect(dailyEligibility(dayRow({ spend: '' })).reason).toBe(DAILY_REJECTION.MISSING_MEASURE);
  });

  it('ACCEPTS a measured zero — absence and zero are different facts', () => {
    // A day the campaign was live and spent nothing is a real observation, and
    // the distinction between it and a missing field is the whole point.
    const v = dailyEligibility(dayRow({ spend: '0' }));
    expect(v.ok).toBe(true);
  });

  it('REFUSES a row with no identity', () => {
    expect(dailyEligibility({ ...dayRow(), campaign_id: null, campaign_name: null }).reason)
      .toBe(DAILY_REJECTION.NO_IDENTITY);
  });
});

describe('R8 — what a normalized daily row says', () => {
  it('separates the day it measured from the moment it was observed', () => {
    // The distinction this whole population exists to make. `date` is when we
    // looked; windowStart/windowEnd are what we looked at.
    const { snapshots } = run([dayRow()]);
    expect(snapshots).toHaveLength(1);
    const [s] = snapshots;
    expect(s.date).toBe(OBSERVED);
    expect(s.windowStart).toEqual(new Date('2026-08-10T00:00:00.000Z'));
    expect(s.windowEnd).toEqual(new Date('2026-08-10T00:00:00.000Z'));
    expect(s.date).not.toEqual(s.windowStart);
  });

  it('declares the DAILY measurement window, never ROLLING_WINDOW', () => {
    const [s] = run([dayRow()]).snapshots;
    expect(s.measurementWindow).toBe('DAILY');
  });

  it('lands the additive primitives as the platform reported them', () => {
    const [s] = run([dayRow()]).snapshots;
    expect(s.spendMinor).toBe(42050);      // EGP piastres
    expect(s.revenueMinor).toBe(210000);
    expect(s.impressions).toBe(15000);
    expect(s.clicks).toBe(300);
    expect(s.conversions).toBe(12);
  });

  it('carries NULL for the cumulative metrics — not zero, and not a daily value', () => {
    // A daily reach is a real number that answers a different question, and it
    // does not sum. null says "this row does not answer that"; 0 would say
    // "nobody was reached", which is false.
    const [s] = run([dayRow({ reach: '9000', frequency: '1.7' })]).snapshots;
    expect(s.reach).toBeNull();
    expect(s.frequency).toBeNull();
  });

  it('takes the MAX across overlapping purchase aliases, never the sum', () => {
    // omni_purchase already contains the pixel purchases. Summing them is the
    // 2× conversions defect the rest of the normalizer exists to avoid, and the
    // daily population must not reintroduce it.
    const [s] = run([dayRow({
      actions: [
        { action_type: 'purchase', value: '12' },
        { action_type: 'omni_purchase', value: '12' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '10' },
      ],
    })]).snapshots;
    expect(s.conversions).toBe(12);
  });

  it('one campaign over three days becomes three rows, one observation instant', () => {
    const rows = ['2026-08-08', '2026-08-09', '2026-08-10']
      .map((d) => dayRow({ date_start: d, date_stop: d, spend: '100' }));
    const { snapshots } = run(rows);
    expect(snapshots).toHaveLength(3);
    expect(new Set(snapshots.map((s) => s.windowStart.toISOString())).size).toBe(3);
    expect(new Set(snapshots.map((s) => s.date))).toEqual(new Set([OBSERVED]));
  });

  it('builds NO account rollup — the reason this is not a mode of metaNormalize', () => {
    // metaNormalize sums its campaigns into one ACCOUNT row. Over rows covering
    // different days that sum is a week of spend wearing one day's period.
    const { snapshots } = run([
      dayRow({ date_start: '2026-08-09', date_stop: '2026-08-09' }),
      dayRow({ date_start: '2026-08-10', date_stop: '2026-08-10' }),
    ]);
    expect(snapshots.every((s) => s.entityLevel === 'CAMPAIGN')).toBe(true);
    expect(snapshots.some((s) => s.entityLevel === 'ACCOUNT')).toBe(false);
  });

  it('drops refused rows and reports why, instead of landing them', () => {
    const { snapshots, rejected } = run([
      dayRow(),
      dayRow({ campaign_id: 'c2', date_start: '2026-05-13', date_stop: '2026-08-10' }),
      dayRow({ campaign_id: 'c3', spend: null }),
    ]);
    expect(snapshots).toHaveLength(1);
    expect(rejected).toEqual([
      { externalId: 'c2', reason: DAILY_REJECTION.NOT_ONE_DAY },
      { externalId: 'c3', reason: DAILY_REJECTION.MISSING_MEASURE },
    ]);
  });

  it('unwraps the SDK envelope, like every other normalizer', () => {
    const { snapshots } = run([{ _data: dayRow() }]);
    expect(snapshots).toHaveLength(1);
  });

  it('returns nothing at all for an account that returned nothing', () => {
    // Not a zero row, not a placeholder day. An account with no delivery in the
    // window has no daily observations.
    expect(run([]).snapshots).toEqual([]);
  });
});
