/**
 * Portfolio Schema — cross-channel portfolio view
 *
 * Mirrors the Phase 3 PortfolioService output: blended totals (MER),
 * platform-vs-blended gap, and pacing — per channel and for the
 * portfolio. Money is integer minor units.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { BlendedChannelSchema } from './blendedTruth.schema';
import { PacingSchema } from './pacing.schema';

export const PortfolioTotalsSchema = z.object({
  spendMinor: z.number().int(),
  platformRevenueMinor: z.number().int(),
  blendedRevenueMinor: z.number().int(),
  blendedRoas: z.number(),
  platformRoas: z.number(),
  gapMinor: z.number().int(),
  gapPct: z.number(),
  reconciledCount: z.number().int(),
  unverifiedCount: z.number().int(),
});

export const PortfolioChannelSchema = BlendedChannelSchema.extend({
  pacing: PacingSchema.nullable(),
});

export const PortfolioViewSchema = z.object({
  workspaceId: z.string().nullable(),
  generatedAt: z.string().optional(),
  monthlyBudgetMinor: z.number().int().nullable(),
  totals: PortfolioTotalsSchema.nullable(),
  pacing: PacingSchema.nullable(),
  channels: z.array(PortfolioChannelSchema),
});

export type PortfolioTotals = z.infer<typeof PortfolioTotalsSchema>;
export type PortfolioChannel = z.infer<typeof PortfolioChannelSchema>;
export type PortfolioView = z.infer<typeof PortfolioViewSchema>;
