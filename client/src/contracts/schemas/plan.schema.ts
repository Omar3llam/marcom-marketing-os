/**
 * Plan Schema — the forward-looking planning surface (Phase 6)
 *
 * Mirrors the Prisma Plan + NorthStarGoal rows and the goal-tracker
 * output. The landing is a `trendBasedLandingEstimate` RANGE (never a
 * "projected landing" implying precision); AT_RISK can come from a LEADING
 * fatigue signal before the headline breaks. `memoryBasis` records what
 * the plan leaned on ("Powered by Memory").
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { RangeSchema, ScenarioSchema } from './scenario.schema';
import { UnitEconomicsSchema } from './unitEconomics.schema';
import { ComparatorSchema } from './guardrailRule.schema';

export const PlanStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'CLOSED']);
export const GoalStatusSchema = z.enum(['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'ACHIEVED', 'MISSED']);

// A leading indicator (reused fatigue forecast) that can raise goal risk.
export const LeadingSignalSchema = z.object({
  signal: z.string(),
  entityId: z.string().nullish(),
  projectedBreachDate: z.string(),
  daysToBreach: z.number().nullish(),
  confidence: z.number().nullish(),
});

// The patterns a plan leaned on — traceability.
export const MemoryBasisSchema = z.array(
  z.object({
    patternId: z.string(),
    kind: z.string(),
    statement: z.string(),
    accuracy: z.number().nullable(),
  }),
);

// goalTrackerEngine.estimateLanding() output.
export const GoalLandingSchema = z.object({
  metric: z.string(),
  target: z.object({
    comparator: ComparatorSchema,
    targetValue: z.number(),
    spendCeilingMinor: z.number().int().nullable(),
  }),
  paceToDate: z.number(),
  trendBasedLandingEstimate: RangeSchema,
  laggingStatus: GoalStatusSchema,
  leadingRisk: z.boolean(),
  leadingSignals: z.array(LeadingSignalSchema),
  status: GoalStatusSchema,
  pctOfPeriodElapsed: z.number(),
  assumptions: z.array(z.string()),
  basis: z.string(),
});

export const NorthStarGoalSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string(),
  metric: z.string(),
  comparator: ComparatorSchema,
  targetValue: z.number(),
  spendCeilingMinor: z.number().int().nullish(),
  currency: z.string().default('USD'),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  status: GoalStatusSchema,
  planId: z.string().nullish(),
});

// The assembled projections block stored on a Plan (all ranges).
export const PlanProjectionsSchema = z.object({
  scenario: ScenarioSchema.nullable(),
  economics: UnitEconomicsSchema.partial().nullable(),
  goalLanding: GoalLandingSchema.nullable(),
});

export const PlanSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  totalBudgetMinor: z.number().int(),
  currency: z.string().default('USD'),
  status: PlanStatusSchema,
  channelMix: z.array(z.record(z.string(), z.unknown())),
  testingAgenda: z.array(z.record(z.string(), z.unknown())),
  projections: PlanProjectionsSchema,
  memoryBasis: MemoryBasisSchema,
  allocationPlanId: z.string().nullish(),
  goals: z.array(NorthStarGoalSchema).optional(),
  tracking: z
    .object({
      goals: z.array(z.object({ goalId: z.string(), metric: z.string(), landing: GoalLandingSchema.nullable() })),
      refreshedAt: z.string(),
    })
    .optional(),
});

export type PlanStatus = z.infer<typeof PlanStatusSchema>;
export type GoalStatus = z.infer<typeof GoalStatusSchema>;
export type LeadingSignal = z.infer<typeof LeadingSignalSchema>;
export type MemoryBasis = z.infer<typeof MemoryBasisSchema>;
export type GoalLanding = z.infer<typeof GoalLandingSchema>;
export type NorthStarGoal = z.infer<typeof NorthStarGoalSchema>;
export type Plan = z.infer<typeof PlanSchema>;
