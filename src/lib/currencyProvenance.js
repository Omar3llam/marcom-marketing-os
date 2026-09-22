import { isSupportedCurrency, resolveSyncCurrency } from './currencyDetector.js';

// Origin and validity are separate facts. In particular, a valid code copied
// from configuration or another observation is not a source denomination.
export const CURRENCY_PROVENANCE = Object.freeze({
  PLATFORM_REPORTED: 'PLATFORM_REPORTED',
  WORKSPACE_INFERRED: 'WORKSPACE_INFERRED',
  FALLBACK_DEFAULT: 'FALLBACK_DEFAULT',
  LEGACY_UNKNOWN: 'LEGACY_UNKNOWN',
  // MANUAL uploads have neither a platform response nor a workspace lookup.
  USER_SUPPLIED: 'USER_SUPPLIED',
  SNAPSHOT_INFERRED: 'SNAPSHOT_INFERRED',
});

export function isAuthoritativeCurrency({ currency, currencyProvenance } = {}) {
  return currencyProvenance === CURRENCY_PROVENANCE.PLATFORM_REPORTED
    && isSupportedCurrency(currency);
}

/** Add persisted origin to the existing resolution; keep its code precedence. */
export function resolveSyncCurrencyWithProvenance(reported, workspaceCurrency) {
  const resolved = resolveSyncCurrency(reported, workspaceCurrency);
  const origins = {
    reported: CURRENCY_PROVENANCE.PLATFORM_REPORTED,
    workspace: CURRENCY_PROVENANCE.WORKSPACE_INFERRED,
    fallback: CURRENCY_PROVENANCE.FALLBACK_DEFAULT,
  };
  return { ...resolved, currencyProvenance: origins[resolved.source] };
}

/** Preserve the existing code/fallback behavior without inventing its origin. */
export function currencyWithProvenance(currency, currencyProvenance) {
  if (!currency) {
    return { currency: 'USD', currencyProvenance: CURRENCY_PROVENANCE.FALLBACK_DEFAULT };
  }
  return {
    currency,
    currencyProvenance: Object.values(CURRENCY_PROVENANCE).includes(currencyProvenance)
      ? currencyProvenance : CURRENCY_PROVENANCE.LEGACY_UNKNOWN,
  };
}
