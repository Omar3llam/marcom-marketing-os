// ============================================================
// computeResolution — did the entity recover after we called it?
// ------------------------------------------------------------
// The pure half of the lifecycle. It answers a narrow, correlational question
// and its main job is refusing to answer when it cannot: a decision written
// before the lifecycle columns existed has no baseline, and inventing one from
// a rolling snapshot aggregate would fabricate the very number this exists to
// measure.
// ============================================================
import { describe, it, expect } from 'vitest';
import { computeResolution, ctrDelta, MATERIAL_CHANGE } from './decisionLifecycle.js';

// CTR here is a PERCENT (verdictEngine's signalInput unit), not a 0..1 ratio.
const at = (ctr, roas = null) => ({ ctr, roas });

describe('engagement verdicts are scored on CTR', () => {
  it.each([['KILL'], ['REALLOCATE'], ['REFRESH']])('%s recovering by >10%% is IMPROVED', (verdict) => {
    expect(computeResolution(verdict, at(1.0), at(1.5))).toBe('IMPROVED');
  });

  it('a further decline is WORSENED', () => {
    expect(computeResolution('KILL', at(1.0), at(0.5))).toBe('WORSENED');
  });

  it('drift inside the band is UNCHANGED, not a win', () => {
    expect(computeResolution('KILL', at(1.0), at(1.05))).toBe('UNCHANGED');
    expect(computeResolution('KILL', at(1.0), at(0.95))).toBe('UNCHANGED');
  });

  // Without a band every decision resolves IMPROVED or WORSENED on sync noise
  // alone, and UNCHANGED never occurs.
  it('the band is exclusive at both edges', () => {
    expect(computeResolution('KILL', at(1.0), at(1 + MATERIAL_CHANGE))).toBe('UNCHANGED');
    expect(computeResolution('KILL', at(1.0), at(1 - MATERIAL_CHANGE))).toBe('UNCHANGED');
    expect(computeResolution('KILL', at(1.0), at(1.1001))).toBe('IMPROVED');
    expect(computeResolution('KILL', at(1.0), at(0.8999))).toBe('WORSENED');
  });
});

describe('SCALE is scored on ROAS', () => {
  it('a return that grew is IMPROVED', () => {
    expect(computeResolution('SCALE', at(2.0, 3.0), at(2.0, 4.0))).toBe('IMPROVED');
  });

  it('a return that collapsed under the extra budget is WORSENED', () => {
    expect(computeResolution('SCALE', at(2.0, 3.0), at(2.0, 1.0))).toBe('WORSENED');
  });

  it('a return that held is UNCHANGED', () => {
    expect(computeResolution('SCALE', at(2.0, 3.0), at(2.0, 3.1))).toBe('UNCHANGED');
  });

  // The whole point of scoring SCALE on ROAS: a CTR move must not decide it.
  it('ignores CTR entirely', () => {
    expect(computeResolution('SCALE', at(1.0, 3.0), at(9.0, 3.0))).toBe('UNCHANGED');
  });

  it('is UNKNOWN when revenue was never measured', () => {
    expect(computeResolution('SCALE', at(2.0, null), at(2.0, 5.0))).toBe('UNKNOWN');
  });
});

