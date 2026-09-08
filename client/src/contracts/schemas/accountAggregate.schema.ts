/**
 * Account Aggregate Schema — PARITY-01
 *
 * `GET /api/lumi/account/aggregate` — the CANONICAL account-level aggregate.
 * One spend figure, one blended CPA, the verdict lanes they reconcile against,
 * and the population that produced them.
 *
 * Why this contract exists at all: the endpoint has been served, role-gated and
 * DB-tested since the aggregate track, with ZERO client callers, while Attention
 * and Campaigns each recomputed the same numbers in the browser — differently.
 * Parity discovery measured the result: a ten-fold divergence on a 3-exponent
 * currency, and a cross-currency sum labelled with whichever currency came
 * first. The service refuses both by construction. This is the client's half of
 * reading the answer it already publishes.
 *
 * ABSENCE IS PART OF THE PAYLOAD. `spend.minor` is null whenever the account has
 * no single answer, and `spend.unavailable` says which absence it is — the C-07
 * discipline: a token is not a reason, and the three reasons have three
 * different fixes (wait for a sync · set up conversion tracking · there is no
 * conversion policy between currencies).
 *
 * The vocabularies below are CLOSED, and closed enums are dangerous — B8-01: a
 * strict enum fails the parse and kills the surface rather than dropping one
 * field. They are proved equal to the server's own frozen objects by
 * `src/tests/accountAggregateParity.test.js`, which fails in CI the day the
 * service learns a new word. Unknown *fields* are stripped, not rejected, so an
 * additive server change can never blank a KPI strip.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';

/** How well the contributing rows agree about the period they measured. */
export const BoundsStatusSchema = z.enum(['REPORTED', 'NON_UNIFORM', 'NOT_REPORTED']);

/** Currency agreement across the contributing rows. */
export const CurrencyStatusSchema = z.enum(['SINGLE', 'MIXED', 'UNKNOWN']);

/**
 * Why a money figure is absent. Never a 0 — a 0 is a measurement, and each of
 * these means nobody took one.
 */
export const AggregateUnavailableSchema = z.enum([
  'NOT_MEASURED',
  'MIXED_CURRENCY',
  'NO_CONVERSIONS',
]);

/**
 * One lane per verdict, plus `unverdicted`. A campaign with no verdict still
 * spent money and may not be dropped from a total that claims to reconcile
 * against the rows.
 */
export const VerdictCountsSchema = z.object({
  KILL: z.number(),
  HOLD: z.number(),
  SCALE: z.number(),
  WATCH: z.number(),
  REALLOCATE: z.number(),
  REFRESH: z.number(),
  unverdicted: z.number(),
});

export const AggregatePopulationSchema = z.object({
  // What the ROWS said. Null when they do not agree on one label.
  measurementWindow: z.string().nullable(),
  // Bounds are published only when every row reported the SAME ones — see
  // boundsStatus. A union across differing windows would invent a period no row
  // measured, so the server sends null rather than a span.
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  boundsStatus: BoundsStatusSchema,
  // What the SELECTOR declared, beside what the rows said. Both travel; a
  // disagreement between them is a fact worth being able to see.
  declaredWindow: z.string().nullable(),
  campaignCount: z.number(),
});

export const AccountAggregateSchema = z.object({
  // CAMPAIGN, and never two levels summed — an ad-set's spend is a SUBSET of its
  // campaign's. Pinned as a literal so a change is a parse failure here rather
  // than a double count on a screen.
  aggregationLevel: z.literal('CAMPAIGN'),
  population: AggregatePopulationSchema,
  currency: z.string().nullable(),
  currencyStatus: CurrencyStatusSchema,
  spend: z.object({
    minor: z.number().nullable(),
    unavailable: AggregateUnavailableSchema.nullable(),
  }),
  acquisition: z.object({
    // Currency-free, so it survives MIXED_CURRENCY intact.
    conversions: z.number().nullable(),
    blendedCpaMinor: z.number().nullable(),
    unavailable: AggregateUnavailableSchema.nullable(),
  }),
  verdicts: VerdictCountsSchema,
  spendByVerdict: VerdictCountsSchema.nullable(),
  spendByVerdictUnavailable: AggregateUnavailableSchema.nullable(),
});

export const AccountAggregateResponseSchema = z.object({
  workspaceId: z.string().nullable(),
  generatedAt: z.string(),
  // `available: false` is the flag a renderer branches on, so it never has to
  // infer emptiness from a numeric value.
  available: z.boolean(),
  reason: z.string().nullable(),
  aggregate: AccountAggregateSchema.nullable(),
});

export type BoundsStatus = z.infer<typeof BoundsStatusSchema>;
export type CurrencyStatus = z.infer<typeof CurrencyStatusSchema>;
export type AggregateUnavailable = z.infer<typeof AggregateUnavailableSchema>;
export type VerdictCounts = z.infer<typeof VerdictCountsSchema>;
export type AggregatePopulation = z.infer<typeof AggregatePopulationSchema>;
export type AccountAggregate = z.infer<typeof AccountAggregateSchema>;
export type AccountAggregateResponse = z.infer<typeof AccountAggregateResponseSchema>;
