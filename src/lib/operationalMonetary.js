import { classifyCurrencyHomogeneity, CURRENCY_HOMOGENEITY } from './currencyHomogeneity.js';
import { isSupportedCurrency } from './currencyDetector.js';
import { declareStatusVocabulary, KNOWLEDGE } from '@marcom/runtime-contracts';

export const MONETARY_STATUS = Object.freeze({
  VALID: 'MONETARY_VALID',
  UNAVAILABLE_MIXED: 'MONETARY_UNAVAILABLE_MIXED',
  UNAVAILABLE_UNTRUSTED: 'MONETARY_UNAVAILABLE_UNTRUSTED',
});

export const MONETARY_KNOWLEDGE = declareStatusVocabulary('MONETARY_STATUS', MONETARY_STATUS, {
  [MONETARY_STATUS.VALID]: KNOWLEDGE.KNOWN,
  [MONETARY_STATUS.UNAVAILABLE_MIXED]: KNOWLEDGE.CANNOT_ASK,
  [MONETARY_STATUS.UNAVAILABLE_UNTRUSTED]: KNOWLEDGE.CANNOT_ASK,
});

export const MONETARY_REASON = Object.freeze({
  SPEND_CURRENCY_MIXED: 'SPEND_CURRENCY_MIXED',
  SPEND_CURRENCY_UNTRUSTED: 'SPEND_CURRENCY_UNTRUSTED',
  BUDGET_CURRENCY_MISSING: 'BUDGET_CURRENCY_MISSING',
  BUDGET_CURRENCY_INVALID: 'BUDGET_CURRENCY_INVALID',
  BUDGET_CURRENCY_MISMATCH: 'BUDGET_CURRENCY_MISMATCH',
  INCREMENTAL_MONETARY_BASIS_UNPROVEN: 'INCREMENTAL_MONETARY_BASIS_UNPROVEN',
  OUTCOME_MONETARY_BASIS_UNPROVEN: 'OUTCOME_MONETARY_BASIS_UNPROVEN',
});

export function monetaryUnavailable(reason, mixed = false) {
  return { monetaryStatus: mixed ? MONETARY_STATUS.UNAVAILABLE_MIXED : MONETARY_STATUS.UNAVAILABLE_UNTRUSTED, monetaryReason: reason, currency: null };
}

export function authoritativeMoney(rows, amountField = 'amountMinor', { mixedReason = MONETARY_REASON.SPEND_CURRENCY_MIXED, untrustedReason = MONETARY_REASON.SPEND_CURRENCY_UNTRUSTED } = {}) {
  const verdict = classifyCurrencyHomogeneity(rows, { amountField, requireAuthoritative: true });
  if (verdict.status === CURRENCY_HOMOGENEITY.MIXED) return monetaryUnavailable(mixedReason, true);
  if (verdict.status !== CURRENCY_HOMOGENEITY.HOMOGENEOUS_AUTHORITATIVE) return monetaryUnavailable(untrustedReason);
  return { monetaryStatus: MONETARY_STATUS.VALID, monetaryReason: null, currency: verdict.currency };
}

export function matchBudgetCurrency(spend, budgetCurrency) {
  if (budgetCurrency == null || budgetCurrency === '') return monetaryUnavailable(MONETARY_REASON.BUDGET_CURRENCY_MISSING);
  if (typeof budgetCurrency !== 'string' || !isSupportedCurrency(budgetCurrency)) return monetaryUnavailable(MONETARY_REASON.BUDGET_CURRENCY_INVALID);
  if (spend.monetaryStatus !== MONETARY_STATUS.VALID) return spend;
  if (budgetCurrency.trim().toUpperCase() !== spend.currency) return monetaryUnavailable(MONETARY_REASON.BUDGET_CURRENCY_MISMATCH);
  return spend;
}

export function sameMonetaryUnit(...states) {
  if (states.length === 0) return monetaryUnavailable(MONETARY_REASON.SPEND_CURRENCY_UNTRUSTED);
  const unavailable = states.find((s) => s?.monetaryStatus !== MONETARY_STATUS.VALID);
  if (states.some((s) => s?.monetaryStatus !== MONETARY_STATUS.VALID)) return unavailable ?? monetaryUnavailable(MONETARY_REASON.SPEND_CURRENCY_UNTRUSTED);
  const currencies = new Set(states.map((s) => s.currency));
  return currencies.size === 1 ? states[0] : monetaryUnavailable(MONETARY_REASON.SPEND_CURRENCY_MIXED, true);
}
