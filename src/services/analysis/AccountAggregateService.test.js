// ============================================================
// R13-D / B2 — the account aggregate, and what it refuses to say
// ============================================================
// These numbers used to be computed in React, three times, with three different
// sets of rules. This suite pins the one implementation that replaces them, and
// most of it is about the cases where the honest answer is NO NUMBER.
//
// The route/DB half lives in routes/lumi/account.aggregate.test.js — isolation,
// hierarchy and the canonical filter are claims about a QUERY and cannot be
// proven against a fixture. What is proven here is the arithmetic and the
// absence semantics, which are claims about a function.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  computeAccountAggregate, resolveCurrency, resolvePopulationWindow,
  UNAVAILABLE, BOUNDS_STATUS, CURRENCY_STATUS, AGGREGATION_LEVEL,
} from './AccountAggregateService.js';
import { VERDICT } from '../verdict-engine/verdictTypes.js';

const START = new Date('2026-07-20T00:00:00Z');
const END   = new Date('2026-08-18T00:00:00Z');

/** A canonical campaign row, exactly as getCanonicalVerdictCampaigns projects one. */
const row = (over = {}) => ({
  entityId: 'c1', name: 'Eid', channel: 'META', objective: 'OUTCOME_SALES',
  spendMinor: 100_000, revenueMinor: 400_000, conversions: 20,
  roas: 4, ctr: 0.016, frequency: 2.1, currency: 'EGP',
  measurementWindow: 'CUMULATIVE_30D', windowStart: START, windowEnd: END,
  ...over,
});

const verdicts = (map) =>
  Object.fromEntries(Object.entries(map).map(([id, verdict]) => [id, { verdict }]));

describe('1 — the shape, and the level it is aggregated at', () => {
  it('reports CAMPAIGN as its one aggregation level', () => {
    const a = computeAccountAggregate([row()], verdicts({ c1: 'KILL' }));
    // Ad-set spend is a SUBSET of its campaign's. Summing two levels counts the
    // same money twice, so the level is singular and stated on the answer.
    expect(a.aggregationLevel).toBe(AGGREGATION_LEVEL);
    expect(a.aggregationLevel).toBe('CAMPAIGN');
  });

  it('keys verdicts by the canonical taxonomy — no invented buckets', () => {
    const a = computeAccountAggregate([row()], verdicts({ c1: 'KILL' }));
    // Exactly the VERDICT enum, plus the explicit unverdicted lane. Reporting
    // only KILL/HOLD/SCALE/WATCH would silently drop REALLOCATE and REFRESH
    // spend out of an account total — money vanishing by omission.
    expect(Object.keys(a.verdicts).sort()).toEqual([...Object.values(VERDICT), 'unverdicted'].sort());
    expect(Object.keys(a.spendByVerdict).sort()).toEqual([...Object.values(VERDICT), 'unverdicted'].sort());
  });
});

describe('2 — spend is the sum of the rows, and nothing else', () => {
  it('adds up exactly', () => {
    const a = computeAccountAggregate([
      row({ entityId: 'c1', spendMinor: 100_000 }),
      row({ entityId: 'c2', spendMinor: 25_500 }),
      row({ entityId: 'c3', spendMinor: 1 }),
    ], {});
    expect(a.spend.minor).toBe(125_501);
    expect(a.spend.unavailable).toBeNull();
  });

  it('a row that reported no spend contributes nothing — it does not become a 0 sum', () => {
    const a = computeAccountAggregate([
      row({ entityId: 'c1', spendMinor: 40_000 }),
      row({ entityId: 'c2', spendMinor: null }),
    ], {});
    expect(a.spend.minor).toBe(40_000);
  });

  it('NO row reporting spend yields null, not 0', () => {
    const a = computeAccountAggregate([row({ spendMinor: null })], {});
    expect(a.spend.minor).toBeNull();
    expect(a.spend.unavailable).toBe(UNAVAILABLE.NOT_MEASURED);
  });

  it('a measured zero IS reported as zero', () => {
    // The other side of the rule. 0 spend that was actually measured is a fact
    // about the account; refusing to report it would be its own dishonesty.
    const a = computeAccountAggregate([row({ spendMinor: 0 })], {});
    expect(a.spend.minor).toBe(0);
    expect(a.spend.unavailable).toBeNull();
  });
});

