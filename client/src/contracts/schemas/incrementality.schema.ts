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
  // Observed counters. B8-05 · R-E3 — THESE ARE NEVER EMPTY. The columns are
  // `Int @default(0)` and NOT NULL, so the wire always sends a number and the
  // null this once claimed to describe can never arrive. A 0 therefore does not
  // mean "not recorded": `recordCounts` is what moves a holdout DESIGNED →
  // RUNNING, so **status** is the only thing that separates "nobody has entered
  // results" from "we measured, and it was zero". The backend already reads it
  // that way — `concludeIncrementality` refuses on `!(test.exposedUsers > 0)`.
  //
  // They stay `.nullish()` on purpose: admitting more than arrives is the safe
  // direction (B8-01 — a schema narrower than the wire takes the whole surface
  // with it, not one field). The rule that changed is who may be asked, and
  // `HoldoutDetailView` is where it is enforced.
  exposedUsers: z.number().int().nullish(),
  exposedConversions: z.number().int().nullish(),
  holdoutUsers: z.number().int().nullish(),
  holdoutConversions: z.number().int().nullish(),
  liftPct: z.number().nullish(),
  ciLow: z.number().nullish(),
  ciHigh: z.number().nullish(),
  confidenceLabel: ConfidenceLevelSchema.nullish(),
  incrementalRevenueMinor: z.number().int().nullish(),
  // C-13 F-6 — PUBLISHED, THEN EATEN. The route sends a full Prisma row, so
  // `decisionId` was always on the wire; a `z.object` strips what it does not
  // declare, so the id of the Decision this holdout produced never reached a
  // component. The A/B half declares it and keeps it: the two halves of one
  // class, each missing what the other has, one more time. B8-05's forward edge
  // (holdout → `/app/decisions/:id`) cannot exist until this parses.
  decisionId: z.string().nullish(),
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

// B8-05 — the by-id read's envelope. `GET /api/lumi/incrementality/:id` answers
// `{ workspaceId, test }`; a 404/403 is an error status, never an empty body,
// so the absence never has to be inferred from a shape here.
export const IncrementalityDetailResponseSchema = z.object({
  workspaceId: z.string(),
  test: IncrementalityTestSchema,
});
export type IncrementalityDetailResponse = z.infer<typeof IncrementalityDetailResponseSchema>;
