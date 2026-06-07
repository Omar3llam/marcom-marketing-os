/**
 * GuardrailRule Schema — user-defined recurring rule
 *
 * Mirrors the Phase 2 Prisma `GuardrailRule`. Rules are enforced each
 * sweep and produce radar verdicts (Decisions, PROPOSED) — never
 * silent auto-execution; a human still confirms.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { EntityLevelSchema } from './entity.schema';
import { VerdictSchema } from './decision.schema';

export const ComparatorSchema = z.enum(['GT', 'GTE', 'LT', 'LTE']);
export const ThresholdUnitSchema = z.enum(['MINOR', 'RATIO', 'PCT']);

export const GuardrailRuleSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  scopeLevel: EntityLevelSchema.default('ADSET'),
  audienceTag: z.string().nullish(),
  metric: z.string().min(1),
  comparator: ComparatorSchema,
  threshold: z.number(),
  unit: ThresholdUnitSchema.default('RATIO'),
  sustainedDays: z.number().int().min(1).default(1),
  emitVerdict: VerdictSchema.default('WATCH'),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

export type Comparator = z.infer<typeof ComparatorSchema>;
export type ThresholdUnit = z.infer<typeof ThresholdUnitSchema>;
export type GuardrailRule = z.infer<typeof GuardrailRuleSchema>;
