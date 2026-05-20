// ============================================================
// MARCOM — ExecutionStatus Enum + State Transition Matrix
// Phase 11B Task 1: Type-safe execution status foundation
//
// Governance Constraint A: Explicit State Transition Matrix
// All transitions must be declared here. Reject everything else
// at service boundary. No implicit transitions. No auto-healing.
// ============================================================

/**
 * ExecutionStatus Enum
 *
 * Type-safe execution status values preventing typos and enabling
 * exhaustiveness checking in TypeScript.
 *
 * Terminal states (EXECUTED_SUCCESS, EXECUTED_FAILED, CANCELLED)
 * are immutable once reached (Governance Constraint B).
 */
export enum ExecutionStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  EXECUTING = 'EXECUTING',
  EXECUTED_SUCCESS = 'EXECUTED_SUCCESS',
  EXECUTED_FAILED = 'EXECUTED_FAILED',
  TIMED_OUT = 'TIMED_OUT',
  CANCELLED = 'CANCELLED',
}

/**
 * Terminal State Check
 *
 * Terminal states are immutable — no retries, no reopen, no mutation
 * except audit append. Treat like cooled lava. 🌋
 */
export function isTerminalState(status: ExecutionStatus): boolean {
  return (
    status === ExecutionStatus.EXECUTED_SUCCESS ||
    status === ExecutionStatus.EXECUTED_FAILED ||
    status === ExecutionStatus.TIMED_OUT ||
    status === ExecutionStatus.CANCELLED
  );
}

/**
 * State Transition Matrix
 *
 * Explicit allowed transitions. Everything not listed here is ILLEGAL.
 * No "best effort" transitions. No implicit state mutation.
 *
 * Format: Map<FromState, ToState[]>
 */
export const STATE_TRANSITION_MATRIX: Record<ExecutionStatus, ExecutionStatus[]> = {
  [ExecutionStatus.PENDING]: [
    ExecutionStatus.QUEUED,
    ExecutionStatus.CANCELLED,
  ],

  [ExecutionStatus.QUEUED]: [
    ExecutionStatus.EXECUTING,
    ExecutionStatus.CANCELLED,
  ],

  [ExecutionStatus.EXECUTING]: [
    ExecutionStatus.EXECUTED_SUCCESS,
    ExecutionStatus.EXECUTED_FAILED,
    ExecutionStatus.TIMED_OUT,
    ExecutionStatus.CANCELLED,
  ],

  // Terminal states: no outbound transitions (immutable)
  [ExecutionStatus.EXECUTED_SUCCESS]: [],
  [ExecutionStatus.EXECUTED_FAILED]: [],
  [ExecutionStatus.TIMED_OUT]: [],
  [ExecutionStatus.CANCELLED]: [],
};

/**
 * Validate State Transition
 *
 * Returns true if transition is legal according to STATE_TRANSITION_MATRIX.
 * Use this at ExecutionLifecycleService boundary to reject illegal transitions.
 *
 * @param fromStatus - Current execution status
 * @param toStatus - Desired next status
 * @returns true if transition is allowed, false otherwise
 */
export function isLegalTransition(
  fromStatus: ExecutionStatus,
  toStatus: ExecutionStatus
): boolean {
  const allowedTransitions = STATE_TRANSITION_MATRIX[fromStatus];
  return allowedTransitions.includes(toStatus);
}

/**
 * Get Allowed Next States
 *
 * Returns array of valid next states from current state.
 * Empty array for terminal states.
 *
 * @param currentStatus - Current execution status
 * @returns Array of allowed next statuses
 */
export function getAllowedNextStates(
  currentStatus: ExecutionStatus
): ExecutionStatus[] {
  return STATE_TRANSITION_MATRIX[currentStatus] || [];
}

/**
 * Transition Validation Error
 *
 * Thrown when attempting illegal state transition.
 * Captured by ExecutionLifecycleService for telemetry + audit.
 */
export class IllegalTransitionError extends Error {
  constructor(
    public readonly fromStatus: ExecutionStatus,
    public readonly toStatus: ExecutionStatus,
    public readonly executionId?: string
  ) {
    super(
      `Illegal state transition: ${fromStatus} → ${toStatus}` +
      (executionId ? ` (execution: ${executionId})` : '')
    );
    this.name = 'IllegalTransitionError';
  }
}

/**
 * ExecutionReconciliationPayload
 *
 * Required fields for GET /api/execution/active reconciliation endpoint.
 * Backend authority for execution state (Governance Decision 1).
 */
export interface ExecutionReconciliationPayload {
  executionId: string;
  status: ExecutionStatus;
  version: number;               // OCC version field
  updatedAt: string;             // ISO timestamp
  correlationId: string;         // Correlation lineage (Governance Constraint C)
  activeStep?: string;           // Current orchestration step
  retryMetadata?: {
    attempt: number;
    maxAttempts: number;
    nextRetryAt?: string;
  };
  isTerminal: boolean;           // Terminality flag
}

/**
 * ExecutionTransitionRequest
 *
 * Payload for ExecutionLifecycleService.transition() calls.
 * Includes expected version for optimistic concurrency control.
 */
export interface ExecutionTransitionRequest {
  executionId: string;
  newStatus: ExecutionStatus;
  expectedVersion: number;       // OCC: WHERE version = expectedVersion
  actor: 'worker' | 'timeout-handler' | 'user' | 'api';
  correlationId: string;
  metadata?: Record<string, unknown>;
}
