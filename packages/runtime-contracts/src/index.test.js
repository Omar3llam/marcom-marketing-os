// ============================================================
// @marcom/runtime-contracts — contract tests
// ============================================================
// Validates the shared state machine + reconciliation payload
// shape. Backend services + frontend consumers depend on these
// invariants, so this is the canonical regression net.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  ExecutionStatus,
  isTerminalState,
  isLegalTransition,
  getAllowedNextStates,
  IllegalTransitionError,
  validateReconciliationPayload,
  createReconciliationPayload,
} from './index.js';

describe('ExecutionStatus Enum', () => {
  it('should have all 7 status values', () => {
    expect(ExecutionStatus.PENDING).toBe('PENDING');
    expect(ExecutionStatus.QUEUED).toBe('QUEUED');
    expect(ExecutionStatus.EXECUTING).toBe('EXECUTING');
    expect(ExecutionStatus.EXECUTED_SUCCESS).toBe('EXECUTED_SUCCESS');
    expect(ExecutionStatus.EXECUTED_FAILED).toBe('EXECUTED_FAILED');
    expect(ExecutionStatus.TIMED_OUT).toBe('TIMED_OUT');
    expect(ExecutionStatus.CANCELLED).toBe('CANCELLED');
  });

  it('should be frozen (immutable)', () => {
    expect(() => {
      ExecutionStatus.NEW_STATUS = 'NEW_STATUS';
    }).toThrow();
  });
});

describe('isTerminalState', () => {
  it('should identify terminal states correctly', () => {
    expect(isTerminalState(ExecutionStatus.EXECUTED_SUCCESS)).toBe(true);
    expect(isTerminalState(ExecutionStatus.EXECUTED_FAILED)).toBe(true);
    expect(isTerminalState(ExecutionStatus.TIMED_OUT)).toBe(true);
    expect(isTerminalState(ExecutionStatus.CANCELLED)).toBe(true);
  });

  it('should identify non-terminal states correctly', () => {
    expect(isTerminalState(ExecutionStatus.PENDING)).toBe(false);
    expect(isTerminalState(ExecutionStatus.QUEUED)).toBe(false);
    expect(isTerminalState(ExecutionStatus.EXECUTING)).toBe(false);
  });
});

