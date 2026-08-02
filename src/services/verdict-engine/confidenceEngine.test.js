// ============================================================
// confidenceEngine — confidence must MOVE with its evidence
// ============================================================
// Before this, every confidence was a frozen literal: a KILL on 400 impressions
// and a KILL on 400,000 both reported 0.9. These tests exist to make that
// impossible to reintroduce — the headline assertions are the comparative ones
// (more data ⇒ more confidence), not any particular number.
// ============================================================
import { describe, it, expect } from 'vitest';

import {
  computeConfidence, composeConfidence, sampleQuality, dataCompleteness,
  temporalQuality, daysSince, MAX_CONFIDENCE, MIN_IMPRESSIONS, GOOD_IMPRESSIONS,
} from './confidenceEngine.js';

const FULL = { lpv: 100, atc: 20, checkout: 8, purchase: 4 };

describe('computeConfidence — the whole point: it is a function, not a constant', () => {
  it('rises monotonically with impressions, all else equal', () => {
    const at = (impressions) => computeConfidence({ impressions, daysRunning: 14, actionMetrics: FULL, objective: 'OUTCOME_SALES', createdTime: new Date() });
    const series = [500, 2_000, 5_000, 10_000].map(at);
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThan(series[i - 1]);
  });

  it('thin sample + blind funnel + unknown objective → low confidence', () => {
    const c = computeConfidence({ impressions: 500 });
    expect(c).toBeLessThan(0.2);
    expect(c).toBeGreaterThan(0);
  });

  it('full sample + full data + settled → high, but never certain', () => {
    const c = computeConfidence({
      impressions: 10_000, daysRunning: 14, actionMetrics: FULL,
      objective: 'OUTCOME_SALES', createdTime: new Date('2026-07-01'),
    });
    expect(c).toBeGreaterThan(0.9);
    expect(c).toBeLessThanOrEqual(MAX_CONFIDENCE);
  });

  it('NEVER returns 1.0 — platform attribution error is invisible from here', () => {
    const c = computeConfidence({
      impressions: 10_000_000, daysRunning: 900, actionMetrics: FULL,
      objective: 'OUTCOME_SALES', createdTime: new Date('2020-01-01'),
    });
    expect(c).toBe(MAX_CONFIDENCE);
    expect(c).toBeLessThan(1.0);
  });

  it('zero impressions → zero confidence (nothing to be confident about)', () => {
    expect(computeConfidence({ impressions: 0, daysRunning: 30, actionMetrics: FULL, objective: 'OUTCOME_SALES', createdTime: new Date() })).toBe(0);
  });

  it('a missing lpv costs confidence — the funnel-blind penalty', () => {
    const base = { impressions: 10_000, daysRunning: 14, objective: 'OUTCOME_SALES', createdTime: new Date() };
    const withLpv = computeConfidence({ ...base, actionMetrics: FULL });
    const without = computeConfidence({ ...base, actionMetrics: { atc: 20 } });
    expect(without).toBeLessThan(withLpv);
  });

  it('a missing createdTime is a PARTIAL penalty, not zero', () => {
    const base = { impressions: 10_000, daysRunning: 14, actionMetrics: FULL, objective: 'OUTCOME_SALES' };
    const known = computeConfidence({ ...base, createdTime: new Date() });
    const unknown = computeConfidence({ ...base, createdTime: null });
    expect(unknown).toBeLessThan(known);
    expect(unknown).toBeGreaterThan(0.5); // penalised, not disqualified
  });

  it('an unknown objective costs confidence — benchmarks fall back to DEFAULT', () => {
    const base = { impressions: 10_000, daysRunning: 14, actionMetrics: FULL, createdTime: new Date() };
    expect(computeConfidence({ ...base, objective: null }))
      .toBeLessThan(computeConfidence({ ...base, objective: 'OUTCOME_SALES' }));
  });

  it('is deterministic and reads no clock', () => {
    const args = { impressions: 7_777, daysRunning: 5, actionMetrics: FULL, objective: 'OUTCOME_LEADS', createdTime: new Date('2026-01-01') };
    expect(computeConfidence(args)).toBe(computeConfidence(args));
  });

  it('survives being called with nothing at all', () => {
    expect(() => computeConfidence()).not.toThrow();
    expect(computeConfidence()).toBe(0);
  });
});

describe('the three dimensions, separately', () => {
  it('sampleQuality saturates at GOOD_IMPRESSIONS', () => {
    expect(sampleQuality(GOOD_IMPRESSIONS)).toBe(1);
    expect(sampleQuality(GOOD_IMPRESSIONS * 50)).toBe(1);
    expect(sampleQuality(MIN_IMPRESSIONS)).toBeCloseTo(0.1, 5);
    expect(sampleQuality(0)).toBe(0);
    expect(sampleQuality(-5)).toBe(0);
  });

  it('dataCompleteness: full data = 1, fully blind = 0.55 (never near zero)', () => {
    // Blind on every optional field still scores 0.55: spend, impressions and
    // clicks are real and measured, so completeness must not imply we know
    // nothing. The 0.4 floor below is a guard for future penalties — with the
    // current set summing to 0.45 it is not yet binding, and asserting the real
    // 0.55 keeps this test honest about which number is actually load-bearing.
    expect(dataCompleteness({})).toBe(0.55);
    expect(dataCompleteness({ actionMetrics: FULL, objective: 'OUTCOME_SALES', createdTime: new Date() })).toBe(1);
    expect(dataCompleteness({})).toBeGreaterThanOrEqual(0.4);
  });

  it('temporalQuality: unknown age scores 0.7, not 0 — a gap in ingestion is not evidence of youth', () => {
    expect(temporalQuality(null)).toBe(0.7);
    expect(temporalQuality(1)).toBe(0.4);
    expect(temporalQuality(5)).toBe(0.7);
    expect(temporalQuality(30)).toBe(1.0);
  });
});

describe('composeConfidence — signal strength × input quality', () => {
  it('multiplies the two halves', () => {
    expect(composeConfidence(0.9, 0.5)).toBe(0.45);
  });

  it('a strong signal on thin data is not a strong verdict', () => {
    expect(composeConfidence(0.9, 0.1)).toBeLessThan(0.9);
  });

  it('caps at MAX_CONFIDENCE and clamps junk inputs', () => {
    expect(composeConfidence(1, 1)).toBe(MAX_CONFIDENCE);
    expect(composeConfidence(5, 5)).toBe(MAX_CONFIDENCE);
    expect(composeConfidence(NaN, 0.5)).toBe(0);
    expect(composeConfidence(undefined, undefined)).toBe(0);
  });
});

describe('daysSince — time resolved at the boundary, never inside the engine', () => {
  const now = Date.parse('2026-08-02T00:00:00Z');

  it('counts whole days from a platform creation time', () => {
    expect(daysSince('2026-07-30T00:00:00Z', now)).toBe(3);
  });

  it('returns null for an unknown creation time — the too-early gate then SKIPS', () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince(undefined, now)).toBeNull();
  });

  it('returns null (never NaN) for an unparseable value', () => {
    expect(daysSince('not-a-date', now)).toBeNull();
  });

  it('clamps a clock-skewed future date to 0, never negative', () => {
    expect(daysSince('2026-09-01T00:00:00Z', now)).toBe(0);
  });

  it('accepts a Date as well as a string', () => {
    expect(daysSince(new Date('2026-07-26T00:00:00Z'), now)).toBe(7);
  });
});