describe('refusing to score', () => {
  // Every row written before this migration. They must resolve UNKNOWN forever
  // rather than be scored against a reconstructed baseline.
  it('a decision with no baseline is UNKNOWN', () => {
    expect(computeResolution('KILL', {}, at(1.5))).toBe('UNKNOWN');
    expect(computeResolution('KILL', at(null), at(1.5))).toBe('UNKNOWN');
  });

  it('no current reading is UNKNOWN', () => {
    expect(computeResolution('KILL', at(1.0), {})).toBe('UNKNOWN');
  });

  // A ratio against zero is not a 100% collapse, it is undefined.
  it('a zero baseline is UNKNOWN, never WORSENED', () => {
    expect(computeResolution('KILL', at(0), at(0))).toBe('UNKNOWN');
    expect(computeResolution('KILL', at(0), at(2.0))).toBe('UNKNOWN');
  });

  // HOLD and WATCH asked for no intervention, so no action's effect exists to
  // measure — a movement here is the campaign drifting, not a decision working.
  it.each([['HOLD'], ['WATCH']])('%s asked for no action → UNKNOWN', (verdict) => {
    expect(computeResolution(verdict, at(1.0), at(5.0))).toBe('UNKNOWN');
  });

  // ── The HOLD boundary, pinned against data rather than absence ─────────────
  // The test above proves HOLD is UNKNOWN. This proves it is UNKNOWN for the
  // RIGHT REASON — not because the data was thin, but because there is no
  // intervention to measure. Every row below carries complete, valid metrics on
  // both ends, and the KILL column shows what the SAME input yields when a
  // verdict does ask for an action. If a future change made HOLD depend on the
  // numbers, these rows would start disagreeing with each other.
  //
  // This is one half of a boundary. The other half lives in decision-accuracy:
  // HOLD IS scored there, as a prediction, from OutcomeSnapshot.roasDelta. The
  // two are not in conflict — this module asks "did acting help", that one asks
  // "was the call right", and HOLD has an answer only to the second.
  describe('HOLD is UNKNOWN because there is no intervention, not because data is missing', () => {
    it.each([
      ['stable ROAS',      at(1.0, 2.0), at(1.0, 2.0), 'UNCHANGED'],
      ['degraded ROAS',    at(1.0, 2.0), at(1.0, 1.0), 'UNCHANGED'],
      ['improved ROAS',    at(1.0, 2.0), at(1.0, 4.0), 'UNCHANGED'],
      ['CTR improvement',  at(1.0, 2.0), at(1.5, 2.0), 'IMPROVED'],
      ['CTR collapse',     at(1.0, 2.0), at(0.4, 2.0), 'WORSENED'],
    ])('%s, complete on both ends → HOLD UNKNOWN (a KILL on the same input → %s)',
      (_label, before, after, killResult) => {
        expect(computeResolution('HOLD', before, after)).toBe('UNKNOWN');
        // The contrast is the point: the inputs ARE scorable, for a verdict that
        // asked for something.
        expect(computeResolution('KILL', before, after)).toBe(killResult);
      });

    // Missing data reaches the same answer by the OTHER route. Both are UNKNOWN
    // and the word cannot tell them apart — which is why the module documents
    // the two meanings rather than relying on the enum to carry them.
    it.each([
      ['missing before', {},           at(1.0, 2.0)],
      ['missing after',  at(1.0, 2.0), {}],
      ['missing both',   {},           {}],
    ])('%s → UNKNOWN too, by the insufficient-evidence route', (_label, before, after) => {
      expect(computeResolution('HOLD', before, after)).toBe('UNKNOWN');
      expect(computeResolution('KILL', before, after)).toBe('UNKNOWN');
    });

    // The learning boundary (decisionLearning.js) gates on `resolution != null`
    // AND counts only IMPROVED/UNCHANGED/WORSENED toward its denominator. HOLD
    // returning the STRING 'UNKNOWN' — not null — is what makes it pass the
    // first gate and still contribute nothing to the tally. A null here would
    // change which gate excludes it, so the type is load-bearing.
    it('returns the string UNKNOWN, never null — the learning tally depends on it', () => {
      const r = computeResolution('HOLD', at(1.0, 2.0), at(1.0, 2.0));
      expect(r).toBe('UNKNOWN');
      expect(r).not.toBeNull();
      expect(['IMPROVED', 'UNCHANGED', 'WORSENED']).not.toContain(r);
    });
  });

  it.each([[null], [undefined], ['NONSENSE']])('an unrecognised verdict (%s) is UNKNOWN', (verdict) => {
    expect(computeResolution(verdict, at(1.0), at(5.0))).toBe('UNKNOWN');
  });

  it('NaN and Infinity are not readings', () => {
    expect(computeResolution('KILL', at(NaN), at(1.5))).toBe('UNKNOWN');
    expect(computeResolution('KILL', at(1.0), at(Infinity))).toBe('UNKNOWN');
  });

  it('no arguments at all does not throw', () => {
    expect(computeResolution('KILL')).toBe('UNKNOWN');
    expect(computeResolution()).toBe('UNKNOWN');
  });
});

describe('ctrDelta — percentage POINTS', () => {
  it('reports the raw point movement, not a percent of a percent', () => {
    expect(ctrDelta(at(1.64), at(1.20))).toBeCloseTo(-0.44, 5);
    expect(ctrDelta(at(1.00), at(1.50))).toBeCloseTo(0.5, 5);
  });

  it('is null when either end is missing — never a fabricated 0', () => {
    expect(ctrDelta(at(null), at(1.2))).toBeNull();
    expect(ctrDelta(at(1.2), {})).toBeNull();
    expect(ctrDelta()).toBeNull();
  });

  // A real 0 movement is a measurement; null is the absence of one.
  it('distinguishes a measured zero from an absent reading', () => {
    expect(ctrDelta(at(1.2), at(1.2))).toBe(0);
  });
});