describe('3 — blended CPA is a ratio of totals, never a mean of ratios', () => {
  // Σspend / Σconversions = 100_000 / 50 = 2_000
  // mean of per-campaign CPAs = (3_000 + 500) / 2 = 1_750
  // The fixture is chosen so the two answers CANNOT coincide.
  const skewed = [
    row({ entityId: 'c1', spendMinor: 90_000, conversions: 30 }), // CPA 3_000
    row({ entityId: 'c2', spendMinor: 10_000, conversions: 20 }), // CPA   500
  ];

  it('divides account totals', () => {
    const a = computeAccountAggregate(skewed, {});
    expect(a.acquisition.blendedCpaMinor).toBe(2_000);
    expect(a.acquisition.conversions).toBe(50);
  });

  it('is NOT the average of per-campaign CPAs', () => {
    // The legacy feed publishes that quantity under this name
    // (useCampaignFeed.js `cpaSum / cpaCount`). It weights a campaign that spent
    // 100 the same as one that spent 100,000 — a different question entirely.
    const a = computeAccountAggregate(skewed, {});
    expect(a.acquisition.blendedCpaMinor).not.toBe(1_750);
  });

  it('no conversions measured → null, never 0', () => {
    const a = computeAccountAggregate([row({ conversions: null })], {});
    expect(a.acquisition.conversions).toBeNull();
    expect(a.acquisition.blendedCpaMinor).toBeNull();
    expect(a.acquisition.unavailable).toBe(UNAVAILABLE.NO_CONVERSIONS);
    // …while spend is untouched: one absent field does not blank the others.
    expect(a.spend.minor).toBe(100_000);
  });

  it('conversions measured AS zero → the count is 0 and the ratio is null', () => {
    // A real zero and an undefined ratio, side by side. Dividing by it would be
    // Infinity; reporting 0 would claim every conversion was free.
    const a = computeAccountAggregate([row({ conversions: 0 })], {});
    expect(a.acquisition.conversions).toBe(0);
    expect(a.acquisition.blendedCpaMinor).toBeNull();
    expect(a.acquisition.unavailable).toBe(UNAVAILABLE.NO_CONVERSIONS);
  });
});

describe('4 — verdict counts and spend-by-verdict come from the same rows', () => {
  const rows = [
    row({ entityId: 'c1', spendMinor: 50_000 }),
    row({ entityId: 'c2', spendMinor: 30_000 }),
    row({ entityId: 'c3', spendMinor: 20_000 }),
  ];

  it('counts what the verdict map actually says', () => {
    const a = computeAccountAggregate(rows, verdicts({ c1: 'KILL', c2: 'KILL', c3: 'SCALE' }));
    expect(a.verdicts.KILL).toBe(2);
    expect(a.verdicts.SCALE).toBe(1);
    expect(a.verdicts.HOLD).toBe(0);   // established by looking, not assumed
    expect(a.verdicts.unverdicted).toBe(0);
  });

  it('attributes each campaign\'s spend to its own verdict', () => {
    const a = computeAccountAggregate(rows, verdicts({ c1: 'KILL', c2: 'KILL', c3: 'SCALE' }));
    expect(a.spendByVerdict.KILL).toBe(80_000);
    expect(a.spendByVerdict.SCALE).toBe(20_000);
  });

  it('a campaign with NO verdict is counted as unverdicted, never bucketed', () => {
    // The engine gates out campaigns with no spend or no delivery, so a
    // canonical row can exist with no verdict beside it. Dropping its spend
    // would make the lanes silently fail to reconcile with the total.
    const a = computeAccountAggregate(rows, verdicts({ c1: 'KILL' }));
    expect(a.verdicts.KILL).toBe(1);
    expect(a.verdicts.unverdicted).toBe(2);
    expect(a.spendByVerdict.unverdicted).toBe(50_000);
  });

  it('an unknown verdict string does not create a key outside the taxonomy', () => {
    const a = computeAccountAggregate(rows, verdicts({ c1: 'SOMETHING_NEW' }));
    expect(a.verdicts).not.toHaveProperty('SOMETHING_NEW');
    expect(a.verdicts.unverdicted).toBe(3);
  });

  it('the lanes reconcile to the total — no money enters or leaves', () => {
    // The invariant that makes spend-by-verdict auditable rather than decorative.
    const a = computeAccountAggregate(rows, verdicts({ c1: 'KILL', c3: 'REFRESH' }));
    const laneSum = Object.values(a.spendByVerdict).reduce((s, v) => s + v, 0);
    expect(laneSum).toBe(a.spend.minor);
  });
});

