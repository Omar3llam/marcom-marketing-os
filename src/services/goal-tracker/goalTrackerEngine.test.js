import { describe, it, expect } from 'vitest';
import { estimateLanding } from './goalTrackerEngine.js';
import { GOAL_STATUS } from './goalTrackerTypes.js';

const periodStart = '2026-04-01T00:00:00.000Z';
const periodEnd   = '2026-06-30T00:00:00.000Z';
const now         = '2026-05-15T00:00:00.000Z';

// A CAC series trending DOWN toward a "CAC ≤ 2000c" target (good direction).
const improvingCac = [
  { date: '2026-04-05', value: 2_600 },
  { date: '2026-04-19', value: 2_300 },
  { date: '2026-05-03', value: 2_050 },
  { date: '2026-05-14', value: 1_850 },
];

describe('estimateLanding — landing is always a range, framed as an estimate', () => {
  it('produces a {low,expected,high} estimate carrying the non-linearity caveat', () => {
    const out = estimateLanding({
      target: { metric: 'blendedCac', comparator: 'LTE', targetValue: 2_000 },
      actuals: improvingCac, periodStart, periodEnd, now,
    });
    const r = out.trendBasedLandingEstimate;
    expect(r.low).toBeLessThanOrEqual(r.expected);
    expect(r.expected).toBeLessThanOrEqual(r.high);
    expect(out.assumptions.join(' ')).toMatch(/not a guarantee|curves bend/i);
  });

  it('classifies ON_TRACK when even the worst end of the band clears the target', () => {
    const out = estimateLanding({
      target: { metric: 'blendedCac', comparator: 'LTE', targetValue: 2_200 },
      actuals: improvingCac, periodStart, periodEnd, now,
    });
    expect(out.laggingStatus).toBe(GOAL_STATUS.ON_TRACK);
  });

  it('classifies OFF_TRACK when the expected landing misses', () => {
    const out = estimateLanding({
      target: { metric: 'blendedCac', comparator: 'LTE', targetValue: 800 }, // expected ~966 misses
      actuals: improvingCac, periodStart, periodEnd, now,
    });
    expect(out.laggingStatus).toBe(GOAL_STATUS.OFF_TRACK);
  });
});

describe('estimateLanding — leading indicators override a clean lagging trend', () => {
  it('a fatigue breach before period end raises ON_TRACK → AT_RISK', () => {
    const out = estimateLanding({
      target: { metric: 'blendedCac', comparator: 'LTE', targetValue: 2_200 }, // lagging = ON_TRACK
      actuals: improvingCac,
      leadingSignals: [{
        signal: 'creative_fatigue', entityId: 'carousel-4',
        projectedBreachDate: '2026-06-05T00:00:00.000Z', daysToBreach: 21, confidence: 0.8,
      }],
      periodStart, periodEnd, now,
    });
    expect(out.laggingStatus).toBe(GOAL_STATUS.ON_TRACK);
    expect(out.leadingRisk).toBe(true);
    expect(out.status).toBe(GOAL_STATUS.AT_RISK);
    expect(out.basis).toMatch(/on track on blendedCac, but/i);
  });

  it('ignores a fatigue breach that lands AFTER the period ends', () => {
    const out = estimateLanding({
      target: { metric: 'blendedCac', comparator: 'LTE', targetValue: 2_200 },
      actuals: improvingCac,
      leadingSignals: [{ signal: 'creative_fatigue', projectedBreachDate: '2026-08-01T00:00:00.000Z' }],
      periodStart, periodEnd, now,
    });
    expect(out.leadingRisk).toBe(false);
    expect(out.status).toBe(GOAL_STATUS.ON_TRACK);
  });
});

describe('estimateLanding — thin data + determinism', () => {
  it('widens the band early in the period', () => {
    const early = estimateLanding({
      target: { metric: 'blendedCac', comparator: 'LTE', targetValue: 2_000 },
      actuals: improvingCac, periodStart, periodEnd, now: '2026-04-10T00:00:00.000Z',
    });
    const late = estimateLanding({
      target: { metric: 'blendedCac', comparator: 'LTE', targetValue: 2_000 },
      actuals: improvingCac, periodStart, periodEnd, now: '2026-06-20T00:00:00.000Z',
    });
    const span = (o) => o.trendBasedLandingEstimate.high - o.trendBasedLandingEstimate.low;
    expect(span(early)).toBeGreaterThan(span(late));
  });

  it('is deterministic', () => {
    const args = {
      target: { metric: 'blendedCac', comparator: 'LTE', targetValue: 2_000 },
      actuals: improvingCac, periodStart, periodEnd, now,
    };
    expect(estimateLanding(args)).toEqual(estimateLanding(args));
  });
});