describe('State Transition Matrix', () => {
  describe('PENDING transitions', () => {
    it('should allow PENDING → QUEUED', () => {
      expect(isLegalTransition(ExecutionStatus.PENDING, ExecutionStatus.QUEUED)).toBe(true);
    });

    it('should allow PENDING → CANCELLED', () => {
      expect(isLegalTransition(ExecutionStatus.PENDING, ExecutionStatus.CANCELLED)).toBe(true);
    });

    it('should reject PENDING → EXECUTING', () => {
      expect(isLegalTransition(ExecutionStatus.PENDING, ExecutionStatus.EXECUTING)).toBe(false);
    });

    it('should reject PENDING → EXECUTED_SUCCESS', () => {
      expect(isLegalTransition(ExecutionStatus.PENDING, ExecutionStatus.EXECUTED_SUCCESS)).toBe(false);
    });
  });

  describe('QUEUED transitions', () => {
    it('should allow QUEUED → EXECUTING', () => {
      expect(isLegalTransition(ExecutionStatus.QUEUED, ExecutionStatus.EXECUTING)).toBe(true);
    });

    it('should allow QUEUED → CANCELLED', () => {
      expect(isLegalTransition(ExecutionStatus.QUEUED, ExecutionStatus.CANCELLED)).toBe(true);
    });

    it('should reject QUEUED → EXECUTED_SUCCESS', () => {
      expect(isLegalTransition(ExecutionStatus.QUEUED, ExecutionStatus.EXECUTED_SUCCESS)).toBe(false);
    });
  });

  describe('EXECUTING transitions', () => {
    it('should allow EXECUTING → EXECUTED_SUCCESS', () => {
      expect(isLegalTransition(ExecutionStatus.EXECUTING, ExecutionStatus.EXECUTED_SUCCESS)).toBe(true);
    });

    it('should allow EXECUTING → EXECUTED_FAILED', () => {
      expect(isLegalTransition(ExecutionStatus.EXECUTING, ExecutionStatus.EXECUTED_FAILED)).toBe(true);
    });

    it('should allow EXECUTING → TIMED_OUT', () => {
      expect(isLegalTransition(ExecutionStatus.EXECUTING, ExecutionStatus.TIMED_OUT)).toBe(true);
    });

    it('should allow EXECUTING → CANCELLED', () => {
      expect(isLegalTransition(ExecutionStatus.EXECUTING, ExecutionStatus.CANCELLED)).toBe(true);
    });

    it('should reject EXECUTING → PENDING', () => {
      expect(isLegalTransition(ExecutionStatus.EXECUTING, ExecutionStatus.PENDING)).toBe(false);
    });

    it('should reject EXECUTING → QUEUED', () => {
      expect(isLegalTransition(ExecutionStatus.EXECUTING, ExecutionStatus.QUEUED)).toBe(false);
    });
  });

  describe('Terminal state immutability', () => {
    it('should reject all transitions from EXECUTED_SUCCESS', () => {
      expect(getAllowedNextStates(ExecutionStatus.EXECUTED_SUCCESS)).toEqual([]);
      expect(isLegalTransition(ExecutionStatus.EXECUTED_SUCCESS, ExecutionStatus.PENDING)).toBe(false);
      expect(isLegalTransition(ExecutionStatus.EXECUTED_SUCCESS, ExecutionStatus.EXECUTING)).toBe(false);
    });

    it('should reject all transitions from EXECUTED_FAILED', () => {
      expect(getAllowedNextStates(ExecutionStatus.EXECUTED_FAILED)).toEqual([]);
      expect(isLegalTransition(ExecutionStatus.EXECUTED_FAILED, ExecutionStatus.PENDING)).toBe(false);
    });

    it('should reject all transitions from TIMED_OUT', () => {
      expect(getAllowedNextStates(ExecutionStatus.TIMED_OUT)).toEqual([]);
      expect(isLegalTransition(ExecutionStatus.TIMED_OUT, ExecutionStatus.EXECUTING)).toBe(false);
    });

    it('should reject all transitions from CANCELLED', () => {
      expect(getAllowedNextStates(ExecutionStatus.CANCELLED)).toEqual([]);
      expect(isLegalTransition(ExecutionStatus.CANCELLED, ExecutionStatus.QUEUED)).toBe(false);
    });
  });
});

describe('getAllowedNextStates', () => {
  it('should return correct allowed states for PENDING', () => {
    const allowed = getAllowedNextStates(ExecutionStatus.PENDING);
    expect(allowed).toEqual([ExecutionStatus.QUEUED, ExecutionStatus.CANCELLED]);
  });

  it('should return correct allowed states for QUEUED', () => {
    const allowed = getAllowedNextStates(ExecutionStatus.QUEUED);
    expect(allowed).toEqual([ExecutionStatus.EXECUTING, ExecutionStatus.CANCELLED]);
  });

  it('should return correct allowed states for EXECUTING', () => {
    const allowed = getAllowedNextStates(ExecutionStatus.EXECUTING);
    expect(allowed).toEqual([
      ExecutionStatus.EXECUTED_SUCCESS,
      ExecutionStatus.EXECUTED_FAILED,
      ExecutionStatus.TIMED_OUT,
      ExecutionStatus.CANCELLED,
    ]);
  });

  it('should return empty array for terminal states', () => {
    expect(getAllowedNextStates(ExecutionStatus.EXECUTED_SUCCESS)).toEqual([]);
    expect(getAllowedNextStates(ExecutionStatus.EXECUTED_FAILED)).toEqual([]);
    expect(getAllowedNextStates(ExecutionStatus.TIMED_OUT)).toEqual([]);
    expect(getAllowedNextStates(ExecutionStatus.CANCELLED)).toEqual([]);
  });
});

