// ============================================================
// PARITY-01 · ONE reading of the account aggregate, for every surface
// ------------------------------------------------------------
// THE PROPERTY
//
//   Two surfaces that state the same account fact must state the same value,
//   and must never state it at all when the read did not land.
//
// Parity discovery measured both halves failing at once:
//
//   • Attention (overviewDerive.js) divided minor units by a HARDCODED 100
//     while Campaigns (CampaignsView.jsx) used fromMinor() with the currency's
//     real exponent. On a KWD/BHD/JOD workspace — 1000 fils to the dinar — the
//     same rows produced a Total Spend TEN TIMES larger on one axis than the
//     other. Three lines apart, in a file that imports fromMinor and uses it on
//     the next line for a different card.
//
//   • Both summed spend across currencies and labelled the total with whichever
//     currency happened to be first in the array, producing a figure in no
//     currency at all.
//
//   • Campaigns derived `live = campaigns.length > 0`, so a FAILED read became
//     the label "No data yet" — a claim about the operator's account, made by a
//     request that never landed.
//
// The cure is not three fixes. It is one reading, consumed twice: the canonical
// answer is computed once by AccountAggregateService and read here once, so the
// two surfaces cannot disagree again without this file failing.
// ============================================================
import { describe, it, expect } from 'vitest';
import { accountAggregateReading, AGGREGATE_ABSENCE } from './accountAggregate.js';

const aggregate = (over = {}) => ({
  aggregationLevel: 'CAMPAIGN',
  population: {
    measurementWindow: 'CUMULATIVE_30D',
    windowStart: '2026-08-09T00:00:00.000Z',
    windowEnd: '2026-09-07T00:00:00.000Z',
    boundsStatus: 'REPORTED',
    declaredWindow: 'CUMULATIVE_30D',
    campaignCount: 2,
  },
  currency: 'USD',
  currencyStatus: 'SINGLE',
  spend: { minor: 400_000, unavailable: null },
  acquisition: { conversions: 40, blendedCpaMinor: 10_000, unavailable: null },
  verdicts: { KILL: 1, HOLD: 1, SCALE: 0, WATCH: 0, REALLOCATE: 0, REFRESH: 0, unverdicted: 0 },
  spendByVerdict: { KILL: 200_000, HOLD: 200_000, SCALE: 0, WATCH: 0, REALLOCATE: 0, REFRESH: 0, unverdicted: 0 },
  spendByVerdictUnavailable: null,
  ...over,
});
const ok = (agg = aggregate()) => ({
  response: { workspaceId: 'ws', generatedAt: 'now', available: true, reason: null, aggregate: agg },
  loading: false,
  error: null,
});

describe('PARITY-01 · the reading, when the answer landed', () => {
  it('converts minor → major with the CURRENCY exponent, not a hardcoded 100', () => {
    const r = accountAggregateReading(ok());
    expect(r.spend).toBe(4000);        // 400_000 cents
    expect(r.blendedCpa).toBe(100);    // 10_000 cents
    expect(r.currency).toBe('USD');
    expect(r.spendAbsence).toBeNull();
  });

  // THE REGRESSION. A dinar is 1000 fils. `/100` reported 4,000 KWD where the
  // account spent 400 — and the other axis, using fromMinor, said 400.
  it('a 3-exponent currency is not overstated tenfold', () => {
    const r = accountAggregateReading(ok(aggregate({ currency: 'KWD' })));
    expect(r.spend).toBe(400);
    expect(r.blendedCpa).toBe(10);
    expect(r.spend).not.toBe(4000);
  });

  it('carries the window the ROWS reported, not a hardcoded caption', () => {
    const r = accountAggregateReading(ok());
    expect(r.windowLabel).toBe('CUMULATIVE_30D');
    expect(r.campaignCount).toBe(2);
  });

  it('reports no window when the rows do not agree on one', () => {
    const r = accountAggregateReading(ok(aggregate({
      population: { ...aggregate().population, boundsStatus: 'NON_UNIFORM', windowStart: null, windowEnd: null },
    })));
    // The label survives (every row is still a 30-day window); the BOUNDS do not,
    // and the reading says so rather than inventing a span no row measured.
    expect(r.windowLabel).toBe('CUMULATIVE_30D');
    expect(r.boundsKnown).toBe(false);
  });
});

