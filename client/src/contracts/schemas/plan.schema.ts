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
import { RangeSchema, ScenarioTypeSchema, ScenarioProjectionsSchema } from './scenario.schema';
import { AllocationProjectedSchema } from './allocationPlan.schema';
import { UnitEconomicsSchema } from './unitEconomics.schema';
import { ComparatorSchema } from './guardrailRule.schema';

export const PlanStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'CLOSED']);
export const GoalStatusSchema = z.enum(['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'INSUFFICIENT_EVIDENCE', 'ACHIEVED', 'MISSED']);

// Phase 6B — the plan approval gate (collaboration ApprovalService). The DB
// enum is exactly these three; "Request revision" in the UI is REJECTED + reason
// (REQUEST_REVISION belongs to the SEPARATE artifact-approval system).
export const ApprovalStateSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

// One ApprovalRequest row, as listed for the reviewer queue (GET /approvals).
// `plan` is the lightweight context the handler now includes so the queue
// renders a row (name/period/budget) without a second round-trip.
export const ApprovalRequestSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  planId: z.string().nullish(),
  subjectType: z.string(),
  subjectId: z.string(),
  requestedById: z.string().nullish(),
  state: ApprovalStateSchema,
  reason: z.string().nullish(),
  decidedById: z.string().nullish(),
  decidedAt: z.coerce.date().nullish(),
  createdAt: z.coerce.date(),
  plan: z
    .object({
      id: z.string(),
      name: z.string(),
      periodStart: z.coerce.date(),
      periodEnd: z.coerce.date(),
      totalBudgetMinor: z.number().int(),
      currency: z.string().min(1),
      status: PlanStatusSchema,
    })
    .nullish(),
});

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
  currency: z.string().min(1),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  status: GoalStatusSchema,
  trackingUnavailableReason: z.string().nullish(),
  measuredCurrency: z.string().nullish(),
  planId: z.string().nullish(),
});

// What PlanService.buildPlan PERSISTS on a plan — a SUBSET of the live
// /scenario response. The persisted block omits `change`, `currency`, and
// `memoryBasis` (those belong to the ephemeral scenario call), so validating it
// against the full ScenarioSchema would wrongly DROP any real plan carrying a
// scenario projection. Kept faithful to the handler to stay honest.
export const PlanScenarioProjectionSchema = z.object({
  scenarioType: ScenarioTypeSchema,
  // Historical JSON has merAfter and no measurement authority. It remains
  // readable as legacy data; only new writes carry the corrected key/status.
  projections: z.union([
    ScenarioProjectionsSchema,
    ScenarioProjectionsSchema.omit({ blendedRevenueEfficiencyAfter: true }).extend({ merAfter: RangeSchema }),
  ]),
  assumptions: z.array(z.string()),
  confidence: z.number().min(0).max(1).nullable(),
  basis: z.string().nullable(),
  efficiencyStatus: z.enum(['VALID', 'UNAVAILABLE']).optional(),
  efficiencyReason: z.string().nullable().optional(),
});

// The assembled projections block stored on a Plan (all ranges).
export const PlanProjectionsSchema = z.object({
  scenario: PlanScenarioProjectionSchema.nullable(),
  mix: z.object({
    efficiencyStatus: z.enum(['VALID', 'UNAVAILABLE']).optional(),
    efficiencyReason: z.string().nullable().optional(),
    projected: z.union([
      AllocationProjectedSchema,
      z.object({ blendedRevenueMinor: z.number().nullable(), projectedCpaMinor: z.number().nullable(),
        merBefore: z.number().nullable(), merAfter: z.number().nullable() }),
    ]).nullable(),
  }).passthrough().nullish(),
  economics: UnitEconomicsSchema.partial().nullable(),
  goalLanding: GoalLandingSchema.nullable(),
  goalTracking: z.object({
    contractVersion: z.number(), status: GoalStatusSchema,
    unavailableReason: z.string().nullable(), measuredCurrency: z.string().nullable(),
  }).nullish(),
});

export const PlanSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  totalBudgetMinor: z.number().int(),
  currency: z.string().min(1),
  status: PlanStatusSchema,
  channelMix: z.array(z.record(z.string(), z.unknown())),
  testingAgenda: z.array(z.record(z.string(), z.unknown())),
  projections: PlanProjectionsSchema,
  memoryBasis: MemoryBasisSchema,
  allocationPlanId: z.string().nullish(),
  // Phase 6B approval gate — present on every plan row (defaults), plus the
  // latest request (getPlan only) so the owner can read the reviewer's note.
  requiresApproval: z.boolean().optional().default(false),
  approvalState: ApprovalStateSchema.nullish(),
  latestApproval: z
    .object({
      id: z.string(),
      state: ApprovalStateSchema,
      reason: z.string().nullish(),
      decidedAt: z.coerce.date().nullish(),
      createdAt: z.coerce.date(),
    })
    .nullish(),
  goals: z.array(NorthStarGoalSchema).optional(),
  tracking: z
    .object({
      goals: z.array(z.object({ goalId: z.string(), metric: z.string(), status: GoalStatusSchema.optional(),
        unavailableReason: z.string().nullish(), currency: z.string().nullish(), landing: GoalLandingSchema.nullable() })),
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
export type PlanScenarioProjection = z.infer<typeof PlanScenarioProjectionSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