describe('5 — the period is the rows\', and is never invented', () => {
  it('reports the bounds when every row agrees', () => {
    const a = computeAccountAggregate([row({ entityId: 'c1' }), row({ entityId: 'c2' })], {});
    expect(a.population.measurementWindow).toBe('CUMULATIVE_30D');
    expect(a.population.windowStart).toEqual(START);
    expect(a.population.windowEnd).toEqual(END);
    expect(a.population.boundsStatus).toBe(BOUNDS_STATUS.REPORTED);
  });

  it('refuses to publish a UNION when the rows measured different windows', () => {
    // June's 30 days plus July's 30 days is not "1 Jun → 30 Jul" of spend. The
    // sum is still real — every row is a CUMULATIVE_30D measurement — but no
    // single pair of bounds describes it, so none is offered.
    const a = computeAccountAggregate([
      row({ entityId: 'c1', windowStart: new Date('2026-06-01Z'), windowEnd: new Date('2026-06-30Z') }),
      row({ entityId: 'c2', windowStart: new Date('2026-07-01Z'), windowEnd: new Date('2026-07-30Z') }),
    ], {});
    expect(a.population.boundsStatus).toBe(BOUNDS_STATUS.NON_UNIFORM);
    expect(a.population.windowStart).toBeNull();
    expect(a.population.windowEnd).toBeNull();
    // The LABEL survives — they are all still thirty-day measurements.
    expect(a.population.measurementWindow).toBe('CUMULATIVE_30D');
    // …and the money is still reported. Uncertain bounds are not missing data.
    expect(a.spend.minor).toBe(200_000);
  });

  it('one row without bounds makes the whole aggregate\'s bounds unreported', () => {
    const a = computeAccountAggregate([
      row({ entityId: 'c1' }),
      row({ entityId: 'c2', windowStart: null, windowEnd: null }),
    ], {});
    expect(a.population.boundsStatus).toBe(BOUNDS_STATUS.NOT_REPORTED);
    expect(a.population.windowStart).toBeNull();
  });

  it('changing the source window changes the published provenance', () => {
    // The mutation §17.12 asks for, as a test: provenance tracks the rows.
    const before = computeAccountAggregate([row()], {});
    const after = computeAccountAggregate([
      row({ windowStart: new Date('2026-01-01Z'), windowEnd: new Date('2026-01-30Z') }),
    ], {});
    expect(after.population.windowStart).not.toEqual(before.population.windowStart);
    expect(after.population.windowStart).toEqual(new Date('2026-01-01Z'));
  });

  it('publishes what the selector DECLARED beside what the rows said', () => {
    const a = computeAccountAggregate([row({ measurementWindow: 'ROLLING_WINDOW' })], {});
    // Both, never one standing in for the other. A disagreement is a fact worth
    // being able to see rather than one the payload smooths over.
    expect(a.population.measurementWindow).toBe('ROLLING_WINDOW');
    expect(a.population.declaredWindow).toBe('CUMULATIVE_30D');
  });

  it('rows disagreeing about their own window yield no single label', () => {
    const a = computeAccountAggregate([
      row({ entityId: 'c1', measurementWindow: 'CUMULATIVE_30D' }),
      row({ entityId: 'c2', measurementWindow: 'ROLLING_WINDOW' }),
    ], {});
    expect(a.population.measurementWindow).toBeNull();
  });
});

