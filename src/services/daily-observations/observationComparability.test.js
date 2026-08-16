// ============================================================
// R9 — I20, held to all twelve of its conditions
// ============================================================
// The contract is pure, so this file can check every refusal without a database,
// a clock or a fixture table. What it protects:
//
//   • comparability is read from the DECLARED PERIODS and from nothing else —
//     never from sync order, array order, or elapsed time
//   • two days that share any delivery are refused, including the same day
//     compared with itself
//   • a difference may be taken over the ADDITIVE family and no other
//   • an absent measurement stays absent through the arithmetic
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  areComparable, additiveDifference, dailyPeriod, periodsOverlap, isDifferenceable,
  COMPARABILITY, DIFFERENCEABLE_METRICS, NON_DIFFERENCEABLE_METRICS,
} from './observationComparability.js';

const DAY = (d) => new Date(`2026-08-${d}T00:00:00.000Z`);

/** A reduced daily observation, as the reader emits it. */
const obs = (over = {}) => ({
  id: 'row-1',
  workspaceId: 'ws-1',
  entityId: 'e1',
  entityLevel: 'CAMPAIGN',
  source: 'META',
  measurementWindow: 'DAILY',
  day: '2026-08-09',
  windowStart: DAY('09'),
  windowEnd: DAY('09'),
  observedAt: new Date('2026-08-16T09:00:00.000Z'),
  spendMinor: 42000,
  revenueMinor: 210000,
  impressions: 15000,
  clicks: 300,
  conversions: 12,
  ctr: 0.02,
  roas: 5,
  reach: null,
  frequency: null,
  ...over,
});

const before = obs();
const after = obs({ id: 'row-2', day: '2026-08-11', windowStart: DAY('11'), windowEnd: DAY('11') });

describe('R9 — a period is one day, or it is not a period this contract reads', () => {
  it('reads the half-open extent of a day from the inclusive dates the repo writes', () => {
    // canonicalWindowBounds: "a 1-day window is [now, now]". Phase E writes
    // windowStart === windowEnd, so the real extent is [start, start + 1 day).
    expect(dailyPeriod(obs())).toEqual({ start: DAY('09').getTime(), end: DAY('10').getTime() });
  });

  it('refuses a period spanning more than one day', () => {
    // A trailing aggregate that reached the wrong reader. It is not clamped into
    // shape and not treated as its first day.
    expect(dailyPeriod(obs({ windowStart: DAY('09'), windowEnd: DAY('11') }))).toBeNull();
  });

  it('refuses a missing or inverted period', () => {
    expect(dailyPeriod(obs({ windowStart: null }))).toBeNull();
    expect(dailyPeriod(obs({ windowEnd: null }))).toBeNull();
    expect(dailyPeriod(obs({ windowStart: DAY('11'), windowEnd: DAY('09') }))).toBeNull();
    expect(dailyPeriod(obs({ windowStart: 'yesterday', windowEnd: 'today' }))).toBeNull();
  });

  it('treats adjacent days as touching, never overlapping', () => {
    // [Aug 9, Aug 10) and [Aug 10, Aug 11) share no delivery. This is the pair a
    // before/after comparison actually wants, and a closed-interval reading
    // would have refused it.
    const a = dailyPeriod(obs({ windowStart: DAY('09'), windowEnd: DAY('09') }));
    const b = dailyPeriod(obs({ windowStart: DAY('10'), windowEnd: DAY('10') }));
    expect(periodsOverlap(a, b)).toBe(false);
    expect(periodsOverlap(a, a)).toBe(true);
  });
});

