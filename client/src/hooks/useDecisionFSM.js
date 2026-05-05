// ============================================================
// MARCOM / Lumi — Enterprise Decision FSM v4.1
// ------------------------------------------------------------
// STRICT PIPELINE (7 states):
//   COMMAND_CENTER → INPUT_VALIDATION → THEATER (Locked) →
//   SUCCESS → CONFIRM_EXECUTION → API_EXECUTION (Locked) →
//   MEMORY_COMMIT → COMMAND_CENTER
//
// GUARDRAILS:
// - AbortController for all async transitions
// - State locking during THEATER and API_EXECUTION
// - ERROR state with classification & fallback actions
// - NO direct jumps to execution (always through confirmation)
// ============================================================
import { useReducer, useCallback, useRef, useEffect } from 'react';
import { validateDecisionContract } from '@/types/decision.js';

/** @typedef {'COMMAND_CENTER'|'INPUT_VALIDATION'|'THEATER'|'SUCCESS'|'CONFIRM_EXECUTION'|'API_EXECUTION'|'MEMORY_COMMIT'|'ERROR'} FSMView */

export const initialState = {
  view: 'COMMAND_CENTER',
  activeMode: null,
  inputData: null,
  outputData: null,
  errorDetails: null,
  isProcessing: false,
  isLocked: false,
  theatreStep: 0,
  history: [],
  radarAlerts: [],
};

// ── Legal transitions ────────────────────────────────────────
const LEGAL = {
  START_FLOW:           ['COMMAND_CENTER'],
  REVIEW_ALERT:         ['COMMAND_CENTER'],
  SUBMIT_INPUT:         ['INPUT_VALIDATION', 'ERROR'],
  THEATRE_ADVANCE:      ['THEATER'],
  PROCESS_SUCCESS:      ['THEATER'],
  PROCESS_ERROR:        ['THEATER', 'INPUT_VALIDATION', 'API_EXECUTION'],
  CONFIRM_EXECUTION:    ['SUCCESS'],
  EXECUTE_ACTION:       ['CONFIRM_EXECUTION'],
  EXECUTION_COMPLETE:   ['API_EXECUTION'],
  COMMIT_TO_MEMORY:     ['API_EXECUTION'],
  RESET_FLOW:           ['INPUT_VALIDATION', 'THEATER', 'SUCCESS', 'ERROR', 'COMMAND_CENTER', 'CONFIRM_EXECUTION', 'MEMORY_COMMIT'],
  REPLAY_DECISION:      ['COMMAND_CENTER'],
  LOAD_HISTORY:         ['COMMAND_CENTER', 'INPUT_VALIDATION', 'THEATER', 'SUCCESS', 'ERROR'],
  LOAD_RADAR_ALERTS:    ['COMMAND_CENTER'],
  CLEAR_HISTORY:        ['COMMAND_CENTER'],
};

function legal(view, type) {
  if (!LEGAL[type]) return true;
  if (LEGAL[type].includes(view)) return true;
  // eslint-disable-next-line no-console
  console.warn(`[DecisionFSM] illegal transition ${type} from ${view}`);
  return false;
}

// ── Persistence ──────────────────────────────────────────────
const HISTORY_KEY = 'lumi:decisionHistory';
const RADAR_KEY = 'lumi:radarAlerts';

function persistHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }
  catch { /* quota exceeded */ }
}

function clearStoredHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
}

export function loadHistoryFromStorage() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.reduce((acc, item) => {
      try { acc.push(validateDecisionContract(item)); } catch {}
      return acc;
    }, []);
  } catch { return []; }
}

