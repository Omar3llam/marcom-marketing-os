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
  liftPct: z.number().nullish(),
  ciLow: z.number().nullish(),
  ciHigh: z.number().nullish(),
  confidenceLabel: ConfidenceLevelSchema.nullish(),
  incrementalRevenueMinor: z.number().int().nullish(),
});

export type IncrementalityStatus = z.infer<typeof IncrementalityStatusSchema>;
export type HoldoutDesign = z.infer<typeof HoldoutDesignSchema>;
export type IncrementalityReadout = z.infer<typeof IncrementalityReadoutSchema>;
export type IncrementalityTest = z.infer<typeof IncrementalityTestSchema>;
