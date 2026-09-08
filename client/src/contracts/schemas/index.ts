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
  TestExperimentDetailResponseSchema,
  type TestDimension,
  type TestStatus,
  type TestMetric,
  type ConfidenceLabel,
  type TestVariant,
  type TestExperiment,
  type TestExperimentDetailResponse,
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
  ScenarioResponseSchema,
  type ScenarioType,
  type Range,
  type ScenarioProjections,
  type Scenario,
  type ScenarioResponse,
} from './scenario.schema';

export {
  SustainabilityBandSchema,
  SustainabilityBandRangeSchema,
  AccountEconomicsSchema,
  UnitEconomicsSchema,
  CurrentCacSchema,
  EconomicsAssessmentSchema,
  type SustainabilityBand,
  type AccountEconomics,
  type UnitEconomics,
  type CurrentCac,
  type EconomicsAssessment,
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

// ──────────────────────────────────────────────────────────
// Phase 7 — Measurement OS (attribution + incrementality + reconciliation)
// ──────────────────────────────────────────────────────────
export {
  AttributionSourceSchema,
  ConfidenceLevelSchema,
  AttributedSchema,
  type AttributionSource,
  type ConfidenceLevel,
  type Attributed,
} from './attributed.schema';

export {
  AttributionModelSchema,
  AttributionStatusSchema,
  AttributionChannelSchema,
  AttributionResultSchema,
  type AttributionModel,
  type AttributionStatus,
  type AttributionResult,
} from './attribution.schema';

export {
  IncrementalityStatusSchema,
  HoldoutDesignSchema,
  IncrementalityReadoutSchema,
  IncrementalityTestSchema,
  IncrementalityListResponseSchema,
  IncrementalityDetailResponseSchema,
  ConcludeIncrementalityResponseSchema,
  type IncrementalityStatus,
  type HoldoutDesign,
  type IncrementalityReadout,
  type IncrementalityTest,
  type IncrementalityListResponse,
  type IncrementalityDetailResponse,
  type ConcludeIncrementalityResponse,
} from './incrementality.schema';

export {
  ReconciliationRowSchema,
  ReconciliationSchema,
  type ReconciliationRow,
  type Reconciliation,
} from './reconciliation.schema';

// ──────────────────────────────────────────────────────────
// Phase 8 — Collaboration & Reporting OS (roles · narratives · approvals)
// ──────────────────────────────────────────────────────────
export {
  EvidenceKindSchema,
  FigureSchema,
  ClaimSchema,
  NarrativeSectionSchema,
  type EvidenceKind,
  type Figure,
  type Claim,
  type NarrativeSection,
} from './evidenceClaim.schema';

export {
  NarrativePeriodSchema,
  NarrativeAudienceSchema,
  ConfidenceComponentSchema,
  ReportConfidenceSchema,
  StakeholderNarrativeSchema,
  NarrativesListResponseSchema,
  NarrativeResponseSchema,
  type NarrativePeriod,
  type NarrativeAudience,
  type ConfidenceComponent,
  type ReportConfidence,
  type StakeholderNarrative,
  type NarrativesListResponse,
  type NarrativeResponse,
} from './narrative.schema';

export {
  WorkspaceRoleSchema,
  RoleScopeSchema,
  type WorkspaceRole,
  type RoleScope,
} from './role.schema';

export {
  ApprovalStateSchema,
  ApprovalRequestSchema,
  CollaborationEventTypeSchema,
  HandoffSchema,
  type ApprovalState,
  type ApprovalRequest,
  type CollaborationEventType,
  type Handoff,
} from './approval.schema';

export {
  InboxAlertSchema,
  InboxNarrativeSchema,
  InboxApprovalSchema,
  InboxResponseSchema,
  type InboxAlert,
  type InboxNarrative,
  type InboxApproval,
  type InboxResponse,
} from './inbox.schema';

// ──────────────────────────────────────────────────────────
// Phase 9 — Agentic OS (unified home · agenda · loop status)
// ──────────────────────────────────────────────────────────
export {
  AgendaBandSchema,
  AgendaTypeSchema,
  AgendaSeveritySchema,
  HumanActionSchema,
  AgendaItemSchema,
  type AgendaBand,
  type AgendaType,
  type AgendaSeverity,
  type HumanAction,
  type AgendaItem,
} from './agenda.schema';

export {
  LoopStageSchema,
  StageStateSchema,
  LoopHealthSchema,
  StageStatusSchema,
  LoopStatusSchema,
  type LoopStage,
  type StageState,
  type LoopHealth,
  type StageStatus,
  type LoopStatus,
} from './loop.schema';

export {
  AgendaBandViewSchema,
  AgentHomeSchema,
  type AgendaBandView,
  type AgentHome,
} from './home.schema';

// ──────────────────────────────────────────────────────────
// Phase X — Proof Engine (decision accuracy · calibration · velocity)
// ──────────────────────────────────────────────────────────
export {
  CoverageVerdictSchema,
  LiftStatusSchema,
  CalibrationDirectionSchema,
  ReliabilityBinSchema,
  CalibrationSchema,
  AccountLiftSchema,
  VelocityPeriodSchema,
  VelocitySchema,
  AccuracyCoverageSchema,
  AccuracySurfaceSchema,
  DecisionAccuracySchema,
  PendingOutcomeSchema,
  PendingOutcomesResponseSchema,
  OutcomeEvidenceStatusSchema,
  EvidenceCoverageSchema,
  EvidenceWindowSchema,
  OutcomeEvidenceResponseSchema,
  type CoverageVerdict,
  type LiftStatus,
  type CalibrationDirection,
  type ReliabilityBin,
  type Calibration,
  type AccountLift,
  type VelocityPeriod,
  type Velocity,
  type AccuracyCoverage,
  type AccuracySurface,
  type DecisionAccuracy,
  type PendingOutcome,
  type PendingOutcomesResponse,
  type OutcomeEvidenceStatus,
  type EvidenceWindow,
  type OutcomeEvidenceResponse,
} from './accuracy.schema';

// ──────────────────────────────────────────────────────────
// Phase 12 — Connectors (connection status · health; display fields only)
// ──────────────────────────────────────────────────────────
export {
  ConnectorHealthSchema,
  ConnectionSchema,
  ConnectionsResponseSchema,
  type ConnectorHealth,
  type Connection,
  type ConnectionsResponse,
} from './connections.schema';

// ──────────────────────────────────────────────────────────
// PARITY-01 — the CANONICAL account aggregate. One spend figure and one
// blended CPA for the whole account, read rather than recomputed: Attention and
// Campaigns each derived their own and disagreed by a factor of ten.
// ──────────────────────────────────────────────────────────
export {
  BoundsStatusSchema,
  CurrencyStatusSchema,
  AggregateUnavailableSchema,
  VerdictCountsSchema,
  AggregatePopulationSchema,
  AccountAggregateSchema,
  AccountAggregateResponseSchema,
  type BoundsStatus,
  type CurrencyStatus,
  type AggregateUnavailable,
  type VerdictCounts,
  type AggregatePopulation,
  type AccountAggregate,
  type AccountAggregateResponse,
} from './accountAggregate.schema';

// ──────────────────────────────────────────────────────────
// PARITY-04 — the SUBJECT axis's two reads. NOT entity.schema.ts, which
// describes the Prisma entity GRAPH; these describe the flattened HTTP WIRE.
// ──────────────────────────────────────────────────────────
export {
  ConnectorVerdictValueSchema,
  ConnectorCampaignRowSchema,
  ConnectorVerdictRowSchema,
  GatedOutRowSchema,
  ConnectorCampaignsResponseSchema,
  ConnectorVerdictsResponseSchema,
  type ConnectorVerdictValue,
  type ConnectorCampaignRow,
  type ConnectorVerdictRow,
  type GatedOutRow,
  type ConnectorCampaignsResponse,
  type ConnectorVerdictsResponse,
} from './connectorCampaigns.schema';
