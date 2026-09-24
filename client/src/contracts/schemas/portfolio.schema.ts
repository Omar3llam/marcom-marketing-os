/**
 * Portfolio Schema — cross-channel portfolio view
 *
 * Mirrors the Phase 3 PortfolioService output: selected Blended Truth totals,
 * platform-vs-blended gap, and pacing — per channel and for the
 * portfolio. Money is integer minor units.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { BlendedChannelSchema, BlendedPortfolioSchema } from './blendedTruth.schema';
import { PacingSchema } from './pacing.schema';

// PortfolioService passes through the blended portfolio's monetary refusal.
// Reuse its nullable fields so mixed/untrusted money remains a parsed refusal.
export const PortfolioTotalsSchema = BlendedPortfolioSchema;

/**
 * What a spend-to-budget comparison was allowed to use — or why it was refused.
 * Mirrors src/services/budget-period/spendPeriod.js.
 *
 * `status` and `reason` are strings, not enums, on purpose: B8-01 measured that
 * a strict enum kills the WHOLE surface on one unknown value. A refusal the
 * client cannot name must still reach the operator as a refusal.
 */
export const SpendPeriodSchema = z.object({
  status: z.string(),
  reason: z.string().nullable(),
  period: z.object({ start: z.string(), end: z.string() }),
  window: z.object({ start: z.string(), end: z.string() }).nullable(),
  daysCovered: z.number().int().nullable(),
  spendMinor: z.number().int().nullable(),
  currency: z.string().nullable().optional(),
});

export const PortfolioChannelSchema = BlendedChannelSchema.extend({
  pacing: PacingSchema.nullable(),
});

export const PortfolioViewSchema = z.object({
  workspaceId: z.string().nullable(),
  generatedAt: z.string().optional(),
  monthlyBudgetMinor: z.number().int().nullable(),
  monthlyBudgetCurrency: z.string().nullable().optional(),
  pacingMonetaryStatus: z.string().optional(),
  pacingMonetaryReason: z.string().nullable().optional(),
  totals: PortfolioTotalsSchema.nullable(),
  pacing: PacingSchema.nullable(),
  // Optional: a server older than the spend-window slice does not send it.
  spendPeriod: SpendPeriodSchema.nullish(),
  channels: z.array(PortfolioChannelSchema),
});

export type SpendPeriod = z.infer<typeof SpendPeriodSchema>;

export type PortfolioTotals = z.infer<typeof PortfolioTotalsSchema>;
export type PortfolioChannel = z.infer<typeof PortfolioChannelSchema>;
export type PortfolioView = z.infer<typeof PortfolioViewSchema>;