describe('R9 — areComparable refuses what it cannot prove', () => {
  it('accepts two non-overlapping days of one entity, in order', () => {
    expect(areComparable(before, after)).toEqual({ ok: true });
  });

  it('accepts adjacent days — the boundary case that must not be refused', () => {
    const next = obs({ id: 'row-2', windowStart: DAY('10'), windowEnd: DAY('10') });
    expect(areComparable(before, next).ok).toBe(true);
  });

  it('refuses a missing side rather than treating it as zero', () => {
    expect(areComparable(null, after).reason).toBe(COMPARABILITY.MISSING_OBSERVATION);
    expect(areComparable(before, null).reason).toBe(COMPARABILITY.MISSING_OBSERVATION);
    expect(areComparable(null, null).reason).toBe(COMPARABILITY.MISSING_OBSERVATION);
  });

  it('refuses an ambiguous day', () => {
    // A day that did not reduce to one reading is not a measurement. Choosing one
    // of its rows would make the answer depend on query order.
    expect(areComparable(obs({ ambiguous: true }), after).reason).toBe(COMPARABILITY.AMBIGUOUS_OBSERVATION);
    expect(areComparable(before, obs({ ...after, ambiguous: true })).reason).toBe(COMPARABILITY.AMBIGUOUS_OBSERVATION);
  });

  it('refuses an observation that cannot name the row it came from', () => {
    // I20's twelfth condition. Without a row id the result is unreproducible —
    // a later reader could not fetch the same two rows back.
    expect(areComparable(obs({ id: null }), after).reason).toBe(COMPARABILITY.UNIDENTIFIED_ROW);
  });

  it('refuses a different workspace, entity, level or source', () => {
    expect(areComparable(before, obs({ ...after, workspaceId: 'ws-2' })).reason).toBe(COMPARABILITY.DIFFERENT_WORKSPACE);
    expect(areComparable(before, obs({ ...after, entityId: 'e2' })).reason).toBe(COMPARABILITY.DIFFERENT_ENTITY);
    expect(areComparable(before, obs({ ...after, entityLevel: 'ADSET' })).reason).toBe(COMPARABILITY.DIFFERENT_LEVEL);
    expect(areComparable(before, obs({ ...after, source: 'GOOGLE' })).reason).toBe(COMPARABILITY.DIFFERENT_SOURCE);
  });

  it('refuses a source pairing even when both sources are real platforms', () => {
    // Meta's Tuesday and GA4's Tuesday are two measurements of one day, and
    // subtracting one from the other is not a quantity.
    const ga4 = obs({ ...after, source: 'GA4' });
    expect(areComparable(before, ga4).reason).toBe(COMPARABILITY.DIFFERENT_SOURCE);
  });

  it('refuses any population that is not DAILY, on either side', () => {
    expect(areComparable(obs({ measurementWindow: 'ROLLING_WINDOW' }), after).reason)
      .toBe(COMPARABILITY.DIFFERENT_POPULATION);
    expect(areComparable(before, obs({ ...after, measurementWindow: 'CUMULATIVE_30D' })).reason)
      .toBe(COMPARABILITY.DIFFERENT_POPULATION);
    // …including two rows that agree with each other but are not daily.
    const legacy = (o) => ({ ...o, measurementWindow: 'LEGACY_UNKNOWN' });
    expect(areComparable(legacy(before), legacy(after)).reason).toBe(COMPARABILITY.DIFFERENT_POPULATION);
  });

  it('refuses a malformed period', () => {
    expect(areComparable(obs({ windowEnd: null }), after).reason).toBe(COMPARABILITY.MALFORMED_PERIOD);
    expect(areComparable(before, obs({ ...after, windowStart: DAY('09'), windowEnd: DAY('12') })).reason)
      .toBe(COMPARABILITY.MALFORMED_PERIOD);
  });

  it('refuses overlapping periods — including a day compared with itself', () => {
    expect(areComparable(before, obs({ id: 'row-2' })).reason).toBe(COMPARABILITY.OVERLAPPING_PERIODS);
  });

  it('refuses a pair whose "after" precedes its "before"', () => {
    // Established from the periods. An implementation that trusted the argument
    // order, or the order rows were synced in, would accept this.
    expect(areComparable(after, before).reason).toBe(COMPARABILITY.WRONG_ORDER);
  });

  it('does not use the observation timestamp to decide order', () => {
    // THE I20 ASSERTION. The "after" day was READ first (an earlier sync) and the
    // "before" day was read later by a backfill. Sync order says one thing, the
    // measured periods say another, and only the periods may decide.
    const readLate = obs({ observedAt: new Date('2026-09-01T00:00:00Z') });                 // Aug 9, read in September
    const readEarly = obs({ ...after, observedAt: new Date('2026-08-12T00:00:00Z') });       // Aug 11, read in August
    expect(areComparable(readLate, readEarly)).toEqual({ ok: true });
    expect(areComparable(readEarly, readLate).reason).toBe(COMPARABILITY.WRONG_ORDER);
  });
});

