// ============================================================
// benchmarkProvider — the CTR bar depends on what the campaign is FOR
// ============================================================
import { describe, it, expect } from 'vitest';

import { getBenchmarks, BENCHMARKS } from './benchmarkProvider.js';

describe('getBenchmarks', () => {
  it('awareness gets 0.5, NOT the global 0.8 default', () => {
    // The headline fix: a 0.9% CTR is strong for reach and weak for lead gen.
    // One global floor called both "weak hook" and proposed a creative refresh
    // on a campaign performing exactly as its objective implies.
    expect(getBenchmarks('OUTCOME_AWARENESS').ctr.weak).toBe(0.5);
    expect(getBenchmarks('OUTCOME_AWARENESS').ctr.weak).not.toBe(0.8);
  });

  it('lead gen sets a higher bar than sales', () => {
    expect(getBenchmarks('OUTCOME_LEADS').ctr.weak).toBe(1.0);
    expect(getBenchmarks('OUTCOME_SALES').ctr.weak).toBe(0.8);
  });

  it('an unknown objective falls to DEFAULT rather than throwing', () => {
    expect(getBenchmarks('OUTCOME_SOMETHING_META_SHIPS_IN_2027')).toBe(BENCHMARKS.DEFAULT);
    expect(() => getBenchmarks('nonsense')).not.toThrow();
  });

  it('null / undefined objective → DEFAULT', () => {
    expect(getBenchmarks(null)).toBe(BENCHMARKS.DEFAULT);
    expect(getBenchmarks()).toBe(BENCHMARKS.DEFAULT);
  });

  it('always returns an object with a usable ctr band', () => {
    for (const o of [null, 'REACH', 'OUTCOME_SALES', 'garbage']) {
      const b = getBenchmarks(o);
      expect(typeof b).toBe('object');
      expect(b.ctr.strong).toBeGreaterThan(b.ctr.weak);
    }
  });

  it('maps legacy Meta objectives onto the right band, not DEFAULT', () => {
    // A long-running account still returns REACH / VIDEO_VIEWS. Without the
    // alias table those silently got e-commerce thresholds — the exact
    // misjudgement this module exists to stop.
    expect(getBenchmarks('REACH').ctr.weak).toBe(0.5);
    expect(getBenchmarks('VIDEO_VIEWS').ctr.weak).toBe(0.5);
    expect(getBenchmarks('CONVERSIONS').ctr.weak).toBe(0.8);
    expect(getBenchmarks('LEAD_GENERATION').ctr.weak).toBe(1.0);
  });

  it('is case-insensitive', () => {
    expect(getBenchmarks('outcome_awareness').ctr.weak).toBe(0.5);
  });

  it('a null stage benchmark means NOT APPLICABLE, never zero', () => {
    // An awareness campaign has no add-to-cart rate to miss. A rule reading
    // null as 0 would fire a checkout diagnosis on a reach campaign.
    expect(getBenchmarks('OUTCOME_AWARENESS').atcRate).toBeNull();
    expect(getBenchmarks('OUTCOME_AWARENESS').lpvRate).toBeNull();
    expect(getBenchmarks('OUTCOME_SALES').atcRate).toBe(0.03);
  });

  it('the table is frozen — callers cannot mutate shared thresholds', () => {
    const b = getBenchmarks('OUTCOME_SALES');
    expect(() => { b.ctr.weak = 99; }).toThrow();
  });
});
