/**
 * Pacing Schema — budget burn-rate projection
 *
 * Mirrors the Phase 3 PacingEngine output. Projects end-of-period spend
 * from the current run rate and flags how many days early the budget
 * exhausts. Money is integer minor units.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';

export const PaceStatusSchema = z.enum(['ON_TRACK', 'OVER', 'UNDER']);

export const PacingSchema = z.object({
  runRateMinor: z.number().int(),
  projectedSpendMinor: z.number().int(),
  paceRatio: z.number(),
  daysRemaining: z.number(),
  exhaustsOnDay: z.number().nullable(),
  daysEarly: z.number().nullable(),
  status: PaceStatusSchema,
});

export type PaceStatus = z.infer<typeof PaceStatusSchema>;
export type Pacing = z.infer<typeof PacingSchema>;
