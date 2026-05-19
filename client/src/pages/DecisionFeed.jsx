// ============================================================
// MARCOM / Lumi — DecisionFeed v4.1 (Enterprise FSM Container)
// ------------------------------------------------------------
// Pure conditional renderer over the 7-state FSM:
//   COMMAND_CENTER → INPUT_VALIDATION → THEATER (Locked) →
//   SUCCESS → CONFIRM_EXECUTION → API_EXECUTION (Locked) →
//   MEMORY_COMMIT → COMMAND_CENTER
//
// Wires orchestrate hook callbacks into the reducer, loads
// persisted history + radar alerts on mount, and runs the API
// call when the FSM transitions to THEATER.
//
// STRICT GUARDRAILS:
// - DecisionFrame handles SUCCESS, CONFIRM_EXECUTION, API_EXECUTION
// - No direct execution (always through confirmation modal)
// - AbortController protection for all async operations
// - Toast notifications for execution success
// - Real-time SSE execution updates
// ============================================================
import { useEffect, useRef } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext.jsx';
import { useIntelligence } from '@/context/IntelligenceContext.jsx';
// Phase 11D: Use XState machine via compatibility adapter
import {
  useDecisionFSM,
  loadHistoryFromStorage,
  loadRadarAlertsFromStorage,
} from '@/fsm/useDecisionFSMCompat';
import { useOrchestrate } from '@/hooks/useOrchestrate.js';
import { useCampaignFeed } from '@/hooks/useCampaignFeed.js';
import { useMemory } from '@/hooks/useMemory.js';
// Phase 11D: Use Phase 11C SSE client with exponential backoff
import { useSSE } from '@/services/useSSE';
import { api } from '@/lib/api.js';
import CommandCenter      from '@/components/decision/CommandCenter.jsx';
import InputView          from '@/components/decision/InputView.jsx';
import TheatreView        from '@/components/decision/TheatreView.jsx';
import DecisionFrame      from '@/components/decision/DecisionFrame.jsx';
import ErrorView          from '@/components/decision/ErrorView.jsx';
import DecisionBreadcrumb from '@/components/decision/DecisionBreadcrumb.jsx';

