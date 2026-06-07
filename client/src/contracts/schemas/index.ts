/**
 * Schema Exports — Runtime contract validation
 *
 * Central export for all Zod schemas and inferred types.
 *
 * USAGE:
 * ```ts
 * // Import schemas for validation
 * import { LumiFeedResponseSchema, CampaignSchema } from '@/contracts/schemas';
 *
 * // Import types (inferred from schemas)
 * import type { Campaign, Alert, Metric } from '@/contracts/schemas';
 *
 * // Validate at runtime
 * const result = LumiFeedResponseSchema.safeParse(payload);
 * if (result.success) {
 *   const data: LumiFeedResponse = result.data;
 * }
 * ```
 *
 * IMPORTANT:
 * These schemas are the source of truth for runtime contracts.
 * Types are inferred from schemas to ensure compile-time and
 * runtime validation stay in sync.
 */

// ──────────────────────────────────────────────────────────
// Metrics
// ──────────────────────────────────────────────────────────
export {
  MetricTrendSchema,
  MetricStatusSchema,
  MetricSchema,
  type MetricTrend,
  type MetricStatus,
  type Metric,
} from './metrics.schema';

// ──────────────────────────────────────────────────────────
// Alerts
// ──────────────────────────────────────────────────────────
export {
  ActionStatusSchema,
  AlertActionPlanSchema,
  AlertAnalysisSchema,
  DecisionMemorySchema,
  AlertPrioritySchema,
  AlertSchema,
  type ActionStatus,
  type AlertActionPlan,
  type AlertAnalysis,
  type DecisionMemory,
  type AlertPriority,
  type Alert,
} from './alert.schema';

// ──────────────────────────────────────────────────────────
// Campaigns
// ──────────────────────────────────────────────────────────
export {
  CampaignStageSchema,
  CampaignSchema,
  type CampaignStage,
  type Campaign,
} from './campaign.schema';

// ──────────────────────────────────────────────────────────
// Execution
// ──────────────────────────────────────────────────────────
export {
  MetaActionTypeSchema,
  TargetTypeSchema,
  ExecuteMetaRequestSchema,
  ExecuteMetaResponseSchema,
  ExecuteMetaErrorValidationSchema,
  ExecuteMetaErrorFailedSchema,
  type MetaActionType,
  type TargetType,
  type ExecuteMetaRequest,
  type ExecuteMetaResponse,
  type ExecuteMetaErrorValidation,
  type ExecuteMetaErrorFailed,
} from './execution.schema';

// ──────────────────────────────────────────────────────────
// API
// ──────────────────────────────────────────────────────────
export {
  LumiFeedResponseSchema,
  ErrorResponseSchema,
  type LumiFeedResponse,
  type ErrorResponse,
} from './api.schema';

// ──────────────────────────────────────────────────────────
// Phase 1 substrate — Entity graph
// ──────────────────────────────────────────────────────────
export {
  ChannelSchema,
  EntityLevelSchema,
  EntityStatusSchema,
  AccountNodeSchema,
  CampaignNodeSchema,
  AdSetNodeSchema,
  AdNodeSchema,
  CreativeNodeSchema,
  type Channel,
  type EntityLevel,
  type EntityStatus,
  type AccountNode,
  type CampaignNode,
  type AdSetNode,
  type AdNode,
  type CreativeNode,
} from './entity.schema';

// ──────────────────────────────────────────────────────────
// Phase 1 substrate — Numeric MetricSnapshot
// ──────────────────────────────────────────────────────────
export {
  DataSourceSchema,
  GranularitySchema,
  MetricSnapshotSchema,
  type DataSource,
  type Granularity,
  type MetricSnapshot,
} from './metricSnapshot.schema';

// ──────────────────────────────────────────────────────────
// Phase 1 substrate — Decision graph (Entity → Decision → Outcome → Memory)
// ──────────────────────────────────────────────────────────
export {
  VerdictSchema,
  DecisionStatusSchema,
  DecisionSchema,
  OutcomeSnapshotSchema,
  DecisionMemoryEntrySchema,
  LevelVerdictSchema,
  type Verdict,
  type DecisionStatus,
  type Decision,
  type OutcomeSnapshot,
  type DecisionMemoryEntry,
  type LevelVerdict,
} from './decision.schema';

// ──────────────────────────────────────────────────────────
// Phase 2 substrate — Fatigue prediction + Guardrail rules
// ──────────────────────────────────────────────────────────
export {
  FatiguePredictionSchema,
  type FatiguePrediction,
} from './fatiguePrediction.schema';

