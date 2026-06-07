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

export const BlendedChannelSchema = z.object({
  channelId: z.string().min(1),
  channel: z.string().nullish(),
  currency: z.string().default('USD'),
  spendMinor: z.number().int(),
  platformRevenueMinor: z.number().int(),
  actualRevenueMinor: z.number().int().nullable(),
  blendedRevenueMinor: z.number().int(),
  gapMinor: z.number().int(),
  gapPct: z.number(),
  platformRoas: z.number(),
  blendedRoas: z.number(),
  coverage: CoverageSchema,
  confidence: ConfidenceSchema,
});

export const BlendedPortfolioSchema = z.object({
  spendMinor: z.number().int(),
  platformRevenueMinor: z.number().int(),
  blendedRevenueMinor: z.number().int(),
  gapMinor: z.number().int(),
  gapPct: z.number(),
  platformRoas: z.number(),
  blendedRoas: z.number(),
  reconciledCount: z.number().int(),
  unverifiedCount: z.number().int(),
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
