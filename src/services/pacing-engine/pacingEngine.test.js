// ============================================================
// PacingEngine — burn-rate projection correctness
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { projectPacing, PACE_STATUS } from './pacingEngine.js';

describe('pacingEngine.projectPacing', () => {
  it('flags OVER and reports how many days early the budget exhausts', () => {
    // 30-day month, budget 300,000 (10,000/day for on-track). Spent 120,000
    // in 10 days = 12,000/day ⇒ exhausts on day 25 ⇒ ~5 days early.
    const r = projectPacing({ monthlyBudgetMinor: 300_000, spentMinor: 120_000, daysElapsed: 10, daysInPeriod: 30 });
    expect(r.status).toBe(PACE_STATUS.OVER);
    expect(r.projectedSpendMinor).toBe(360_000);
    expect(r.paceRatio).toBeCloseTo(1.2, 5);
    expect(r.exhaustsOnDay).toBe(25);
    expect(r.daysEarly).toBe(5);
  });

  it('reproduces the "exhausts 6 days early" headline', () => {
    // budget 300k, 24 days in, spent 240k ⇒ 10k/day... tune to land 6 early:
    // 30-day month, run rate that exhausts on day 24 ⇒ rate = 300k/24 = 12,500/day.
    const r = projectPacing({ monthlyBudgetMinor: 300_000, spentMinor: 125_000, daysElapsed: 10, daysInPeriod: 30 });
    expect(r.exhaustsOnDay).toBe(24);
    expect(r.daysEarly).toBe(6);
    expect(r.status).toBe(PACE_STATUS.OVER);
  });

  it('reports ON_TRACK when projected spend lands on budget', () => {
    const r = projectPacing({ monthlyBudgetMinor: 300_000, spentMinor: 100_000, daysElapsed: 10, daysInPeriod: 30 });
    expect(r.status).toBe(PACE_STATUS.ON_TRACK);
    expect(r.projectedSpendMinor).toBe(300_000);
    expect(r.daysEarly).toBe(0);
  });

  it('reports UNDER when under-pacing (leftover budget)', () => {
    const r = projectPacing({ monthlyBudgetMinor: 300_000, spentMinor: 50_000, daysElapsed: 10, daysInPeriod: 30 });
    expect(r.status).toBe(PACE_STATUS.UNDER);
    expect(r.projectedSpendMinor).toBe(150_000);
    expect(r.daysEarly).toBeLessThan(0); // exhausts AFTER the period (never, within it)
  });

  it('handles day 0 (no run rate yet) without dividing by zero', () => {
    const r = projectPacing({ monthlyBudgetMinor: 300_000, spentMinor: 0, daysElapsed: 0, daysInPeriod: 30 });
    expect(r.runRateMinor).toBe(0);
    expect(r.projectedSpendMinor).toBe(0);
    expect(r.exhaustsOnDay).toBeNull();
    expect(r.daysEarly).toBeNull();
  });

  it('validates inputs', () => {
    expect(() => projectPacing({ monthlyBudgetMinor: 0, spentMinor: 1, daysElapsed: 1, daysInPeriod: 30 })).toThrow(/monthlyBudgetMinor/);
    expect(() => projectPacing({ monthlyBudgetMinor: 100, spentMinor: 1, daysElapsed: 40, daysInPeriod: 30 })).toThrow(/daysElapsed/);
  });
});
