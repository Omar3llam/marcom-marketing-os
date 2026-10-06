import { describe, expect, it } from 'vitest';
import { channelGapText, gapPresentation } from './gapPresentation.js';

describe('gap presentation — existing ratio contract', () => {
  it('does not manufacture a percentage for null ratio and signed zero-denominator money', () => {
    expect(gapPresentation(null, -120000)).toEqual({
      direction: 'UNAVAILABLE', pctText: '—', magnitudeMinor: null,
    });
    expect(channelGapText(null)).toBe('—');
  });
  it.each([
    [0.25, 120000, 'ABOVE', '25%', 120000],
    [-0.25, -120000, 'BELOW', '25%', 120000],
    [0, 0, 'MATCH', '0%', 0],
    [-0.004, -1, 'BELOW', '0.4%', 1],
    [0.006, 1, 'ABOVE', '0.6%', 1],
  ])('formats %s without changing signed evidence', (ratio, minor, direction, pctText, magnitudeMinor) => {
    expect(gapPresentation(ratio, minor)).toEqual({ direction, pctText, magnitudeMinor });
  });

  it.each([
    [.004, '0.4%'], [-.004, '0.4%'], [.006, '0.6%'], [-.006, '0.6%'],
    [.005, '0.5%'], [-.005, '0.5%'], [.001, '0.1%'], [-.001, '0.1%'],
    [.0004, '<0.1%'], [-.0004, '<0.1%'], [.0009999, '<0.1%'],
    [.000001, '<0.1%'], [-.000001, '<0.1%'], [Number.MIN_VALUE, '<0.1%'],
    [-Number.MIN_VALUE, '<0.1%'], [.0099, '1%'], [-.0099, '1%'], [.0095, '1%'],
    [.0040000000000000036, '0.4%'],
    [.01, '1%'], [.05, '5%'], [.10, '10%'], [.15, '15%'], [.25, '25%'],
  ])('preserves nonzero ratio %s with adaptive magnitude %s and unrounded direction', (ratio, text) => {
    const direction = ratio > 0 ? 'ABOVE' : 'BELOW';
    const relation = ratio > 0 ? 'above' : 'below';
    expect(gapPresentation(ratio)).toEqual({ direction, pctText: text, magnitudeMinor: null });
    expect(channelGapText(ratio)).toBe(`${text} ${relation}`);
    expect(gapPresentation(ratio).pctText).not.toMatch(/^-0|^0%$/);
  });

  it.each([0, -0])('keeps exact zero %s distinct from bounded nonzero', ratio => {
    expect(gapPresentation(ratio, 0)).toEqual({ direction: 'MATCH', pctText: '0%', magnitudeMinor: 0 });
    expect(channelGapText(ratio)).toBe('0%');
  });

  it('keeps absolute-money direction for the composer’s zero-denominator placeholder', () => {
    expect(gapPresentation(0, -120000)).toEqual({ direction: 'BELOW', pctText: '0%', magnitudeMinor: 120000 });
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
