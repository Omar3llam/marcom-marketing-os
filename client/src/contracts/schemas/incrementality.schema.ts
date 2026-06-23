/**
 * Incrementality Schema — holdout design + causal readout (Phase 7)
 *
 * Mirrors incrementalityEngine.designHoldout()/readIncrementality() + the
 * persisted IncrementalityTest. The readout is a lift with a CONFIDENCE
 * INTERVAL, never a point; INCONCLUSIVE when the CI crosses zero or the
 * sample is below the floor.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { AttributedSchema, ConfidenceLevelSchema } from './attributed.schema';

export const IncrementalityStatusSchema = z.enum(['DESIGNED', 'RUNNING', 'CONCLUDED', 'ABANDONED']);

export const HoldoutDesignSchema = z.object({
  sampleSizePerArm: z.number().int().positive(),
  durationDays: z.number().int().positive(),
  holdoutPct: z.number().positive(),
  guardrails: z.record(z.string(), z.unknown()),
  assumptions: z.array(z.string()),
});

export const IncrementalityReadoutSchema = z.object({
  status: z.enum(['CONCLUSIVE', 'INCONCLUSIVE']),
  exposedCvr: z.number(),
  holdoutCvr: z.number(),
  absoluteLift: z.number(),
  liftPct: z.number(),
  ci: z.tuple([z.number(), z.number()]), // the confidence interval — never a point
  confidenceLabel: ConfidenceLevelSchema,
  conclusive: z.boolean(),
  incrementalConversions: AttributedSchema,
  incrementalRevenueMinor: AttributedSchema,
  rationale: z.string(),
});

export const IncrementalityTestSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string(),
  channel: z.string(),
  entityId: z.string().nullish(),
  holdoutPct: z.number(),
  mde: z.number(),
  sampleSizePerArm: z.number().int(),
  durationDays: z.number().int(),
  status: IncrementalityStatusSchema,
  // Observed counters — empty until results are recorded (the write seam).
  exposedUsers: z.number().int().nullish(),
  exposedConversions: z.number().int().nullish(),
  holdoutUsers: z.number().int().nullish(),
  holdoutConversions: z.number().int().nullish(),
  liftPct: z.number().nullish(),
  ciLow: z.number().nullish(),
  ciHigh: z.number().nullish(),
  confidenceLabel: ConfidenceLevelSchema.nullish(),
  incrementalRevenueMinor: z.number().int().nullish(),
  startedAt: z.string().nullish(),
  concludedAt: z.string().nullish(),
  // Provenance (Phase 7C): the concluded A/B test this holdout was promoted from.
  // Null/absent for holdouts designed directly. Declared so it survives parsing.
  sourceTest: z
    .object({ id: z.string(), dimension: z.string(), hypothesis: z.string().nullish() })
    .nullish(),
});

// ── API response envelopes (the route → hook contract seam) ──
export const IncrementalityListResponseSchema = z.object({
  workspaceId: z.string().nullable(),
  tests: z.array(IncrementalityTestSchema),
});

export const ConcludeIncrementalityResponseSchema = z.object({
  workspaceId: z.string(),
  readout: IncrementalityReadoutSchema,
  memoryId: z.string().nullish(),
  decisionId: z.string().nullish(),
});

export type IncrementalityStatus = z.infer<typeof IncrementalityStatusSchema>;
export type HoldoutDesign = z.infer<typeof HoldoutDesignSchema>;
export type IncrementalityReadout = z.infer<typeof IncrementalityReadoutSchema>;
export type IncrementalityTest = z.infer<typeof IncrementalityTestSchema>;
export type IncrementalityListResponse = z.infer<typeof IncrementalityListResponseSchema>;
export type ConcludeIncrementalityResponse = z.infer<typeof ConcludeIncrementalityResponseSchema>;
