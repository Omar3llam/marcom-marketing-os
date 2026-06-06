// ============================================================
// FatigueForecaster — unit tests
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { forecastFatigue } from './fatigueForecaster.js';

// Helper: build a daily series from a list of frequencies starting at a date.
function daily(freqs, start = '2026-05-01', ctrs = null) {
  return freqs.map((f, i) => {
    const d = new Date(Date.parse(start) + i * 86_400_000).toISOString();
    return ctrs ? { date: d, frequency: f, ctr: ctrs[i] } : { date: d, frequency: f };
  });
}

describe('forecastFatigue — input validation', () => {
  it('throws on too-few points', () => {
    expect(() => forecastFatigue({ series: [{ date: '2026-05-01', frequency: 1 }] }))
      .toThrow('at least 2 points');
  });
  it('throws on bad frequency', () => {
    expect(() => forecastFatigue({ series: [{ date: '2026-05-01', frequency: -1 }, { date: '2026-05-02', frequency: 1 }] }))
      .toThrow('frequency must be');
  });
});

describe('forecastFatigue — predicts breach before it happens', () => {
  it('projects a breach date for a rising-frequency ad set', () => {
    // 2.0 → 2.3 → 2.6 → 2.9 (=+0.3/day), ceiling 3.5 → ~2 days after last point
    const series = daily([2.0, 2.3, 2.6, 2.9]);
    const r = forecastFatigue({ series, ceiling: 3.5 });
    expect(r.willBreach).toBe(true);
    expect(r.slopePerDay).toBeCloseTo(0.3, 1);
    expect(r.daysToBreach).toBeGreaterThan(1);
    expect(r.daysToBreach).toBeLessThan(3);
    expect(new Date(r.projectedBreachDate).getTime()).toBeGreaterThan(Date.parse('2026-05-04'));
    expect(r.confidence).toBeGreaterThan(0.8); // near-perfect linear fit
  });

  it('flags an already-breached ad set with daysToBreach 0', () => {
    const series = daily([3.2, 3.5, 3.8]);
    const r = forecastFatigue({ series, ceiling: 3.5 });
    expect(r.willBreach).toBe(true);
    expect(r.daysToBreach).toBe(0);
  });

  it('returns no breach for a flat/declining series', () => {
    const series = daily([1.5, 1.4, 1.5, 1.3]);
    const r = forecastFatigue({ series, ceiling: 3.5 });
    expect(r.willBreach).toBe(false);
    expect(r.projectedBreachDate).toBeNull();
  });

  it('CTR decay raises confidence vs frequency-only', () => {
    const freqs = [2.0, 2.3, 2.6, 2.9];
    const base = forecastFatigue({ series: daily(freqs) });
    const withCtr = forecastFatigue({ series: daily(freqs, '2026-05-01', [1.5, 1.3, 1.1, 0.9]) });
    expect(withCtr.confidence).toBeGreaterThanOrEqual(base.confidence);
  });

  it('prior fatigue memory nudges confidence up', () => {
    const series = daily([2.0, 2.3, 2.6, 2.9]);
    const noMem = forecastFatigue({ series });
    const withMem = forecastFatigue({ series, memory: [{ accuracy: 0.9 }] });
    expect(withMem.confidence).toBeGreaterThanOrEqual(noMem.confidence);
  });

  it('is deterministic', () => {
    const series = daily([2.0, 2.4, 2.7, 3.0]);
    expect(forecastFatigue({ series })).toEqual(forecastFatigue({ series }));
  });
});
