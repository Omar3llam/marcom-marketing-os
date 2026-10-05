import { describe, it, expect } from 'vitest';
import { authoritativeMoney } from './operationalMonetary.js';
import { exactRevenueWindow, unknownRevenueWindow } from './revenueMeasurementWindow.js';
import { evaluateRevenueReconciliation, aggregateRevenueReconciliations, RECONCILIATION_KNOWLEDGE } from './revenueReconciliation.js';
const window = exactRevenueWindow('2026-08-01', '2026-08-30');
const money = (currency = 'EGP', currencyProvenance = 'PLATFORM_REPORTED') => authoritativeMoney([{ amountMinor: 100, currency, currencyProvenance }]);
const input = (over = {}) => ({ actualPresent: true, platformRevenueMinor: 100, actualRevenueMinor: 75,
  platformMoney: money(), actualMoney: money(), platformWindow: window, actualWindow: window, ...over });
describe('one pure revenue reconciliation authority', () => {
  it.each(['LEGACY_UNKNOWN', 'WORKSPACE_INFERRED', 'FALLBACK_DEFAULT', 'SNAPSHOT_INFERRED', 'USER_SUPPLIED', null])('never promotes %s money provenance', origin => {
    expect(evaluateRevenueReconciliation(input({ actualMoney: money('EGP', origin) }))).toMatchObject({ status: 'UNAVAILABLE', reason: 'MONETARY_BASIS_UNAVAILABLE', gapMinor: null });
  });
  it.each([null, undefined, NaN, Infinity])('requires finite actual revenue: %s', actualRevenueMinor => {
    expect(evaluateRevenueReconciliation(input({ actualRevenueMinor }))).toMatchObject({ status: 'UNAVAILABLE', gapMinor: null });
  });
  it('requires a real platform population even for numeric zero', () => {
    expect(evaluateRevenueReconciliation(input({ platformPresent: false, platformRevenueMinor: 0 }))).toMatchObject({ status: 'UNAVAILABLE', gapMinor: null });
  });
  it('unknown evidence carries no invented common window', () => {
    expect(evaluateRevenueReconciliation(input({ platformWindow: unknownRevenueWindow() })).window).toEqual(unknownRevenueWindow());
  });
  it('combines genuine opposite signed gaps into a portfolio match', () => {
    const a = evaluateRevenueReconciliation(input());
    const b = evaluateRevenueReconciliation(input({ actualRevenueMinor: 125 }));
    expect(aggregateRevenueReconciliations([a, b])).toMatchObject({ status: 'AVAILABLE', gapMinor: 0, gapPct: 0, reconciledCount: 2 });
  });
  it('no comparable population does not become zero', () => {
    const unavailable = evaluateRevenueReconciliation(input({ actualWindow: unknownRevenueWindow() }));
    expect(aggregateRevenueReconciliations([unavailable])).toMatchObject({ status: 'UNAVAILABLE', reason: 'NO_COMPARABLE_CHANNELS', gapMinor: null });
    expect(aggregateRevenueReconciliations([])).toMatchObject({ status: 'UNVERIFIED', gapMinor: null, totalChannelCount: 0 });
  });
  it('registers every public status epistemically', () => expect(RECONCILIATION_KNOWLEDGE).toBeDefined());
});
