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
// ============================================================
import { useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext.jsx';
import {
  useDecisionFSM,
  loadHistoryFromStorage,
  loadRadarAlertsFromStorage,
} from '@/hooks/useDecisionFSM.js';
import { useOrchestrate } from '@/hooks/useOrchestrate.js';
import CommandCenter      from '@/components/decision/CommandCenter.jsx';
import InputView          from '@/components/decision/InputView.jsx';
import TheatreView        from '@/components/decision/TheatreView.jsx';
import DecisionFrame      from '@/components/decision/DecisionFrame.jsx';
import ErrorView          from '@/components/decision/ErrorView.jsx';
import DecisionBreadcrumb from '@/components/decision/DecisionBreadcrumb.jsx';

export default function DecisionFeed() {
  const { auth } = useAuth();
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
  } = useDecisionFSM();

  const { execute, cancel } = useOrchestrate({
    onSuccess: reportSuccess,
    onError:   reportError,
    onStep:    (step) => dispatch({ type: 'THEATRE_ADVANCE', step }),
  });

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
   */
  async function executeMetaAction() {
    try {
      // Get Firebase token
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        reportError(
          'Authentication required',
          'NO_TOKEN',
          'auth',
          true,
          'Please sign in again'
        );
        return;
      }

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

      // Build request payload
      const payload = {
        actionType,
        targetId,
        targetType,
        options: state.outputData?.options || {},
      };

      // Make API call
      const response = await axios.post('/api/execute/meta', payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      if (response.data.success) {
        toast.success('Action executed successfully', {
          description: `${verdict} action applied to ${targetId}`,
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
    if (state.view === 'MEMORY_COMMIT') {
      toast.success('Action executed successfully', {
        description: `${state.outputData?.verdict} action applied via Meta API`,
        duration: 3000,
      });
      setTimeout(() => {
        commitToMemory();
      }, 500);
    }
  }, [state.view, state.outputData, commitToMemory]);

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

        {/* ──────────────────────────────────────────────────── */}
        {/* STATES: SUCCESS / CONFIRM_EXECUTION / API_EXECUTION   */}
        {/* ──────────────────────────────────────────────────── */}
        {(state.view === 'SUCCESS' ||
          state.view === 'CONFIRM_EXECUTION' ||
          state.view === 'API_EXECUTION') &&
          state.outputData && (
            <DecisionFrame
              data={state.outputData}
              view={state.view}
              isLocked={state.isLocked}
              onConfirmExecution={confirmExecution}
              onExecuteAction={executeAction}
              onCommitToMemory={commitToMemory}
              onReset={reset}
            />
          )}

        {/* ──────────────────────────────────────────────────── */}
        {/* STATE: ERROR                                          */}
        {/* ──────────────────────────────────────────────────── */}
        {state.view === 'ERROR' && state.errorDetails && (
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
