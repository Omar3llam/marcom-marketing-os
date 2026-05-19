/**
 * useDecisionMachine Hook (Phase 11)
 *
 * React hook for integrating XState decision machine into components.
 * Provides type-safe API for state transitions and side effects.
 *
 * @example
 * ```tsx
 * const { state, send, context } = useDecisionMachine();
 *
 * // Start flow
 * send({ type: 'START_FLOW', mode: 'csv', inputData: csvData });
 *
 * // Handle SSE status updates
 * useEffect(() => {
 *   eventSource.onmessage = (event) => {
 *     const data = JSON.parse(event.data);
 *     send({ type: 'SSE_STATUS_UPDATE', status: data.status, error: data.error });
 *   };
 * }, [send]);
 *
 * // Render based on state
 * if (state.matches('executing')) return <ExecutingView />;
 * if (state.matches('success')) return <SuccessView data={context.outputData} />;
 * ```
 */
import { useMachine } from '@xstate/react';
import { useEffect } from 'react';
import { decisionMachine } from './decisionMachine';
import type { DecisionContext } from './decisionMachine';

export interface UseDecisionMachineResult {
  /** Current state value */
  state: any;
  /** State machine context */
  context: DecisionContext;
  /** Send event to machine */
  send: (event: any) => void;
  /** Check if in specific state */
  isInState: (stateName: string) => boolean;
  /** Check if can retry */
  canRetry: boolean;
  /** Check if execution in progress */
  isExecuting: boolean;
  /** Check if locked (cannot send new actions) */
  isLocked: boolean;
}

/**
 * React hook for decision execution FSM
 */
export function useDecisionMachine(): UseDecisionMachineResult {
  const [state, send] = useMachine(decisionMachine);

  const context = state.context as DecisionContext;

  // Cleanup on unmount: abort in-flight execution
  useEffect(() => {
    return () => {
      if (
        state.matches('executing') ||
        state.matches('streaming') ||
        state.matches('polling')
      ) {
        send({ type: 'CANCEL' });
      }
    };
  }, [send, state]);

  // Helper: Check if in specific state
  const isInState = (stateName: string): boolean => {
    return state.matches(stateName);
  };

  // Helper: Check if can retry
  const canRetry = context.retryCount < 5; // RETRY_MAX_ATTEMPTS

  // Helper: Check if execution in progress
  const isExecuting =
    state.matches('executing') ||
    state.matches('streaming') ||
    state.matches('polling') ||
    state.matches('retrying');

  // Helper: Check if locked (cannot accept new START_FLOW)
  const isLocked =
    isExecuting ||
    state.matches('validating') ||
    state.matches('planning');

  return {
    state,
    context,
    send,
    isInState,
    canRetry,
    isExecuting,
    isLocked,
  };
}

/**
 * Hook for simplified decision flow (backward compatibility with useDecisionFSM)
 *
 * @deprecated Use useDecisionMachine for full FSM control
 */
export function useSimplifiedDecisionFlow() {
  const machine = useDecisionMachine();

  return {
    state: {
      view: machine.state.value as string,
      isProcessing: machine.isExecuting,
      isLocked: machine.isLocked,
      errorDetails: machine.context.error,
      outputData: machine.context.outputData,
      history: machine.context.history,
      radarAlerts: machine.context.radarAlerts,
      retryCount: machine.context.retryCount,
    },

    // Legacy action methods (for backward compatibility)
    startFlow: (mode: string) => {
      machine.send({ type: 'START_FLOW', mode, inputData: null });
    },

    submitInput: (inputData: any) => {
      machine.send({ type: 'START_FLOW', mode: machine.context.mode, inputData });
    },

    reportSuccess: (data: any) => {
      // Success is now SSE-driven, not manual
      machine.send({ type: 'SSE_STATUS_UPDATE', status: 'EXECUTED_SUCCESS' });
    },

    reportError: (message: string, code: string, classification: string) => {
      machine.send({
        type: 'EXECUTION_TIMEOUT_OVERRIDE',
        error: {
          message,
          code,
          classification,
          severity: 'high',
          retryable: true,
        },
      });
    },

    executeAction: () => {
      // Execution happens automatically after planning
      // This is a no-op for compatibility
    },

    reset: () => {
      machine.send({ type: 'RESET' });
    },

    commitToMemory: () => {
      machine.send({ type: 'COMMIT_TO_MEMORY' });
    },

    updateExecutionStatus: (status: string, error: any = null) => {
      machine.send({ type: 'SSE_STATUS_UPDATE', status, error });
    },
  };
}
