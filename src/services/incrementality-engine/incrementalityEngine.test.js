import { describe, it, expect } from 'vitest';
import { designHoldout, readIncrementality } from './incrementalityEngine.js';
import { CONFIDENCE_LEVEL, ATTRIBUTION_SOURCE } from '../attribution-engine/attributionTypes.js';

describe('designHoldout — honest power calc', () => {
  it('requires more sample for a smaller MDE (monotonic)', () => {
    const base = { baselineCvr: 0.02, dailyEligible: 5_000, holdoutPct: 0.1 };
    const big = designHoldout({ ...base, mde: 0.30 });
    const small = designHoldout({ ...base, mde: 0.10 });
    expect(small.sampleSizePerArm).toBeGreaterThan(big.sampleSizePerArm);
    expect(big.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(big.guardrails.maxHoldoutShare).toBeLessThanOrEqual(0.25);
  });

  it('clamps duration to the guardrail window', () => {
    const d = designHoldout({ baselineCvr: 0.02, mde: 0.5, dailyEligible: 100_000, holdoutPct: 0.1 });
    expect(d.durationDays).toBeGreaterThanOrEqual(7); // min duration guardrail
  });

  it('rejects invalid baseline', () => {
    expect(() => designHoldout({ baselineCvr: 0, mde: 0.2, dailyEligible: 1000 })).toThrow(/baselineCvr/);
  });
});

describe('readIncrementality — causal lift as a CONFIDENCE INTERVAL, refuses when unsure', () => {
  it('calls a clean separation: positive lift, CI excludes zero, HIGH-ish confidence', () => {
    const r = readIncrementality({
      exposed: { users: 50_000, conversions: 1_200 }, // 2.4%
      holdout: { users: 50_000, conversions: 1_000 }, // 2.0%
      aovMinor: 5_000,
    });
    expect(r.conclusive).toBe(true);
    expect(r.liftPct).toBeGreaterThan(0);
    expect(r.ci[0]).toBeGreaterThan(0); // CI excludes zero
    expect(r.incrementalConversions.source).toBe(ATTRIBUTION_SOURCE.INCREMENTALITY);
    expect(r.incrementalConversions.band).toEqual(r.ci);
    expect(r.incrementalRevenueMinor.value).toBe(r.incrementalConversions.value * 5_000);
  });

  it('refuses (INCONCLUSIVE) when the CI crosses zero, even on a raw lift', () => {
    const r = readIncrementality({
      exposed: { users: 800, conversions: 30 },  // ~3.75%
      holdout: { users: 800, conversions: 27 },  // ~3.375% — noisy, overlapping
      aovMinor: 5_000,
    });
    expect(r.conclusive).toBe(false);
    expect(r.status).toBe('INCONCLUSIVE');
    expect(r.incrementalConversions.value).toBe(0);
    expect(r.rationale).toMatch(/includes zero|too thin/i);
  });

  it('refuses below the conversion floor regardless of lift', () => {
    const r = readIncrementality({
      exposed: { users: 200, conversions: 10 },
      holdout: { users: 200, conversions: 2 },
      aovMinor: 5_000,
    });
    expect(r.conclusive).toBe(false);
    expect(r.confidenceLabel).toBe(CONFIDENCE_LEVEL.LOW);
    expect(r.rationale).toMatch(/too thin/i);
  });

  it('is deterministic', () => {
    const args = { exposed: { users: 50_000, conversions: 1_200 }, holdout: { users: 50_000, conversions: 1_000 }, aovMinor: 5_000 };
    expect(readIncrementality(args)).toEqual(readIncrementality(args));
  });
});
