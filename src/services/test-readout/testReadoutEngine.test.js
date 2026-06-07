// ============================================================
// TestReadoutEngine — unit tests
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { readTest }                   from './testReadoutEngine.js';
import { CONFIDENCE_LABEL, METRIC }   from './testReadoutTypes.js';

describe('readTest — CTR (rate metric, z-test)', () => {
  it('declares the challenger the winner on a clear, well-sampled CTR lift', () => {
    // A: 1.60% CTR (800/50000), B: ~2.10% CTR (1050/50000) → ~31% lift, huge sample.
    const r = readTest({
      metric: METRIC.CTR,
      variants: [
        { variantId: 'a', label: 'Hook A', isControl: true,  impressions: 50000, clicks: 800,  conversions: 40, spendMinor: 500000, revenueMinor: 1200000 },
        { variantId: 'b', label: 'Hook B', isControl: false, impressions: 50000, clicks: 1050, conversions: 55, spendMinor: 500000, revenueMinor: 1500000 },
      ],
    });
    expect(r.winnerLabel).toBe('Hook B');
    expect(r.winnerVariantId).toBe('b');
    expect(r.lift).toBeGreaterThan(28);
    expect(r.confidenceLabel).toBe(CONFIDENCE_LABEL.HIGH);
    // 31% lift ≥ 30% scale threshold → SCALE the winner.
    expect(r.verdict).toBe('SCALE');
    expect(r.rationale).toMatch(/Hook B beat Hook A/);
  });

  it('refuses to call a winner on a thin sample, even with a big raw lift', () => {
    // Same ~31% lift, but only ~180 impressions/arm → below the 1000 floor.
    const r = readTest({
      metric: METRIC.CTR,
      variants: [
        { variantId: 'a', label: 'A', isControl: true,  impressions: 180, clicks: 3, conversions: 0, spendMinor: 0, revenueMinor: 0 },
        { variantId: 'b', label: 'B', isControl: false, impressions: 180, clicks: 4, conversions: 0, spendMinor: 0, revenueMinor: 0 },
      ],
    });
    expect(r.confidenceLabel).toBe(CONFIDENCE_LABEL.INCONCLUSIVE);
    expect(r.verdict).toBeNull();
    expect(r.sampleNote).toMatch(/too thin/i);
  });

  it('returns no winner on a tie', () => {
    const r = readTest({
      metric: METRIC.CTR,
      variants: [
        { variantId: 'a', label: 'A', isControl: true,  impressions: 50000, clicks: 1000, conversions: 0, spendMinor: 0, revenueMinor: 0 },
        { variantId: 'b', label: 'B', isControl: false, impressions: 50000, clicks: 1000, conversions: 0, spendMinor: 0, revenueMinor: 0 },
      ],
    });
    expect(r.winnerLabel).toBeNull();
    expect(r.verdict).toBeNull();
    expect(r.confidenceLabel).toBe(CONFIDENCE_LABEL.INCONCLUSIVE);
  });

  it('does not emit a verdict when the control wins', () => {
    const r = readTest({
      metric: METRIC.CTR,
      variants: [
        { variantId: 'a', label: 'A', isControl: true,  impressions: 50000, clicks: 1200, conversions: 0, spendMinor: 0, revenueMinor: 0 },
        { variantId: 'b', label: 'B', isControl: false, impressions: 50000, clicks: 800,  conversions: 0, spendMinor: 0, revenueMinor: 0 },
      ],
    });
    expect(r.winnerLabel).toBeNull();
    expect(r.verdict).toBeNull();
  });
});

describe('readTest — ROAS (ratio metric)', () => {
  it('reads a strong ROAS lift but caps confidence at MODERATE', () => {
    // B ROAS 3.0x vs A 2.0x → 50% lift, plenty of conversions.
    const r = readTest({
      metric: METRIC.ROAS,
      variants: [
        { variantId: 'a', label: 'Offer A', isControl: true,  impressions: 20000, clicks: 600, conversions: 60, spendMinor: 1000000, revenueMinor: 2000000 },
        { variantId: 'b', label: 'Offer B', isControl: false, impressions: 20000, clicks: 600, conversions: 90, spendMinor: 1000000, revenueMinor: 3000000 },
      ],
    });
    expect(r.winnerLabel).toBe('Offer B');
    expect(r.lift).toBeGreaterThanOrEqual(49);
    expect(r.confidenceLabel).toBe(CONFIDENCE_LABEL.MODERATE);
    expect(['SCALE', 'REFRESH']).toContain(r.verdict);
  });

  it('is INCONCLUSIVE on a ROAS test with too few conversions', () => {
    const r = readTest({
      metric: METRIC.ROAS,
      variants: [
        { variantId: 'a', label: 'A', isControl: true,  impressions: 2000, clicks: 60, conversions: 3, spendMinor: 100000, revenueMinor: 200000 },
        { variantId: 'b', label: 'B', isControl: false, impressions: 2000, clicks: 60, conversions: 5, spendMinor: 100000, revenueMinor: 350000 },
      ],
    });
    expect(r.confidenceLabel).toBe(CONFIDENCE_LABEL.INCONCLUSIVE);
    expect(r.verdict).toBeNull();
  });
});

describe('readTest — guards', () => {
  it('throws when fewer than two variants are supplied', () => {
    expect(() => readTest({ metric: METRIC.CTR, variants: [{ label: 'A', isControl: true }] }))
      .toThrow(/at least two variants/);
  });

  it('is deterministic', () => {
    const variants = [
      { variantId: 'a', label: 'A', isControl: true,  impressions: 50000, clicks: 800,  conversions: 40, spendMinor: 500000, revenueMinor: 1200000 },
      { variantId: 'b', label: 'B', isControl: false, impressions: 50000, clicks: 1050, conversions: 55, spendMinor: 500000, revenueMinor: 1500000 },
    ];
    expect(readTest({ metric: METRIC.CTR, variants })).toEqual(readTest({ metric: METRIC.CTR, variants }));
  });
});
