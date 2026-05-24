import { useDecisionFeed } from '@/hooks/useDecisionFeed.js';
import CommandCenter      from '@/components/decision/CommandCenter.jsx';
import InputView          from '@/components/decision/InputView.jsx';
import TheatreView        from '@/components/decision/TheatreView.jsx';
import DecisionFrame      from '@/components/decision/DecisionFrame.jsx';
import ErrorView          from '@/components/decision/ErrorView.jsx';
import DecisionBreadcrumb from '@/components/decision/DecisionBreadcrumb.jsx';

export default function DecisionFeed() {
  const {
    state, dispatch,
    startFlow, reviewAlert, submitInput, confirmExecution, executeAction,
    commitToMemory, reset, replay,
    execute, cancel,
    summary,
  } = useDecisionFeed();

  return (
    <div className="flex flex-col h-full bg-surface-light">
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
            radarAlerts={state.radarAlerts}
            summary={summary}
            onStartFlow={startFlow}
            onReviewAlert={reviewAlert}
            onReplay={replay}
            onClearHistory={() => dispatch({ type: 'CLEAR_HISTORY' })}
          />
        )}

        {state.view === 'INPUT_VALIDATION' && state.activeMode && (
          <InputView
            mode={state.activeMode}
            initialData={state.inputData}
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
