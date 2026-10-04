import { describe, expect, it } from 'vitest';
import { channelGapText, gapPresentation } from './gapPresentation.js';

describe('gap presentation — existing ratio contract', () => {
  it.each([
    [0.25, 120000, 'ABOVE', '25%', 120000],
    [-0.25, -120000, 'BELOW', '25%', 120000],
    [0, 0, 'MATCH', '0%', 0],
    [-0.004, -1, 'BELOW', '0%', 1],
    [0.006, 1, 'ABOVE', '1%', 1],
  ])('formats %s without changing signed evidence', (ratio, minor, direction, pctText, magnitudeMinor) => {
    expect(gapPresentation(ratio, minor)).toEqual({ direction, pctText, magnitudeMinor });
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '0.25'])(
    'withholds non-finite or missing ratio %s', (ratio) => {
      expect(gapPresentation(ratio, 100).direction).toBe('UNAVAILABLE');
      expect(channelGapText(ratio)).toBe('—');
    },
  );

  it.each([null, Number.NaN, Number.NEGATIVE_INFINITY])('withholds unavailable monetary difference %s', (minor) => {
    expect(gapPresentation(0.25, minor).direction).toBe('UNAVAILABLE');
  });
});
