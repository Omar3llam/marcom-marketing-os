import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api.js';
import { connectExecutionStream } from '@/lib/events.js';
import {
  RECONCILIATION_DEBOUNCE_MS,
  isTerminalStatus,
  persistExecutionSnapshot,
  loadExecutionSnapshot,
  emitTelemetry,
} from './helpers.js';

export function useExecutionReconciliation({ onStateChange, onError, getFirebaseToken }) {
  const [executionState, setExecutionState] = useState(null);
  const disconnectSSERef        = useRef(null);
  const reconciliationTimerRef  = useRef(null);
  const currentExecutionIdRef   = useRef(null);
  const currentVersionRef       = useRef(0);

  const reconcile = useCallback(async (executionId, reason = 'manual') => {
    if (!executionId) { console.warn('[ExecutionReconciliation] Cannot reconcile: no executionId'); return; }
    emitTelemetry('execution_reconciliation_started', { executionId, reason, timestamp: new Date().toISOString() });
    try {
      const { data } = await api.get(`/api/execute/${executionId}/active`);
      const newState = {
        executionId: data.executionId, status: data.status, version: data.version,
        isTerminal: data.isTerminal, canResume: data.canResume, isStale: data.isStale,
        activeStep: data.activeStep, response: data.response, retryMetadata: data.retryMetadata,
        updatedAt: data.updatedAt, lastTransitionAt: data.lastTransitionAt,
        serverNow: data.serverNow, correlationId: data.correlationId,
      };
      setExecutionState(newState);
      currentVersionRef.current = newState.version;
      persistExecutionSnapshot(executionId, newState);
      emitTelemetry('execution_reconciliation_succeeded', { executionId, reason, status: data.status, version: data.version, isTerminal: data.isTerminal, timestamp: new Date().toISOString() });
      if (onStateChange) onStateChange(newState);
      if (data.canResume && !disconnectSSERef.current) {
        connectSSE(executionId);
      } else if (!data.canResume && disconnectSSERef.current) {
        disconnectSSERef.current();
        disconnectSSERef.current = null;
      }
      return newState;
    } catch (err) {
      console.error('[ExecutionReconciliation] Reconciliation failed', { executionId, reason, error: err.message });
      emitTelemetry('execution_reconciliation_failed', { executionId, reason, error: err.message, timestamp: new Date().toISOString() });
      if (onError) onError({ message: err.response?.data?.error || err.message || 'Reconciliation failed', code: err.response?.data?.code || 'RECONCILIATION_ERROR', executionId, reason });
      throw err;
    }
  // connectSSE is defined later; adding it to deps would create a circular dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onStateChange, onError]);

  const handleExecutionUpdate = useCallback((event) => {
    const { status, targetId, timestamp, version } = event;
    if (version != null && version < currentVersionRef.current) {
      console.warn('[ExecutionReconciliation] Dropping stale SSE event', { incomingVersion: version, localVersion: currentVersionRef.current, status });
      emitTelemetry('execution_stale_event_dropped', { executionId: targetId, incomingVersion: version, localVersion: currentVersionRef.current, status, timestamp: new Date().toISOString() });
      return;
    }
    setExecutionState((prevState) => {
      const updatedState = { ...prevState, status, version: version ?? (prevState?.version ?? 0) + 1, updatedAt: timestamp, lastTransitionAt: timestamp, isTerminal: isTerminalStatus(status) };
      currentVersionRef.current = updatedState.version;
      if (targetId) persistExecutionSnapshot(targetId, updatedState);
      if (onStateChange) onStateChange(updatedState);
      if (isTerminalStatus(status)) {
        if (disconnectSSERef.current) { disconnectSSERef.current(); disconnectSSERef.current = null; }
      }
      return updatedState;
    });
  }, [onStateChange]);

  const connectSSE = useCallback((executionId) => {
    if (disconnectSSERef.current) { disconnectSSERef.current(); disconnectSSERef.current = null; }
    disconnectSSERef.current = connectExecutionStream(getFirebaseToken, {
      onExecutionUpdate: handleExecutionUpdate,
      onError: (err) => {
        console.error('[ExecutionReconciliation] SSE error', err);
        if (reconciliationTimerRef.current) clearTimeout(reconciliationTimerRef.current);
        reconciliationTimerRef.current = setTimeout(() => {
          reconcile(executionId, 'sse_disconnect').catch((reconcileErr) => {
            console.error('[ExecutionReconciliation] Reconciliation after SSE error failed', reconcileErr);
          });
        }, RECONCILIATION_DEBOUNCE_MS);
        if (onError) onError(err);
      },
      onConnected: () => {
        if (reconciliationTimerRef.current) { clearTimeout(reconciliationTimerRef.current); reconciliationTimerRef.current = null; }
      },
    });
  }, [getFirebaseToken, handleExecutionUpdate, reconcile, onError]);

  const startExecution = useCallback((executionId) => {
    if (!executionId) { console.warn('[ExecutionReconciliation] Cannot start execution: no executionId'); return; }
    currentExecutionIdRef.current = executionId;
    const cached = loadExecutionSnapshot(executionId);
    if (cached) {
      setExecutionState(cached);
      currentVersionRef.current = cached.version;
      if (onStateChange) onStateChange(cached);
    } else {
      const initialState = { executionId, status: 'PENDING', version: 0, isTerminal: false, canResume: true, isStale: false, activeStep: null, response: null, retryMetadata: null, updatedAt: new Date().toISOString(), lastTransitionAt: new Date().toISOString(), correlationId: executionId };
      setExecutionState(initialState);
      currentVersionRef.current = 0;
      if (onStateChange) onStateChange(initialState);
    }
    connectSSE(executionId);
    emitTelemetry('execution_resume_attempted', { executionId, hasCachedState: !!cached, timestamp: new Date().toISOString() });
  }, [connectSSE, onStateChange]);

  const disconnect = useCallback(() => {
    if (disconnectSSERef.current) { disconnectSSERef.current(); disconnectSSERef.current = null; }
    if (reconciliationTimerRef.current) { clearTimeout(reconciliationTimerRef.current); reconciliationTimerRef.current = null; }
    currentExecutionIdRef.current = null;
  }, []);

  useEffect(() => { return () => { disconnect(); }; }, [disconnect]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && currentExecutionIdRef.current) {
        reconcile(currentExecutionIdRef.current, 'visibility_restore').catch((err) => {
          console.error('[ExecutionReconciliation] Visibility reconciliation failed', err);
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => { document.removeEventListener('visibilitychange', handleVisibilityChange); };
  }, [reconcile]);

  return { executionState, startExecution, reconcile, disconnect };
}
