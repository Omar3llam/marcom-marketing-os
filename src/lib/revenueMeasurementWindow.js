// A revenue window is evidence about the period measured, never about sync time.
// MetricSnapshot already stores the bounds; LEGACY_UNKNOWN and absent/invalid
// bounds cannot be promoted to an exact period by a reader.
import { declareStatusVocabulary, KNOWLEDGE } from '@marcom/runtime-contracts';

export const REVENUE_WINDOW_STATUS = Object.freeze({ EXACT: 'EXACT', UNKNOWN: 'UNKNOWN' });
export const REVENUE_WINDOW_KNOWLEDGE = declareStatusVocabulary('REVENUE_WINDOW_STATUS', REVENUE_WINDOW_STATUS, {
  [REVENUE_WINDOW_STATUS.EXACT]: KNOWLEDGE.KNOWN,
  [REVENUE_WINDOW_STATUS.UNKNOWN]: KNOWLEDGE.NOT_ENOUGH,
});
export const PERIOD_COMPATIBILITY = Object.freeze({
  COMPATIBLE: 'COMPATIBLE', INCOMPATIBLE: 'INCOMPATIBLE', UNKNOWN: 'UNKNOWN',
});

export const unknownRevenueWindow = () => ({ windowStatus: REVENUE_WINDOW_STATUS.UNKNOWN, windowStart: null, windowEnd: null });

const time = (value) => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
};

export function exactRevenueWindow(windowStart, windowEnd) {
  const start = time(windowStart);
  const end = time(windowEnd);
  return start != null && end != null && start <= end
    ? { windowStatus: REVENUE_WINDOW_STATUS.EXACT, windowStart: new Date(start), windowEnd: new Date(end) }
    : unknownRevenueWindow();
}

export function revenueWindowOfSnapshot(row) {
  if (!row || !['ROLLING_WINDOW', 'CUMULATIVE_30D', 'DAILY'].includes(row.measurementWindow)) {
    return unknownRevenueWindow();
  }
  return exactRevenueWindow(row.windowStart, row.windowEnd);
}

export function combineRevenueWindows(windows = []) {
  if (windows.length === 0) return unknownRevenueWindow();
  const first = windows[0];
  if (first?.windowStatus !== REVENUE_WINDOW_STATUS.EXACT) return unknownRevenueWindow();
  const exact = exactRevenueWindow(first.windowStart, first.windowEnd);
  if (exact.windowStatus !== REVENUE_WINDOW_STATUS.EXACT) return exact;
  return windows.every((window) => compareRevenueWindows(exact, window) === PERIOD_COMPATIBILITY.COMPATIBLE)
    ? exact : unknownRevenueWindow();
}

// Exact equality, not overlap. Unknown evidence cannot establish either match
// or mismatch, so the caller must keep a third state instead of guessing.
export function compareRevenueWindows(revenue, spend) {
  if (revenue?.windowStatus !== REVENUE_WINDOW_STATUS.EXACT
    || spend?.windowStatus !== REVENUE_WINDOW_STATUS.EXACT) return PERIOD_COMPATIBILITY.UNKNOWN;
  const a = exactRevenueWindow(revenue.windowStart, revenue.windowEnd);
  const b = exactRevenueWindow(spend.windowStart, spend.windowEnd);
  if (a.windowStatus !== REVENUE_WINDOW_STATUS.EXACT || b.windowStatus !== REVENUE_WINDOW_STATUS.EXACT) {
    return PERIOD_COMPATIBILITY.UNKNOWN;
  }
  return a.windowStart.getTime() === b.windowStart.getTime() && a.windowEnd.getTime() === b.windowEnd.getTime()
    ? PERIOD_COMPATIBILITY.COMPATIBLE : PERIOD_COMPATIBILITY.INCOMPATIBLE;
}
