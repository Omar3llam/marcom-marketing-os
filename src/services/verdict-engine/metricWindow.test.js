// ============================================================
// The canonical verdict window contract
// ------------------------------------------------------------
// Two halves, and the split is the point.
//
//   PART 1  the algebra this contract CAN enforce today — additive Σ, derived
//           ratios computed after aggregation, and the flat refusal to
//           reconstruct reach/frequency from daily rows.
//
//   PART 2  KNOWN GAPS, written INVERTED — they assert the defect that exists
//           right now, so that fixing it BREAKS them and forces the update.
//
//           MARKERS CORRECTED IN PHASE D. They originally named Phase C and
//           Phase D as the events that would invert them. That was wrong, and
//           the way it was wrong is worth keeping: Phase C DID land the
//           `measurementWindow` column, and none of these tests moved — because
//           they exercise the READER, and the reader still does not select the
//           column. A row can carry perfect provenance that nothing reads.
//
//           All three now invert on the same event: PHASE D ACTIVATION —
//           EntityGraphService resolving by window instead of by newest row.
//           The resolver itself is built and tested (canonicalResolver.test.js);
//           activation is blocked on Phase F, which is the first thing that will
//           produce a CUMULATIVE_30D row for it to select.
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { effectiveByEntity } from '../entity-graph/entityGraphEngine.js';
import { aggregateMetrics, toSignalInput, evaluateVerdict } from './verdictEngine.js';
import {
  CANONICAL_VERDICT_WINDOW_DAYS, canonicalWindowBounds,
  METRIC_FAMILY, ADDITIVE_METRICS, DERIVED_METRICS, CUMULATIVE_METRICS,
  NON_AGGREGABLE_REASON, metricFamily, canAggregateFromDaily,
  sumAdditive, deriveCtr, deriveRoas, sameWindow,
} from './metricWindow.js';

const day = (n, over = {}) => ({
  date: new Date(`2026-08-${String(n).padStart(2, '0')}T00:00:00Z`),
  spendMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0, ...over,
});

// ════════════════════════════════════════════════════════════
// PART 1 — the contract this PR enforces
// ════════════════════════════════════════════════════════════

describe('the window is a product contract, not a sync artifact', () => {
  it('is 30 days', () => {
    expect(CANONICAL_VERDICT_WINDOW_DAYS).toBe(30);
  });

  // The whole defect this contract closes is that the window used to be
  // whatever the last sync requested. A window read from the environment would
  // reintroduce it one layer down, so this must be a literal.
  it('is not environment-configurable', () => {
    const prev = process.env.CANONICAL_VERDICT_WINDOW_DAYS;
    process.env.CANONICAL_VERDICT_WINDOW_DAYS = '7';
    expect(CANONICAL_VERDICT_WINDOW_DAYS).toBe(30);
    if (prev === undefined) delete process.env.CANONICAL_VERDICT_WINDOW_DAYS;
    else process.env.CANONICAL_VERDICT_WINDOW_DAYS = prev;
  });

  // It is NOT one of the ingestion presets. Pinned because the cheapest wrong
  // move in Phase D is to reach for last_90d because a row already has it.
  it('is none of the ingestion presets (90 from cron, ~37mo from maximum)', () => {
    expect(CANONICAL_VERDICT_WINDOW_DAYS).not.toBe(90);
    expect(CANONICAL_VERDICT_WINDOW_DAYS).not.toBe(7);
  });

  it('bounds are trailing, rolling, and inclusive at both ends', () => {
    const now = new Date('2026-08-30T12:00:00Z');
    const { start, end, days } = canonicalWindowBounds(now);
    expect(days).toBe(30);
    expect(end).toEqual(now);
    // inclusive both ends → 29 days back, covering 30 days of delivery
    expect(start.toISOString()).toBe('2026-08-01T12:00:00.000Z');
    expect(Math.round((end - start) / 86_400_000) + 1).toBe(30);
  });

  // Not calendar-aligned: a verdict must mean the same thing on the 3rd as on
  // the 28th, and a calendar month would make Lumi most confident right before
  // it resets to nothing.
  it('does not reset on a month boundary', () => {
    const a = canonicalWindowBounds(new Date('2026-09-01T00:00:00Z'));
    const b = canonicalWindowBounds(new Date('2026-08-31T00:00:00Z'));
    expect(a.start.getTime() - b.start.getTime()).toBe(86_400_000); // slides by one day
    expect(a.start.getUTCMonth()).toBe(7); // reaches back INTO August, not to Sep 1
  });

  it('rejects an unusable `now` rather than inventing a window', () => {
    expect(() => canonicalWindowBounds('not-a-date')).toThrow(/invalid/);
  });
});