describe('6 — two currencies produce no number at all', () => {
  const mixed = [
    row({ entityId: 'c1', currency: 'EGP', spendMinor: 100_000, conversions: 10 }),
    row({ entityId: 'c2', currency: 'USD', spendMinor: 50_000, conversions: 10 }),
  ];

  it('refuses to sum them', () => {
    const a = computeAccountAggregate(mixed, {});
    expect(a.currencyStatus).toBe(CURRENCY_STATUS.MIXED);
    expect(a.currency).toBeNull();
    expect(a.spend.minor).toBeNull();
    expect(a.spend.unavailable).toBe(UNAVAILABLE.MIXED_CURRENCY);
  });

  it('never picks one currency and totals everything under it', () => {
    // The frontend heuristic this replaces: "first non-USD currency wins", then
    // sum. 150_000 is the number that heuristic produces, in no real currency.
    const a = computeAccountAggregate(mixed, {});
    expect(a.spend.minor).not.toBe(150_000);
    expect(a.currency).not.toBe('EGP');
    expect(a.currency).not.toBe('USD');
  });

  it('blocks every money-valued field, and only those', () => {
    const a = computeAccountAggregate(mixed, verdicts({ c1: 'KILL', c2: 'HOLD' }));
    expect(a.acquisition.blendedCpaMinor).toBeNull();
    expect(a.acquisition.unavailable).toBe(UNAVAILABLE.MIXED_CURRENCY);
    expect(a.spendByVerdict).toBeNull();
    expect(a.spendByVerdictUnavailable).toBe(UNAVAILABLE.MIXED_CURRENCY);
    // COUNTS survive — a count is a count whatever the money was denominated in,
    // and blanking them would hide real verdicts behind an accounting problem.
    expect(a.verdicts.KILL).toBe(1);
    expect(a.verdicts.HOLD).toBe(1);
    expect(a.acquisition.conversions).toBe(20);
  });

  it('one currency across every row aggregates normally', () => {
    const a = computeAccountAggregate([row({ entityId: 'c1' }), row({ entityId: 'c2' })], {});
    expect(a.currencyStatus).toBe(CURRENCY_STATUS.SINGLE);
    expect(a.currency).toBe('EGP');
    expect(a.spend.minor).toBe(200_000);
  });

  it('no row stating a currency is UNKNOWN, not a USD guess', () => {
    const { currency, status } = resolveCurrency([row({ currency: null })]);
    expect(status).toBe(CURRENCY_STATUS.UNKNOWN);
    expect(currency).toBeNull();
  });
});

describe('7 — an account with nothing measured gets no aggregate at all', () => {
  it('returns null rather than a shell of zeroes', () => {
    // "0 spend, 0 KILL, 0 SCALE across 0 campaigns" is a measurement of an
    // account. Nothing measured this one, and the difference is the whole rule.
    expect(computeAccountAggregate([], {})).toBeNull();
    expect(computeAccountAggregate(null, {})).toBeNull();
    expect(computeAccountAggregate(undefined)).toBeNull();
  });

  it('rows with no verdicts still produce real, established zero counts', () => {
    // The contrast case: here we DID look at a campaign, so "no KILLs" is a
    // finding rather than an assumption.
    const a = computeAccountAggregate([row()], {});
    expect(a).not.toBeNull();
    expect(a.verdicts.KILL).toBe(0);
    expect(a.population.campaignCount).toBe(1);
  });
});

describe('8 — the pure helpers hold on their own', () => {
  it('resolvePopulationWindow reports nothing for no rows', () => {
    const w = resolvePopulationWindow([]);
    expect(w.measurementWindow).toBeNull();
    expect(w.boundsStatus).toBe(BOUNDS_STATUS.NOT_REPORTED);
  });

  it('resolveCurrency is order-independent', () => {
    const a = resolveCurrency([row({ currency: 'USD' }), row({ currency: 'EGP' })]);
    const b = resolveCurrency([row({ currency: 'EGP' }), row({ currency: 'USD' })]);
    expect(a).toEqual(b);
    expect(a.status).toBe(CURRENCY_STATUS.MIXED);
  });
});
