// ============================================================
// MARCOM / Lumi — Decision FSM
// ------------------------------------------------------------
// Five-state finite state machine driving DecisionFeed:
//   COMMAND_CENTER ↔ INPUT → THEATER → SUCCESS | ERROR
// All transitions go through the reducer; illegal transitions
// log + ignore (never throw — UI mustn't crash on a bug).
// History persists to localStorage; invalid entries are dropped
// silently on load.
// ============================================================
import { useReducer, useCallback } from 'react';
import { validateDecisionContract } from '@/types/decision.js';

/** @typedef {'COMMAND_CENTER'|'INPUT'|'THEATER'|'SUCCESS'|'ERROR'} FSMView */

export const initialState = {
  view: 'COMMAND_CENTER',
  activeMode: null,
  inputData: null,
  outputData: null,
  errorDetails: null,
  isProcessing: false,
  theatreStep: 0,
  history: [],
};

// ── Legal transitions ────────────────────────────────────────
const LEGAL = {
  START_FLOW:      ['COMMAND_CENTER'],
  SUBMIT_INPUT:    ['INPUT', 'ERROR'],   // allow retry from ERROR
  THEATRE_ADVANCE: ['THEATER'],
  PROCESS_SUCCESS: ['THEATER'],
  PROCESS_ERROR:   ['THEATER', 'INPUT'],
  RESET_FLOW:      ['INPUT', 'THEATER', 'SUCCESS', 'ERROR', 'COMMAND_CENTER'],
  REPLAY_DECISION: ['COMMAND_CENTER'],
  LOAD_HISTORY:    ['COMMAND_CENTER', 'INPUT', 'THEATER', 'SUCCESS', 'ERROR'],
  CLEAR_HISTORY:   ['COMMAND_CENTER'],
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

function persistHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }
  catch { /* quota exceeded — silently skip */ }
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

// ── Reducer ──────────────────────────────────────────────────
export function decisionReducer(state, action) {
  if (!legal(state.view, action.type)) return state;

  switch (action.type) {
    case 'START_FLOW':
      return {
        ...state,
        view: 'INPUT',
        activeMode: action.mode,
        inputData: null,
        outputData: null,
        errorDetails: null,
        isProcessing: false,
        theatreStep: 0,
      };

    case 'SUBMIT_INPUT':
      return {
        ...state,
        view: 'THEATER',
        inputData: action.inputData,
        isProcessing: true,
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
          errorDetails: { message: err.message || 'Invalid response schema', code: 'SCHEMA_VIOLATION', retryable: true },
        };
      }
      const updatedHistory = [validated, ...state.history].slice(0, 20);
      persistHistory(updatedHistory);
      return {
        ...state,
        view: 'SUCCESS',
        outputData: validated,
        isProcessing: false,
        history: updatedHistory,
      };
    }

    case 'PROCESS_ERROR':
      return {
        ...state,
        view: 'ERROR',
        isProcessing: false,
        errorDetails: {
          message:   action.message,
          code:      action.code,
          retryable: action.retryable !== false,
        },
      };

    case 'RESET_FLOW':
      return { ...initialState, history: state.history };

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
      };
    }

    case 'LOAD_HISTORY':
      return { ...state, history: action.history };

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

  const startFlow     = useCallback((mode)        => dispatch({ type: 'START_FLOW', mode }), []);
  const submitInput   = useCallback((inputData)   => dispatch({ type: 'SUBMIT_INPUT', inputData }), []);
  const reportSuccess = useCallback((data)        => dispatch({ type: 'PROCESS_SUCCESS', data }), []);
  const reportError   = useCallback((message, code, retryable = true) =>
                                     dispatch({ type: 'PROCESS_ERROR', message, code, retryable }), []);
  const reset         = useCallback(()            => dispatch({ type: 'RESET_FLOW' }), []);
  const replay        = useCallback((data)        => dispatch({ type: 'REPLAY_DECISION', data }), []);

  return { state, dispatch, startFlow, submitInput, reportSuccess, reportError, reset, replay };
}