describe('metric families — three algebras, never one', () => {
  it('classifies every verdict-bearing metric', () => {
    for (const m of ADDITIVE_METRICS) expect(metricFamily(m)).toBe(METRIC_FAMILY.ADDITIVE);
    for (const m of DERIVED_METRICS) expect(metricFamily(m)).toBe(METRIC_FAMILY.DERIVED);
    for (const m of CUMULATIVE_METRICS) expect(metricFamily(m)).toBe(METRIC_FAMILY.CUMULATIVE);
  });

  it('reach and frequency are the ONLY cumulative metrics', () => {
    expect([...CUMULATIVE_METRICS].sort()).toEqual(['frequency', 'reach']);
  });

  it('vouches for nothing it has not classified', () => {
    expect(metricFamily('cpcMinor')).toBeNull();
    expect(canAggregateFromDaily('cpcMinor')).toBe(false);
    expect(canAggregateFromDaily(undefined)).toBe(false);
  });

  it('additive and derived aggregate from daily; cumulative does not', () => {
    expect(canAggregateFromDaily('spendMinor')).toBe(true);
    expect(canAggregateFromDaily('ctr')).toBe(true);
    expect(canAggregateFromDaily('reach')).toBe(false);
    expect(canAggregateFromDaily('frequency')).toBe(false);
  });

  // The reason is data, not a comment, so a UI can say WHY instead of "n/a".
  it('states a real reason for each refusal', () => {
    for (const m of CUMULATIVE_METRICS) {
      expect(NON_AGGREGABLE_REASON[m]).toMatch(/unique|frequency/i);
      expect(NON_AGGREGABLE_REASON[m].length).toBeGreaterThan(40);
    }
  });
});

describe('REQUIRED TEST 3 — additive reconstruction', () => {
  it('Σ daily rows: 100 + 120 + 140 = 360', () => {
    const agg = sumAdditive([
      day(1, { spendMinor: 100 }), day(2, { spendMinor: 120 }), day(3, { spendMinor: 140 }),
    ]);
    expect(agg.spendMinor).toBe(360);
  });

  it('sums every additive metric, independently', () => {
    const agg = sumAdditive([
      day(1, { spendMinor: 100, revenueMinor: 400, impressions: 1000, clicks: 12, conversions: 4 }),
      day(2, { spendMinor: 120, revenueMinor: 180, impressions: 1200, clicks: 10, conversions: 2 }),
    ]);
    expect(agg).toEqual({ spendMinor: 220, revenueMinor: 580, impressions: 2200, clicks: 22, conversions: 6 });
  });

  // #359's lesson, one layer up: this is only valid because the rows are daily
  // and disjoint. Applied to today's overlapping window aggregates it would be
  // the over-count that PR was written to remove.
  it('never touches reach or frequency, even when the rows carry them', () => {
    const agg = sumAdditive([day(1, { reach: 7600, frequency: 1.3 }), day(2, { reach: 8900, frequency: 1.4 })]);
    expect(agg).not.toHaveProperty('reach');
    expect(agg).not.toHaveProperty('frequency');
  });
});

