/**
 * BlendedTruth Schema — platform-claimed vs actual revenue reconciliation
 *
 * Selected revenue and efficiency remain independent of source comparison.
 * A gap requires the backend's explicit monetary and exact-window authority;
 * actual-source coverage/confidence alone cannot authorize it.
 * Money is integer minor units.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { isKnownCurrency } from '@/lib/monetaryCurrency.js';

const WindowSchema = z.discriminatedUnion('windowStatus', [
  z.object({ windowStatus: z.literal('EXACT'), windowStart: z.string().datetime(), windowEnd: z.string().datetime() }),
  z.object({ windowStatus: z.literal('UNKNOWN'), windowStart: z.null(), windowEnd: z.null() }),
]);
export const RevenueReconciliationSchema = z.object({
  status: z.enum(['AVAILABLE', 'UNAVAILABLE', 'UNVERIFIED']),
  reason: z.enum(['ACTUAL_REVENUE_UNAVAILABLE', 'MONETARY_BASIS_UNAVAILABLE', 'MEASUREMENT_WINDOW_UNKNOWN',
    'MEASUREMENT_WINDOW_MISMATCH', 'PORTFOLIO_WINDOW_MISMATCH', 'PORTFOLIO_CURRENCY_MISMATCH', 'NO_COMPARABLE_CHANNELS']).nullable(),
  windowCompatibility: z.enum(['COMPATIBLE', 'INCOMPATIBLE', 'UNKNOWN']),
  window: WindowSchema, currency: z.string().refine(isKnownCurrency, 'Unsupported currency').nullable(),
  platformRevenueMinor: z.number().int().finite().nullable(), actualRevenueMinor: z.number().int().finite().nullable(),
  gapMinor: z.number().int().finite().nullable(), gapPct: z.number().finite().nullable(),
  gapPctReason: z.literal('ZERO_PLATFORM_DENOMINATOR').nullable(), gapDenominator: z.literal('PLATFORM_REVENUE'),
}).superRefine((r, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (r.status === 'AVAILABLE') {
    if (r.reason !== null || r.window.windowStatus !== 'EXACT' || r.windowCompatibility !== 'COMPATIBLE' || !r.currency
      || r.gapMinor === null || r.platformRevenueMinor === null || r.actualRevenueMinor === null) fail('Available reconciliation requires its published monetary and exact-window basis');
    if (r.gapPct === null ? r.gapPctReason !== 'ZERO_PLATFORM_DENOMINATOR' : r.gapPctReason !== null) fail('Percentage and its refusal reason disagree');
    if (r.platformRevenueMinor === 0 && r.gapMinor !== 0 && r.gapPct !== null) fail('A zero platform denominator cannot publish a percentage');
    if (r.gapPctReason === 'ZERO_PLATFORM_DENOMINATOR' && (r.platformRevenueMinor !== 0 || r.gapMinor === 0)) fail('Invalid zero-denominator refusal');
  } else {
    if (r.gapMinor !== null || r.gapPct !== null || r.currency !== null || r.platformRevenueMinor !== null
      || r.actualRevenueMinor !== null || r.gapPctReason !== null || r.window.windowStatus !== 'UNKNOWN') fail('Unavailable reconciliation cannot publish comparison numbers or a common basis');
    if (r.reason === null || (r.status === 'UNVERIFIED' && r.reason !== 'ACTUAL_REVENUE_UNAVAILABLE')) fail('Reconciliation refusal requires a consistent reason');
  }
});
const CountsSchema = z.object({ reconciledCount: z.number().int().nonnegative(), unverifiedCount: z.number().int().nonnegative(),
  unavailableCount: z.number().int().nonnegative(), totalChannelCount: z.number().int().nonnegative() });
const PortfolioReconciliationSchema = RevenueReconciliationSchema.and(CountsSchema);
const aliasesAgree = (r: { gapMinor: number | null; gapPct: number | null; reconciliation: { gapMinor: number | null; gapPct: number | null } }, ctx: z.RefinementCtx) => {
  if (r.gapMinor !== r.reconciliation.gapMinor || r.gapPct !== r.reconciliation.gapPct) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Gap aliases must equal published reconciliation' });
  }
};

export const CoverageSchema   = z.enum(['RECONCILED', 'UNVERIFIED']);
export const ConfidenceSchema = z.enum(['HIGH', 'LOW']);
export const MonetaryStatusSchema = z.enum([
  'MONETARY_VALID', 'MONETARY_UNAVAILABLE_MIXED', 'MONETARY_UNAVAILABLE_UNTRUSTED',
]);
export const BlendedRevenueEfficiencySchema = z.object({
  status: z.enum(['VALID', 'UNAVAILABLE']),
  reason: z.string().nullable(),
  value: z.number().nullable(),
  currency: z.string().nullable(),
  windowCompatibility: z.enum(['COMPATIBLE', 'INCOMPATIBLE', 'UNKNOWN']),
});

export const BlendedChannelSchema = z.object({
  channelId: z.string().min(1),
  channel: z.string().nullish(),
  // Display identity (campaign name). Nullish: pre-fix rows + any snapshot whose
  // entityId has no matching Campaign fall back to channel → channelId in the view.
  name: z.string().nullish(),
  currency: z.string().nullable().optional(),
  // The no-workspace empty response predates these fields; measured rows carry them.
  monetaryStatus: MonetaryStatusSchema.optional(),
  monetaryReason: z.string().nullable().optional(),
  spendMinor: z.number().int().nullable(),
  platformRevenueMinor: z.number().int().nullable(),
  actualRevenueMinor: z.number().int().nullable(),
  blendedRevenueMinor: z.number().int().nullable(),
  gapMinor: z.number().int().nullable(),
  gapPct: z.number().nullable(),
  platformRoas: z.number().nullable(),
  blendedRoas: z.number().nullable(),
  blendedRevenueEfficiency: BlendedRevenueEfficiencySchema.optional(),
  coverage: CoverageSchema,
  confidence: ConfidenceSchema,
  reconciliation: RevenueReconciliationSchema,
  // Phase 12 — connector freshness. `stale` only when a connector tracks this
  // channel and its last SUCCESSFUL sync is past the threshold; null lastSyncedAt
  // when no connector tracks it (seed/CSV). Numbers are unchanged by staleness.
  stale: z.boolean().optional(),
  lastSyncedAt: z.string().nullish(),
});

export const BlendedPortfolioSchema = z.object({
  currency: z.string().nullable().optional(),
  // The no-workspace empty response has no monetary status or denomination.
  monetaryStatus: MonetaryStatusSchema.optional(),
  monetaryReason: z.string().nullable().optional(),
  spendMinor: z.number().int().nullable(),
  platformRevenueMinor: z.number().int().nullable(),
  blendedRevenueMinor: z.number().int().nullable(),
  gapMinor: z.number().int().nullable(),
  gapPct: z.number().nullable(),
  platformRoas: z.number().nullable(),
  blendedRoas: z.number().nullable(),
  blendedRevenueEfficiency: BlendedRevenueEfficiencySchema.optional(),
  reconciledCount: z.number().int(),
  unverifiedCount: z.number().int(),
  unavailableCount: z.number().int().nonnegative(),
  totalChannelCount: z.number().int().nonnegative(),
  reconciliation: PortfolioReconciliationSchema,
  hasStale: z.boolean().optional(), // any tracked channel stale → render the honesty banner
}).superRefine((r, ctx) => {
  aliasesAgree(r, ctx);
  const keys = ['reconciledCount', 'unverifiedCount', 'unavailableCount', 'totalChannelCount'] as const;
  if (keys.some(key => r[key] !== r.reconciliation[key])
    || r.totalChannelCount !== r.reconciledCount + r.unverifiedCount + r.unavailableCount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Reconciliation population counts disagree' });
  }
});

export const BlendedTruthSchema = z.object({
  // Keep the exported object extendable for PortfolioChannelSchema. The
  // endpoint admission applies the cross-field alias coupling here.
  channels: z.array(BlendedChannelSchema.superRefine(aliasesAgree)),
  portfolio: BlendedPortfolioSchema,
});

export type Coverage = z.infer<typeof CoverageSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type BlendedChannel = z.infer<typeof BlendedChannelSchema>;
export type BlendedPortfolio = z.infer<typeof BlendedPortfolioSchema>;
export type BlendedTruth = z.infer<typeof BlendedTruthSchema>;
