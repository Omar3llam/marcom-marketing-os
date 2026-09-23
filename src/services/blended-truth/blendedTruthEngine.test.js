// ============================================================
// BlendedTruthEngine — reconciliation correctness
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { reconcile, COVERAGE, CONFIDENCE } from './blendedTruthEngine.js';

const proven = (c) => {
  const state = { monetaryStatus: 'MONETARY_VALID', monetaryReason: null, currency: c.currency ?? 'EGP' };
  return { ...c, monetaryEvidence: { spend: state, platform: state, actual: state, blended: state } };
};
const reconcileProven = ({ channels }) => reconcile({ channels: channels.map(proven) });

describe('blendedTruthEngine.reconcile', () => {
  it('uses the GA4/Shopify actual where present and surfaces the inflation gap', () => {
    // Meta claims 84,200 (EGP minor) but GA4 actual is 63,150 on 20,000 spend.
    const { channels } = reconcileProven({
      channels: [
        { channelId: 'meta', platformRevenueMinor: 8420000, actualRevenueMinor: 6315000, spendMinor: 2000000, currency: 'EGP' },
      ],
    });
    const c = channels[0];
    expect(c.blendedRevenueMinor).toBe(6315000);          // blended == actual
    expect(c.gapMinor).toBe(2105000);                     // platform over-reported
    expect(c.gapPct).toBeCloseTo(0.25, 5);                // ~25% inflation
    expect(c.coverage).toBe(COVERAGE.RECONCILED);
    expect(c.confidence).toBe(CONFIDENCE.HIGH);
    // blended ROAS is materially lower than the platform claim
    expect(c.platformRoas).toBeCloseTo(4.21, 2);
    expect(c.blendedRoas).toBeCloseTo(3.1575, 3);
    expect(c.blendedRoas).toBeLessThan(c.platformRoas);
  });

  it('falls back to the raw platform number but flags LOW / UNVERIFIED when no actual exists', () => {
    const { channels } = reconcileProven({
      channels: [
        { channelId: 'tiktok', platformRevenueMinor: 5000000, actualRevenueMinor: null, spendMinor: 1000000 },
      ],
    });
    const c = channels[0];
    expect(c.blendedRevenueMinor).toBe(5000000);          // raw platform used as-is
    expect(c.gapMinor).toBe(0);                           // no measured gap
    expect(c.coverage).toBe(COVERAGE.UNVERIFIED);
    expect(c.confidence).toBe(CONFIDENCE.LOW);
    expect(c.blendedRoas).toBe(c.platformRoas);
  });

  it('treats a missing actualRevenueMinor key the same as null (unverified)', () => {
    const { channels } = reconcileProven({
      channels: [{ channelId: 'snap', platformRevenueMinor: 100, spendMinor: 50 }],
    });
    expect(channels[0].coverage).toBe(COVERAGE.UNVERIFIED);
    expect(channels[0].confidence).toBe(CONFIDENCE.LOW);
  });

  it('rolls a mixed portfolio up: blended truth + per-coverage counts', () => {
    const { portfolio } = reconcileProven({
      channels: [
        { channelId: 'meta',   platformRevenueMinor: 8420000, actualRevenueMinor: 6315000, spendMinor: 2000000 },
        { channelId: 'tiktok', platformRevenueMinor: 5000000, actualRevenueMinor: null,    spendMinor: 1000000 },
      ],
    });
    expect(portfolio.spendMinor).toBe(3000000);
    expect(portfolio.platformRevenueMinor).toBe(13420000);
    expect(portfolio.blendedRevenueMinor).toBe(11315000); // 6315000 + 5000000
    expect(portfolio.gapMinor).toBe(2105000);
    expect(portfolio.reconciledCount).toBe(1);
    expect(portfolio.unverifiedCount).toBe(1);
    expect(portfolio.blendedRoas).toBeLessThan(portfolio.platformRoas);
  });

  it('handles zero spend without dividing by zero', () => {
    const { channels } = reconcile({
      channels: [{ channelId: 'x', platformRevenueMinor: 0, actualRevenueMinor: 0, spendMinor: 0 }],
    });
    expect(channels[0].platformRoas).toBeNull();
    expect(channels[0].blendedRoas).toBeNull();
    expect(channels[0].gapPct).toBeNull();
  });

  it('throws on a non-finite platform revenue', () => {
    expect(() => reconcile({ channels: [{ channelId: 'x', platformRevenueMinor: NaN, spendMinor: 10 }] }))
      .toThrow(/platformRevenueMinor/);
  });

  // ── Display identity (P1.2): the engine forwards `name` so the view can show a
  // real campaign name instead of the raw detId UUID — WITHOUT touching numerics.
  describe('name forwarding (display identity)', () => {
    it('forwards the input name onto the reconciled row', () => {
      const { channels } = reconcile({
        channels: [{ channelId: 'B-uuid', channel: 'META', name: 'Summer Promo', platformRevenueMinor: 100, spendMinor: 50 }],
      });
      expect(channels[0].name).toBe('Summer Promo');
      expect(channels[0].channel).toBe('META'); // channel preserved alongside name
    });

    it('is null-safe when no name is supplied (graceful fallback in the view)', () => {
      const { channels } = reconcile({
        channels: [{ channelId: 'B-uuid', platformRevenueMinor: 100, spendMinor: 50 }],
      });
      expect(channels[0].name).toBeNull();
    });

    it('does not change any numeric output (identity correction only)', () => {
      const input = { channelId: 'meta', channel: 'META', platformRevenueMinor: 8420000, actualRevenueMinor: 6315000, spendMinor: 2000000 };
      const withName    = reconcile({ channels: [{ ...input, name: 'Named' }] }).channels[0];
      const withoutName = reconcile({ channels: [input] }).channels[0];
      // Compare every field EXCEPT name — the numerics must be byte-identical.
      const numsWith = { ...withName };       delete numsWith.name;
      const numsWithout = { ...withoutName }; delete numsWithout.name;
      expect(numsWith).toEqual(numsWithout);
    });
  });
});
