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

// B5-01T′: UNAVAILABLE/UNKNOWN are the absence of a source and of a confidence,
// not weak grades of them. A failed evidence read produces value:null with these
// two — never a 0 labelled PLATFORM/MEDIUM, which is what the backend used to
// emit and what `status` now makes impossible to mistake for a measurement.
export const AttributionSourceSchema = z.enum(['PLATFORM', 'BLENDED', 'MODEL', 'INCREMENTALITY', 'UNAVAILABLE']);
export const ConfidenceLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']);
export const EvidenceStatusSchema = z.enum(['OK', 'UNAVAILABLE']);

// The wrapper every attributed figure MUST use. A bare number fails parsing.
export const AttributedSchema = z.object({
  value: z.number().nullable(),
  source: AttributionSourceSchema,
  confidence: ConfidenceLevelSchema,
  modelName: z.string().nullish(),
  band: z.tuple([z.number(), z.number()]).nullish(), // optional confidence interval
  caveat: z.string().nullish(),
  // Why the value is null, when it is. `nullish` so pre-B5-01T′ payloads and
  // any hand-built fixture still parse.
  status: EvidenceStatusSchema.nullish(),
  reason: z.string().nullish(),
});

export type AttributionSource = z.infer<typeof AttributionSourceSchema>;
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;
export type Attributed = z.infer<typeof AttributedSchema>;
