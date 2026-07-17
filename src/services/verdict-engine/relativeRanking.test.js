// ============================================================
// relativeRanking — unit tests
// ============================================================
// Exercises the portfolio-relative post-pass through the REAL pipeline
// (rollupVerdicts → applyRelativeRanking) so the tests bind to the same annotated
// shape production runs on, not a hand-mocked one.
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { rollupVerdicts } from './verdictEngine.js';
import { applyRelativeRanking } from './relativeRanking.js';
import { VERDICT } from './verdictTypes.js';

// A connector-shaped CAMPAIGN leaf. CTR% = clicks/impressions*100. Defaults land a
// plain awareness HOLD (freq < 3, ctr ≥ 0.5, no revenue) unless overridden.
function campaign(id, { clicks, impressions = 10_000, frequency = 1.2, spendMinor = 5_000, revenueMinor = 0, revenueExpected = false, objective = 'OUTCOME_AWARENESS' }) {
  return {
    id, level: 'CAMPAIGN', name: id, revenueExpected, objective,
    metrics: { spendMinor, revenueMinor, impressions, clicks, conversions: 0, frequency },
  };
}
const account = (children) => ({ id: 'acct', level: 'ACCOUNT', children });
const rank = (tree) => {
  const a = applyRelativeRanking(rollupVerdicts(tree));
  return Object.fromEntries(a.children.map((c) => [c.id, c]));
};

describe('applyRelativeRanking — cohort extremes', () => {
  // Four awareness HOLDs with CTR 0.6 / 2 / 3 / 5 (avg 2.65).
  const base = () => account([
    campaign('c1', { clicks: 60 }),   // 0.60% — worst
    campaign('c2', { clicks: 200 }),  // 2.00%
    campaign('c3', { clicks: 300 }),  // 3.00%
    campaign('c4', { clicks: 500 }),  // 5.00% — best
  ]);

  it('upgrades the bottom of a cohort to KILL', () => {
    const byId = rank(base());
    expect(byId.c1.verdict).toBe(VERDICT.KILL);
    expect(byId.c1.relativeRank).toBe('BOTTOM');
  });

  it('upgrades the top of a cohort to SCALE', () => {
    const byId = rank(base());
    expect(byId.c4.verdict).toBe(VERDICT.SCALE);
    expect(byId.c4.relativeRank).toBe('TOP');
  });

  it('leaves the middle of the cohort as an untouched HOLD', () => {
    const byId = rank(base());
    expect(byId.c2.verdict).toBe(VERDICT.HOLD);
    expect(byId.c3.verdict).toBe(VERDICT.HOLD);
    expect(byId.c2.relativeRank).toBeUndefined();
  });

  it('quotes the real CTR and the cohort average in the rationale (no fabricated numbers)', () => {
    const byId = rank(base());
    expect(byId.c1.rationale).toContain('0.60%');
    expect(byId.c1.rationale).toContain('2.65%');
    expect(byId.c1.rationale).toContain('awareness group');
    expect(byId.c1.rationale).toContain('engagement signals only');
  });

  it('is deterministic — same input twice yields identical output', () => {
    expect(rank(base())).toEqual(rank(base()));
  });
});

describe('applyRelativeRanking — governing law', () => {
  it('does not rank a cohort with fewer than 3 candidates', () => {
    const byId = rank(account([
      campaign('a', { clicks: 60 }),
      campaign('b', { clicks: 500 }),
    ]));
    expect(byId.a.verdict).toBe(VERDICT.HOLD);
    expect(byId.b.verdict).toBe(VERDICT.HOLD);
    expect(byId.a.relativeRank).toBeUndefined();
    expect(byId.b.relativeRank).toBeUndefined();
  });

  it('excludes a revenue-measured campaign (ROAS track owns it) even at the bottom', () => {
    // 3 awareness candidates + a revenue-measured HOLD with the lowest CTR.
    const byId = rank(account([
      campaign('m1', { clicks: 200 }),  // 2.0%
      campaign('m2', { clicks: 300 }),  // 3.0%
      campaign('m3', { clicks: 500 }),  // 5.0%
      campaign('rev', { clicks: 200, revenueMinor: 8_000 }), // roas 1.6 → HOLD, measured
    ]));
    expect(byId.rev.verdict).toBe(VERDICT.HOLD);   // untouched by relative ranking
    expect(byId.rev.relativeRank == null).toBe(true);
    // the awareness cohort still ranks among ITS three
    expect(byId.m1.verdict).toBe(VERDICT.KILL);
    expect(byId.m3.verdict).toBe(VERDICT.SCALE);
  });

  it('never overrides an absolute non-HOLD/WATCH verdict', () => {
    // cFat is an awareness REFRESH (freq past ceiling, weak CTR) and the worst CTR —
    // it must stay REFRESH, not be relatively killed.
    const byId = rank(account([
      campaign('k1', { clicks: 200 }),  // 2.0% HOLD
      campaign('k2', { clicks: 300 }),  // 3.0% HOLD
      campaign('k3', { clicks: 500 }),  // 5.0% HOLD
      campaign('cFat', { clicks: 50, frequency: 4.0 }), // 0.5% + freq 4 → REFRESH
    ]));
    expect(byId.cFat.verdict).toBe(VERDICT.REFRESH);
    expect(byId.cFat.relativeRank == null).toBe(true);
  });

  it('excludes a trivial-spend row from ranking', () => {
    const byId = rank(account([
      campaign('s1', { clicks: 200 }),                    // 2.0% real spend
      campaign('s2', { clicks: 300 }),                    // 3.0%
      campaign('s3', { clicks: 500 }),                    // 5.0%
      campaign('tiny', { clicks: 10, spendMinor: 500 }),  // 0.1% but sub-floor spend
    ]));
    expect(byId.tiny.relativeRank == null).toBe(true);
    expect(byId.tiny.verdict).toBe(VERDICT.HOLD);
    // s1 is the worst of the three that DO qualify
    expect(byId.s1.verdict).toBe(VERDICT.KILL);
  });

  it('ranks awareness and conversion campaigns in separate cohorts', () => {
    // 3 awareness + 3 conversion (tracking-gap) campaigns; each cohort ranks alone.
    const byId = rank(account([
      campaign('aw1', { clicks: 100 }),  // 1.0% awareness (worst awareness)
      campaign('aw2', { clicks: 300 }),  // 3.0%
      campaign('aw3', { clicks: 500 }),  // 5.0% (best awareness)
      campaign('cv1', { clicks: 400, revenueExpected: true, objective: 'OUTCOME_SALES' }),  // 4.0% (worst conv)
      campaign('cv2', { clicks: 600, revenueExpected: true, objective: 'OUTCOME_SALES' }),  // 6.0%
      campaign('cv3', { clicks: 800, revenueExpected: true, objective: 'OUTCOME_SALES' }),  // 8.0% (best conv)
    ]));
    // awareness cohort: aw1 worst → KILL, aw3 best → SCALE
    expect(byId.aw1.verdict).toBe(VERDICT.KILL);
    expect(byId.aw3.verdict).toBe(VERDICT.SCALE);
    // conversion cohort: cv1 worst → KILL (despite 4% > aw1's 1%, it's judged among conv)
    expect(byId.cv1.verdict).toBe(VERDICT.KILL);
    expect(byId.cv1.rationale).toContain('conversion group');
    expect(byId.cv3.verdict).toBe(VERDICT.SCALE);
  });
});
