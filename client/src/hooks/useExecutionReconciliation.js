// ============================================================
// MARCOM / Lumi — Execution Reconciliation Hook
// Phase 11B Task 6: Frontend reconciliation with backend authority
// ============================================================
// Architecture Gate Decision 1: Backend reconciliation = single source of truth.
//
// CRITICAL LAWS:
// 1. sessionStorage = optimization cache ONLY (not authority)
// 2. Backend reconciliation payload ALWAYS wins (authority replacement, not merge)
// 3. Stale event filtering: if (incoming.version < local.version) DROP EVENT
// 4. SSE = best effort transport, Reconciliation API = recovery authority
//
// Reconciliation Flow:
//   SSE connected → receive event → compare versions → apply if incoming.version >= local
//   → persist snapshot (optimization only)
//
//   SSE disconnect / refresh / visibility restore → GET /api/execute/:id/active
//   → replace local state completely → resume SSE only if canResume === true
//
// Usage:
//   const { executionState, startExecution, reconcile } = useExecutionReconciliation({
//     onStateChange: (state) => { ... },
//     onError: (error) => { ... },
//   });
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api.js';
import { connectExecutionStream } from '@/lib/events.js';

const SESSION_KEY_PREFIX = 'lumi:execution:';
const RECONCILIATION_DEBOUNCE_MS = 500;

/**
 * Execution Reconciliation Hook
 *
 * Manages execution state with SSE streaming + backend reconciliation.
 * Enforces version-based causally consistent updates.
 *
 * @param {object} options
 * @param {Function} options.onStateChange - Callback when execution state changes
 * @param {Function} options.onError - Callback when errors occur
 * @param {Function} options.getFirebaseToken - Function returning Firebase ID token
 * @returns {object} { executionState, startExecution, reconcile, disconnect }
 */
