import { validateDecisionContract } from '@/types/decision.js';
import { initialState, legal, persistHistory, clearStoredHistory } from './state.js';

/**
 * Updates the decision FSM state based on the provided action.
 *
 * Determines and returns the next reducer state for the decision flow; if the action is not permitted in the current view or is unrecognized, the original state is returned unchanged.
 *
 * @param {Object} state - Current FSM state.
 * @param {Object} action - Action object containing a `type` string and any action-specific payload.
 * @returns {Object} The new state object after applying the action, or the original state if no transition is performed.
 */
export function decisionReducer(state, action) {
  if (!legal(state.view, action.type)) return state;

  switch (action.type) {
    case 'START_FLOW':
      return { ...state, view: 'INPUT_VALIDATION', activeMode: action.mode, inputData: null, outputData: null, errorDetails: null, isProcessing: false, isLocked: false, theatreStep: 0 };

    case 'REVIEW_ALERT':
      return { ...state, view: 'INPUT_VALIDATION', activeMode: 'campaign', inputData: action.alertData, outputData: null, errorDetails: null, isProcessing: false, isLocked: false, theatreStep: 0 };

    case 'VIEW_PORTFOLIO':
      return { ...state, view: 'PORTFOLIO', activeMode: null, inputData: null, outputData: null, errorDetails: null, isProcessing: false, isLocked: false, theatreStep: 0 };

    case 'VIEW_TESTING':
      return { ...state, view: 'TESTING', activeMode: null, inputData: null, outputData: null, errorDetails: null, isProcessing: false, isLocked: false, theatreStep: 0 };

    case 'VIEW_MEMORY':
      return { ...state, view: 'MEMORY', activeMode: null, inputData: null, outputData: null, errorDetails: null, isProcessing: false, isLocked: false, theatreStep: 0 };

    case 'VIEW_PLAN':
      return { ...state, view: 'PLAN', activeMode: null, inputData: null, outputData: null, errorDetails: null, isProcessing: false, isLocked: false, theatreStep: 0 };

    case 'VIEW_MEASURE':
      return { ...state, view: 'MEASURE', activeMode: null, inputData: null, outputData: null, errorDetails: null, isProcessing: false, isLocked: false, theatreStep: 0 };

    case 'SUBMIT_INPUT':
      return { ...state, view: 'THEATER', inputData: action.inputData, isProcessing: true, isLocked: true, theatreStep: 0, errorDetails: null };

    case 'THEATRE_ADVANCE':
      return { ...state, theatreStep: action.step };

    case 'PROCESS_SUCCESS': {
      let validated;
      try { validated = validateDecisionContract(action.data); }
      catch (err) {
        return { ...state, view: 'ERROR', isProcessing: false, isLocked: false, errorDetails: { message: err.message || 'Invalid response schema', code: 'SCHEMA_VIOLATION', classification: 'parsing', retryable: true, fallbackAction: 'Contact support if issue persists' } };
      }
      return { ...state, view: 'SUCCESS', outputData: validated, isProcessing: false, isLocked: false };
    }

    case 'PROCESS_ERROR':
      return { ...state, view: 'ERROR', isProcessing: false, isLocked: false, errorDetails: { message: action.message, code: action.code, classification: action.classification || 'network', retryable: action.retryable !== false, fallbackAction: action.fallbackAction || 'Try uploading CSV instead' } };

    case 'CONFIRM_EXECUTION':
      return { ...state, view: 'CONFIRM_EXECUTION' };

    case 'EXECUTE_ACTION':
      return { ...state, view: 'API_EXECUTION', isProcessing: true, isLocked: true, executionStatus: null };

    case 'EXECUTION_STATUS_UPDATE': {
      const { status, error } = action;
      if (status === 'QUEUED') return { ...state, view: 'EXECUTION_QUEUED', executionStatus: { status: 'QUEUED', timestamp: action.timestamp } };
      if (status === 'EXECUTING') return { ...state, view: 'EXECUTING', executionStatus: { status: 'EXECUTING', timestamp: action.timestamp }, isProcessing: true };
      if (status === 'EXECUTED_SUCCESS') return { ...state, view: 'EXECUTED_SUCCESS', executionStatus: { status: 'SUCCESS', timestamp: action.timestamp }, isProcessing: false, isLocked: false };
      if (status === 'EXECUTED_FAILED') return { ...state, view: 'EXECUTED_FAILED', executionStatus: { status: 'FAILED', error, timestamp: action.timestamp }, isProcessing: false, isLocked: false, errorDetails: { message: error || 'Execution failed', code: 'EXECUTION_FAILED', classification: 'platform', retryable: true, fallbackAction: 'Review error and try again' } };
      return state;
    }

    case 'EXECUTION_COMPLETE':
      return { ...state, view: 'MEMORY_COMMIT', isProcessing: false, isLocked: false };

    case 'COMMIT_TO_MEMORY': {
      const updatedHistory = [state.outputData, ...state.history].slice(0, 20);
      persistHistory(updatedHistory);
      return { ...initialState, history: updatedHistory, radarAlerts: state.radarAlerts };
    }

    case 'RESET_FLOW':
      return { ...initialState, history: state.history, radarAlerts: state.radarAlerts };

    case 'REPLAY_DECISION': {
      let validated;
      try { validated = validateDecisionContract(action.data); }
      catch { return state; }
      return { ...state, view: 'SUCCESS', activeMode: validated.mode, outputData: validated, errorDetails: null, isProcessing: false, isLocked: false };
    }

    case 'LOAD_HISTORY':
      return { ...state, history: action.history };

    case 'LOAD_RADAR_ALERTS':
      return { ...state, radarAlerts: action.alerts };

    case 'CLEAR_HISTORY':
      clearStoredHistory();
      return { ...state, history: [] };

    default:
      return state;
  }
}
