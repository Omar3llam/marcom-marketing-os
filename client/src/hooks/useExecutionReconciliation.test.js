// ============================================================
// useExecutionReconciliation Tests
// Phase 11B Task 6: Frontend reconciliation validation
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useExecutionReconciliation } from './useExecutionReconciliation.js';

// Mock dependencies
vi.mock('@/lib/api.js', () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock('@/lib/events.js', () => ({
  connectExecutionStream: vi.fn(),
}));

import { api } from '@/lib/api.js';
import { connectExecutionStream } from '@/lib/events.js';

describe('useExecutionReconciliation', () => {
  let mockOnStateChange;
  let mockOnError;
  let mockGetFirebaseToken;
  let mockSSEDisconnect;
  let mockSSEHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();

    mockOnStateChange = vi.fn();
    mockOnError = vi.fn();
    mockGetFirebaseToken = vi.fn().mockResolvedValue('mock-firebase-token');
    mockSSEDisconnect = vi.fn();

    // Mock connectExecutionStream to capture handlers
    connectExecutionStream.mockImplementation((getToken, handlers) => {
      mockSSEHandlers = handlers;
      return mockSSEDisconnect;
    });
  });

  describe('reconcile()', () => {
    it('should fetch backend state and replace local state completely', async () => {
      const executionId = 'exec-123';
      const backendState = {
        executionId,
        status: 'EXECUTING',
        version: 5,
        isTerminal: false,
        canResume: true,
        isStale: false,
        activeStep: 'GENERATE_STRATEGY',
        response: null,
        retryMetadata: null,
        updatedAt: '2026-05-20T10:00:00.000Z',
        lastTransitionAt: '2026-05-20T10:00:00.000Z',
        serverNow: '2026-05-20T10:01:00.000Z',
        correlationId: 'corr-123',
      };

      api.get.mockResolvedValue({ data: backendState });

      const { result } = renderHook(() =>
        useExecutionReconciliation({
          onStateChange: mockOnStateChange,
          onError: mockOnError,
          getFirebaseToken: mockGetFirebaseToken,
        })
      );

      await act(async () => {
        await result.current.reconcile(executionId, 'page_reload');
      });

      expect(api.get).toHaveBeenCalledWith(`/api/execute/${executionId}/active`);
      expect(result.current.executionState).toEqual(backendState);
      expect(mockOnStateChange).toHaveBeenCalledWith(backendState);
    });

    it('should resume SSE if canResume=true', async () => {
      const executionId = 'exec-456';
      const backendState = {
        executionId,
        status: 'EXECUTING',
        version: 3,
        isTerminal: false,
        canResume: true, // Should resume SSE
        isStale: false,
        activeStep: null,
        response: null,
        retryMetadata: null,
        updatedAt: '2026-05-20T10:00:00.000Z',
        lastTransitionAt: '2026-05-20T10:00:00.000Z',
        serverNow: '2026-05-20T10:01:00.000Z',
        correlationId: 'corr-456',
      };

      api.get.mockResolvedValue({ data: backendState });

      const { result } = renderHook(() =>
        useExecutionReconciliation({
          onStateChange: mockOnStateChange,
          onError: mockOnError,
          getFirebaseToken: mockGetFirebaseToken,
        })
      );

      await act(async () => {
        await result.current.reconcile(executionId, 'sse_disconnect');
      });

      expect(connectExecutionStream).toHaveBeenCalled();
    });

    it('should NOT resume SSE if canResume=false', async () => {
      const executionId = 'exec-stale';
      const backendState = {
        executionId,
        status: 'EXECUTING',
        version: 2,
        isTerminal: false,
        canResume: false, // Should NOT resume SSE
        isStale: true,
        activeStep: null,
        response: null,
        retryMetadata: null,
        updatedAt: '2026-05-20T08:00:00.000Z',
        lastTransitionAt: '2026-05-20T08:00:00.000Z',
        serverNow: '2026-05-20T10:00:00.000Z',
        correlationId: 'corr-stale',
      };

      api.get.mockResolvedValue({ data: backendState });

      const { result } = renderHook(() =>
        useExecutionReconciliation({
          onStateChange: mockOnStateChange,
          onError: mockOnError,
          getFirebaseToken: mockGetFirebaseToken,
        })
      );

      // Start execution first (establishes SSE)
      act(() => {
        result.current.startExecution(executionId);
      });

      const initialSSECalls = connectExecutionStream.mock.calls.length;

      await act(async () => {
        await result.current.reconcile(executionId, 'manual');
      });

      // Should disconnect existing SSE
      expect(mockSSEDisconnect).toHaveBeenCalled();
      // Should NOT create new SSE connection (canResume=false)
      expect(connectExecutionStream).toHaveBeenCalledTimes(initialSSECalls);
    });

    it('should call onError if reconciliation fails', async () => {
      const executionId = 'exec-error';
      const error = new Error('Reconciliation failed');
      error.response = {
        data: { error: 'Execution not found', code: 'NOT_FOUND' },
      };

      api.get.mockRejectedValue(error);

      const { result } = renderHook(() =>
        useExecutionReconciliation({
          onStateChange: mockOnStateChange,
          onError: mockOnError,
          getFirebaseToken: mockGetFirebaseToken,
        })
      );

      await act(async () => {
        try {
          await result.current.reconcile(executionId, 'manual');
        } catch {}
      });

      expect(mockOnError).toHaveBeenCalledWith({
        message: 'Execution not found',
        code: 'NOT_FOUND',
        executionId,
        reason: 'manual',
      });
    });

    it('should persist state to sessionStorage (optimization only)', async () => {
      const executionId = 'exec-cache';
      const backendState = {
        executionId,
        status: 'QUEUED',
        version: 1,
        isTerminal: false,
        canResume: true,
        isStale: false,
        activeStep: null,
        response: null,
        retryMetadata: null,
        updatedAt: '2026-05-20T10:00:00.000Z',
        lastTransitionAt: '2026-05-20T10:00:00.000Z',
        serverNow: '2026-05-20T10:00:30.000Z',
        correlationId: 'corr-cache',
      };

      api.get.mockResolvedValue({ data: backendState });

      const { result } = renderHook(() =>
        useExecutionReconciliation({
          onStateChange: mockOnStateChange,
          onError: mockOnError,
          getFirebaseToken: mockGetFirebaseToken,
        })
      );

      await act(async () => {
        await result.current.reconcile(executionId, 'manual');
      });

      // Verify sessionStorage persistence
      const cachedRaw = sessionStorage.getItem(`lumi:execution:${executionId}`);
      expect(cachedRaw).toBeTruthy();
      const cached = JSON.parse(cachedRaw);
      expect(cached.status).toBe('QUEUED');
      expect(cached.version).toBe(1);
    });
  });

  describe('SSE event handling', () => {
    it('should apply SSE event if incoming.version >= local.version', async () => {
      const executionId = 'exec-sse-123';

      const { result } = renderHook(() =>
        useExecutionReconciliation({
          onStateChange: mockOnStateChange,
          onError: mockOnError,
          getFirebaseToken: mockGetFirebaseToken,
        })
      );

      // Start execution (version 0)
      act(() => {
        result.current.startExecution(executionId);
      });

      // Simulate SSE event with higher version
      act(() => {
        mockSSEHandlers.onExecutionUpdate({
          type: 'EXECUTION_STATUS',
          status: 'EXECUTING',
          targetId: executionId,
          timestamp: '2026-05-20T10:00:00.000Z',
          version: 1,
        });
      });

      expect(result.current.executionState.status).toBe('EXECUTING');
      expect(result.current.executionState.version).toBe(1);
    });

    it('should DROP SSE event if incoming.version < local.version (stale event)', async () => {
      const executionId = 'exec-stale-event';

      const { result } = renderHook(() =>
        useExecutionReconciliation({
          onStateChange: mockOnStateChange,
          onError: mockOnError,
          getFirebaseToken: mockGetFirebaseToken,
        })
      );

      // Start execution
      act(() => {
        result.current.startExecution(executionId);
      });

      // Simulate SSE event with version 5
      act(() => {
        mockSSEHandlers.onExecutionUpdate({
          type: 'EXECUTION_STATUS',
          status: 'EXECUTING',
          targetId: executionId,
          timestamp: '2026-05-20T10:00:00.000Z',
          version: 5,
        });
      });

      expect(result.current.executionState.version).toBe(5);

      // Simulate STALE SSE event with version 3 (< 5)
      const beforeUpdate = result.current.executionState;
      act(() => {
        mockSSEHandlers.onExecutionUpdate({
          type: 'EXECUTION_STATUS',
          status: 'QUEUED', // Outdated status
          targetId: executionId,
          timestamp: '2026-05-20T09:00:00.000Z',
          version: 3, // STALE (3 < 5)
        });
      });

      // State should NOT change (stale event dropped)
      expect(result.current.executionState).toBe(beforeUpdate);
      expect(result.current.executionState.version).toBe(5);
      expect(result.current.executionState.status).toBe('EXECUTING');
    });

    it('should disconnect SSE when terminal state is reached', async () => {
      const executionId = 'exec-terminal-sse';

      const { result } = renderHook(() =>
        useExecutionReconciliation({
          onStateChange: mockOnStateChange,
          onError: mockOnError,
          getFirebaseToken: mockGetFirebaseToken,
        })
      );

      act(() => {
        result.current.startExecution(executionId);
      });

      // Simulate terminal SSE event
      act(() => {
        mockSSEHandlers.onExecutionUpdate({
          type: 'EXECUTION_STATUS',
          status: 'EXECUTED_SUCCESS',
          targetId: executionId,
          timestamp: '2026-05-20T10:00:00.000Z',
          version: 10,
        });
      });

      expect(result.current.executionState.status).toBe('EXECUTED_SUCCESS');
      expect(result.current.executionState.isTerminal).toBe(true);
      expect(mockSSEDisconnect).toHaveBeenCalled();
    });
  });

  describe('startExecution()', () => {
    it('should initialize execution and connect SSE', () => {
      const executionId = 'exec-start-123';

      const { result } = renderHook(() =>
        useExecutionReconciliation({
          onStateChange: mockOnStateChange,
          onError: mockOnError,
          getFirebaseToken: mockGetFirebaseToken,
        })
      );

      act(() => {
        result.current.startExecution(executionId);
      });

      expect(result.current.executionState).toBeTruthy();
      expect(result.current.executionState.executionId).toBe(executionId);
      expect(result.current.executionState.status).toBe('PENDING');
      expect(connectExecutionStream).toHaveBeenCalled();
      expect(mockOnStateChange).toHaveBeenCalled();
    });

    it('should restore from sessionStorage if cached', () => {
      const executionId = 'exec-cached';
      const cachedState = {
        executionId,
        status: 'EXECUTING',
        version: 3,
        isTerminal: false,
        canResume: true,
        isStale: false,
      };

      sessionStorage.setItem(
        `lumi:execution:${executionId}`,
        JSON.stringify(cachedState)
      );

      const { result } = renderHook(() =>
        useExecutionReconciliation({
          onStateChange: mockOnStateChange,
          onError: mockOnError,
          getFirebaseToken: mockGetFirebaseToken,
        })
      );

      act(() => {
        result.current.startExecution(executionId);
      });

      expect(result.current.executionState.status).toBe('EXECUTING');
      expect(result.current.executionState.version).toBe(3);
    });
  });

  describe('disconnect()', () => {
    it('should disconnect SSE and cleanup', () => {
      const executionId = 'exec-disconnect';

      const { result } = renderHook(() =>
        useExecutionReconciliation({
          onStateChange: mockOnStateChange,
          onError: mockOnError,
          getFirebaseToken: mockGetFirebaseToken,
        })
      );

      act(() => {
        result.current.startExecution(executionId);
      });

      act(() => {
        result.current.disconnect();
      });

      expect(mockSSEDisconnect).toHaveBeenCalled();
    });
  });
});
