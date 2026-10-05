import { declareStatusVocabulary, KNOWLEDGE } from '@marcom/runtime-contracts';
import { MONETARY_STATUS, sameMonetaryUnit, monetaryUnavailable, MONETARY_REASON } from './operationalMonetary.js';
import { isAuthoritativeCurrency } from './currencyProvenance.js';
import { compareRevenueWindows, combineRevenueWindows, unknownRevenueWindow, PERIOD_COMPATIBILITY } from './revenueMeasurementWindow.js';

export const RECONCILIATION_STATUS = Object.freeze({ AVAILABLE: 'AVAILABLE', UNAVAILABLE: 'UNAVAILABLE', UNVERIFIED: 'UNVERIFIED' });
export const RECONCILIATION_KNOWLEDGE = declareStatusVocabulary('RECONCILIATION_STATUS', RECONCILIATION_STATUS, {
  AVAILABLE: KNOWLEDGE.KNOWN, UNAVAILABLE: KNOWLEDGE.NOT_ENOUGH, UNVERIFIED: KNOWLEDGE.NOTHING_THERE,
});
export const RECONCILIATION_REASON = Object.freeze({
  ACTUAL_REVENUE_UNAVAILABLE: 'ACTUAL_REVENUE_UNAVAILABLE', MONETARY_BASIS_UNAVAILABLE: 'MONETARY_BASIS_UNAVAILABLE',
  MEASUREMENT_WINDOW_UNKNOWN: 'MEASUREMENT_WINDOW_UNKNOWN', MEASUREMENT_WINDOW_MISMATCH: 'MEASUREMENT_WINDOW_MISMATCH',
  PORTFOLIO_WINDOW_MISMATCH: 'PORTFOLIO_WINDOW_MISMATCH', PORTFOLIO_CURRENCY_MISMATCH: 'PORTFOLIO_CURRENCY_MISMATCH',
  NO_COMPARABLE_CHANNELS: 'NO_COMPARABLE_CHANNELS', ZERO_PLATFORM_DENOMINATOR: 'ZERO_PLATFORM_DENOMINATOR',
});

const withheld = (status, reason, windowCompatibility = PERIOD_COMPATIBILITY.UNKNOWN) => ({
  status, reason, windowCompatibility, window: unknownRevenueWindow(), currency: null,
  platformRevenueMinor: null, actualRevenueMinor: null, gapMinor: null, gapPct: null,
  gapPctReason: null, gapDenominator: 'PLATFORM_REVENUE',
});
// This arithmetic answers only platform-vs-actual reconciliation, never the
// independent selected-revenue/spend efficiency question.
function available(platformRevenueMinor, actualRevenueMinor, currency, window) {
  const gapMinor = platformRevenueMinor - actualRevenueMinor;
  const gapPct = platformRevenueMinor === 0 ? (gapMinor === 0 ? 0 : null) : gapMinor / platformRevenueMinor;
  if (![platformRevenueMinor, actualRevenueMinor, gapMinor].every(Number.isFinite)
    || (gapPct !== null && !Number.isFinite(gapPct))) {
    return withheld(RECONCILIATION_STATUS.UNAVAILABLE, RECONCILIATION_REASON.MONETARY_BASIS_UNAVAILABLE);
  }
  return { status: RECONCILIATION_STATUS.AVAILABLE, reason: null, windowCompatibility: PERIOD_COMPATIBILITY.COMPATIBLE,
    window, currency, platformRevenueMinor, actualRevenueMinor, gapMinor, gapPct,
    gapPctReason: gapPct === null ? RECONCILIATION_REASON.ZERO_PLATFORM_DENOMINATOR : null, gapDenominator: 'PLATFORM_REVENUE' };
}

// Positive-only aggregation authority cannot denominate measured zero. For this
// comparison, source measurements (including zero) carry their own persisted
// currency evidence. Reuse the currency and monetary-unit authorities without
// changing efficiency's existing selected-revenue/spend contract.
function reconciliationUnit(measurements, publishedMoney) {
  if (measurements === undefined) return publishedMoney;
  if (!measurements.length || measurements.some(row => !Number.isFinite(row.amountMinor) || !isAuthoritativeCurrency(row))) {
    return monetaryUnavailable(MONETARY_REASON.SPEND_CURRENCY_UNTRUSTED);
  }
  return sameMonetaryUnit(...measurements.map(row => ({ monetaryStatus: MONETARY_STATUS.VALID,
    monetaryReason: null, currency: row.currency.trim().toUpperCase() })));
}

