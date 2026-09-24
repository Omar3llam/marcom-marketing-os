/**
 * BlendedTruth Schema — platform-claimed vs actual revenue reconciliation
 *
 * Mirrors the Phase 3 BlendedTruthEngine output. Where GA4/Shopify
 * actuals exist a channel RECONCILES (confidence HIGH) and the
 * platform-over-report gap is surfaced; otherwise the raw platform
 * number is used but flagged UNVERIFIED / LOW. Money is integer minor units.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';

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
  hasStale: z.boolean().optional(), // any tracked channel stale → render the honesty banner
});

export const BlendedTruthSchema = z.object({
  channels: z.array(BlendedChannelSchema),
  portfolio: BlendedPortfolioSchema,
});

export type Coverage = z.infer<typeof CoverageSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type BlendedChannel = z.infer<typeof BlendedChannelSchema>;
export type BlendedPortfolio = z.infer<typeof BlendedPortfolioSchema>;
export type BlendedTruth = z.infer<typeof BlendedTruthSchema>;
