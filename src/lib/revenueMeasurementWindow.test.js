import { describe, expect, it } from 'vitest';
import {
  combineRevenueWindows, compareRevenueWindows, exactRevenueWindow,
  PERIOD_COMPATIBILITY, revenueWindowOfSnapshot, REVENUE_WINDOW_STATUS,
} from './revenueMeasurementWindow.js';

const exact = (start, end) => exactRevenueWindow(`${start}T00:00:00Z`, `${end}T23:59:59.999Z`);

describe('revenue measurement-window evidence', () => {
  it('keeps legacy and absent bounds unknown, even beside a sync timestamp', () => {
    const sync = new Date('2026-09-23T12:00:00Z');
    expect(revenueWindowOfSnapshot({ date: sync, measurementWindow: 'LEGACY_UNKNOWN',
      windowStart: sync, windowEnd: sync }).windowStatus).toBe(REVENUE_WINDOW_STATUS.UNKNOWN);
    expect(revenueWindowOfSnapshot({ date: sync, measurementWindow: 'ROLLING_WINDOW' }).windowStatus)
      .toBe(REVENUE_WINDOW_STATUS.UNKNOWN);
    expect(revenueWindowOfSnapshot({ date: sync, windowStart: sync, windowEnd: sync }).windowStatus)
      .toBe(REVENUE_WINDOW_STATUS.UNKNOWN);
  });

  it('requires identical exact bounds; overlap alone is incompatible', () => {
    const revenue = exact('2026-09-01', '2026-09-30');
    expect(compareRevenueWindows(revenue, exact('2026-09-01', '2026-09-30')))
      .toBe(PERIOD_COMPATIBILITY.COMPATIBLE);
    expect(compareRevenueWindows(revenue, exact('2026-09-02', '2026-09-30')))
      .toBe(PERIOD_COMPATIBILITY.INCOMPATIBLE);
    expect(compareRevenueWindows(revenue, exactRevenueWindow(null, null)))
      .toBe(PERIOD_COMPATIBILITY.UNKNOWN);
  });

  it('aggregates only matching known windows; mixed or missing evidence is unknown', () => {
    const a = exact('2026-09-01', '2026-09-30');
    expect(combineRevenueWindows([a, a]).windowStatus).toBe(REVENUE_WINDOW_STATUS.EXACT);
    expect(combineRevenueWindows([a, exact('2026-09-02', '2026-09-30')]).windowStatus)
      .toBe(REVENUE_WINDOW_STATUS.UNKNOWN);
    expect(combineRevenueWindows([a, exactRevenueWindow(null, null)]).windowStatus)
      .toBe(REVENUE_WINDOW_STATUS.UNKNOWN);
  });
});
