// A deliberately narrow answer to one question: may monetary campaign values
// be compared or added without conversion? It never chooses a default currency,
// repairs a row, or converts an amount.
import { isSupportedCurrency } from './currencyDetector.js';

export const CURRENCY_HOMOGENEITY = Object.freeze({
  HOMOGENEOUS_KNOWN: 'HOMOGENEOUS_KNOWN',
  MIXED: 'MIXED',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Classify the rows that actually contribute positive monetary value.
 * Null and measured-zero amounts do not enter a sum, share, or ranking and
 * therefore do not establish (or invalidate) its unit.
 */
export function classifyCurrencyHomogeneity(rows = [], { amountField = 'spendMinor' } = {}) {
  const contributors = Array.isArray(rows)
    ? rows.filter((row) => Number.isFinite(row?.[amountField]) && row[amountField] > 0)
    : [];

  if (contributors.length === 0) {
    return { status: CURRENCY_HOMOGENEITY.UNKNOWN, currency: null, contributorCount: 0 };
  }

  const currencies = new Set();
  for (const row of contributors) {
    if (!isSupportedCurrency(row?.currency)) {
      return {
        status: CURRENCY_HOMOGENEITY.UNKNOWN,
        currency: null,
        contributorCount: contributors.length,
      };
    }
    currencies.add(row.currency.toUpperCase().trim());
  }

  if (currencies.size > 1) {
    return {
      status: CURRENCY_HOMOGENEITY.MIXED,
      currency: null,
      contributorCount: contributors.length,
    };
  }

  return {
    status: CURRENCY_HOMOGENEITY.HOMOGENEOUS_KNOWN,
    currency: [...currencies][0],
    contributorCount: contributors.length,
  };
}

export function currencyUnavailableReason(status) {
  if (status === CURRENCY_HOMOGENEITY.MIXED) return 'MIXED_CURRENCY';
  if (status === CURRENCY_HOMOGENEITY.UNKNOWN) return 'UNKNOWN_CURRENCY';
  return null;
}