describe('R9 — a difference may be taken over the additive family, and no other', () => {
  it('differences exactly the five additive counters', () => {
    expect([...DIFFERENCEABLE_METRICS])
      .toEqual(['spendMinor', 'revenueMinor', 'impressions', 'clicks', 'conversions']);
  });

  it('never offers reach or frequency', () => {
    // CUMULATIVE metrics count unique people; the difference of two days' values
    // is not a quantity that exists. Not merely omitted from the output — refused
    // by the family contract itself.
    expect([...NON_DIFFERENCEABLE_METRICS]).toEqual(['reach', 'frequency']);
    for (const m of NON_DIFFERENCEABLE_METRICS) expect(isDifferenceable(m)).toBe(false);
    const { metrics } = additiveDifference(before, after);
    expect(metrics).not.toHaveProperty('reach');
    expect(metrics).not.toHaveProperty('frequency');
  });

  it('never offers a ctr or roas delta', () => {
    // DERIVED metrics are ratios, recomputed from summed parts rather than
    // subtracted. Each side's own ratio is on the observation; a "roas delta" is
    // a question this module will not answer, because the answer would look like
    // an outcome.
    const { metrics } = additiveDifference(before, after);
    expect(metrics).not.toHaveProperty('ctr');
    expect(metrics).not.toHaveProperty('roas');
    expect(isDifferenceable('ctr')).toBe(false);
    expect(isDifferenceable('roas')).toBe(false);
  });

  it('computes after − before, and nothing cleverer', () => {
    const richer = obs({ ...after, spendMinor: 50000, revenueMinor: 100000, impressions: 20000, clicks: 250, conversions: 10 });
    expect(additiveDifference(before, richer).metrics).toEqual({
      spendMinor: 8000,
      revenueMinor: -110000,
      impressions: 5000,
      clicks: -50,
      conversions: -2,
    });
  });

  it('propagates an absent measurement as absent, never as zero', () => {
    // The difference of an unmeasured quantity is unmeasured. A 0 here would be
    // indistinguishable from "nothing changed", which is a claim about the world.
    const { metrics } = additiveDifference(before, obs({ ...after, conversions: null }));
    expect(metrics.conversions).toBeNull();
    expect(metrics.conversions).not.toBe(0);
    expect(metrics.spendMinor).toBe(0); // …while a real no-change stays a real 0
  });

  it('refuses to difference anything the contract refused to compare', () => {
    const result = additiveDifference(before, obs({ ...after, source: 'GOOGLE' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(COMPARABILITY.DIFFERENT_SOURCE);
    expect(result).not.toHaveProperty('metrics');
  });

  it('names nothing an outcome', () => {
    // R9 establishes what was observed and whether it may be compared. It does
    // not conclude. A field called success or outcome here would be a claim the
    // substrate cannot support.
    const keys = Object.keys(additiveDifference(before, after));
    expect(keys).toEqual(['ok', 'metrics']);
    for (const k of Object.keys(additiveDifference(before, after).metrics)) {
      expect(k).not.toMatch(/outcome|success|failure|correct|accuracy|sustained/i);
    }
  });
});
