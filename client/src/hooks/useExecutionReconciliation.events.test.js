import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExecutionReconciliation } from './useExecutionReconciliation.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('@/lib/events.js', () => ({ connectExecutionStream: vi.fn() }));

import { connectExecutionStream } from '@/lib/events.js';

describe('useExecutionReconciliation — SSE, startExecution, disconnect', () => {
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
    connectExecutionStream.mockImplementation((getToken, handlers) => {
      mockSSEHandlers = handlers;
      return mockSSEDisconnect;
    });
  });

  describe('SSE event handling', () => {
    it('should apply SSE event if incoming.version >= local.version', async () => {
      const executionId = 'exec-sse-123';
      const { result } = renderHook(() => useExecutionReconciliation({ onStateChange: mockOnStateChange, onError: mockOnError, getFirebaseToken: mockGetFirebaseToken }));

      act(() => { result.current.startExecution(executionId); });

      act(() => {
        mockSSEHandlers.onExecutionUpdate({ type: 'EXECUTION_STATUS', status: 'EXECUTING', targetId: executionId, timestamp: '2026-05-20T10:00:00.000Z', version: 1 });
      });

      expect(result.current.executionState.status).toBe('EXECUTING');
      expect(result.current.executionState.version).toBe(1);
    });

    it('should DROP SSE event if incoming.version < local.version (stale event)', async () => {
      const executionId = 'exec-stale-event';
      const { result } = renderHook(() => useExecutionReconciliation({ onStateChange: mockOnStateChange, onError: mockOnError, getFirebaseToken: mockGetFirebaseToken }));

      act(() => { result.current.startExecution(executionId); });

      act(() => {
        mockSSEHandlers.onExecutionUpdate({ type: 'EXECUTION_STATUS', status: 'EXECUTING', targetId: executionId, timestamp: '2026-05-20T10:00:00.000Z', version: 5 });
      });
      expect(result.current.executionState.version).toBe(5);

      const beforeUpdate = result.current.executionState;
      act(() => {
        mockSSEHandlers.onExecutionUpdate({ type: 'EXECUTION_STATUS', status: 'QUEUED', targetId: executionId, timestamp: '2026-05-20T09:00:00.000Z', version: 3 });
      });

      expect(result.current.executionState).toBe(beforeUpdate);
      expect(result.current.executionState.version).toBe(5);
      expect(result.current.executionState.status).toBe('EXECUTING');
    });

    it('should disconnect SSE when terminal state is reached', async () => {
      const executionId = 'exec-terminal-sse';
      const { result } = renderHook(() => useExecutionReconciliation({ onStateChange: mockOnStateChange, onError: mockOnError, getFirebaseToken: mockGetFirebaseToken }));

      act(() => { result.current.startExecution(executionId); });

      act(() => {
        mockSSEHandlers.onExecutionUpdate({ type: 'EXECUTION_STATUS', status: 'EXECUTED_SUCCESS', targetId: executionId, timestamp: '2026-05-20T10:00:00.000Z', version: 10 });
      });

      expect(result.current.executionState.status).toBe('EXECUTED_SUCCESS');
      expect(result.current.executionState.isTerminal).toBe(true);
      expect(mockSSEDisconnect).toHaveBeenCalled();
    });
  });

  describe('startExecution()', () => {
    it('should initialize execution and connect SSE', () => {
      const executionId = 'exec-start-123';
      const { result } = renderHook(() => useExecutionReconciliation({ onStateChange: mockOnStateChange, onError: mockOnError, getFirebaseToken: mockGetFirebaseToken }));

      act(() => { result.current.startExecution(executionId); });

      expect(result.current.executionState).toBeTruthy();
      expect(result.current.executionState.executionId).toBe(executionId);
      expect(result.current.executionState.status).toBe('PENDING');
      expect(connectExecutionStream).toHaveBeenCalled();
      expect(mockOnStateChange).toHaveBeenCalled();
    });

    it('should restore from sessionStorage if cached', () => {
      const executionId = 'exec-cached';
      const cachedState = { executionId, status: 'EXECUTING', version: 3, isTerminal: false, canResume: true, isStale: false };
      sessionStorage.setItem(`lumi:execution:${executionId}`, JSON.stringify(cachedState));

      const { result } = renderHook(() => useExecutionReconciliation({ onStateChange: mockOnStateChange, onError: mockOnError, getFirebaseToken: mockGetFirebaseToken }));

      act(() => { result.current.startExecution(executionId); });

      expect(result.current.executionState.status).toBe('EXECUTING');
      expect(result.current.executionState.version).toBe(3);
    });
  });

  describe('disconnect()', () => {
    it('should disconnect SSE and cleanup', () => {
      const executionId = 'exec-disconnect';
      const { result } = renderHook(() => useExecutionReconciliation({ onStateChange: mockOnStateChange, onError: mockOnError, getFirebaseToken: mockGetFirebaseToken }));

      act(() => { result.current.startExecution(executionId); });
      act(() => { result.current.disconnect(); });

      expect(mockSSEDisconnect).toHaveBeenCalled();
    });
  });
});
