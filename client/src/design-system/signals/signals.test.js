// ============================================================
// signals — WATCH / REALLOCATE / REFRESH are first-class verdict tokens
// ------------------------------------------------------------
// Before this, only SCALE/HOLD/KILL had tokens, so getSignalTokens fell back to
// HOLD (with a console.warn) for the three Phase-2 verdicts — a decision-first UI
// would render them as HOLD. These pin that they resolve to their own tokens with
// no warning.
// ============================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSignalTokens, SIGNALS } from './signals.js';

afterEach(() => vi.restoreAllMocks());

describe('signals — Phase-2 verdict tokens', () => {
  it('WATCH / REALLOCATE / REFRESH are defined (no HOLD fallback, no warn)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const v of ['WATCH', 'REALLOCATE', 'REFRESH']) {
      expect(SIGNALS[v]).toBeDefined();
      getSignalTokens(v);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('WATCH and REFRESH use the watch token (distinct from HOLD)', () => {
    expect(getSignalTokens('WATCH').text).toBe('text-signal-watch');
    expect(getSignalTokens('REFRESH').text).toBe('text-signal-watch');
    expect(getSignalTokens('WATCH').text).not.toBe(getSignalTokens('HOLD').text);
  });

  it('every token carries the 4-key shape (surface/text/border/glow)', () => {
    for (const v of ['WATCH', 'REALLOCATE', 'REFRESH']) {
      expect(Object.keys(SIGNALS[v]).sort()).toEqual(['border', 'glow', 'surface', 'text']);
    }
  });

  it('an unknown verdict still falls back to HOLD (with a warn) — unchanged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getSignalTokens('NONSENSE')).toBe(SIGNALS.HOLD);
    expect(warn).toHaveBeenCalled();
  });
});
