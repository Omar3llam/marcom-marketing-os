/**
 * AllocationPlan Schema — cross-channel capital allocation
 *
 * Mirrors the Phase 3 Prisma `AllocationPlan` + the allocationEngine
 * preview output. A plan distributes a budget toward a goal on BLENDED
 * truth; each move is a PROPOSED REALLOCATE Decision the human confirms.
 * Money is integer minor units.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { SpendPeriodSchema } from './portfolio.schema';
import { MonetaryStatusSchema } from './blendedTruth.schema';

// Engine is goal-generic; only GROWTH_CEILING is implemented today.
export const GoalTypeSchema = z.enum(['GROWTH_CEILING']);
export const AllocationStatusSchema = z.enum(['PROPOSED', 'ACCEPTED', 'REJECTED']);

export const AllocationGoalSchema = z.object({
  type: GoalTypeSchema,
  value: z.number().nullish(),
});

// One channel's recommended move within a plan.
export const AllocationMoveSchema = z.object({
  channelId: z.string().min(1),
  channel: z.string().nullish(),
  verdict: z.string(),
  // Null when spend over the governed period is not measured: no current spend,
  // no target, no move. Never a zero standing in for "we don't know".
  currentSpendMinor: z.number().int().nullable(),
  recommendedSpendMinor: z.number().int().nullable(),
  deltaMinor: z.number().int().nullable(),
  blendedRoas: z.number().nullable(),
  rationale: z.string(),
});

export const AllocationProjectedSchema = z.object({
  blendedRevenueMinor: z.number().int().nullable(),
  projectedCpaMinor: z.number().int().nullable(),
  merBefore: z.number().nullable(),
  merAfter: z.number().nullable(),
});

// allocationEngine.allocate() preview shape.
export const AllocationPlanPreviewSchema = z.object({
  goal: AllocationGoalSchema,
  totalBudgetMinor: z.number().int(),
  currency: z.string().nullable(),
  monetaryStatus: MonetaryStatusSchema.optional(),
  monetaryReason: z.string().nullable().optional(),
  // The period the budget governs, and whether moves could be sized against it.
  spendPeriod: SpendPeriodSchema.nullish(),
  allocations: z.array(AllocationMoveSchema),
  projected: AllocationProjectedSchema,
  reasoningTrail: z.array(z.string()),
});

// Persisted Prisma AllocationPlan row.
export const AllocationPlanSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  goalType: GoalTypeSchema,
  goalValue: z.number().nullish(),
  totalBudgetMinor: z.number().int(),
  currency: z.string(),
  projectedRoas: z.number().nullish(),
  projectedCpaMinor: z.number().int().nullish(),
  merBefore: z.number().nullish(),
  merAfter: z.number().nullish(),
  reasoning: z.string(),
  status: AllocationStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type GoalType = z.infer<typeof GoalTypeSchema>;
export type AllocationStatus = z.infer<typeof AllocationStatusSchema>;
export type AllocationGoal = z.infer<typeof AllocationGoalSchema>;
export type AllocationMove = z.infer<typeof AllocationMoveSchema>;
export type AllocationProjected = z.infer<typeof AllocationProjectedSchema>;
export type AllocationPlanPreview = z.infer<typeof AllocationPlanPreviewSchema>;
export type AllocationPlan = z.infer<typeof AllocationPlanSchema>;
