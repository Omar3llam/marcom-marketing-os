// ============================================================
// currencyForMarket — onboarding market → default display currency
// ============================================================
// New workspaces start with a sensible display currency derived from the
// onboarding market (the id stored on user.context.market), so an EG account
// reads EGP everywhere from day one instead of USD-until-first-sync. The map
// mirrors client/src/pages/OnboardingPage/constants.js MARKETS; the Meta/CSV
// currency still overrides it as the authoritative source.
import { describe, it, expect } from 'vitest';
import { currencyForMarket, isSupportedCurrency, validateCurrencyCode } from './currencyDetector.js';

describe('currencyForMarket', () => {
  it('maps every onboarding market id to its currency', () => {
    expect(currencyForMarket('eg')).toBe('EGP');
    expect(currencyForMarket('sa')).toBe('SAR');
    expect(currencyForMarket('ae')).toBe('AED');
    expect(currencyForMarket('kw')).toBe('KWD');
    expect(currencyForMarket('jo')).toBe('JOD');
    expect(currencyForMarket('ma')).toBe('MAD');
  });

  it('is case-insensitive and trims', () => {
    expect(currencyForMarket(' EG ')).toBe('EGP');
    expect(currencyForMarket('Sa')).toBe('SAR');
  });

  it('falls back to USD for an unknown or missing market (never throws)', () => {
    expect(currencyForMarket('us')).toBe('USD');
    expect(currencyForMarket('')).toBe('USD');
    expect(currencyForMarket(null)).toBe('USD');
    expect(currencyForMarket(undefined)).toBe('USD');
    expect(currencyForMarket(42)).toBe('USD');
  });

  it('every mapped currency is itself a supported ISO code (downstream validators accept it)', () => {
    for (const m of ['eg', 'sa', 'ae', 'kw', 'jo', 'ma']) {
      const ccy = currencyForMarket(m);
      expect(isSupportedCurrency(ccy)).toBe(true);
      expect(validateCurrencyCode(ccy)).toBe(ccy); // not coerced to USD
    }
  });
});
