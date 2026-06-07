import { describe, it, expect } from 'vitest';
import { computeUnitEconomics } from './unitEconomicsEngine.js';
import { SUSTAINABILITY_BAND } from './unitEconomicsTypes.js';

// AOV $50 (5000c), 60% margin → contribution $30 (3000c). 2 lifetime orders
// → LTV $60 (6000c).
const econ = { aovMinor: 5_000, grossMarginPct: 0.6, avgOrdersPerCustomer: 2, repeatRate: 0.4 };

describe('computeUnitEconomics — core math', () => {
  it('computes contribution, LTV, and LTV:CAC', () => {
    const out = computeUnitEconomics({ ...econ, cacMinor: 1_500 }); // CAC $15
    expect(out.contributionPerOrderMinor).toBe(3_000);
    expect(out.ltvMinor).toBe(6_000);
    expect(out.ltvToCac.expected).toBe(4); // 6000/1500
    expect(out.sustainabilityBand.expected).toBe(SUSTAINABILITY_BAND.HEALTHY);
    expect(out.sustainable).toBe(true);
  });

  it('payback in whole orders, rounded up', () => {
    const out = computeUnitEconomics({ ...econ, cacMinor: 3_500 }); // CAC $35, contribution $30
    expect(out.paybackOrders).toBe(2); // ceil(3500/3000)
  });
});

describe('computeUnitEconomics — honest band across a CAC range', () => {
  it('flips HEALTHY → THIN → UNDERWATER as CAC worsens', () => {
    // LTV 6000. CAC range: low 1500 (ratio 4 HEALTHY), expected 3000 (ratio 2 THIN),
    // high 7000 (ratio 0.86 UNDERWATER).
    const out = computeUnitEconomics({
      ...econ,
      cacMinor: { low: 1_500, expected: 3_000, high: 7_000 },
    });
    // Best case (low CAC) → high ratio → HEALTHY; worst case → UNDERWATER.
    expect(out.sustainabilityBand.high).toBe(SUSTAINABILITY_BAND.HEALTHY);
    expect(out.sustainabilityBand.expected).toBe(SUSTAINABILITY_BAND.THIN);
    expect(out.sustainabilityBand.low).toBe(SUSTAINABILITY_BAND.UNDERWATER);
    expect(out.ltvToCac.low).toBeLessThan(out.ltvToCac.high);
  });
});

describe('computeUnitEconomics — guards + determinism', () => {
  it('throws on invalid AOV', () => {
    expect(() => computeUnitEconomics({ aovMinor: 0, grossMarginPct: 0.5, cacMinor: 1000 })).toThrow(/aovMinor/);
  });
  it('throws on out-of-range margin', () => {
    expect(() => computeUnitEconomics({ aovMinor: 5000, grossMarginPct: 1.5, cacMinor: 1000 })).toThrow(/grossMarginPct/);
  });
  it('is deterministic', () => {
    const args = { ...econ, cacMinor: { low: 1_500, expected: 3_000, high: 7_000 } };
    expect(computeUnitEconomics(args)).toEqual(computeUnitEconomics(args));
  });
});
