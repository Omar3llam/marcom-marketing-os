/**
 * Attributed Schema — the Phase-7 honesty primitive
 *
 * THE GUARD, encoded: no revenue/efficiency number leaves the backend as a
 * bare value. Every figure is wrapped with WHERE it came from (source) and
 * HOW MUCH to trust it (confidence) — so the product can never quietly show
 * attributed revenue it can't defend. `band` optionally carries a CI.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';

export const AttributionSourceSchema = z.enum(['PLATFORM', 'BLENDED', 'MODEL', 'INCREMENTALITY']);
export const ConfidenceLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

// The wrapper every attributed figure MUST use. A bare number fails parsing.
export const AttributedSchema = z.object({
  value: z.number().nullable(),
  source: AttributionSourceSchema,
  confidence: ConfidenceLevelSchema,
  modelName: z.string().nullish(),
  band: z.tuple([z.number(), z.number()]).nullish(), // optional confidence interval
  caveat: z.string().nullish(),
});

export type AttributionSource = z.infer<typeof AttributionSourceSchema>;
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;
export type Attributed = z.infer<typeof AttributedSchema>;
