// ============================================================
// @marcom/runtime-contracts · ExecutionReconciliationPayload
// ============================================================
// Shape returned by GET /api/execute/:id/active. Backend authority
// for execution state (Architecture Gate Decision 1).
// ============================================================
import { ExecutionStatus, isTerminalState } from './executionStatus.js';

const REQUIRED_FIELDS = [
  'executionId',
  'status',
  'version',
  'updatedAt',
  'correlationId',
  'isTerminal',
];

const VALID_STATUSES = Object.values(ExecutionStatus);

/**
 * Throws if payload is missing required fields or has an unknown status.
 * Returns true on success.
 */
export function validateReconciliationPayload(payload) {
  for (const field of REQUIRED_FIELDS) {
    if (payload[field] === undefined || payload[field] === null) {
      throw new Error(`ReconciliationPayload missing required field: ${field}`);
    }
  }
  if (!VALID_STATUSES.includes(payload.status)) {
    throw new Error(`ReconciliationPayload has invalid status: ${payload.status}`);
  }
  return true;
}

/**
 * Factory ensuring all required fields are present. Used by
 * GET /api/execute/:id/active.
 */
export function createReconciliationPayload(execution) {
  return {
    executionId: execution.id,
    status: execution.status,
    version: execution.version ?? 0,
    updatedAt: execution.updatedAt?.toISOString
      ? execution.updatedAt.toISOString()
      : (execution.updatedAt || new Date().toISOString()),
    correlationId: execution.correlationId || execution.id,
    activeStep: execution.activeStep || null,
    retryMetadata: execution.retryMetadata
      ? {
          attempt: execution.retryMetadata.attempt || 0,
          maxAttempts: execution.retryMetadata.maxAttempts || 3,
          nextRetryAt: execution.retryMetadata.nextRetryAt || null,
        }
      : null,
    isTerminal: isTerminalState(execution.status),
  };
}
