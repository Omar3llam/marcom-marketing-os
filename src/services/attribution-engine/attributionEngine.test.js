import { describe, it, expect } from 'vitest';
import { attributeCredit } from './attributionEngine.js';
import { ATTRIBUTION_MODEL, ATTRIBUTION_SOURCE, ATTRIBUTION_STATUS, CONFIDENCE_LEVEL } from './attributionTypes.js';

const channels = [
  { channelId: 'meta',   channel: 'META',   conversions: 200, platformRevenueMinor: 1_000_000, blendedRevenueMinor: 820_000, spendMinor: 400_000, currency: 'USD' },
  { channelId: 'google', channel: 'GOOGLE', conversions: 120, platformRevenueMinor:   600_000, blendedRevenueMinor: 560_000, spendMinor: 250_000, currency: 'USD' },
  { channelId: 'tiktok', channel: 'TIKTOK', conversions:  40, platformRevenueMinor:   180_000, blendedRevenueMinor: 180_000, spendMinor: 100_000, currency: 'USD' },
];
const economics = { aovMinor: 5_000 };

// Every figure must be wrapped: { value, source, confidence, ... }.
function isAttributed(a) {
  return a && 'value' in a && typeof a.source === 'string' && typeof a.confidence === 'string';
}
function allWrapped(result) {
  if (result.status !== 'OK') return true;
  for (const c of result.channels) {
    if (!isAttributed(c.creditedConversions) || !isAttributed(c.creditedRevenueMinor)) return false;
  }
  return isAttributed(result.totalRevenueMinor);
}

describe('attributeCredit — the GUARD: no bare numbers, no invented journeys', () => {
  it('LAST_TOUCH credits each channel its own platform conversions, source PLATFORM', () => {
    const r = attributeCredit({ channels, model: ATTRIBUTION_MODEL.LAST_TOUCH, economics });
    expect(r.status).toBe(ATTRIBUTION_STATUS.OK);
    const meta = r.channels.find((c) => c.channelId === 'meta');
    expect(meta.creditedConversions.value).toBe(200);
    expect(meta.creditedRevenueMinor.source).toBe(ATTRIBUTION_SOURCE.PLATFORM);
    expect(allWrapped(r)).toBe(true);
  });

  it('path models return INSUFFICIENT_DATA when no paths are connected (never fabricates)', () => {
    for (const model of [ATTRIBUTION_MODEL.FIRST_TOUCH, ATTRIBUTION_MODEL.LINEAR, ATTRIBUTION_MODEL.POSITION_BASED]) {
      const r = attributeCredit({ channels, model, paths: [], economics });
      expect(r.status).toBe(ATTRIBUTION_STATUS.INSUFFICIENT_DATA);
      expect(r.reason).toMatch(/path data/i);
      expect(r.channels).toBeUndefined();
    }
  });

  it('path models redistribute correctly WITH a synthetic path set', () => {
    // Two conversions; each journey meta → google → tiktok.
    const paths = [
      { conversionId: 'c1', channel: 'meta',   touchPosition: 0 },
      { conversionId: 'c1', channel: 'google', touchPosition: 1 },
      { conversionId: 'c1', channel: 'tiktok', touchPosition: 2 },
      { conversionId: 'c2', channel: 'meta',   touchPosition: 0 },
      { conversionId: 'c2', channel: 'tiktok', touchPosition: 1 },
    ];
    const first = attributeCredit({ channels, model: ATTRIBUTION_MODEL.FIRST_TOUCH, paths, economics });
    expect(first.status).toBe(ATTRIBUTION_STATUS.OK);
    // meta is first touch on both conversions → 2.0 credit.
    expect(first.channels.find((c) => c.channelId === 'meta').creditedConversions.value).toBeCloseTo(2.0, 5);
    expect(first.channels.find((c) => c.channelId === 'google').creditedConversions.value).toBeCloseTo(0, 5);
    // All MODEL-sourced + rules-based caveat.
    expect(first.channels[0].creditedConversions.source).toBe(ATTRIBUTION_SOURCE.MODEL);
    expect(first.channels[0].creditedConversions.caveat).toMatch(/not causal/i);

    const linear = attributeCredit({ channels, model: ATTRIBUTION_MODEL.LINEAR, paths, economics });
    // meta: 1/3 (c1) + 1/2 (c2) = 0.8333
    expect(linear.channels.find((c) => c.channelId === 'meta').creditedConversions.value).toBeCloseTo(0.83, 2);
  });

  it('INCREMENTALITY_WEIGHTED uses measured lift, flags untested channels LOW, NOT Google DDA', () => {
    const incrementality = {
      meta: { incrementalConversions: 150, confidenceLabel: CONFIDENCE_LEVEL.HIGH, ciLow: 0.1, ciHigh: 0.25 },
      // google + tiktok have no test
    };
    const r = attributeCredit({ channels, model: ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED, incrementality, economics });
    expect(r.status).toBe(ATTRIBUTION_STATUS.OK);
    const meta = r.channels.find((c) => c.channelId === 'meta');
    expect(meta.creditedConversions.value).toBe(150); // incremental, not the 200 claimed
    expect(meta.creditedConversions.source).toBe(ATTRIBUTION_SOURCE.INCREMENTALITY);
    expect(meta.creditedConversions.confidence).toBe(CONFIDENCE_LEVEL.HIGH);
    expect(meta.creditedRevenueMinor.value).toBe(150 * economics.aovMinor);
    const google = r.channels.find((c) => c.channelId === 'google');
    expect(google.creditedConversions.confidence).toBe(CONFIDENCE_LEVEL.LOW);
    expect(google.creditedConversions.caveat).toMatch(/no holdout/i);
    expect(r.caveat).toMatch(/NOT Google/i);
    expect(allWrapped(r)).toBe(true);
  });

  it('is deterministic and rejects an unknown model', () => {
    const args = { channels, model: ATTRIBUTION_MODEL.LAST_TOUCH, economics };
    expect(attributeCredit(args)).toEqual(attributeCredit(args));
    expect(() => attributeCredit({ channels, model: 'DATA_DRIVEN', economics })).toThrow(/model must be/);
  });
});
