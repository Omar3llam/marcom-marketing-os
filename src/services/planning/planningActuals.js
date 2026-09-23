import { classifyCurrencyHomogeneity, CURRENCY_HOMOGENEITY } from '../../lib/currencyHomogeneity.js';
import { isSupportedCurrency } from '../../lib/currencyDetector.js';

export const PLANNING_EVIDENCE = Object.freeze({
  VALID: 'VALID',
  INSUFFICIENT: 'INSUFFICIENT_EVIDENCE',
});

export const PLANNING_REASON = Object.freeze({
  BUSINESS_REVENUE_SOURCE_UNAVAILABLE: 'BUSINESS_REVENUE_SOURCE_UNAVAILABLE',
  ACTUAL_CURRENCY_MIXED: 'ACTUAL_CURRENCY_MIXED',
  ACTUAL_CURRENCY_UNTRUSTED: 'ACTUAL_CURRENCY_UNTRUSTED',
  TARGET_CURRENCY_MISMATCH: 'TARGET_CURRENCY_MISMATCH',
  INSUFFICIENT_MEASUREMENT_EVIDENCE: 'INSUFFICIENT_MEASUREMENT_EVIDENCE',
  MEASUREMENT_WINDOW_UNTRUSTED: 'MEASUREMENT_WINDOW_UNTRUSTED',
  MEASUREMENT_WINDOW_MISMATCH: 'MEASUREMENT_WINDOW_MISMATCH',
});

const unavailable = (reason) => ({ status: PLANNING_EVIDENCE.INSUFFICIENT, reason, currency: null, value: null });
const valid = (value, currency) => ({ status: PLANNING_EVIDENCE.VALID, reason: null, currency, value });

function unit(rows, field) {
  const result = classifyCurrencyHomogeneity(rows, { amountField: field, requireAuthoritative: true });
  if (result.status === CURRENCY_HOMOGENEITY.MIXED) return unavailable(PLANNING_REASON.ACTUAL_CURRENCY_MIXED);
  if (result.status !== CURRENCY_HOMOGENEITY.HOMOGENEOUS_AUTHORITATIVE) {
    return unavailable(PLANNING_REASON.ACTUAL_CURRENCY_UNTRUSTED);
  }
  return valid(null, result.currency);
}

function dayOf(date) {
  if (date == null) return null;
  const time = new Date(date).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

function commonWindow(rows) {
  const periods = rows.map((r) => {
    const start = dayOf(r.windowStart);
    const end = dayOf(r.windowEnd);
    return r.measurementWindow === 'ROLLING_WINDOW' && start && end && start <= end
      ? `${start}|${end}` : null;
  });
  if (periods.some((p) => p == null)) return PLANNING_REASON.MEASUREMENT_WINDOW_UNTRUSTED;
  return new Set(periods).size === 1 ? null : PLANNING_REASON.MEASUREMENT_WINDOW_MISMATCH;
}

/** One complete observation-day population. No unsafe row is dropped to make a ratio. */
export function evaluatePlanningActual(rows, metric, targetCurrency) {
  if (metric === 'mer') return unavailable(PLANNING_REASON.BUSINESS_REVENUE_SOURCE_UNAVAILABLE);
  if (!Array.isArray(rows) || rows.length === 0) return unavailable(PLANNING_REASON.INSUFFICIENT_MEASUREMENT_EVIDENCE);
  if (!['blendedCac', 'blendedRoas', 'actualSpend'].includes(metric)) {
    return unavailable(PLANNING_REASON.INSUFFICIENT_MEASUREMENT_EVIDENCE);
  }
  if (rows.some((r) => !Number.isFinite(r.spendMinor) || r.spendMinor < 0)) {
    return unavailable(PLANNING_REASON.INSUFFICIENT_MEASUREMENT_EVIDENCE);
  }
  const spend = unit(rows, 'spendMinor');
  if (spend.status !== PLANNING_EVIDENCE.VALID) return spend;
  const windowReason = commonWindow(rows);
  if (windowReason) return unavailable(windowReason);
  const spendMinor = rows.reduce((total, r) => total + r.spendMinor, 0);
  if (spendMinor <= 0) return unavailable(PLANNING_REASON.INSUFFICIENT_MEASUREMENT_EVIDENCE);

  if (metric === 'actualSpend' || metric === 'blendedCac') {
    if (!isSupportedCurrency(targetCurrency) || targetCurrency.trim().toUpperCase() !== spend.currency) {
      return unavailable(PLANNING_REASON.TARGET_CURRENCY_MISMATCH);
    }
    if (metric === 'actualSpend') return valid(spendMinor, spend.currency);
    if (rows.some((r) => !Number.isInteger(r.conversions) || r.conversions < 0)) {
      return unavailable(PLANNING_REASON.INSUFFICIENT_MEASUREMENT_EVIDENCE);
    }
    const conversions = rows.reduce((total, r) => total + r.conversions, 0);
    return conversions > 0 ? valid(spendMinor / conversions, spend.currency)
      : unavailable(PLANNING_REASON.INSUFFICIENT_MEASUREMENT_EVIDENCE);
  }

  if (rows.some((r) => !Number.isFinite(r.revenueMinor) || r.revenueMinor < 0)) {
    return unavailable(PLANNING_REASON.INSUFFICIENT_MEASUREMENT_EVIDENCE);
  }
  const revenue = unit(rows, 'revenueMinor');
  if (revenue.status !== PLANNING_EVIDENCE.VALID) return revenue;
  if (revenue.currency !== spend.currency) return unavailable(PLANNING_REASON.ACTUAL_CURRENCY_MIXED);
  const revenueMinor = rows.reduce((total, r) => total + r.revenueMinor, 0);
  return revenueMinor > 0 ? valid(revenueMinor / spendMinor, spend.currency)
    : unavailable(PLANNING_REASON.INSUFFICIENT_MEASUREMENT_EVIDENCE);
}