describe('REQUIRED TEST 4 — CTR is derived AFTER aggregation', () => {
  it('clicks 10+20 over impressions 1000+2000 → 30/3000', () => {
    const agg = sumAdditive([
      day(1, { clicks: 10, impressions: 1000 }),
      day(2, { clicks: 20, impressions: 2000 }),
    ]);
    expect(deriveCtr(agg.clicks, agg.impressions)).toBeCloseTo((30 / 3000) * 100, 10);
  });

  // The fixture above cannot FAIL under the wrong method — both days sit at
  // 1.0%, so mean(daily CTR) agrees by coincidence. This one has teeth: a tiny
  // high-CTR day next to a huge low-CTR one is exactly where an unweighted mean
  // invents a number no row contains.
  it('is impression-weighted, not a mean of daily rates', () => {
    const agg = sumAdditive([
      day(1, { clicks: 10, impressions: 100 }),    // 10.0%
      day(2, { clicks: 20, impressions: 10_000 }), // 0.2%
    ]);
    const weighted = deriveCtr(agg.clicks, agg.impressions);
    const meanOfDaily = (10 + 0.2) / 2;
    expect(weighted).toBeCloseTo(0.29703, 4);
    expect(meanOfDaily).toBeCloseTo(5.1, 4);
    expect(weighted).not.toBeCloseTo(meanOfDaily, 1); // 0.30% vs 5.10%
  });

  it('is null when impressions were never measured — a rate off zero is undefined, not 0%', () => {
    expect(deriveCtr(0, 0)).toBeNull();
    expect(deriveCtr(5, null)).toBeNull();
  });

  it('a measured zero-click day is a real 0%, not an absence', () => {
    expect(deriveCtr(0, 5000)).toBe(0);
  });
});

describe('REQUIRED TEST 5 — ROAS is derived AFTER aggregation', () => {
  it('revenue 100+300 over spend 100+900 → 400/1000, not the mean of the dailies', () => {
    const agg = sumAdditive([
      day(1, { revenueMinor: 100, spendMinor: 100 }), // 1.000×
      day(2, { revenueMinor: 300, spendMinor: 900 }), // 0.333×
    ]);
    expect(deriveRoas(agg.revenueMinor, agg.spendMinor)).toBeCloseTo(0.4, 10);
    const meanOfDaily = (1 + 1 / 3) / 2;
    expect(meanOfDaily).toBeCloseTo(0.6667, 4);
    // 0.40 is below break-even (KILL territory); 0.67 is not. Same days.
    expect(deriveRoas(agg.revenueMinor, agg.spendMinor)).toBeLessThan(1.0);
  });

  // Identical to toSignalInput's `revenueMeasured` rule, on purpose: Phase D
  // must be able to swap this in without changing which campaigns are scored.
  it('is null unless BOTH revenue and spend are positive — never a fabricated 0.00×', () => {
    expect(deriveRoas(0, 1000)).toBeNull();   // revenue never measured
    expect(deriveRoas(1000, 0)).toBeNull();   // nothing spent
    expect(deriveRoas(null, 1000)).toBeNull();
  });
});

describe('REQUIRED TESTS 6 + 7 — reach and frequency cannot come from daily rows', () => {
  const week = [1.31, 1.28, 1.35, 1.22, 1.40, 1.33, 1.29];

  it('6 · neither Σ nor mean of daily frequency is the window frequency', () => {
    const sum = week.reduce((a, b) => a + b, 0);
    const mean = sum / week.length;
    // True window frequency = Σimpressions ÷ UNIQUE window reach.
    const trueWindow = (100_000 * 7) / 210_000;
    expect(sum).toBeCloseTo(9.18, 2);      // not a frequency at all
    expect(mean).toBeCloseTo(1.31, 2);     // the average DAILY frequency
    expect(trueWindow).toBeCloseTo(3.33, 2);
    expect(mean).not.toBeCloseTo(trueWindow, 1);
    // And the gap decides verdicts: the fatigue ceiling is 3.5.
    expect(mean < 3.5).toBe(true);
    expect(trueWindow < 3.5).toBe(true);
    expect((100_000 * 30) / 600_000 >= 3.5).toBe(true); // over 30 days it crosses
  });

  it('7 · Σ daily reach overstates unique window reach', () => {
    const dailyReach = 76_000;
    const trueUnique = 210_000;
    expect(dailyReach * 7).toBe(532_000);
    expect(dailyReach * 7).toBeGreaterThan(trueUnique); // 2.53× overstated
  });

  // The contract's real defence: the algebra does not OFFER these operations.
  it('the module provides no way to aggregate either one', () => {
    expect(canAggregateFromDaily('reach')).toBe(false);
    expect(canAggregateFromDaily('frequency')).toBe(false);
    expect(sumAdditive([day(1, { reach: 100 })])).not.toHaveProperty('reach');
  });
});

