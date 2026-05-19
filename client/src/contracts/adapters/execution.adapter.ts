/**
 * Execution Adapter — Validate and normalize execution responses
 *
 * Transforms raw execution responses into clean domain data:
 * - Runtime validation via Zod schemas
 * - Error detection and classification
 * - Result pattern for controlled error handling
 *
 * @example
 * ```ts
 * import { parseExecutionResponse } from '@/contracts/adapters';
 *
 * const result = parseExecutionResponse(rawPayload);
 * if (!result.success) {
 *   toast.error('Execution failed', { description: result.error.message });
 *   return;
 * }
 *
 * // Guaranteed valid execution result
 * const execution: ExecuteMetaResponse = result.data;
 * toast.success(execution.message);
 * ```
 */

import {
  ExecuteMetaResponseSchema,
  ExecuteMetaErrorValidationSchema,
  ExecuteMetaErrorFailedSchema,
  type ExecuteMetaResponse,
  type ExecuteMetaErrorValidation,
  type ExecuteMetaErrorFailed,
} from '../schemas';
import { ParsingError, ApiError } from '../errors';
import { success, failure, type Result } from '../result/Result';

/**
 * Parse and validate execution response
 *
 * Handles both success and error responses from /api/execute/meta
 *
 * @param payload - Raw response from /api/execute/meta
 * @returns Result with validated data or API/parsing error
 */
export function parseExecutionResponse(
  payload: unknown
): Result<ExecuteMetaResponse> {
  // Try parsing as success response
  const successResult = ExecuteMetaResponseSchema.safeParse(payload);
  if (successResult.success) {
    return success(successResult.data);
  }

  // Try parsing as validation error
  const validationErrorResult = ExecuteMetaErrorValidationSchema.safeParse(payload);
  if (validationErrorResult.success) {
    return failure(
      new ApiError({
        message: validationErrorResult.data.error,
        endpoint: '/api/execute/meta',
        method: 'POST',
        httpStatus: 400,
        errorCode: validationErrorResult.data.code,
        fallbackAction: 'Check request parameters and try again',
      })
    );
  }

  // Try parsing as execution failed error
  const failedErrorResult = ExecuteMetaErrorFailedSchema.safeParse(payload);
  if (failedErrorResult.success) {
    return failure(
      new ApiError({
        message: failedErrorResult.data.error,
        endpoint: '/api/execute/meta',
        method: 'POST',
        httpStatus: 500,
        errorCode: failedErrorResult.data.code,
        fallbackAction: 'Check Meta API permissions or retry later',
        context: {
          executionId: failedErrorResult.data.executionId,
          auditLogId: failedErrorResult.data.auditLogId,
        },
      })
    );
  }

  // Couldn't parse as any known shape — parsing error
  return failure(
    new ParsingError({
      message: 'Invalid execution response format',
      issues: successResult.error.issues,
      endpoint: '/api/execute/meta',
      schema: 'ExecuteMetaResponseSchema',
      fallbackAction: 'Contact support if issue persists',
    })
  );
}

/**
 * Type guard — check if execution was idempotent replay
 *
 * @param response - Validated execution response
 * @returns True if this was a replay of a previous execution
 */
export function isIdempotentReplay(response: ExecuteMetaResponse): boolean {
  return response.idempotentReplay === true;
}

/**
 * Type guard — check if response has audit log
 *
 * @param response - Validated execution response
 * @returns True if audit log ID is present
 */
export function hasAuditLog(response: ExecuteMetaResponse): boolean {
  return !!response.auditLogId;
}
