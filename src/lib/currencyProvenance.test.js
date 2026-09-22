import { describe, it, expect } from 'vitest';
import {
  CURRENCY_PROVENANCE as P, currencyWithProvenance,
  isAuthoritativeCurrency, resolveSyncCurrencyWithProvenance,
} from './currencyProvenance.js';

describe('currency origin is independent of code validity', () => {
  it.each(['EGP', 'USD', 'SAR'])('reports %s only when the platform supplied it', (currency) => {
    const result = resolveSyncCurrencyWithProvenance(currency, 'AED');
    expect(result).toEqual({ currency, currencyProvenance: P.PLATFORM_REPORTED, source: 'reported' });
    expect(isAuthoritativeCurrency(result)).toBe(true);
  });

  it('keeps workspace inference distinguishable from default USD', () => {
    const workspace = resolveSyncCurrencyWithProvenance(null, 'EGP');
    const fallback = resolveSyncCurrencyWithProvenance(null, null);
    expect(workspace).toMatchObject({ currency: 'EGP', currencyProvenance: P.WORKSPACE_INFERRED });
    expect(fallback).toMatchObject({ currency: 'USD', currencyProvenance: P.FALLBACK_DEFAULT });
    expect(isAuthoritativeCurrency(workspace)).toBe(false);
    expect(isAuthoritativeCurrency(fallback)).toBe(false);
  });

  it.each(Object.values(P).filter((p) => p !== P.PLATFORM_REPORTED))('%s never attests a valid code', (currencyProvenance) => {
    expect(isAuthoritativeCurrency({ currency: 'USD', currencyProvenance })).toBe(false);
  });

  it.each([null, undefined, '', '???', 'ZZZ', 42])('invalid code %s cannot be authoritative', (currency) => {
    expect(isAuthoritativeCurrency({ currency, currencyProvenance: P.PLATFORM_REPORTED })).toBe(false);
    const resolved = resolveSyncCurrencyWithProvenance(currency, null);
    expect(resolved.currencyProvenance).toBe(P.FALLBACK_DEFAULT);
  });

  it('does not infer provenance from a valid code or an unknown token', () => {
    expect(currencyWithProvenance('EGP')).toEqual({ currency: 'EGP', currencyProvenance: P.LEGACY_UNKNOWN });
    expect(currencyWithProvenance('EGP', 'reported').currencyProvenance).toBe(P.LEGACY_UNKNOWN);
    expect(isAuthoritativeCurrency({ currency: 'EGP' })).toBe(false);
  });

  it('a missing code cannot inherit a reported tag onto fallback USD', () => {
    expect(currencyWithProvenance(null, P.PLATFORM_REPORTED)).toEqual({
      currency: 'USD', currencyProvenance: P.FALLBACK_DEFAULT,
    });
  });

  it('preserves supplied codes and invalid source facts without validating them into authority', () => {
    expect(currencyWithProvenance(' egp ', P.PLATFORM_REPORTED).currency).toBe(' egp ');
    const malformed = currencyWithProvenance('???', P.PLATFORM_REPORTED);
    expect(malformed.currency).toBe('???');
    expect(isAuthoritativeCurrency(malformed)).toBe(false);
  });
});
