// ============================================================
// PARITY-01 · the account aggregate contract admits what the server publishes
// ------------------------------------------------------------
// B8-01's law: a slice that ARMS a guard owns proving the guard admits the
// truth. A strict zod enum does not reject one field — it fails the parse and
// kills the whole surface, so every closed vocabulary below is exercised
// against a payload shaped exactly like the one `src/routes/lumi/account.js`
// returns, and the three shapes its own DB-backed tests pin:
//
//   available:true  + a full aggregate           (account.aggregate.test.js #1)
//   available:true  + MIXED_CURRENCY refusal     (#7)
//   available:false + NO_CANONICAL_MEASUREMENT   (#8)
//
// The vocabularies themselves are proved to MATCH the server's frozen objects
// in src/tests/accountAggregateParity.test.js — this file proves the parse, that
// one proves the words.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  AccountAggregateResponseSchema,
  AccountAggregateSchema,
} from './accountAggregate.schema';

// Mirrors account.aggregate.test.js #1 exactly: EGP, 100_000 minor over 20
// conversions → 5_000 minor CPA, bounds REPORTED.
const FULL = {
  workspaceId: 'ws-1',
  generatedAt: '2026-09-08T00:00:00.000Z',
  available: true,
  reason: null,
  aggregate: {
    aggregationLevel: 'CAMPAIGN',
    population: {
      measurementWindow: 'CUMULATIVE_30D',
      windowStart: '2026-08-09T00:00:00.000Z',
      windowEnd: '2026-09-07T00:00:00.000Z',
      boundsStatus: 'REPORTED',
      declaredWindow: 'CUMULATIVE_30D',
      campaignCount: 1,
    },
    currency: 'EGP',
    currencyStatus: 'SINGLE',
    spend: { minor: 100_000, unavailable: null },
    acquisition: { conversions: 20, blendedCpaMinor: 5_000, unavailable: null },
    verdicts: { KILL: 1, HOLD: 0, SCALE: 0, WATCH: 0, REALLOCATE: 0, REFRESH: 0, unverdicted: 0 },
    spendByVerdict: { KILL: 100_000, HOLD: 0, SCALE: 0, WATCH: 0, REALLOCATE: 0, REFRESH: 0, unverdicted: 0 },
    spendByVerdictUnavailable: null,
  },
};

describe('PARITY-01 · AccountAggregateResponseSchema', () => {
  it('parses a full aggregate without stripping a field a surface renders', () => {
    const parsed = AccountAggregateResponseSchema.safeParse(FULL);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // C-04's lesson: a field on the wire is not a field the client has. Every
    // one of these reaches a pixel, so the parse must carry it through.
    expect(parsed.data.aggregate?.spend.minor).toBe(100_000);
    expect(parsed.data.aggregate?.acquisition.blendedCpaMinor).toBe(5_000);
    expect(parsed.data.aggregate?.currency).toBe('EGP');
    expect(parsed.data.aggregate?.population.campaignCount).toBe(1);
    expect(parsed.data.aggregate?.population.measurementWindow).toBe('CUMULATIVE_30D');
    expect(parsed.data.aggregate?.population.boundsStatus).toBe('REPORTED');
  });

  it('parses the MIXED_CURRENCY refusal — the money is null and says why', () => {
    const mixed = {
      ...FULL,
      aggregate: {
        ...FULL.aggregate,
        currency: null,
        currencyStatus: 'MIXED',
        spend: { minor: null, unavailable: 'MIXED_CURRENCY' },
        acquisition: { conversions: 40, blendedCpaMinor: null, unavailable: 'MIXED_CURRENCY' },
        spendByVerdict: null,
        spendByVerdictUnavailable: 'MIXED_CURRENCY',
      },
    };
    const parsed = AccountAggregateResponseSchema.safeParse(mixed);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.aggregate?.spend.unavailable).toBe('MIXED_CURRENCY');
    // A count is currency-free and survives the refusal.
    expect(parsed.data.aggregate?.acquisition.conversions).toBe(40);
  });

  it('parses the explicit empty state, and it is NOT a shell of zeroes', () => {
    const empty = {
      workspaceId: 'ws-1',
      generatedAt: '2026-09-08T00:00:00.000Z',
      available: false,
      reason: 'NO_CANONICAL_MEASUREMENT',
      aggregate: null,
    };
    const parsed = AccountAggregateResponseSchema.safeParse(empty);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.available).toBe(false);
    expect(parsed.data.reason).toBe('NO_CANONICAL_MEASUREMENT');
    expect(parsed.data.aggregate).toBeNull();
  });

  it('accepts every bounds status the server can report', () => {
    for (const boundsStatus of ['REPORTED', 'NON_UNIFORM', 'NOT_REPORTED']) {
      const body = {
        ...FULL,
        aggregate: {
          ...FULL.aggregate,
          population: {
            ...FULL.aggregate.population,
            boundsStatus,
            ...(boundsStatus === 'REPORTED' ? {} : { windowStart: null, windowEnd: null }),
          },
        },
      };
      expect(AccountAggregateResponseSchema.safeParse(body).success).toBe(true);
    }
  });

  it('accepts every unavailable reason the server can give', () => {
    for (const unavailable of ['NOT_MEASURED', 'MIXED_CURRENCY', 'NO_CONVERSIONS']) {
      const body = {
        ...FULL,
        aggregate: { ...FULL.aggregate, spend: { minor: null, unavailable } },
      };
      expect(AccountAggregateResponseSchema.safeParse(body).success).toBe(true);
    }
  });

  it('tolerates a field the server ADDS — additive change may not kill a surface', () => {
    const widened = {
      ...FULL,
      aggregate: { ...FULL.aggregate, somethingNewTheServerAdded: { anything: true } },
    };
    expect(AccountAggregateResponseSchema.safeParse(widened).success).toBe(true);
  });

  // ── self-refutation ───────────────────────────────────────────────────────
  it('REJECTS a payload the server could not produce', () => {
    expect(AccountAggregateSchema.safeParse({}).success).toBe(false);
    // A guard that admits everything is not a guard: an unknown vocabulary word
    // must fail here, which is exactly what makes the parity test next door
    // load-bearing.
    const bogus = {
      ...FULL.aggregate,
      spend: { minor: null, unavailable: 'ZZZ_NOT_A_REASON' },
    };
    expect(AccountAggregateSchema.safeParse(bogus).success).toBe(false);
    const wrongLevel = { ...FULL.aggregate, aggregationLevel: 'ADSET' };
    expect(AccountAggregateSchema.safeParse(wrongLevel).success).toBe(false);
  });
});
