import { MONETARY_STATUS, sameMonetaryUnit } from './operationalMonetary.js';
import { compareRevenueWindows, PERIOD_COMPATIBILITY } from './revenueMeasurementWindow.js';
import { declareStatusVocabulary, KNOWLEDGE } from '@marcom/runtime-contracts';

export const EFFICIENCY_STATUS = Object.freeze({ VALID: 'VALID', UNAVAILABLE: 'UNAVAILABLE' });
export const EFFICIENCY_KNOWLEDGE = declareStatusVocabulary('EFFICIENCY_STATUS', EFFICIENCY_STATUS, {
  [EFFICIENCY_STATUS.VALID]: KNOWLEDGE.KNOWN,
  [EFFICIENCY_STATUS.UNAVAILABLE]: KNOWLEDGE.CANNOT_ASK,
});
export const EFFICIENCY_REASON = Object.freeze({
  REVENUE_BASIS_UNAVAILABLE: 'REVENUE_BASIS_UNAVAILABLE',
  SPEND_BASIS_UNAVAILABLE: 'SPEND_BASIS_UNAVAILABLE',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  CURRENCY_UNTRUSTED: 'CURRENCY_UNTRUSTED',
  MEASUREMENT_WINDOW_UNKNOWN: 'MEASUREMENT_WINDOW_UNKNOWN',
  MEASUREMENT_WINDOW_MISMATCH: 'MEASUREMENT_WINDOW_MISMATCH',
  ZERO_DENOMINATOR: 'ZERO_DENOMINATOR',
});

// The numerator is the selected Blended Truth revenue, never total-business
// revenue. A ratio is publishable only when both monetary and temporal evidence
// prove that these two amounts can be divided.
export function evaluateBlendedRevenueEfficiency({
  revenueMinor, spendMinor, revenueMoney, spendMoney, revenueWindow, spendWindow,
} = {}) {
  const windowCompatibility = compareRevenueWindows(revenueWindow, spendWindow);
  const unavailable = (reason) => ({ status: EFFICIENCY_STATUS.UNAVAILABLE, reason, value: null, currency: null, windowCompatibility });
  if (!Number.isFinite(revenueMinor) || revenueMinor < 0) return unavailable(EFFICIENCY_REASON.REVENUE_BASIS_UNAVAILABLE);
  if (!Number.isFinite(spendMinor) || spendMinor < 0) return unavailable(EFFICIENCY_REASON.SPEND_BASIS_UNAVAILABLE);
  if (revenueMoney?.monetaryStatus !== MONETARY_STATUS.VALID || spendMoney?.monetaryStatus !== MONETARY_STATUS.VALID) {
    return unavailable(EFFICIENCY_REASON.CURRENCY_UNTRUSTED);
  }
  if (sameMonetaryUnit(revenueMoney, spendMoney).monetaryStatus !== MONETARY_STATUS.VALID) {
    return unavailable(EFFICIENCY_REASON.CURRENCY_MISMATCH);
  }
  if (windowCompatibility === PERIOD_COMPATIBILITY.UNKNOWN) return unavailable(EFFICIENCY_REASON.MEASUREMENT_WINDOW_UNKNOWN);
  if (windowCompatibility === PERIOD_COMPATIBILITY.INCOMPATIBLE) return unavailable(EFFICIENCY_REASON.MEASUREMENT_WINDOW_MISMATCH);
  if (spendMinor === 0) return unavailable(EFFICIENCY_REASON.ZERO_DENOMINATOR);
  return {
    status: EFFICIENCY_STATUS.VALID, reason: null,
    value: revenueMinor / spendMinor, currency: revenueMoney.currency, windowCompatibility,
  };
}