export function loadRadarAlertsFromStorage() {
  try {
    const raw = localStorage.getItem(RADAR_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function persistRadarAlerts(alerts) {
  try { localStorage.setItem(RADAR_KEY, JSON.stringify(alerts)); }
  catch { /* quota exceeded */ }
}

// ── Reducer ──────────────────────────────────────────────────
export function decisionReducer(state, action) {
  if (!legal(state.view, action.type)) return state;

  switch (action.type) {
    case 'START_FLOW':
      return {
        ...state,
        view: 'INPUT_VALIDATION',
        activeMode: action.mode,
        inputData: null,
        outputData: null,
        errorDetails: null,
        isProcessing: false,
        isLocked: false,
        theatreStep: 0,
      };

    case 'REVIEW_ALERT':
      // Transition from radar alert to INPUT_VALIDATION with pre-filled data
      return {
        ...state,
        view: 'INPUT_VALIDATION',
        activeMode: 'campaign',
        inputData: action.alertData,
        outputData: null,
        errorDetails: null,
        isProcessing: false,
        isLocked: false,
        theatreStep: 0,
      };

    case 'SUBMIT_INPUT':
      return {
        ...state,
        view: 'THEATER',
        inputData: action.inputData,
        isProcessing: true,
        isLocked: true, // LOCK during async theater
        theatreStep: 0,
        errorDetails: null,
      };

    case 'THEATRE_ADVANCE':
      return { ...state, theatreStep: action.step };

    case 'PROCESS_SUCCESS': {
      let validated;
      try { validated = validateDecisionContract(action.data); }
      catch (err) {
        return {
          ...state,
          view: 'ERROR',
          isProcessing: false,
          isLocked: false,
          errorDetails: {
            message: err.message || 'Invalid response schema',
            code: 'SCHEMA_VIOLATION',
            classification: 'parsing',
            retryable: true,
            fallbackAction: 'Contact support if issue persists',
          },
        };
      }
      // Do NOT add to history yet — wait for COMMIT_TO_MEMORY
      return {
        ...state,
        view: 'SUCCESS',
        outputData: validated,
        isProcessing: false,
        isLocked: false,
      };
    }

    case 'PROCESS_ERROR':
      return {
        ...state,
        view: 'ERROR',
        isProcessing: false,
        isLocked: false,
        errorDetails: {
          message:        action.message,
          code:           action.code,
          classification: action.classification || 'network',
          retryable:      action.retryable !== false,
          fallbackAction: action.fallbackAction || 'Try uploading CSV instead',
        },
      };

    case 'CONFIRM_EXECUTION':
      return {
        ...state,
        view: 'CONFIRM_EXECUTION',
      };

    case 'EXECUTE_ACTION':
      return {
        ...state,
        view: 'API_EXECUTION',
        isProcessing: true,
        isLocked: true, // LOCK during API execution
      };

    case 'EXECUTION_COMPLETE':
      return {
        ...state,
        view: 'MEMORY_COMMIT',
        isProcessing: false,
        isLocked: false,
      };

    case 'COMMIT_TO_MEMORY': {
      const updatedHistory = [state.outputData, ...state.history].slice(0, 20);
      persistHistory(updatedHistory);
      return {
        ...initialState,
        history: updatedHistory,
        radarAlerts: state.radarAlerts,
      };
    }

    case 'RESET_FLOW':
      return {
        ...initialState,
        history: state.history,
        radarAlerts: state.radarAlerts,
      };

    case 'REPLAY_DECISION': {
      let validated;
      try { validated = validateDecisionContract(action.data); }
      catch { return state; }
      return {
        ...state,
        view: 'SUCCESS',
        activeMode: validated.mode,
        outputData: validated,
        errorDetails: null,
        isProcessing: false,
        isLocked: false,
      };
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

// ── Hook ─────────────────────────────────────────────────────
export function useDecisionFSM() {
  const [state, dispatch] = useReducer(decisionReducer, initialState);
  const abortControllerRef = useRef(null);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const startFlow = useCallback((mode) => {
    dispatch({ type: 'START_FLOW', mode });
  }, []);

  const reviewAlert = useCallback((alertData) => {
    dispatch({ type: 'REVIEW_ALERT', alertData });
  }, []);

  const submitInput = useCallback((inputData) => {
    // Create new AbortController for this async operation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    dispatch({ type: 'SUBMIT_INPUT', inputData });
  }, []);

  const reportSuccess = useCallback((data) => {
    dispatch({ type: 'PROCESS_SUCCESS', data });
  }, []);

  const reportError = useCallback((message, code, classification = 'network', retryable = true, fallbackAction = null) => {
    // Strict error classification: only allow auth, network, platform, validation
    const VALID_CLASSIFICATIONS = ['auth', 'network', 'platform', 'validation'];
    const sanitizedClassification = VALID_CLASSIFICATIONS.includes(classification)
      ? classification
      : 'network';

    dispatch({
      type: 'PROCESS_ERROR',
      message,
      code,
      classification: sanitizedClassification,
      retryable,
      fallbackAction,
    });
  }, []);

  const confirmExecution = useCallback(() => {
    dispatch({ type: 'CONFIRM_EXECUTION' });
  }, []);

  const executeAction = useCallback(() => {
    // Create new AbortController for API execution
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    dispatch({ type: 'EXECUTE_ACTION' });
  }, []);

  const executionComplete = useCallback(() => {
    dispatch({ type: 'EXECUTION_COMPLETE' });
  }, []);

  const commitToMemory = useCallback(() => {
    dispatch({ type: 'COMMIT_TO_MEMORY' });
  }, []);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    dispatch({ type: 'RESET_FLOW' });
  }, []);

  const replay = useCallback((data) => {
    dispatch({ type: 'REPLAY_DECISION', data });
  }, []);

  const loadRadarAlerts = useCallback((alerts) => {
    dispatch({ type: 'LOAD_RADAR_ALERTS', alerts });
  }, []);

  return {
    state,
    dispatch,
    abortSignal: abortControllerRef.current?.signal,
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
  };
}
