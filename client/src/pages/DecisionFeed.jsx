// ============================================================
// MARCOM / Lumi — DecisionFeed (FSM container)
// ------------------------------------------------------------
// Pure conditional renderer over the FSM view. Wires the
// orchestrate hook callbacks into the reducer, loads persisted
// history on mount, and runs the API call when the FSM
// transitions to THEATER.
// ============================================================
import { useEffect } from 'react';
import { useDecisionFSM, loadHistoryFromStorage } from '@/hooks/useDecisionFSM.js';
import { useOrchestrate } from '@/hooks/useOrchestrate.js';
import CommandCenter      from '@/components/decision/CommandCenter.jsx';
import InputView          from '@/components/decision/InputView.jsx';
import TheatreView        from '@/components/decision/TheatreView.jsx';
import SuccessView        from '@/components/decision/SuccessView.jsx';
import ErrorView          from '@/components/decision/ErrorView.jsx';
import DecisionBreadcrumb from '@/components/decision/DecisionBreadcrumb.jsx';

export default function DecisionFeed() {
  const {
    state, dispatch, startFlow, submitInput,
    reportSuccess, reportError, reset, replay,
  } = useDecisionFSM();

  const { execute, cancel } = useOrchestrate({
    onSuccess: reportSuccess,
    onError:   reportError,
    onStep:    (step) => dispatch({ type: 'THEATRE_ADVANCE', step }),
  });

  // Hydrate history from localStorage on mount.
  useEffect(() => {
    const history = loadHistoryFromStorage();
    if (history.length > 0) dispatch({ type: 'LOAD_HISTORY', history });
  }, [dispatch]);

  // When the FSM transitions into THEATER, fire the orchestration call.
  useEffect(() => {
    if (state.view === 'THEATER' && state.activeMode && state.inputData) {
      execute(state.activeMode, state.inputData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view]);

  return (
    <div className="flex flex-col h-full bg-lumi-bg">
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
        {state.view === 'COMMAND_CENTER' && (
          <CommandCenter
            history={state.history}
            onStartFlow={startFlow}
            onReplay={replay}
            onClearHistory={() => dispatch({ type: 'CLEAR_HISTORY' })}
          />
        )}

        {state.view === 'INPUT' && state.activeMode && (
          <InputView
            mode={state.activeMode}
            onSubmit={submitInput}
            onCancel={reset}
          />
        )}

        {state.view === 'THEATER' && (
          <TheatreView
            mode={state.activeMode}
            currentStep={state.theatreStep}
            onCancel={() => { cancel(); reset(); }}
          />
        )}

        {state.view === 'SUCCESS' && state.outputData && (
          <SuccessView
            data={state.outputData}
            onReset={reset}
            onCommit={() => reset()}
          />
        )}

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
