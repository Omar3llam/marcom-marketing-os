import { describe, expect, it } from 'vitest';
import {
  CURRENCY_HOMOGENEITY,
  classifyCurrencyHomogeneity,
  currencyUnavailableReason,
} from './currencyHomogeneity.js';

const row = (currency, spendMinor = 100) => ({ currency, spendMinor });

describe('classifyCurrencyHomogeneity', () => {
  it.each(['EGP', 'USD', 'SAR'])('establishes one known %s population', (currency) => {
    expect(classifyCurrencyHomogeneity([row(currency), row(currency, 250)])).toEqual({
      status: CURRENCY_HOMOGENEITY.HOMOGENEOUS_KNOWN,
      currency,
      contributorCount: 2,
    });
  });

  it('normalizes a valid code without changing any amount', () => {
    const rows = [row(' egp ', 123), row('EGP', 456)];
    expect(classifyCurrencyHomogeneity(rows).currency).toBe('EGP');
    expect(rows.map((r) => r.spendMinor)).toEqual([123, 456]);
  });

  it.each([
    [['EGP', 'USD'], CURRENCY_HOMOGENEITY.MIXED],
    [['SAR', 'EGP'], CURRENCY_HOMOGENEITY.MIXED],
    [['EGP', null], CURRENCY_HOMOGENEITY.UNKNOWN],
    [['USD', 'XYZ'], CURRENCY_HOMOGENEITY.UNKNOWN],
  ])('%j fails closed as %s', (currencies, status) => {
    expect(classifyCurrencyHomogeneity(currencies.map((c) => row(c)))).toMatchObject({
      status,
      currency: null,
    });
  });

  it('does not manufacture a currency when nothing contributes money', () => {
    expect(classifyCurrencyHomogeneity([row('USD', 0), row(null, null)])).toEqual({
      status: CURRENCY_HOMOGENEITY.UNKNOWN,
      currency: null,
      contributorCount: 0,
    });
  });
});

describe('currencyUnavailableReason', () => {
  it('maps non-homogeneous states to explicit reasons', () => {
    expect(currencyUnavailableReason(CURRENCY_HOMOGENEITY.MIXED)).toBe('MIXED_CURRENCY');
    expect(currencyUnavailableReason(CURRENCY_HOMOGENEITY.UNKNOWN)).toBe('UNKNOWN_CURRENCY');
    expect(currencyUnavailableReason(CURRENCY_HOMOGENEITY.HOMOGENEOUS_KNOWN)).toBeNull();
  });
});