export function useExecutionReconciliation({ onStateChange, onError, getFirebaseToken }) {
  const [executionState, setExecutionState] = useState(null);
  const disconnectSSERef = useRef(null);
  const reconciliationTimerRef = useRef(null);
  const currentExecutionIdRef = useRef(null);
  const currentVersionRef = useRef(0); // Track current version for stale detection

  /**
   * Reconcile Execution State
   *
   * Calls GET /api/execute/:id/active to fetch authoritative backend state.
   * This is the recovery mechanism after:
   * - SSE disconnect
   * - Page reload
   * - Tab visibility restore
   * - Race conflict
   * - Timeout transition
   *
   * IMPORTANT: Backend payload ALWAYS wins (authority replacement, not merge).
   *
   * @param {string} executionId - Execution request ID
   * @param {string} reason - Reconciliation reason (sse_disconnect, page_reload, visibility_restore)
   */
  const reconcile = useCallback(async (executionId, reason = 'manual') => {
    if (!executionId) {
      console.warn('[ExecutionReconciliation] Cannot reconcile: no executionId');
      return;
    }

    console.log(`[ExecutionReconciliation] Starting reconciliation (reason: ${reason})`, {
      executionId,
      reason,
    });

    // Emit telemetry event
    emitTelemetry('execution_reconciliation_started', {
      executionId,
      reason,
      timestamp: new Date().toISOString(),
    });

    try {
      // Call backend reconciliation endpoint
      const { data } = await api.get(`/api/execute/${executionId}/active`);

      console.log('[ExecutionReconciliation] Reconciliation successful', {
        executionId,
        status: data.status,
        version: data.version,
        isTerminal: data.isTerminal,
        canResume: data.canResume,
        isStale: data.isStale,
      });

      // CRITICAL: Replace state completely (authority replacement, NOT merge)
      const newState = {
        executionId: data.executionId,
        status: data.status,
        version: data.version,
        isTerminal: data.isTerminal,
        canResume: data.canResume,
        isStale: data.isStale,
        activeStep: data.activeStep,
        response: data.response,
        retryMetadata: data.retryMetadata,
        updatedAt: data.updatedAt,
        lastTransitionAt: data.lastTransitionAt,
        serverNow: data.serverNow,
        correlationId: data.correlationId,
      };

      setExecutionState(newState);
      currentVersionRef.current = newState.version; // Update version ref

      // Persist to sessionStorage (optimization only)
      persistExecutionSnapshot(executionId, newState);

      // Emit telemetry event
      emitTelemetry('execution_reconciliation_succeeded', {
        executionId,
        reason,
        status: data.status,
        version: data.version,
        isTerminal: data.isTerminal,
        timestamp: new Date().toISOString(),
      });

      // Notify parent component
      if (onStateChange) {
        onStateChange(newState);
      }

      // Resume SSE only if canResume === true
      if (data.canResume && !disconnectSSERef.current) {
        console.log('[ExecutionReconciliation] Resuming SSE (canResume=true)');
        connectSSE(executionId);
      } else if (!data.canResume && disconnectSSERef.current) {
        console.log('[ExecutionReconciliation] Stopping SSE (canResume=false)');
        disconnectSSERef.current();
        disconnectSSERef.current = null;
      }

      return newState;
    } catch (err) {
      console.error('[ExecutionReconciliation] Reconciliation failed', {
        executionId,
        reason,
        error: err.message,
      });

      // Emit telemetry event
      emitTelemetry('execution_reconciliation_failed', {
        executionId,
        reason,
        error: err.message,
        timestamp: new Date().toISOString(),
      });

      if (onError) {
        onError({
          message: err.response?.data?.error || err.message || 'Reconciliation failed',
          code: err.response?.data?.code || 'RECONCILIATION_ERROR',
          executionId,
          reason,
        });
      }

      throw err;
    }
  // connectSSE is defined later in the hook; adding it to deps would create a
  // circular dependency chain. The ref-based SSE connection is stable in practice.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onStateChange, onError]);

  /**
   * Handle SSE Execution Update
   *
   * Applies stale-event filtering: if (incoming.version < local.version) DROP EVENT.
   * This prevents delayed SSE packets from becoming "temporal grenades" 💣⏱️.
   *
   * @param {object} event - SSE event from connectExecutionStream
   */
  const handleExecutionUpdate = useCallback((event) => {
    const { status, targetId, timestamp, version } = event;

    console.log('[ExecutionReconciliation] SSE event received', {
      status,
      targetId,
      timestamp,
      version,
    });

    // CRITICAL STALE-EVENT LAW:
    // If incoming.version < local.version → DROP EVENT
    // Use ref for version tracking to avoid closure issues
    if (version != null && version < currentVersionRef.current) {
      console.warn('[ExecutionReconciliation] Dropping stale SSE event', {
        incomingVersion: version,
        localVersion: currentVersionRef.current,
        status,
      });

      // Emit telemetry event
      emitTelemetry('execution_stale_event_dropped', {
        executionId: targetId,
        incomingVersion: version,
        localVersion: currentVersionRef.current,
        status,
        timestamp: new Date().toISOString(),
      });

      return; // DROP EVENT
    }

    // Apply update (incoming.version >= local.version)
    setExecutionState((prevState) => {
      const updatedState = {
        ...prevState,
        status,
        version: version ?? (prevState?.version ?? 0) + 1,
        updatedAt: timestamp,
        lastTransitionAt: timestamp,
        isTerminal: isTerminalStatus(status),
      };

      // Update version ref
      currentVersionRef.current = updatedState.version;

      // Persist snapshot (optimization only)
      if (targetId) {
        persistExecutionSnapshot(targetId, updatedState);
      }

      // Notify parent component
      if (onStateChange) {
        onStateChange(updatedState);
      }

      // If terminal state reached, stop SSE
      if (isTerminalStatus(status)) {
        console.log('[ExecutionReconciliation] Terminal state reached, disconnecting SSE', {
          status,
        });
        if (disconnectSSERef.current) {
          disconnectSSERef.current();
          disconnectSSERef.current = null;
        }
      }

      return updatedState;
    });
  }, [onStateChange]);

  /**
   * Connect SSE for Execution Updates
   *
   * Establishes SSE connection with automatic reconnection.
   * On disconnect, triggers reconciliation after debounce delay.
   *
   * @param {string} executionId - Execution request ID
   */
  const connectSSE = useCallback((executionId) => {
    // Disconnect existing SSE if any
    if (disconnectSSERef.current) {
      disconnectSSERef.current();
      disconnectSSERef.current = null;
    }

    console.log('[ExecutionReconciliation] Connecting SSE', { executionId });

    disconnectSSERef.current = connectExecutionStream(getFirebaseToken, {
      onExecutionUpdate: handleExecutionUpdate,
      onError: (err) => {
        console.error('[ExecutionReconciliation] SSE error', err);

        // On SSE disconnect/error, trigger reconciliation after debounce
        if (reconciliationTimerRef.current) {
          clearTimeout(reconciliationTimerRef.current);
        }

        reconciliationTimerRef.current = setTimeout(() => {
          console.log('[ExecutionReconciliation] SSE disconnect detected, triggering reconciliation');
          reconcile(executionId, 'sse_disconnect').catch((reconcileErr) => {
            console.error('[ExecutionReconciliation] Reconciliation after SSE error failed', reconcileErr);
          });
        }, RECONCILIATION_DEBOUNCE_MS);

        if (onError) {
          onError(err);
        }
      },
      onConnected: () => {
        console.log('[ExecutionReconciliation] SSE connected');
        // Clear any pending reconciliation timer
        if (reconciliationTimerRef.current) {
          clearTimeout(reconciliationTimerRef.current);
          reconciliationTimerRef.current = null;
        }
      },
    });
  }, [getFirebaseToken, handleExecutionUpdate, reconcile, onError]);

  /**
   * Start Execution Tracking
   *
   * Initializes execution state and starts SSE connection.
   *
   * @param {string} executionId - Execution request ID
   */
  const startExecution = useCallback((executionId) => {
    if (!executionId) {
      console.warn('[ExecutionReconciliation] Cannot start execution: no executionId');
      return;
    }

    console.log('[ExecutionReconciliation] Starting execution tracking', { executionId });

    currentExecutionIdRef.current = executionId;

    // Try to restore from sessionStorage (optimization only)
    const cached = loadExecutionSnapshot(executionId);
    if (cached) {
      console.log('[ExecutionReconciliation] Restored execution from cache', {
        executionId,
        status: cached.status,
        version: cached.version,
      });
      setExecutionState(cached);
      currentVersionRef.current = cached.version; // Update version ref
      if (onStateChange) {
        onStateChange(cached);
      }
    } else {
      // Initialize with PENDING state
      const initialState = {
        executionId,
        status: 'PENDING',
        version: 0,
        isTerminal: false,
        canResume: true,
        isStale: false,
        activeStep: null,
        response: null,
        retryMetadata: null,
        updatedAt: new Date().toISOString(),
        lastTransitionAt: new Date().toISOString(),
        correlationId: executionId,
      };
      setExecutionState(initialState);
      currentVersionRef.current = 0; // Initialize version ref
      if (onStateChange) {
        onStateChange(initialState);
      }
    }

    // Connect SSE
    connectSSE(executionId);

    // Emit telemetry event
    emitTelemetry('execution_resume_attempted', {
      executionId,
      hasCachedState: !!cached,
      timestamp: new Date().toISOString(),
    });
  }, [connectSSE, onStateChange]);

  /**
   * Disconnect SSE and cleanup
   */
  const disconnect = useCallback(() => {
    console.log('[ExecutionReconciliation] Disconnecting');
    if (disconnectSSERef.current) {
      disconnectSSERef.current();
      disconnectSSERef.current = null;
    }
    if (reconciliationTimerRef.current) {
      clearTimeout(reconciliationTimerRef.current);
      reconciliationTimerRef.current = null;
    }
    currentExecutionIdRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // Page visibility reconciliation
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && currentExecutionIdRef.current) {
        console.log('[ExecutionReconciliation] Page visible, triggering reconciliation');
        reconcile(currentExecutionIdRef.current, 'visibility_restore').catch((err) => {
          console.error('[ExecutionReconciliation] Visibility reconciliation failed', err);
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [reconcile]);

  return {
    executionState,
    startExecution,
    reconcile,
    disconnect,
  };
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Check if status is terminal
 */
function isTerminalStatus(status) {
  const TERMINAL_STATES = [
    'EXECUTED_SUCCESS',
    'EXECUTED_FAILED',
    'TIMED_OUT',
    'CANCELLED',
  ];
  return TERMINAL_STATES.includes(status);
}

/**
 * Persist execution snapshot to sessionStorage (optimization only)
 */
function persistExecutionSnapshot(executionId, state) {
  try {
    const key = `${SESSION_KEY_PREFIX}${executionId}`;
    sessionStorage.setItem(key, JSON.stringify(state));
  } catch (err) {
    console.warn('[ExecutionReconciliation] Failed to persist snapshot', err);
  }
}

/**
 * Load execution snapshot from sessionStorage (optimization only)
 */
function loadExecutionSnapshot(executionId) {
  try {
    const key = `${SESSION_KEY_PREFIX}${executionId}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[ExecutionReconciliation] Failed to load snapshot', err);
    return null;
  }
}

/**
 * Emit telemetry event (lightweight logging)
 */
function emitTelemetry(eventType, data) {
  console.debug(`[Telemetry] ${eventType}`, data);
  // Future: Send to telemetry sink (OpenTelemetry, Sentry, etc.)
}
