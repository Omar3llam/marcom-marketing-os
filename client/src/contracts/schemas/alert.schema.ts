/**
 * Alert Schema — Campaign alert contracts
 *
 * Validates alert data from backend responses.
 * Ensures type-safe alert priorities, action plans, and analysis.
 *
 * @example
 * ```ts
 * import { AlertSchema } from '@/contracts/schemas';
 *
 * const result = AlertSchema.safeParse(payload);
 * if (result.success) {
 *   console.log(result.data.priority); // 'HIGH' | 'MEDIUM' | 'LOW'
 *   console.log(result.data.action_plan.action); // 'PAUSE_CAMPAIGN'
 * }
 * ```
 */

import { z } from 'zod';
import { MetricSchema } from './metrics.schema';

/**
 * Action plan status
 */
export const ActionStatusSchema = z.enum([
  'PENDING',
  'QUEUED',
  'EXECUTING',
  'EXECUTED_SUCCESS',
  'EXECUTED_FAILED',
]);

/**
 * Alert action plan schema
 *
 * Describes what action should be taken and its current status.
 */
export const AlertActionPlanSchema = z.object({
  action: z.string().min(1, 'Action required'),
  status: ActionStatusSchema,
  imageUrl: z.string().url().nullable(),
  reference_prompt: z.string().nullable(),
});

/**
 * Alert analysis schema
 *
 * Contains AI-generated verdict and root cause analysis.
 */
export const AlertAnalysisSchema = z.object({
  verdict: z.string().min(1, 'Verdict required'),
  root_cause: z.string().min(1, 'Root cause required'),
});

/**
 * Decision memory schema
 *
 * Historical insight from past decisions on similar situations.
 */
export const DecisionMemorySchema = z.object({
  actionType: z.string(),
  decisionRationale: z.string(),
  isSustainable: z.boolean().nullable(),
  impactDurationHrs: z.number().nullable(),
});

/**
 * Alert priority level
 */
export const AlertPrioritySchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);

/**
 * Campaign alert schema
 *
 * Represents a single alert for a campaign with:
 * - action_id: Unique alert identifier
 * - idempotency_key: Execution idempotency key
 * - priority: Alert priority level
 * - analysis: AI-generated verdict and root cause
 * - historical_insight: Human-readable historical context
 * - action_plan: Recommended action with status
 * - metrics: Supporting metrics for this alert
 * - memory: Historical decision patterns
 * - creative_assets: Optional creative asset metadata
 */
export const AlertSchema = z.object({
  action_id: z.string().uuid('Invalid action ID format'),
  idempotency_key: z.string().min(1, 'Idempotency key required'),
  priority: AlertPrioritySchema,
  analysis: AlertAnalysisSchema,
  historical_insight: z.string().nullable(),
  action_plan: AlertActionPlanSchema,
  metrics: z.array(MetricSchema),
  memory: z.array(DecisionMemorySchema),
  creative_assets: z.any().nullable(), // Flexible for future creative types
});

/**
 * Type inference from schemas
 */
export type ActionStatus = z.infer<typeof ActionStatusSchema>;
export type AlertActionPlan = z.infer<typeof AlertActionPlanSchema>;
export type AlertAnalysis = z.infer<typeof AlertAnalysisSchema>;
export type DecisionMemory = z.infer<typeof DecisionMemorySchema>;
export type AlertPriority = z.infer<typeof AlertPrioritySchema>;
export type Alert = z.infer<typeof AlertSchema>;
