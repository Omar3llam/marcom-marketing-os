export const SESSION_KEY_PREFIX = 'lumi:execution:';
export const RECONCILIATION_DEBOUNCE_MS = 500;

export const TERMINAL_STATES = ['EXECUTED_SUCCESS', 'EXECUTED_FAILED', 'TIMED_OUT', 'CANCELLED'];

export function isTerminalStatus(status) {
  return TERMINAL_STATES.includes(status);
}

export function persistExecutionSnapshot(executionId, state) {
  try {
    sessionStorage.setItem(`${SESSION_KEY_PREFIX}${executionId}`, JSON.stringify(state));
  } catch (err) {
    console.warn('[ExecutionReconciliation] Failed to persist snapshot', err);
  }
}

export function loadExecutionSnapshot(executionId) {
  try {
    const raw = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${executionId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[ExecutionReconciliation] Failed to load snapshot', err);
    return null;
  }
}

export function emitTelemetry(eventType, data) {
  console.debug(`[Telemetry] ${eventType}`, data);
}