export default function DecisionFeed() {
  const { currentUser } = useAuth();
  const {
    state,
    dispatch,
    abortSignal,
    startFlow,
    reviewAlert,
    submitInput,
    reportSuccess,
    reportError,
    confirmExecution,
    executeAction,
    executionComplete,
    commitToMemory,
    reset,
    replay,
    loadRadarAlerts,
    updateExecutionStatus,
  } = useDecisionFSM();

  const { execute, cancel } = useOrchestrate({
    onSuccess: reportSuccess,
    onError:   reportError,
    onStep:    (step) => dispatch({ type: 'THEATRE_ADVANCE', step }),
  });

  const { summary } = useCampaignFeed();
  const { recordDecision } = useMemory();
  const { refresh } = useIntelligence();

  // ══════════════════════════════════════════════════════════════
  // HYDRATION: Load history + radar alerts from localStorage on mount
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    const history = loadHistoryFromStorage();
    if (history.length > 0) dispatch({ type: 'LOAD_HISTORY', history });

    const alerts = loadRadarAlertsFromStorage();
    if (alerts.length > 0) loadRadarAlerts(alerts);
  }, [dispatch, loadRadarAlerts]);

  // ══════════════════════════════════════════════════════════════
  // RADAR: Wire radar alerts from live API (runs once after mount)
  // Falls back to localStorage silently if API fails or returns 503.
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    let cancelled = false;

    api.get('/api/v1/paid/radar')
      .then((res) => {
        if (cancelled) return;
        const alerts = res.data?.alerts;

        // Always update radar state when we get a successful response,
        // even if alerts is empty (clears stale localStorage alerts when Meta disconnected)
        if (Array.isArray(alerts) && res.data?.source !== 'mock') {
          loadRadarAlerts(alerts);
          // Persist so next load is instant (empty array clears stale data)
          try {
            localStorage.setItem('lumi:radarAlerts', JSON.stringify(alerts));
          } catch { /* quota exceeded */ }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // 503 (MCP not connected) is expected — keep localStorage version.
        // Log non-503 errors for observability without surfacing to user;
        // the localStorage alerts loaded above are the correct fallback.
        const status = err?.response?.status;
        if (status !== 503) {
          console.warn('[RadarFetch] live fetch failed:', status, err?.message);
        }
      });

    return () => { cancelled = true; };
  }, [loadRadarAlerts]); // Run once on mount

  // ══════════════════════════════════════════════════════════════
  // SSE: Phase 11C client with exponential backoff
  // ══════════════════════════════════════════════════════════════
  const { state: sseState, metrics: sseMetrics, isConnected: sseConnected } = useSSE({
    onMessage: (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[DecisionFeed] SSE message:', data);

        // Handle EXECUTION_STATUS events
        if (data.type === 'EXECUTION_STATUS') {
          const { status, error, timestamp, actionType, targetId } = data;

          // Update FSM state
          updateExecutionStatus(status, error, timestamp);

          // Show toast notifications for execution lifecycle
          if (status === 'QUEUED') {
            toast.info('Action queued', {
              description: `${actionType || 'Action'} for ${targetId || 'target'}`,
              duration: 2000,
            });
          } else if (status === 'EXECUTING') {
            toast.loading('Executing action...', {
              description: 'Applying changes to Meta Ads',
              duration: 2000,
            });
          } else if (status === 'EXECUTED_SUCCESS') {
            toast.success('Action executed successfully', {
              description: 'Changes applied to Meta Ads',
              duration: 3000,
            });
          } else if (status === 'EXECUTED_FAILED') {
            toast.error('Execution failed', {
              description: error || 'Unknown error',
              duration: 4000,
            });
          }
        }
      } catch (err) {
        console.error('[DecisionFeed] Failed to parse SSE message:', err);
      }
    },
    onError: (error) => {
      console.error('[DecisionFeed] SSE error:', error);

      // Only show toast for critical errors (max reconnect exceeded)
      if (sseState === 'FAILED') {
        toast.error('Real-time updates disconnected', {
          description: 'Refresh the page to reconnect',
          duration: 5000,
        });
      }
    },
    autoConnect: true, // Auto-connect when auth is ready
    maxRetries: 5,
    baseDelay: 2000,
    maxDelay: 32000,
  });

  // ══════════════════════════════════════════════════════════════
  // SSE State Monitoring: Send FSM events on connection state changes
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    // Notify FSM when SSE drops during execution
    if (sseState === 'RECONNECTING' && state.isProcessing) {
      console.warn('[DecisionFeed] SSE dropped during execution, FSM will switch to polling');
      dispatch({ type: 'SSE_DISCONNECTED' });
    }

    // Log SSE metrics for observability
    if (sseMetrics.reconnectAttempts > 0) {
      console.log('[DecisionFeed] SSE metrics:', {
        state: sseState,
        attempts: sseMetrics.reconnectAttempts,
        downtime: sseMetrics.downtime,
        totalMessages: sseMetrics.totalMessages,
      });
    }
  }, [sseState, sseMetrics, state.isProcessing, dispatch]);

  // ══════════════════════════════════════════════════════════════
  // THEATER: When FSM transitions to THEATER, fire orchestration call
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (state.view === 'THEATER' && state.activeMode && state.inputData) {
      execute(state.activeMode, state.inputData, abortSignal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view]);

  // ══════════════════════════════════════════════════════════════
  // API_EXECUTION: Execute action via Meta API (real execution)
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (state.view === 'API_EXECUTION' && state.outputData) {
      executeMetaAction();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view]);

  /**
   * Execute Meta Ads action with real API call.
   * Maps verdict to actionType, validates data, and handles errors.
   * Firebase JWT is auto-injected by api.js interceptor.
   * Idempotency key prevents duplicate executions.
   */
  async function executeMetaAction() {
    try {
      // Map verdict to actionType
      const verdict = state.outputData?.verdict;
      const actionTypeMap = {
        KILL: 'PAUSE_CAMPAIGN',
        PAUSE: 'PAUSE_CAMPAIGN',
        HOLD: 'PAUSE_CAMPAIGN',
        SCALE: 'SCALE_CAMPAIGN',
        OPTIMIZE: 'OPTIMIZE_CAMPAIGN',
      };
      const actionType = actionTypeMap[verdict] || 'PAUSE_CAMPAIGN';

      // Extract target information from action
      const targetId = state.outputData?.action?.target_id || state.outputData?.targetId;
      const targetType = state.outputData?.action?.target_type || state.outputData?.targetType || 'campaign';

      if (!targetId) {
        reportError(
          'Invalid target ID',
          'INVALID_TARGET',
          'validation',
          false,
          'Target campaign/adset not found'
        );
        return;
      }

      // Generate idempotency key (prevents duplicate executions)
      const idempotencyKey = crypto.randomUUID();

      // Build request payload
      const payload = {
        actionType,
        targetId,
        targetType,
        idempotencyKey,
        options: state.outputData?.options || {},
      };

      // Make API call (token auto-injected by api.js interceptor)
      const response = await api.post('/api/execute/meta', payload, {
        timeout: 15000,
      });

      if (response.data.success) {
        // Check if this was an idempotent replay
        const isReplay = response.data.idempotentReplay === true;

        toast.success(isReplay ? 'Action already executed' : 'Action executed successfully', {
          description: isReplay
            ? `${verdict} was previously applied to ${targetId}`
            : `${verdict} action applied to ${targetId}`,
          duration: 2000,
        });
        executionComplete();
      } else {
        reportError(
          response.data.error || 'Execution failed',
          response.data.code || 'EXECUTION_ERROR',
          'platform',
          true,
          'Check Meta Ads account and retry'
        );
      }
    } catch (err) {
      // Classify error based on type
      let classification = 'network';
      let fallbackAction = 'Check your connection and retry';

      if (err.response?.status === 401 || err.response?.status === 403) {
        classification = 'auth';
        fallbackAction = 'Please sign in again';
      } else if (err.response?.status === 400 || err.response?.status === 422) {
        classification = 'validation';
        fallbackAction = 'Review the action parameters and retry';
      } else if (err.response?.status >= 500) {
        classification = 'platform';
        fallbackAction = 'Meta API error - try again in a few moments';
      } else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        classification = 'network';
        fallbackAction = 'Request timed out - please retry';
      }

      reportError(
        err.response?.data?.error || err.message || 'Failed to execute action',
        err.response?.data?.code || err.code || 'UNKNOWN_ERROR',
        classification,
        true,
        fallbackAction
      );
    }
  }

  // ══════════════════════════════════════════════════════════════
  // MEMORY_COMMIT: Show success toast and commit to memory
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (state.view !== 'MEMORY_COMMIT') return;
    toast.success('Action executed successfully', {
      description: `${state.outputData?.verdict} action applied via Meta API`,
      duration: 3000,
    });

    // Persist decision to CMO memory system
    recordDecision({
      campaignId:        state.outputData?.campaignId ?? state.inputData?.campaignId ?? 'unknown',
      actionType:        state.outputData?.verdict ?? 'UNKNOWN',
      decisionRationale: state.outputData?.whyBreakdown?.[0] ?? state.outputData?.why ?? '',
    }).catch(() => {}); // Silent fail — memory write is non-critical

    const t = setTimeout(() => {
      commitToMemory();
      refresh(); // cascade: radar, ticker, trust strip all update
    }, 500);
    return () => clearTimeout(t);
  }, [state.view, state.outputData, state.inputData, commitToMemory, recordDecision, refresh]);

  return (
    <div className="flex flex-col h-full bg-surface-light">
      {/* Breadcrumb navigation (hide on COMMAND_CENTER) */}
      {state.view !== 'COMMAND_CENTER' && (
        <DecisionBreadcrumb
          view={state.view}
          mode={state.activeMode}
          verdict={state.outputData?.verdict}
          agents={state.outputData?.agentsUsed}
          onBack={reset}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {/* ──────────────────────────────────────────────────── */}
        {/* STATE: COMMAND_CENTER                                 */}
        {/* ──────────────────────────────────────────────────── */}
        {state.view === 'COMMAND_CENTER' && (
          <CommandCenter
            history={state.history}
            radarAlerts={state.radarAlerts}
            summary={summary}
            onStartFlow={startFlow}
            onReviewAlert={reviewAlert}
            onReplay={replay}
            onClearHistory={() => dispatch({ type: 'CLEAR_HISTORY' })}
          />
        )}

        {/* ──────────────────────────────────────────────────── */}
        {/* STATE: INPUT_VALIDATION                               */}
        {/* ──────────────────────────────────────────────────── */}
        {state.view === 'INPUT_VALIDATION' && state.activeMode && (
          <InputView
            mode={state.activeMode}
            initialData={state.inputData}
            onSubmit={submitInput}
            onCancel={reset}
          />
        )}

        {/* ──────────────────────────────────────────────────── */}
        {/* STATE: THEATER (Locked during async processing)      */}
        {/* ──────────────────────────────────────────────────── */}
        {state.view === 'THEATER' && (
          <TheatreView
            mode={state.activeMode}
            currentStep={state.theatreStep}
            onCancel={() => { cancel(); reset(); }}
          />
        )}

        {/* ──────────────────────────────────────────────────────────────── */}
        {/* STATES: SUCCESS / CONFIRM_EXECUTION / API_EXECUTION / EXECUTING */}
        {/* ──────────────────────────────────────────────────────────────── */}
        {(state.view === 'SUCCESS' ||
          state.view === 'CONFIRM_EXECUTION' ||
          state.view === 'API_EXECUTION' ||
          state.view === 'EXECUTION_QUEUED' ||
          state.view === 'EXECUTING' ||
          state.view === 'EXECUTED_SUCCESS') &&
          state.outputData && (
            <DecisionFrame
              data={state.outputData}
              view={state.view}
              isLocked={state.isLocked}
              executionStatus={state.executionStatus}
              onConfirmExecution={confirmExecution}
              onExecuteAction={executeAction}
              onCommitToMemory={commitToMemory}
              onReset={reset}
            />
          )}

        {/* ──────────────────────────────────────────────────── */}
        {/* STATE: ERROR / EXECUTED_FAILED                        */}
        {/* ──────────────────────────────────────────────────── */}
        {(state.view === 'ERROR' || state.view === 'EXECUTED_FAILED') && state.errorDetails && (
          <ErrorView
            error={state.errorDetails}
            onRetry={() => {
              if (state.inputData && state.activeMode) {
                dispatch({ type: 'SUBMIT_INPUT', inputData: state.inputData });
              } else {
                reset();
              }
            }}
            onBack={reset}
          />
        )}
      </div>
    </div>
  );
}
