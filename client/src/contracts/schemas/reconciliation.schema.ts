/**
 * Reconciliation Schema — platform vs blended vs incremental (Phase 7)
 *
 * Mirrors ReconciliationService.getReconciliation(). Three Attributed columns
 * per channel with the gaps made explicit — the centerpiece of the honesty
 * story: "the platform claims X, blended truth says Y, only Z is proven causal."
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { AttributedSchema } from './attributed.schema';

export const ReconciliationRowSchema = z.object({
  channelId: z.string(),
  channel: z.string().nullish(),
  platform: AttributedSchema,     // last-click, as reported
  blended: AttributedSchema,      // P3 blended truth
  incremental: AttributedSchema,  // causal (value null when no holdout)
  gaps: z.object({
    platformVsBlendedMinor: z.number(),
    blendedVsIncrementalMinor: z.number().nullable(),
  }),
});

export const ReconciliationSchema = z.object({
  status: z.enum(['OK', 'INSUFFICIENT_DATA']),
  rows: z.array(ReconciliationRowSchema),
  portfolio: z
    .object({
      spendMinor: z.number().int(),
      platformRevenueMinor: z.number().int(),
      blendedRevenueMinor: z.number().int(),
      platformVsBlendedMinor: z.number().int(),
      gapPct: z.number(),
    })
    .nullable(),
});

export type ReconciliationRow = z.infer<typeof ReconciliationRowSchema>;
export type Reconciliation = z.infer<typeof ReconciliationSchema>;
