// ============================================================
// contentRecommendations — deterministic verdict → creative action
// ------------------------------------------------------------
// No AI: the same verdict (+ signalType) always yields the same guidance, and an
// absent verdict yields nothing (honest empty, never filler).
// ============================================================
import { describe, it, expect } from 'vitest';
import { getContentRecommendations } from './contentRecommendations.js';

describe('getContentRecommendations', () => {
  it('KILL + LOW_CTR → the weak-hook rebuild set', () => {
    const recs = getContentRecommendations('KILL', 'LOW_CTR');
    expect(recs).toHaveLength(3);
    expect(recs[0]).toMatch(/new hook/i);
  });

  it('SCALE + HEALTHY → scale/duplicate guidance', () => {
    const recs = getContentRecommendations('SCALE', 'HEALTHY');
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.join(' ')).toMatch(/duplicate/i);
  });

  it('a known verdict with an unmatched signalType falls back to that verdict\'s default', () => {
    const fallback = getContentRecommendations('KILL', 'SOMETHING_UNMAPPED');
    expect(fallback).toEqual(getContentRecommendations('KILL', null));
    expect(fallback.length).toBeGreaterThan(0);
  });

  it('HOLD with no signalType → the HOLD default set', () => {
    const recs = getContentRecommendations('HOLD', null);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.join(' ')).toMatch(/hold steady/i);
  });

  it('no verdict → empty (honest, no filler)', () => {
    expect(getContentRecommendations(null, null)).toEqual([]);
    expect(getContentRecommendations(undefined, 'LOW_CTR')).toEqual([]);
  });

  it('an unknown verdict → empty (never a generic recommendation)', () => {
    expect(getContentRecommendations('MYSTERY', 'LOW_CTR')).toEqual([]);
  });

  it('all six engine verdicts return at least one recommendation (verdict-only)', () => {
    for (const v of ['KILL', 'REFRESH', 'REALLOCATE', 'WATCH', 'HOLD', 'SCALE']) {
      expect(getContentRecommendations(v, null).length).toBeGreaterThan(0);
    }
  });
});
