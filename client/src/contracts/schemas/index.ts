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