describe('IllegalTransitionError', () => {
  it('should create error with correct message', () => {
    const error = new IllegalTransitionError(
      ExecutionStatus.EXECUTED_SUCCESS,
      ExecutionStatus.PENDING,
      'exec-123'
    );

    expect(error.message).toBe(
      'Illegal state transition: EXECUTED_SUCCESS → PENDING (execution: exec-123)'
    );
    expect(error.name).toBe('IllegalTransitionError');
    expect(error.fromStatus).toBe(ExecutionStatus.EXECUTED_SUCCESS);
    expect(error.toStatus).toBe(ExecutionStatus.PENDING);
    expect(error.executionId).toBe('exec-123');
  });

  it('should create error without executionId', () => {
    const error = new IllegalTransitionError(
      ExecutionStatus.PENDING,
      ExecutionStatus.EXECUTED_SUCCESS
    );

    expect(error.message).toBe(
      'Illegal state transition: PENDING → EXECUTED_SUCCESS'
    );
    expect(error.executionId).toBeNull();
  });
});

describe('validateReconciliationPayload', () => {
  it('should validate complete payload', () => {
    const payload = {
      executionId: 'exec-123',
      status: ExecutionStatus.EXECUTING,
      version: 3,
      updatedAt: new Date().toISOString(),
      correlationId: 'corr-456',
      isTerminal: false,
    };

    expect(() => validateReconciliationPayload(payload)).not.toThrow();
  });

  it('should reject payload missing executionId', () => {
    const payload = {
      status: ExecutionStatus.EXECUTING,
      version: 3,
      updatedAt: new Date().toISOString(),
      correlationId: 'corr-456',
      isTerminal: false,
    };

    expect(() => validateReconciliationPayload(payload)).toThrow(
      'ReconciliationPayload missing required field: executionId'
    );
  });

  it('should reject payload with invalid status', () => {
    const payload = {
      executionId: 'exec-123',
      status: 'INVALID_STATUS',
      version: 3,
      updatedAt: new Date().toISOString(),
      correlationId: 'corr-456',
      isTerminal: false,
    };

    expect(() => validateReconciliationPayload(payload)).toThrow(
      'ReconciliationPayload has invalid status: INVALID_STATUS'
    );
  });
});

describe('createReconciliationPayload', () => {
  it('should create valid payload from execution', () => {
    const execution = {
      id: 'exec-789',
      status: ExecutionStatus.EXECUTING,
      version: 5,
      updatedAt: new Date('2026-05-20T10:00:00Z'),
      correlationId: 'corr-789',
      activeStep: 'step-2',
      retryMetadata: {
        attempt: 2,
        maxAttempts: 3,
        nextRetryAt: '2026-05-20T10:05:00Z',
      },
    };

    const payload = createReconciliationPayload(execution);

    expect(payload.executionId).toBe('exec-789');
    expect(payload.status).toBe(ExecutionStatus.EXECUTING);
    expect(payload.version).toBe(5);
    expect(payload.updatedAt).toBe('2026-05-20T10:00:00.000Z');
    expect(payload.correlationId).toBe('corr-789');
    expect(payload.activeStep).toBe('step-2');
    expect(payload.retryMetadata).toEqual({
      attempt: 2,
      maxAttempts: 3,
      nextRetryAt: '2026-05-20T10:05:00Z',
    });
    expect(payload.isTerminal).toBe(false);
  });

  it('should handle missing optional fields', () => {
    const execution = {
      id: 'exec-999',
      status: ExecutionStatus.EXECUTED_SUCCESS,
      updatedAt: new Date('2026-05-20T11:00:00Z'),
    };

    const payload = createReconciliationPayload(execution);

    expect(payload.executionId).toBe('exec-999');
    expect(payload.status).toBe(ExecutionStatus.EXECUTED_SUCCESS);
    expect(payload.version).toBe(0); // Default
    expect(payload.correlationId).toBe('exec-999'); // Fallback to id
    expect(payload.activeStep).toBeNull();
    expect(payload.retryMetadata).toBeNull();
    expect(payload.isTerminal).toBe(true);
  });
});
