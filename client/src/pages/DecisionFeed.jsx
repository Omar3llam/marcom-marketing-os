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
import { toast } from 'sonner';
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
  // API_EXECUTION: Mock Meta API execution (1.5s delay)
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (state.view === 'API_EXECUTION') {
      const timer = setTimeout(() => {
        executionComplete();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [state.view, executionComplete]);

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
    <div className="flex flex-col h-full bg-lumi-bg">
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