export {
  ComparatorSchema,
  ThresholdUnitSchema,
  GuardrailRuleSchema,
  type Comparator,
  type ThresholdUnit,
  type GuardrailRule,
} from './guardrailRule.schema';

// ──────────────────────────────────────────────────────────
// Phase 3 — Capital allocation (blended truth + pacing + allocation + portfolio)
// ──────────────────────────────────────────────────────────
export {
  CoverageSchema,
  ConfidenceSchema,
  BlendedChannelSchema,
  BlendedPortfolioSchema,
  BlendedTruthSchema,
  type Coverage,
  type Confidence,
  type BlendedChannel,
  type BlendedPortfolio,
  type BlendedTruth,
} from './blendedTruth.schema';

export {
  PaceStatusSchema,
  PacingSchema,
  type PaceStatus,
  type Pacing,
} from './pacing.schema';

export {
  GoalTypeSchema,
  AllocationStatusSchema,
  AllocationGoalSchema,
  AllocationMoveSchema,
  AllocationProjectedSchema,
  AllocationPlanPreviewSchema,
  AllocationPlanSchema,
  type GoalType,
  type AllocationStatus,
  type AllocationGoal,
  type AllocationMove,
  type AllocationProjected,
  type AllocationPlanPreview,
  type AllocationPlan,
} from './allocationPlan.schema';

export {
  PortfolioTotalsSchema,
  PortfolioChannelSchema,
  PortfolioViewSchema,
  type PortfolioTotals,
  type PortfolioChannel,
  type PortfolioView,
} from './portfolio.schema';

// ──────────────────────────────────────────────────────────
// Phase 4 — Testing OS (experiments + agenda + readout)
// ──────────────────────────────────────────────────────────
export {
  TestDimensionSchema,
  TestStatusSchema,
  TestMetricSchema,
  ConfidenceLabelSchema,
  TestVariantSchema,
  TestExperimentSchema,
  type TestDimension,
  type TestStatus,
  type TestMetric,
  type ConfidenceLabel,
  type TestVariant,
  type TestExperiment,
} from './testExperiment.schema';

export {
  TestSuggestionVariantSchema,
  TestSuggestionSchema,
  TestAgendaSchema,
  type TestSuggestionVariant,
  type TestSuggestion,
  type TestAgenda,
} from './testAgenda.schema';

export {
  TestVerdictSchema,
  TestReadoutSchema,
  ConcludeTestResponseSchema,
  type TestVerdict,
  type TestReadout,
  type ConcludeTestResponse,
} from './testReadout.schema';

// ──────────────────────────────────────────────────────────
// Phase 5 — Memory Moat (account patterns + briefing + gated network)
// ──────────────────────────────────────────────────────────
export {
  PatternKindSchema,
  PatternStatusSchema,
  PromotableSpecSchema,
  AccountPatternSchema,
  type PatternKind,
  type PatternStatus,
  type PromotableSpec,
  type AccountPattern,
} from './accountPattern.schema';

export {
  NetworkStatusSchema,
  NetworkInsightSchema,
  NetworkResponseSchema,
  type NetworkStatus,
  type NetworkInsight,
  type NetworkResponse,
} from './networkInsight.schema';

export {
  BriefingSchema,
  type Briefing,
} from './briefing.schema';

// ──────────────────────────────────────────────────────────
// Phase 6 — Planning OS (scenario + unit economics + plans/goals)
// ──────────────────────────────────────────────────────────
export {
  ScenarioTypeSchema,
  RangeSchema,
  ScenarioProjectionsSchema,
  ScenarioSchema,
  type ScenarioType,
  type Range,
  type ScenarioProjections,
  type Scenario,
} from './scenario.schema';

export {
  SustainabilityBandSchema,
  SustainabilityBandRangeSchema,
  AccountEconomicsSchema,
  UnitEconomicsSchema,
  type SustainabilityBand,
  type AccountEconomics,
  type UnitEconomics,
} from './unitEconomics.schema';

export {
  PlanStatusSchema,
  GoalStatusSchema,
  LeadingSignalSchema,
  MemoryBasisSchema,
  GoalLandingSchema,
  NorthStarGoalSchema,
  PlanProjectionsSchema,
  PlanSchema,
  type PlanStatus,
  type GoalStatus,
  type LeadingSignal,
  type MemoryBasis,
  type GoalLanding,
  type NorthStarGoal,
  type Plan,
} from './plan.schema';