export function evaluateRevenueReconciliation({ actualPresent, platformRevenueMinor, actualRevenueMinor,
  platformMoney, actualMoney, platformMeasurements, actualMeasurements, platformWindow, actualWindow, platformPresent = true } = {}) {
  const windowCompatibility = compareRevenueWindows(platformWindow, actualWindow);
  const refuse = reason => withheld(RECONCILIATION_STATUS.UNAVAILABLE, reason, windowCompatibility);
  if (!actualPresent) return withheld(RECONCILIATION_STATUS.UNVERIFIED, RECONCILIATION_REASON.ACTUAL_REVENUE_UNAVAILABLE);
  const unit = sameMonetaryUnit(reconciliationUnit(platformMeasurements, platformMoney), reconciliationUnit(actualMeasurements, actualMoney));
  if (!platformPresent || !Number.isFinite(platformRevenueMinor) || !Number.isFinite(actualRevenueMinor)
    || unit.monetaryStatus !== MONETARY_STATUS.VALID) return refuse(RECONCILIATION_REASON.MONETARY_BASIS_UNAVAILABLE);
  if (windowCompatibility === PERIOD_COMPATIBILITY.UNKNOWN) return refuse(RECONCILIATION_REASON.MEASUREMENT_WINDOW_UNKNOWN);
  if (windowCompatibility === PERIOD_COMPATIBILITY.INCOMPATIBLE) return refuse(RECONCILIATION_REASON.MEASUREMENT_WINDOW_MISMATCH);
  return available(platformRevenueMinor, actualRevenueMinor, unit.currency, combineRevenueWindows([platformWindow, actualWindow]));
}

// Portfolio membership comes exclusively from published channel reconciliations.
// Never re-evaluate raw-source eligibility or let excluded channels dilute gaps.
export function aggregateRevenueReconciliations(reconciliations = []) {
  const comparable = reconciliations.filter(r => r.status === RECONCILIATION_STATUS.AVAILABLE);
  const counts = { reconciledCount: comparable.length,
    unverifiedCount: reconciliations.filter(r => r.status === RECONCILIATION_STATUS.UNVERIFIED).length,
    unavailableCount: reconciliations.filter(r => r.status === RECONCILIATION_STATUS.UNAVAILABLE).length,
    totalChannelCount: reconciliations.length };
  const result = (() => {
    if (!comparable.length) return withheld(counts.unavailableCount ? RECONCILIATION_STATUS.UNAVAILABLE : RECONCILIATION_STATUS.UNVERIFIED,
      counts.unavailableCount ? RECONCILIATION_REASON.NO_COMPARABLE_CHANNELS : RECONCILIATION_REASON.ACTUAL_REVENUE_UNAVAILABLE);
    const window = combineRevenueWindows(comparable.map(r => r.window));
    if (window.windowStatus !== 'EXACT') return withheld(RECONCILIATION_STATUS.UNAVAILABLE, RECONCILIATION_REASON.PORTFOLIO_WINDOW_MISMATCH, PERIOD_COMPATIBILITY.INCOMPATIBLE);
    const unit = sameMonetaryUnit(...comparable.map(r => ({ monetaryStatus: MONETARY_STATUS.VALID, currency: r.currency })));
    if (unit.monetaryStatus !== MONETARY_STATUS.VALID) return withheld(RECONCILIATION_STATUS.UNAVAILABLE, RECONCILIATION_REASON.PORTFOLIO_CURRENCY_MISMATCH, PERIOD_COMPATIBILITY.COMPATIBLE);
    return available(comparable.reduce((sum, r) => sum + r.platformRevenueMinor, 0),
      comparable.reduce((sum, r) => sum + r.actualRevenueMinor, 0), unit.currency, window);
  })();
  return { ...result, ...counts };
}
