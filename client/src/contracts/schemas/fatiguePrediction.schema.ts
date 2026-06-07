/**
 * FatiguePrediction Schema — forward-looking creative-fatigue forecast
 *
 * Mirrors the Phase 2 Prisma `FatiguePrediction`. Predicts the day an
 * entity breaches its fatigue ceiling before it bleeds, and (on
 * resolution) records predicted-vs-actual for memory.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { EntityLevelSchema } from './entity.schema';

export const FatiguePredictionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  entityId: z.string().min(1),
  entityLevel: EntityLevelSchema,
  metric: z.string().default('frequency'),
  ceiling: z.number(),
  projectedBreachDate: z.coerce.date(),
  confidence: z.number().min(0).max(1),
  basis: z.string().nullish(),
  createdAt: z.coerce.date(),

  // Resolution
  resolvedAt: z.coerce.date().nullish(),
  actualBreachDate: z.coerce.date().nullish(),
  accuracy: z.number().min(0).max(1).nullish(),
});

export type FatiguePrediction = z.infer<typeof FatiguePredictionSchema>;
