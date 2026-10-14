/**
 * AccountPattern Schema — Phase 5 Memory Moat
 *
 * Mirrors the Prisma `AccountPattern` + the patternEngine output. A
 * pattern is truth-weighted: its confidence reflects recency-weighted
 * accuracy ("was Lumi right?") and support, not a raw count. A promotable
 * pattern carries an executable guardrail spec; SUPERSEDED/CONFLICTED
 * patterns (conflict resolution) are never promoted.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { EntityLevelSchema } from './entity.schema';
import { VerdictSchema } from './decision.schema';
import { ComparatorSchema, ThresholdUnitSchema } from './guardrailRule.schema';

export const PatternKindSchema = z.enum([
  'FATIGUE_CEILING', 'SCALING_WINDOW', 'CREATIVE_ANGLE_LONGEVITY', 'SEASONAL_EFFECT',
]);
export const PatternStatusSchema = z.enum(['EMERGING', 'ESTABLISHED', 'SUPERSEDED', 'CONFLICTED']);

// The executable guardrail spec a promotable pattern carries.
export const PromotableSpecSchema = z.object({
  metric: z.string(),
  comparator: ComparatorSchema,
  threshold: z.number(),
  unit: ThresholdUnitSchema,
  emitVerdict: VerdictSchema,
  scopeLevel: EntityLevelSchema.nullish(),
  audienceTag: z.string().nullish(),
  sustainedDays: z.number().int().nullish(),
});

export const AccountPatternSchema = z.object({
  id: z.string().min(1),
  patternKey: z.string().optional(),
  kind: PatternKindSchema,
  statement: z.string(),
  basis: z.string().nullish(),
  // truth, not just volume
  support: z.number().int(),
  effectiveSupport: z.number(),
  accuracy: z.number().nullable(),       // "right X%" — null until known outcomes
  confidence: z.number(),
  status: PatternStatusSchema,
  promotable: z.boolean().optional(),
  // spec (null for informational kinds)
  metric: z.string().nullish(),
  scopeLevel: EntityLevelSchema.nullish(),
  audienceTag: z.string().nullish(),
  comparator: ComparatorSchema.nullish(),
  threshold: z.number().nullish(),
  unit: ThresholdUnitSchema.nullish(),
  emitVerdict: VerdictSchema.nullish(),
  sustainedDays: z.number().int().nullish(),
  // conflict resolution + provenance
  supersededById: z.string().nullish(),
  // C-14 — `supersededByKey` was declared here and is NOT a database column at
  // all: it is an in-memory field of the extraction pass, consumed at
  // PatternService:262 to resolve an id and never published by anything. A
  // declaration is what a component may rely on, so declaring a field the
  // server cannot ever send is a promise that resolves to `undefined` forever.
  // Removed rather than selected, because there is nothing to select.
  promotedRuleId: z.string().nullish(),
  firstObservedAt: z.coerce.date().optional(),
  lastObservedAt: z.coerce.date().optional(),
  // C-14 · A — how often this belief met a measured outcome, and how often it
  // held. RAW counts, published BESIDE `accuracy` and never as its derivation:
  // accuracy is recency-weighted, so 0.85 beside 3 of 5 is two true facts about
  // one belief, not an arithmetic error. `made`/`held` are null (not zero) when
  // the count could not be read — a zero would be the claim "never checked".
  checks: z.object({
    made: z.number().int().nullable(),
    held: z.number().int().nullable(),
    knowledge: z.string(),
  }).optional(),
  // C-14 · B — what replaced this belief. The FORWARD edge: the row carrying
  // `supersededById` is the superseded one, and it points at the winner.
  // Resolved to a statement, because an id is not readable.
  replacedBy: z.object({
    value: z.object({ id: z.string(), statement: z.string() }).nullable(),
    knowledge: z.string(),
  }).optional(),
});

export type PatternKind = z.infer<typeof PatternKindSchema>;
export type PatternStatus = z.infer<typeof PatternStatusSchema>;
export type PromotableSpec = z.infer<typeof PromotableSpecSchema>;
export type AccountPattern = z.infer<typeof AccountPatternSchema>;