describe('PARITY-01 · the reading, when there is no single answer', () => {
  it('a mixed-currency account gets NO total — not a sum, not a zero', () => {
    const r = accountAggregateReading(ok(aggregate({
      currency: null,
      currencyStatus: 'MIXED',
      spend: { minor: null, unavailable: 'MIXED_CURRENCY' },
      acquisition: { conversions: 40, blendedCpaMinor: null, unavailable: 'MIXED_CURRENCY' },
      spendByVerdict: null,
      spendByVerdictUnavailable: 'MIXED_CURRENCY',
    })));
    expect(r.spend).toBeNull();
    expect(r.blendedCpa).toBeNull();
    expect(r.spendAbsence).toBe(AGGREGATE_ABSENCE.MIXED_CURRENCY);
    // C-07 — a token is not a reason. The operator is told WHICH absence this is.
    expect(r.spendLabel).toMatch(/currenc/i);
    expect(r.spendLabel).not.toMatch(/no data yet/i);
  });

  it('spend measured but no conversions → CPA absent for its OWN reason', () => {
    const r = accountAggregateReading(ok(aggregate({
      acquisition: { conversions: 0, blendedCpaMinor: null, unavailable: 'NO_CONVERSIONS' },
    })));
    expect(r.spend).toBe(4000);            // spend is still known
    expect(r.blendedCpa).toBeNull();
    expect(r.cpaAbsence).toBe(AGGREGATE_ABSENCE.NO_CONVERSIONS);
    expect(r.spendAbsence).toBeNull();     // two absences, two causes
  });
});

describe('PARITY-01 · the reading, when nothing landed', () => {
  it('a FAILED READ never renders as an empty account', () => {
    const r = accountAggregateReading({ response: null, loading: false, error: new Error('boom') });
    expect(r.spend).toBeNull();
    expect(r.spendAbsence).toBe(AGGREGATE_ABSENCE.READ_FAILED);
    // The defect this slice exists to close.
    expect(r.spendLabel).not.toMatch(/no data yet/i);
    expect(r.spendLabel).toMatch(/couldn.t|could not/i);
  });

  it('LOADING is not an answer either', () => {
    const r = accountAggregateReading({ response: null, loading: true, error: null });
    expect(r.spend).toBeNull();
    expect(r.spendAbsence).toBe(AGGREGATE_ABSENCE.LOADING);
    expect(r.spendLabel).not.toMatch(/no data yet/i);
  });

  it('"No data yet" is reserved for the one case that measured it', () => {
    const r = accountAggregateReading({
      response: { workspaceId: 'ws', generatedAt: 'now', available: false, reason: 'NO_CANONICAL_MEASUREMENT', aggregate: null },
      loading: false,
      error: null,
    });
    expect(r.spend).toBeNull();
    expect(r.spendAbsence).toBe(AGGREGATE_ABSENCE.NO_MEASUREMENT);
    expect(r.spendLabel).toMatch(/no data yet/i);
  });

  it('a REFUSAL is not a failure and not an empty account', () => {
    // The endpoint is BUYER|STRATEGIST. Both surfaces are closed to a CLIENT,
    // but LockFromClient renders its children while the role resolves, so the
    // 403 is briefly reachable — and "you may not read this" is a third claim.
    const r = accountAggregateReading({ response: null, loading: false, error: null, forbidden: true });
    expect(r.spendAbsence).toBe(AGGREGATE_ABSENCE.NOT_PERMITTED);
    expect(r.spendLabel).not.toMatch(/no data yet/i);
    expect(r.spendLabel).not.toMatch(/couldn.t/i);
  });

  // ── self-refutation ───────────────────────────────────────────────────────
  it('the five absences are five DIFFERENT sentences', () => {
    const label = (input) => accountAggregateReading(input).spendLabel;
    const said = new Set([
      label({ response: null, loading: true, error: null }),
      label({ response: null, loading: false, error: new Error('x') }),
      label({ response: { available: false, reason: 'NO_CANONICAL_MEASUREMENT', aggregate: null }, loading: false, error: null }),
      label(ok(aggregate({ currency: null, currencyStatus: 'MIXED', spend: { minor: null, unavailable: 'MIXED_CURRENCY' } }))),
      label({ response: null, loading: false, error: null, forbidden: true }),
    ]);
    expect(said.size).toBe(5);
  });
});
