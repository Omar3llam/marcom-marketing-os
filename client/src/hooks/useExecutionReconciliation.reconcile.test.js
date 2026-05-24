import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExecutionReconciliation } from './useExecutionReconciliation.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('@/lib/events.js', () => ({ connectExecutionStream: vi.fn() }));

import { api } from '@/lib/api.js';
import { connectExecutionStream } from '@/lib/events.js';

describe('useExecutionReconciliation — reconcile()', () => {
  let mockOnStateChange;
  let mockOnError;
  let mockGetFirebaseToken;
  let mockSSEDisconnect;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockOnStateChange = vi.fn();
    mockOnError = vi.fn();
    mockGetFirebaseToken = vi.fn().mockResolvedValue('mock-firebase-token');
    mockSSEDisconnect = vi.fn();
    connectExecutionStream.mockImplementation((getToken, handlers) => {
      return mockSSEDisconnect;
    });
  });

  it('should fetch backend state and replace local state completely', async () => {
    const executionId = 'exec-123';
    const backendState = { executionId, status: 'EXECUTING', version: 5, isTerminal: false, canResume: true, isStale: false, activeStep: 'GENERATE_STRATEGY', response: null, retryMetadata: null, updatedAt: '2026-05-20T10:00:00.000Z', lastTransitionAt: '2026-05-20T10:00:00.000Z', serverNow: '2026-05-20T10:01:00.000Z', correlationId: 'corr-123' };
    api.get.mockResolvedValue({ data: backendState });

    const { result } = renderHook(() => useExecutionReconciliation({ onStateChange: mockOnStateChange, onError: mockOnError, getFirebaseToken: mockGetFirebaseToken }));

    await act(async () => { await result.current.reconcile(executionId, 'page_reload'); });

    expect(api.get).toHaveBeenCalledWith(`/api/execute/${executionId}/active`);
    expect(result.current.executionState).toEqual(backendState);
    expect(mockOnStateChange).toHaveBeenCalledWith(backendState);
  });

  it('should resume SSE if canResume=true', async () => {
    const executionId = 'exec-456';
    const backendState = { executionId, status: 'EXECUTING', version: 3, isTerminal: false, canResume: true, isStale: false, activeStep: null, response: null, retryMetadata: null, updatedAt: '2026-05-20T10:00:00.000Z', lastTransitionAt: '2026-05-20T10:00:00.000Z', serverNow: '2026-05-20T10:01:00.000Z', correlationId: 'corr-456' };
    api.get.mockResolvedValue({ data: backendState });

    const { result } = renderHook(() => useExecutionReconciliation({ onStateChange: mockOnStateChange, onError: mockOnError, getFirebaseToken: mockGetFirebaseToken }));

    await act(async () => { await result.current.reconcile(executionId, 'sse_disconnect'); });

    expect(connectExecutionStream).toHaveBeenCalled();
  });

  it('should NOT resume SSE if canResume=false', async () => {
    const executionId = 'exec-stale';
    const backendState = { executionId, status: 'EXECUTING', version: 2, isTerminal: false, canResume: false, isStale: true, activeStep: null, response: null, retryMetadata: null, updatedAt: '2026-05-20T08:00:00.000Z', lastTransitionAt: '2026-05-20T08:00:00.000Z', serverNow: '2026-05-20T10:00:00.000Z', correlationId: 'corr-stale' };
    api.get.mockResolvedValue({ data: backendState });

    const { result } = renderHook(() => useExecutionReconciliation({ onStateChange: mockOnStateChange, onError: mockOnError, getFirebaseToken: mockGetFirebaseToken }));

    act(() => { result.current.startExecution(executionId); });
    const initialSSECalls = connectExecutionStream.mock.calls.length;

    await act(async () => { await result.current.reconcile(executionId, 'manual'); });

    expect(mockSSEDisconnect).toHaveBeenCalled();
    expect(connectExecutionStream).toHaveBeenCalledTimes(initialSSECalls);
  });

  it('should call onError if reconciliation fails', async () => {
    const executionId = 'exec-error';
    const error = new Error('Reconciliation failed');
    error.response = { data: { error: 'Execution not found', code: 'NOT_FOUND' } };
    api.get.mockRejectedValue(error);

    const { result } = renderHook(() => useExecutionReconciliation({ onStateChange: mockOnStateChange, onError: mockOnError, getFirebaseToken: mockGetFirebaseToken }));

    await act(async () => { try { await result.current.reconcile(executionId, 'manual'); } catch {} });

    expect(mockOnError).toHaveBeenCalledWith({ message: 'Execution not found', code: 'NOT_FOUND', executionId, reason: 'manual' });
  });

  it('should persist state to sessionStorage (optimization only)', async () => {
    const executionId = 'exec-cache';
    const backendState = { executionId, status: 'QUEUED', version: 1, isTerminal: false, canResume: true, isStale: false, activeStep: null, response: null, retryMetadata: null, updatedAt: '2026-05-20T10:00:00.000Z', lastTransitionAt: '2026-05-20T10:00:00.000Z', serverNow: '2026-05-20T10:00:30.000Z', correlationId: 'corr-cache' };
    api.get.mockResolvedValue({ data: backendState });

    const { result } = renderHook(() => useExecutionReconciliation({ onStateChange: mockOnStateChange, onError: mockOnError, getFirebaseToken: mockGetFirebaseToken }));

    await act(async () => { await result.current.reconcile(executionId, 'manual'); });

    const cachedRaw = sessionStorage.getItem(`lumi:execution:${executionId}`);
    expect(cachedRaw).toBeTruthy();
    const cached = JSON.parse(cachedRaw);
    expect(cached.status).toBe('QUEUED');
    expect(cached.version).toBe(1);
  });
});