describe('missing data stays missing', () => {
  it('no rows yields null, not a zero-filled total', () => {
    expect(sumAdditive([])).toBeNull();
    expect(sumAdditive(null)).toBeNull();
    expect(sumAdditive(undefined)).toBeNull();
  });

  // The distinction the whole codebase turns on: a campaign that spent nothing
  // and a window with no measurement are not the same fact.
  it('a real zero-spend row is a measurement, and is NOT null', () => {
    expect(sumAdditive([day(1, { spendMinor: 0 })])).toEqual({
      spendMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0,
    });
  });

  it('ignores non-numeric values rather than coercing them into the total', () => {
    const agg = sumAdditive([day(1, { spendMinor: 100 }), day(2, { spendMinor: null }), null]);
    expect(agg.spendMinor).toBe(100);
  });
});

describe('no cross-window ROAS (§14 — the actual-revenue overlay)', () => {
  const w = (s, e) => ({ start: new Date(s), end: new Date(e) });

  it('the same window is the same window', () => {
    expect(sameWindow(w('2026-08-01', '2026-08-30'), w('2026-08-01', '2026-08-30'))).toBe(true);
  });

  // This is the live case: GA4 revenue uploaded once, platform spend re-stamped
  // every sync. effectiveByEntity currently divides one by the other and bounds
  // the drift at 90 days rather than refusing.
  it('a GA4 window and a platform window that differ are NOT combinable', () => {
    expect(sameWindow(w('2026-07-01', '2026-07-30'), w('2026-08-01', '2026-08-30'))).toBe(false);
    expect(sameWindow(w('2026-08-01', '2026-08-30'), w('2026-08-01', '2026-08-31'))).toBe(false);
  });

  it('an unknown window is never assumed compatible', () => {
    expect(sameWindow(null, w('2026-08-01', '2026-08-30'))).toBe(false);
    expect(sameWindow(w('nonsense', 'nonsense'), w('2026-08-01', '2026-08-30'))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// PART 2 — KNOWN GAPS, pinned inverted
// ------------------------------------------------------------
// Required contract tests 1, 2 and 8 CANNOT pass today. They need the window
// provenance column (Phase C) and the window-aware resolver (Phase D), and this
// PR builds neither — it changes no production behaviour by design.
//
// Omitting them would let the gap go quiet, and a `skip` proves nothing and is
// read as "someone will get to it". So each is written INVERTED: it asserts the
// defect that exists right now, and it is CONSTRUCTED TO BREAK the moment the
// owning phase lands. A red test is the handoff.
// ════════════════════════════════════════════════════════════

const snap = (o) => ({
  entityId: 'E1', entityLevel: 'CAMPAIGN', source: 'META', currency: 'USD',
  spendMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0,
  frequency: null, reach: null, ctr: null, roas: null, actionMetrics: null, ...o,
});

describe('REQUIRED TEST 1 — window identity ⟶ MUST INVERT ON PHASE D ACTIVATION', () => {
  // Phase C shipped `measurementWindow` on the TABLE — and this test did not
  // move, because EntityGraphService's METRIC_SELECT still does not read it.
  // That gap is the honest state: provenance exists, resolution does not. On
  // Phase D activation the surviving row WILL carry a window field and this
  // flips to asserting that two rows from different windows stay distinguishable.
  it('KNOWN GAP: the row a READER sees carries nothing that names its period', () => {
    const cron = snap({ date: new Date('2026-08-01'), spendMinor: 900_00, frequency: 4.2 });   // last_90d
    const manual = snap({ date: new Date('2026-08-02'), spendMinor: 9000_00, frequency: 9.8 }); // maximum
    const eff = effectiveByEntity([cron, manual]).get('E1');

    for (const field of ['window', 'windowDays', 'datePreset', 'windowStart', 'windowEnd']) {
      expect(eff).not.toHaveProperty(field); // ← every one of these must become present
    }
    // `granularity` is not a substitute: all three writers hardcode 'DAILY'
    // onto rows that are 90-day and lifetime aggregates.
    expect(eff).not.toHaveProperty('granularity');
  });

  it('KNOWN GAP: two rows from incompatible windows are structurally identical', () => {
    const shape = (r) => Object.keys(r).sort().join(',');
    const ninetyDay = snap({ date: new Date('2026-08-01'), frequency: 4.2, spendMinor: 900_00 });
    const lifetime = snap({ date: new Date('2026-08-01'), frequency: 9.8, spendMinor: 9000_00 });
    expect(shape(ninetyDay)).toBe(shape(lifetime)); // ← must diverge after Phase C
  });
});

describe('REQUIRED TEST 2 — sync independence ⟶ MUST INVERT ON PHASE D ACTIVATION', () => {
  // Phase D resolves metrics BY WINDOW instead of by newest row. When it lands,
  // the manual row must stop winning merely for being newer.
  it('KNOWN GAP: the newest row wins on date alone, so Manual Sync re-bases every verdict', () => {
    const cron = snap({ date: new Date('2026-08-01'), spendMinor: 900_00, frequency: 4.2 });
    const manual = snap({ date: new Date('2026-08-02'), spendMinor: 9000_00, frequency: 9.8 });

    // Order-independent: it is the DATE that decides, not the array position.
    for (const rows of [[cron, manual], [manual, cron]]) {
      const eff = effectiveByEntity(rows).get('E1');
      expect(eff.frequency).toBe(9.8);     // ← the `maximum` row
      expect(eff.spendMinor).toBe(9000_00);
    }
    // After Phase D both assertions become `4.2` / `900_00`-shaped: resolved for
    // the canonical 30-day window, indifferent to which preset synced last.
  });
});

describe('REQUIRED TEST 8 — verdict invariance ⟶ MUST INVERT ON PHASE D ACTIVATION', () => {
  // The same campaign, the same money, the same engagement. ONLY the window the
  // frequency was measured over differs. After Phase D every row here must
  // produce the SAME verdict; today they do not.
  const verdictAtFrequency = (frequency) => {
    const agg = aggregateMetrics({
      metrics: { spendMinor: 100_00, revenueMinor: 90_00, impressions: 100_000, clicks: 900, conversions: 3, frequency },
    });
    return evaluateVerdict({
      level: 'CAMPAIGN', metrics: toSignalInput(agg, 'USD'), objective: 'OUTCOME_SALES', daysRunning: 30,
    }).verdict;
  };

  it('KNOWN GAP: the ingestion preset changes the verdict — HOLD at daily grain, KILL at every window', () => {
    // frequency for one campaign, measured over four different periods
    expect(verdictAtFrequency(1.31)).toBe('HOLD'); //  daily — below the 3.5 ceiling
    expect(verdictAtFrequency(3.68)).toBe('KILL'); //  7-day
    expect(verdictAtFrequency(5.00)).toBe('KILL'); // 30-day — the canonical window
    expect(verdictAtFrequency(9.80)).toBe('KILL'); // 90-day / maximum

    // The gap, stated as one assertion so it cannot be read past:
    const verdicts = new Set([1.31, 3.68, 5.0, 9.8].map(verdictAtFrequency));
    expect(verdicts.size).toBeGreaterThan(1); // ← must become exactly 1 after Phase D
  });

  // Worth pinning separately: ROAS and CTR are ALREADY window-consistent,
  // because toSignalInput re-derives both from one row's raw counts. Frequency
  // is the single verdict input carried verbatim from Meta, and therefore the
  // only one whose window can drift away from the others.
  it('ROAS and CTR are re-derived from raw counts, so they cannot drift apart', () => {
    const agg = aggregateMetrics({
      metrics: { spendMinor: 100_00, revenueMinor: 90_00, impressions: 100_000, clicks: 900, conversions: 3, frequency: 5 },
    });
    const si = toSignalInput(agg, 'USD');
    expect(si.roas).toBeCloseTo(0.9, 10);  // 9000/10000, both from the same row
    expect(si.ctr).toBeCloseTo(0.9, 10);   // 900/100000×100, both from the same row
    expect(deriveRoas(agg.revenueMinor, agg.spendMinor)).toBeCloseTo(si.roas, 10);
    expect(deriveCtr(agg.clicks, agg.impressions)).toBeCloseTo(si.ctr, 10);
  });
});
