import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../lib/prisma.js', () => ({ prisma: { decision: { findFirst: vi.fn() }, campaign: { findFirst: vi.fn() } } }));
vi.mock('../daily-observations/dailyObservationReader.js', () => ({ readDailyObservations: vi.fn() }));
vi.mock('../connectors/connectorRegistry.js', () => ({ resolve: () => ({ fetchDailyRaw() {}, normalizeDaily() {} }) }));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));
import { prisma } from '../../lib/prisma.js';
import { readDailyObservations } from '../daily-observations/dailyObservationReader.js';
import { aggregateWindow, readOutcomeEvidence } from './outcomeEvidenceComparison.js';
import { comparisonWindows } from './comparisonWindow.js';

const boundary = new Date('2026-08-10T09:30:00.000Z');
const windows = comparisonWindows(boundary);
const row = (day, over = {}) => ({ id: day, day, entityId: 'entity', entityLevel: 'CAMPAIGN',
  source: 'META', measurementWindow: 'DAILY', windowStart: new Date(day), windowEnd: new Date(day),
  observedAt: new Date('2026-08-20'), spendMinor: 100, revenueMinor: 200,
  currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED', ...over });
const rows = (days, over = {}) => days.map(day => row(day, over));
const noMoney = { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null };
const aggregate = rs => aggregateWindow(rs.map(r => r.day), new Map(rs.map(r => [r.day, r])));
beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.findFirst.mockResolvedValue({ id: 'decision', entityId: 'entity', entityLevel: 'CAMPAIGN',
    verdict: 'KILL', humanExecutedAt: boundary });
  prisma.campaign.findFirst.mockResolvedValue({ channel: 'META' });
  readDailyObservations.mockResolvedValue({ before: rows(windows.baseline.days), after: rows(windows.observation.days) });
});

describe('P7-07C window monetary basis', () => {
  it.each([
    { currency: 'USD' }, { currency: null }, { currency: 'ZZZ' },
    ...['LEGACY_UNKNOWN', 'WORKSPACE_INFERRED', 'FALLBACK_DEFAULT', 'SNAPSHOT_INFERRED', 'USER_SUPPLIED', null]
      .map(currencyProvenance => ({ currencyProvenance })),
  ])('withholds all money for an unsafe contributing row %j, retaining coverage and refs', over => {
    const rs = [row('2026-08-03'), row('2026-08-04', over)];
    const result = aggregate(rs);
    expect(result).toMatchObject(noMoney);
    expect(result.coverage).toEqual({ required: 2, observed: 2, missing: [], complete: true });
    expect(result.refs).toEqual(rs.map(r => ({ id: r.id, day: r.day, observedAt: r.observedAt })));
  });
  it('preserves exact seven-day authoritative EGP sums', () => {
    expect(aggregate(rows(windows.baseline.days))).toMatchObject({ spendMinor: 700, revenueMinor: 1400,
      roas: 2, currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED' });
  });
  it('does not borrow denomination from rows without numeric money', () => {
    expect(aggregate([row('2026-08-03', { spendMinor: null, revenueMinor: null })])).toMatchObject(noMoney);
  });
  it('retains a genuine zero revenue and zero ROAS', () => {
    expect(aggregate([row('2026-08-03', { revenueMinor: 0 })])).toMatchObject({ spendMinor: 100, revenueMinor: 0, roas: 0 });
  });
  it('retains measured zero spend with null ROAS', () => {
    expect(aggregate([row('2026-08-03', { spendMinor: 0 })])).toMatchObject({ spendMinor: 0, revenueMinor: 200, roas: null });
  });
  it('does not treat a missing revenue as zero or derive ROAS', () => {
    expect(aggregate([row('2026-08-03', { revenueMinor: null })])).toMatchObject({ spendMinor: 100, revenueMinor: null, roas: null, currency: 'EGP' });
  });
  it('empty observations remain absent', () => { expect(aggregate([])).toMatchObject(noMoney); });
});

describe('P7-07C comparison authority and state precedence', () => {
  it.each([{ currency: 'USD' }, { currencyProvenance: 'LEGACY_UNKNOWN' }, { currency: null }])(
    'complete unsafe monetary comparisons refuse without discarding observation identity %j', async over => {
      readDailyObservations.mockResolvedValue({ before: rows(windows.baseline.days), after: rows(windows.observation.days, over) });
      const result = await readOutcomeEvidence('ws', 'decision');
      expect(result).toMatchObject({ status: 'NOT_MEASURABLE', reason: 'MONETARY_BASIS_UNAVAILABLE', delta: noMoney });
      expect(result.baseline.spendMinor).toBe(700);
      expect(result.observation.coverage.complete).toBe(true);
      expect(result.observation.refs).toHaveLength(7);
    });
  it('complete same-currency evidence retains exact deltas and their denomination', async () => {
    readDailyObservations.mockResolvedValue({ before: rows(windows.baseline.days), after: rows(windows.observation.days, { spendMinor: 50, revenueMinor: 0 }) });
    expect(await readOutcomeEvidence('ws', 'decision')).toMatchObject({ status: 'MEASURABLE',
      delta: { spendMinor: -350, revenueMinor: -1400, roas: -2, currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED' } });
  });
  it('coverage precedes monetary refusal and preserves each safe side', async () => {
    readDailyObservations.mockResolvedValue({ before: rows(windows.baseline.days), after: rows(windows.observation.days.slice(0, 4), { currency: 'USD' }) });
    expect(await readOutcomeEvidence('ws', 'decision')).toMatchObject({ status: 'INSUFFICIENT_COVERAGE',
      baseline: { currency: 'EGP' }, observation: { currency: 'USD', spendMinor: 400 }, delta: noMoney });
  });
  it('ambiguous evidence still withdraws affected totals', async () => {
    readDailyObservations.mockResolvedValue({ before: rows(windows.baseline.days), after: rows(windows.observation.days, { ambiguous: true }) });
    expect(await readOutcomeEvidence('ws', 'decision')).toMatchObject({ status: 'AMBIGUOUS', observation: noMoney, delta: noMoney });
  });
  it('no rows remain NOT_OBSERVED', async () => {
    readDailyObservations.mockResolvedValue({ before: [], after: [] });
    expect(await readOutcomeEvidence('ws', 'decision')).toMatchObject({ status: 'NOT_OBSERVED', baseline: noMoney, observation: noMoney, delta: noMoney });
  });
  it('failed read remains UNAVAILABLE', async () => {
    readDailyObservations.mockRejectedValue(new Error('read failed'));
    expect(await readOutcomeEvidence('ws', 'decision')).toMatchObject({ status: 'UNAVAILABLE', baseline: null, observation: null, delta: noMoney });
  });
});
