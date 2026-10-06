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
import { isKnownCurrency } from '@/lib/monetaryCurrency.js';

// Engine is goal-generic; only GROWTH_CEILING is implemented today.
export const GoalTypeSchema = z.enum(['GROWTH_CEILING']);
export const AllocationStatusSchema = z.enum(['PROPOSED', 'ACCEPTED', 'REJECTED']);
export const AllocationBasisSchema = z.enum(['blended', 'incremental']);

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
  currentSpendMinor: z.number().int().finite().nullable(),
  recommendedSpendMinor: z.number().int().finite().nullable(),
  deltaMinor: z.number().int().finite().nullable(),
  blendedRoas: z.number().finite().nullable(),
  rationale: z.string(),
}).superRefine((move, ctx) => {
  const values = [move.currentSpendMinor, move.recommendedSpendMinor, move.deltaMinor];
  if (values.some(value => value === null) && !values.every(value => value === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Move amounts must all be measured or all unavailable' });
  } else if (move.currentSpendMinor !== null && move.recommendedSpendMinor !== null
    && move.deltaMinor !== move.recommendedSpendMinor - move.currentSpendMinor) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Published budget change contradicts measured spend and recommendation' });
  }
});

export const AllocationProjectedSchema = z.object({
  blendedRevenueMinor: z.number().int().finite().nullable(),
  projectedCpaMinor: z.number().int().finite().nullable(),
  blendedRevenueEfficiencyBefore: z.number().finite().nullable(),
  blendedRevenueEfficiencyAfter: z.number().finite().nullable(),
});

// allocationEngine.allocate() preview shape.
export const AllocationPlanPreviewSchema = z.object({
  goal: AllocationGoalSchema,
  totalBudgetMinor: z.number().int().finite().positive(),
  currency: z.string().refine(isKnownCurrency, 'Unsupported allocation currency').nullable(),
  monetaryStatus: MonetaryStatusSchema.optional(),
  monetaryReason: z.string().nullable().optional(),
  efficiencyStatus: z.enum(['VALID', 'UNAVAILABLE']),
  efficiencyReason: z.string().nullable(),
  basis: AllocationBasisSchema,
  // The period the budget governs, and whether moves could be sized against it.
  spendPeriod: SpendPeriodSchema.nullish(),
  allocations: z.array(AllocationMoveSchema),
  projected: AllocationProjectedSchema,
  reasoningTrail: z.array(z.string()),
}).superRefine((plan, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const sized = plan.monetaryStatus === 'MONETARY_VALID' && plan.efficiencyStatus === 'VALID'
    && plan.spendPeriod?.status === 'MEASURABLE';
  if (plan.efficiencyStatus === 'VALID' && !sized) fail('Valid allocation efficiency requires measured money and governed spend');
  if (sized) {
    if (!plan.currency || plan.spendPeriod?.currency !== plan.currency) fail('Measured plan requires one explicit plan/period currency');
    const numericMoves = plan.allocations.every(move => move.currentSpendMinor !== null && move.recommendedSpendMinor !== null && move.deltaMinor !== null);
    if (!numericMoves) fail('Measured plan requires sized moves');
    // Admission validates server totals. Rendering never uses a replacement sum.
    else if (plan.allocations.reduce((sum, move) => sum + move.recommendedSpendMinor!, 0) !== plan.totalBudgetMinor) fail('Recommended budgets must equal the published total budget');
    if (plan.projected.blendedRevenueEfficiencyBefore === null || plan.projected.blendedRevenueEfficiencyAfter === null) fail('Measured plan requires finite projected efficiency');
  } else {
    if (plan.allocations.some(move => move.currentSpendMinor !== null || move.recommendedSpendMinor !== null || move.deltaMinor !== null)) fail('Refused plan cannot publish sized moves');
    if (Object.values(plan.projected).some(value => value !== null)) fail('Refused plan cannot publish dependent projections');
  }
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
  // Physical Prisma names remain legacy storage; first-party API uses the
  // semantic fields below and does not promote historical values.
  merBefore: z.number().nullish(),
  merAfter: z.number().nullish(),
  reasoning: z.string(),
  status: AllocationStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type GoalType = z.infer<typeof GoalTypeSchema>;
export type AllocationStatus = z.infer<typeof AllocationStatusSchema>;
export type AllocationBasis = z.infer<typeof AllocationBasisSchema>;
export type AllocationGoal = z.infer<typeof AllocationGoalSchema>;
export type AllocationMove = z.infer<typeof AllocationMoveSchema>;
export type AllocationProjected = z.infer<typeof AllocationProjectedSchema>;
export type AllocationPlanPreview = z.infer<typeof AllocationPlanPreviewSchema>;
export type AllocationPlan = z.infer<typeof AllocationPlanSchema>;
