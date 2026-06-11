/**
 * Execution Schema — Meta action execution contracts
 *
 * Validates execution request/response data.
 * Ensures type-safe action types, targets, and execution results.
 *
 * @example
 * ```ts
 * import { ExecuteMetaRequestSchema } from '@/contracts/schemas';
 *
 * const result = ExecuteMetaRequestSchema.safeParse(payload);
 * if (result.success) {
 *   submitExecution(result.data);
 * }
 * ```
 */

import { z } from 'zod';

/**
 * Meta action types
 */
export const MetaActionTypeSchema = z.enum([
  'PAUSE_CAMPAIGN',
  'RESUME_CAMPAIGN',
  'PAUSE_ADSET',
  'RESUME_ADSET',
  'SCALE_BUDGET',
  'REDUCE_BUDGET',
]);

/**
 * Target type for action
 */
export const TargetTypeSchema = z.enum(['campaign', 'adset', 'ad']);

/**
 * Execute Meta request schema
 *
 * POST /api/execute/meta
 */
export const ExecuteMetaRequestSchema = z.object({
  actionType: MetaActionTypeSchema,
  targetId: z.string().min(1, 'Target ID required'),
  targetType: TargetTypeSchema,
  idempotencyKey: z.string().min(1, 'Idempotency key required'),
  options: z
    .object({
      amount: z.number().optional(),
    })
    .catchall(z.any())
    .optional(),
});

/**
 * Execute Meta response schema (success)
 *
 * POST /api/execute/meta → 200
 */
export const ExecuteMetaResponseSchema = z.object({
  success: z.literal(true),
  idempotentReplay: z.boolean(),
  executionId: z.string(),
  auditLogId: z.string().optional(),
  status: z.literal('EXECUTED_SUCCESS'),
  data: z.object({
    meta_response: z.any().optional(),
  }),
  message: z.string(),
});

/**
 * Execute Meta error schema (validation)
 *
 * POST /api/execute/meta → 400
 */
export const ExecuteMetaErrorValidationSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.literal('VALIDATION_ERROR'),
});

/**
 * Execute Meta error schema (execution failed)
 *
 * POST /api/execute/meta → 500
 */
export const ExecuteMetaErrorFailedSchema = z.object({
  success: z.literal(false),
  idempotentReplay: z.literal(false),
  executionId: z.string(),
  auditLogId: z.string(),
  status: z.literal('FAILED'),
  error: z.string(),
  code: z.string().optional(),
});

/**
 * Type inference from schemas
 */
export type MetaActionType = z.infer<typeof MetaActionTypeSchema>;
export type TargetType = z.infer<typeof TargetTypeSchema>;
export type ExecuteMetaRequest = z.infer<typeof ExecuteMetaRequestSchema>;
export type ExecuteMetaResponse = z.infer<typeof ExecuteMetaResponseSchema>;
export type ExecuteMetaErrorValidation = z.infer<typeof ExecuteMetaErrorValidationSchema>;
export type ExecuteMetaErrorFailed = z.infer<typeof ExecuteMetaErrorFailedSchema>;
