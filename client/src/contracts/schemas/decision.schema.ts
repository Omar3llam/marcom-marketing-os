/**
 * Decision Graph Schema — Entity → Decision → Outcome → Memory
 *
 * Mirrors the Phase 1 Prisma decision graph. This is the layer that
 * makes Lumi an operating system rather than a dashboard: every
 * verdict on an entity produces a measurable Outcome, which distills
 * into reusable Memory.
 *
 * Distinct from the legacy execution-engine `DecisionMemory` model —
 * these are the marketing decision-graph contracts.
 *
 * Source of truth: schemas (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { EntityLevelSchema } from './entity.schema';

/** Marketing decision verdict. Phase 2 adds REALLOCATE + REFRESH. */
export const VerdictSchema = z.enum(['KILL', 'HOLD', 'SCALE', 'WATCH', 'REALLOCATE', 'REFRESH']);

/** Workflow status of a decision. */
export const DecisionStatusSchema = z.enum(['PROPOSED', 'EXECUTED', 'DISMISSED']);

export const DecisionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  entityId: z.string().min(1),
  entityLevel: EntityLevelSchema,
  verdict: VerdictSchema,
  confidence: z.number().min(0).max(1),
  diagnosis: z.string(),
  rootCause: z.string().nullish(),
  status: DecisionStatusSchema.default('PROPOSED'),
  createdAt: z.coerce.date(),
});

export const OutcomeSnapshotSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  decisionId: z.string().min(1),
  entityId: z.string().min(1),
  entityLevel: EntityLevelSchema,

  // Realized result — minor units.
  spendDeltaMinor: z.number().int().nullish(),
  revenueDeltaMinor: z.number().int().nullish(),
  roasDelta: z.number().nullish(),

  windowStart: z.coerce.date().nullish(),
  windowEnd: z.coerce.date().nullish(),
  sustained: z.boolean().nullish(),
  createdAt: z.coerce.date(),
});

export const DecisionMemoryEntrySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  decisionId: z.string().nullish(),
  entityId: z.string().nullish(),
  actionType: z.string().nullish(),
  rationale: z.string(),
  isSustainable: z.boolean().nullish(),
  impactDurationHrs: z.number().int().nullish(),
  createdAt: z.coerce.date(),
});

/**
 * A verdict at one entity level — the unit of the multi-level
 * drill-down (a campaign can be SCALE while a child ad set is KILL).
 */
export const LevelVerdictSchema = z.object({
  entityId: z.string().min(1),
  entityLevel: EntityLevelSchema,
  verdict: VerdictSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().nullish(),
});

export type LevelVerdict = z.infer<typeof LevelVerdictSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type OutcomeSnapshot = z.infer<typeof OutcomeSnapshotSchema>;
export type DecisionMemoryEntry = z.infer<typeof DecisionMemoryEntrySchema>;
