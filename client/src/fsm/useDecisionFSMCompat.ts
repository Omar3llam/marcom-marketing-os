/**
 * Backward Compatibility Adapter (Phase 11D)
 *
 * Provides the old useDecisionFSM interface using the new XState machine.
 * Allows gradual migration without breaking existing components.
 *
 * @deprecated Use useDecisionMachine directly for new code
 */
import { useDecisionMachine } from './useDecisionMachine';
import type { DecisionContext } from './decisionMachine';

export interface LegacyFSMState {
  view: string;
  activeMode: string | null;
  inputData: any;
  outputData: any;
  errorDetails: any;
  isProcessing: boolean;
  isLocked: boolean;
  theatreStep: number;
  history: any[];
  radarAlerts: any[];
  executionStatus: any;
}

export interface LegacyFSMActions {
  startFlow: (mode: string) => void;
  reviewAlert: (alertData: any) => void;
  submitInput: (inputData: any) => void;
  reportSuccess: (data: any) => void;
  reportError: (message: string, code: string, classification?: string, retryable?: boolean, fallbackAction?: string) => void;
  confirmExecution: () => void;
  executeAction: () => void;
  executionComplete: () => void;
  commitToMemory: () => void;
  reset: () => void;
  replay: (data: any) => void;
  loadRadarAlerts: (alerts: any[]) => void;
  updateExecutionStatus: (status: string, error?: string | null, timestamp?: string | null) => void;
  dispatch: (action: any) => void;
  abortSignal: AbortSignal | undefined;
}

/**
 * Map XState machine states to legacy FSM views
 */
function mapStateToView(stateMachine: any, context: DecisionContext): string {
  const state = stateMachine.value;

  // Map XState states to legacy FSM views
  const stateMap: Record<string, string> = {
    idle: 'COMMAND_CENTER',
    validating: 'INPUT_VALIDATION',
    planning: 'THEATER',
    executing: 'API_EXECUTION',
    streaming: 'EXECUTING',
    polling: 'EXECUTING',
    retrying: 'THEATER',
    degraded: 'ERROR',
    partialSuccess: 'EXECUTED_SUCCESS',
    success: 'EXECUTED_SUCCESS',
    failed: 'ERROR',
    aborted: 'ERROR',
  };

  return stateMap[state as string] || 'COMMAND_CENTER';
}

/**
 * useDecisionFSM compatibility hook
 *
 * Wraps useDecisionMachine to provide the old interface.
 */
export function useDecisionFSM(): { state: LegacyFSMState } & LegacyFSMActions {
  const machine = useDecisionMachine();

  // Map XState state to legacy state shape
  const state: LegacyFSMState = {
    view: mapStateToView(machine.state, machine.context),
    activeMode: machine.context.mode,
    inputData: machine.context.inputData,
    outputData: machine.context.outputData,
    errorDetails: machine.context.error,
    isProcessing: machine.isExecuting,
    isLocked: machine.isLocked,
    theatreStep: 0, // Theatre steps handled internally by XState now
    history: machine.context.history,
    radarAlerts: machine.context.radarAlerts,
    executionStatus: {
      status: machine.state.value,
      timestamp: new Date().toISOString(),
    },
  };

  // Map old actions to new events
  const startFlow = (mode: string) => {
    machine.send({ type: 'START_FLOW', mode, inputData: null });
  };

  const reviewAlert = (alertData: any) => {
    machine.send({ type: 'START_FLOW', mode: 'campaign', inputData: alertData });
  };

  const submitInput = (inputData: any) => {
    machine.send({ type: 'START_FLOW', mode: machine.context.mode || 'campaign', inputData });
  };

  const reportSuccess = (data: any) => {
    // Success is SSE-driven now, no-op for compatibility
    console.warn('[FSM Compat] reportSuccess is deprecated - success is SSE-driven');
  };

  const reportError = (
    message: string,
    code: string,
    classification = 'network',
    retryable = true,
    fallbackAction = 'Retry'
  ) => {
    machine.send({
      type: 'EXECUTION_TIMEOUT_OVERRIDE',
      error: {
        message,
        code,
        classification,
        severity: 'high',
        retryable,
        fallbackAction,
      },
    });
  };

  const confirmExecution = () => {
    // Execution is automatic after planning now, no-op for compatibility
    console.warn('[FSM Compat] confirmExecution is deprecated - execution is automatic');
  };

  const executeAction = () => {
    // Execution is automatic after planning now, no-op for compatibility
    console.warn('[FSM Compat] executeAction is deprecated - execution is automatic');
  };

  const executionComplete = () => {
    // Completion is SSE-driven now, no-op for compatibility
    console.warn('[FSM Compat] executionComplete is deprecated - completion is SSE-driven');
  };

  const commitToMemory = () => {
    machine.send({ type: 'COMMIT_TO_MEMORY' });
  };

  const reset = () => {
    machine.send({ type: 'RESET' });
  };

  const replay = (data: any) => {
    // Not supported in new FSM yet
    console.warn('[FSM Compat] replay not implemented yet');
  };

  const loadRadarAlerts = (alerts: any[]) => {
    // Radar alerts now part of context initialization
    console.warn('[FSM Compat] loadRadarAlerts should be set during initialization');
  };

  const updateExecutionStatus = (status: string, error: string | null = null, timestamp: string | null = null) => {
    machine.send({ type: 'SSE_STATUS_UPDATE', status, error });
  };

  const dispatch = (action: any) => {
    // Map old dispatch actions to new events
    if (action.type === 'THEATRE_ADVANCE') {
      // Theatre steps are internal now, no-op
      return;
    }
    if (action.type === 'LOAD_HISTORY') {
      // History loaded during initialization
      return;
    }
    console.warn('[FSM Compat] Unknown dispatch action:', action.type);
  };

  return {
    state,
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
    dispatch,
    abortSignal: undefined, // AbortController handled internally by XState now
  };
}

/**
 * Load history from localStorage
 */
export function loadHistoryFromStorage(): any[] {
  try {
    const raw = localStorage.getItem('lumi:decisionHistory');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Load radar alerts from localStorage
 */
export function loadRadarAlertsFromStorage(): any[] {
  try {
    const raw = localStorage.getItem('lumi:radarAlerts');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
