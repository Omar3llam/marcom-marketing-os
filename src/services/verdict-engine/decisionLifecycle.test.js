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
