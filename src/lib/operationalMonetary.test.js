import { describe, expect, it } from 'vitest';
import { authoritativeMoney, matchBudgetCurrency, MONETARY_REASON, MONETARY_STATUS, sameMonetaryUnit } from './operationalMonetary.js';

const row = (currency, currencyProvenance = 'PLATFORM_REPORTED', amountMinor = 100) => ({ currency, currencyProvenance, amountMinor });

describe('operational monetary authority', () => {
  for (const currency of ['EGP', 'USD', 'SAR']) {
    it(`accepts same-source ${currency} contributors and an explicit matching budget`, () => {
      const spend = authoritativeMoney([row(currency), row(currency, 'PLATFORM_REPORTED', 50)]);
      expect(spend).toEqual({ monetaryStatus: MONETARY_STATUS.VALID, monetaryReason: null, currency });
      expect(matchBudgetCurrency(spend, currency)).toEqual(spend);
    });
  }

  it('refuses mixed authoritative currencies without summing them', () => {
    expect(authoritativeMoney([row('EGP'), row('USD')])).toMatchObject({ monetaryStatus: MONETARY_STATUS.UNAVAILABLE_MIXED, monetaryReason: MONETARY_REASON.SPEND_CURRENCY_MIXED, currency: null });
  });

  for (const origin of ['WORKSPACE_INFERRED', 'FALLBACK_DEFAULT', 'LEGACY_UNKNOWN', 'USER_SUPPLIED', 'SNAPSHOT_INFERRED', undefined]) {
    it(`refuses ${origin ?? 'missing'} provenance even for a supported code`, () => {
      expect(authoritativeMoney([{ currency: 'EGP', currencyProvenance: origin, amountMinor: 100 }])).toMatchObject({ monetaryStatus: MONETARY_STATUS.UNAVAILABLE_UNTRUSTED, currency: null });
    });
  }

  it('allows zero rows to be neutral but never to establish a currency', () => {
    expect(authoritativeMoney([row('USD', 'FALLBACK_DEFAULT', 0)])).toMatchObject({ monetaryStatus: MONETARY_STATUS.UNAVAILABLE_UNTRUSTED, currency: null });
    expect(authoritativeMoney([row('EGP'), row('USD', 'FALLBACK_DEFAULT', 0)])).toMatchObject({ monetaryStatus: MONETARY_STATUS.VALID, currency: 'EGP' });
  });

  it('distinguishes missing, invalid, and mismatched budget currency', () => {
    const spend = authoritativeMoney([row('EGP')]);
    expect(matchBudgetCurrency(spend, undefined).monetaryReason).toBe(MONETARY_REASON.BUDGET_CURRENCY_MISSING);
    expect(matchBudgetCurrency(spend, 'NOPE').monetaryReason).toBe(MONETARY_REASON.BUDGET_CURRENCY_INVALID);
    expect(matchBudgetCurrency(spend, 'USD').monetaryReason).toBe(MONETARY_REASON.BUDGET_CURRENCY_MISMATCH);
  });

  it('refuses a cross-channel comparison if one source lacks authority', () => {
    expect(sameMonetaryUnit(authoritativeMoney([row('EGP')]), authoritativeMoney([row('EGP', 'WORKSPACE_INFERRED')]))).toMatchObject({ monetaryStatus: MONETARY_STATUS.UNAVAILABLE_UNTRUSTED, currency: null });
  });
});
