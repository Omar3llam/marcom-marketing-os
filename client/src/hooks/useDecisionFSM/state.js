import { validateDecisionContract } from '@/types/decision.js';

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
  executionStatus: null,
};

export const LEGAL = {
  START_FLOW:              ['COMMAND_CENTER'],
  REVIEW_ALERT:            ['COMMAND_CENTER'],
  VIEW_PORTFOLIO:          ['COMMAND_CENTER', 'PORTFOLIO'],
  VIEW_TESTING:            ['COMMAND_CENTER', 'TESTING'],
  VIEW_MEMORY:             ['COMMAND_CENTER', 'MEMORY'],
  VIEW_PLAN:               ['COMMAND_CENTER', 'PLAN'],
  VIEW_MEASURE:            ['COMMAND_CENTER', 'MEASURE'],
  SUBMIT_INPUT:            ['INPUT_VALIDATION', 'ERROR'],
  THEATRE_ADVANCE:         ['THEATER'],
  PROCESS_SUCCESS:         ['THEATER'],
  PROCESS_ERROR:           ['THEATER', 'INPUT_VALIDATION', 'API_EXECUTION', 'EXECUTING', 'EXECUTED_FAILED'],
  CONFIRM_EXECUTION:       ['SUCCESS'],
  EXECUTE_ACTION:          ['CONFIRM_EXECUTION'],
  EXECUTION_STATUS_UPDATE: ['CONFIRM_EXECUTION', 'API_EXECUTION', 'EXECUTION_QUEUED', 'EXECUTING', 'EXECUTED_SUCCESS', 'EXECUTED_FAILED'],
  EXECUTION_COMPLETE:      ['EXECUTED_SUCCESS'],
  COMMIT_TO_MEMORY:        ['EXECUTED_SUCCESS'],
  RESET_FLOW:              ['INPUT_VALIDATION', 'THEATER', 'SUCCESS', 'ERROR', 'COMMAND_CENTER', 'CONFIRM_EXECUTION', 'MEMORY_COMMIT', 'EXECUTION_QUEUED', 'EXECUTING', 'EXECUTED_SUCCESS', 'EXECUTED_FAILED', 'PORTFOLIO', 'TESTING', 'MEMORY', 'PLAN', 'MEASURE'],
  REPLAY_DECISION:         ['COMMAND_CENTER'],
  LOAD_HISTORY:            ['COMMAND_CENTER', 'INPUT_VALIDATION', 'THEATER', 'SUCCESS', 'ERROR'],
  LOAD_RADAR_ALERTS:       ['COMMAND_CENTER'],
  CLEAR_HISTORY:           ['COMMAND_CENTER'],
};

export function legal(view, type) {
  if (!LEGAL[type]) return true;
  if (LEGAL[type].includes(view)) return true;
  console.warn(`[DecisionFSM] illegal transition ${type} from ${view}`);
  return false;
}

const HISTORY_KEY = 'lumi:decisionHistory';
const RADAR_KEY   = 'lumi:radarAlerts';

export function persistHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }
  catch { /* quota exceeded */ }
}

export function clearStoredHistory() {
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

export function persistRadarAlerts(alerts) {
  try { localStorage.setItem(RADAR_KEY, JSON.stringify(alerts)); }
  catch { /* quota exceeded */ }
}
