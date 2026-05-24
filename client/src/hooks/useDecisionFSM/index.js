import { useReducer, useCallback, useRef, useEffect } from 'react';
import { initialState } from './state.js';
import { decisionReducer } from './reducer.js';

export {
  loadHistoryFromStorage,
  loadRadarAlertsFromStorage,
} from './state.js';

export function useDecisionFSM() {
  const [state, dispatch] = useReducer(decisionReducer, initialState);
  const abortControllerRef    = useRef(null);
  const executionTimeoutRef   = useRef(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null; }
      if (executionTimeoutRef.current) { clearTimeout(executionTimeoutRef.current); executionTimeoutRef.current = null; }
    };
  }, []);

  const startFlow = useCallback((mode) => { dispatch({ type: 'START_FLOW', mode }); }, []);

  const reviewAlert = useCallback((alertData) => { dispatch({ type: 'REVIEW_ALERT', alertData }); }, []);

  const submitInput = useCallback((inputData) => {
    if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null; }
    abortControllerRef.current = new AbortController();
    dispatch({ type: 'SUBMIT_INPUT', inputData });
  }, []);

  const reportSuccess = useCallback((data) => { dispatch({ type: 'PROCESS_SUCCESS', data }); }, []);

  const reportError = useCallback((message, code, classification = 'network', retryable = true, fallbackAction = null) => {
    const VALID_CLASSIFICATIONS = ['auth', 'network', 'platform', 'validation'];
    const sanitizedClassification = VALID_CLASSIFICATIONS.includes(classification) ? classification : 'network';
    dispatch({ type: 'PROCESS_ERROR', message, code, classification: sanitizedClassification, retryable, fallbackAction });
  }, []);

  const confirmExecution = useCallback(() => { dispatch({ type: 'CONFIRM_EXECUTION' }); }, []);

  const executeAction = useCallback(() => {
    if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null; }
    if (executionTimeoutRef.current) { clearTimeout(executionTimeoutRef.current); executionTimeoutRef.current = null; }
    abortControllerRef.current = new AbortController();
    executionTimeoutRef.current = setTimeout(() => {
      dispatch({ type: 'PROCESS_ERROR', message: 'Execution timeout - Meta API operation took too long', code: 'EXECUTION_TIMEOUT', classification: 'platform', retryable: true, fallbackAction: 'Try again or contact support if issue persists' });
    }, 120_000);
    dispatch({ type: 'EXECUTE_ACTION' });
  }, []);

  const executionComplete = useCallback(() => {
    if (executionTimeoutRef.current) { clearTimeout(executionTimeoutRef.current); executionTimeoutRef.current = null; }
    dispatch({ type: 'EXECUTION_COMPLETE' });
  }, []);

  const commitToMemory = useCallback(() => { dispatch({ type: 'COMMIT_TO_MEMORY' }); }, []);

  const reset = useCallback(() => {
    if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null; }
    if (executionTimeoutRef.current) { clearTimeout(executionTimeoutRef.current); executionTimeoutRef.current = null; }
    dispatch({ type: 'RESET_FLOW' });
  }, []);

  const replay = useCallback((data) => { dispatch({ type: 'REPLAY_DECISION', data }); }, []);

  const loadRadarAlerts = useCallback((alerts) => { dispatch({ type: 'LOAD_RADAR_ALERTS', alerts }); }, []);

  const updateExecutionStatus = useCallback((status, error = null, timestamp = null) => {
    if (status === 'EXECUTED_SUCCESS' || status === 'EXECUTED_FAILED') {
      if (executionTimeoutRef.current) { clearTimeout(executionTimeoutRef.current); executionTimeoutRef.current = null; }
    }
    dispatch({ type: 'EXECUTION_STATUS_UPDATE', status, error, timestamp: timestamp || new Date().toISOString() });
  }, []);

  return {
    state, dispatch,
    abortSignal: abortControllerRef.current?.signal,
    startFlow, reviewAlert, submitInput, reportSuccess, reportError,
    confirmExecution, executeAction, executionComplete, commitToMemory,
    reset, replay, loadRadarAlerts, updateExecutionStatus,
  };
}
