import { describe, expect, it } from 'vitest';
import { evaluatePlanningActual, PLANNING_REASON } from './planningActuals.js';

const row = (currency = 'EGP', extra = {}) => ({
  spendMinor: 20_000, revenueMinor: 60_000, conversions: 20,
  currency, currencyProvenance: 'PLATFORM_REPORTED',
  measurementWindow: 'ROLLING_WINDOW',
  windowStart: new Date('2026-08-01T00:00:00Z'),
  windowEnd: new Date('2026-08-30T00:00:00Z'),
  ...extra,
});

describe('planning actual monetary evidence', () => {
  it.each(['EGP', 'USD', 'SAR'])('publishes authoritative homogeneous %s spend', (currency) => {
    expect(evaluatePlanningActual([row(currency), row(currency, { spendMinor: 10_000 })], 'actualSpend', currency))
      .toMatchObject({ status: 'VALID', value: 30_000, currency });
  });

  it('refuses mixed spend and same-code untrusted contributors without dropping either row', () => {
    expect(evaluatePlanningActual([row('EGP'), row('USD')], 'actualSpend', 'EGP').reason)
      .toBe(PLANNING_REASON.ACTUAL_CURRENCY_MIXED);
    for (const currencyProvenance of ['LEGACY_UNKNOWN', 'WORKSPACE_INFERRED', 'FALLBACK_DEFAULT', 'USER_SUPPLIED']) {
      expect(evaluatePlanningActual([row(), row('EGP', { currencyProvenance })], 'actualSpend', 'EGP').reason)
        .toBe(PLANNING_REASON.ACTUAL_CURRENCY_UNTRUSTED);
    }
  });

  it('does not turn a missing spend into a smaller complete population', () => {
    expect(evaluatePlanningActual([row(), row('EGP', { spendMinor: null })], 'actualSpend', 'EGP').reason)
      .toBe(PLANNING_REASON.INSUFFICIENT_MEASUREMENT_EVIDENCE);
  });

  it('publishes CAC only from valid spend and a valid conversion count', () => {
    expect(evaluatePlanningActual([row()], 'blendedCac', 'EGP')).toMatchObject({ status: 'VALID', value: 1000, currency: 'EGP' });
    expect(evaluatePlanningActual([row('EGP', { currencyProvenance: 'LEGACY_UNKNOWN' })], 'blendedCac', 'EGP').value).toBeNull();
    expect(evaluatePlanningActual([row('EGP', { conversions: 0 })], 'blendedCac', 'EGP').value).toBeNull();
  });

  it('refuses target currency mismatch for denominated spend and CAC', () => {
    for (const metric of ['actualSpend', 'blendedCac']) {
      expect(evaluatePlanningActual([row()], metric, 'USD').reason).toBe(PLANNING_REASON.TARGET_CURRENCY_MISMATCH);
      expect(evaluatePlanningActual([row()], metric, 'EGP').status).toBe('VALID');
    }
  });

  it('publishes platform ROAS only from compatible authoritative operands', () => {
    expect(evaluatePlanningActual([row()], 'blendedRoas', 'USD')).toMatchObject({ status: 'VALID', value: 3, currency: 'EGP' });
    const differentRevenueCurrency = [row('EGP', { spendMinor: 20_000, revenueMinor: 0 }),
      row('USD', { spendMinor: 0, revenueMinor: 60_000 })];
    expect(evaluatePlanningActual(differentRevenueCurrency, 'blendedRoas', 'EGP').reason)
      .toBe(PLANNING_REASON.ACTUAL_CURRENCY_MIXED);
    expect(evaluatePlanningActual([row('EGP', { currencyProvenance: 'LEGACY_UNKNOWN' })], 'blendedRoas', 'EGP').value).toBeNull();
  });

  it('refuses unknown or mismatched measurement periods', () => {
    expect(evaluatePlanningActual([row('EGP', { windowStart: null })], 'blendedRoas', 'EGP').reason)
      .toBe(PLANNING_REASON.MEASUREMENT_WINDOW_UNTRUSTED);
    expect(evaluatePlanningActual([row(), row('EGP', { windowStart: new Date('2026-08-02T00:00:00Z') })], 'blendedRoas', 'EGP').reason)
      .toBe(PLANNING_REASON.MEASUREMENT_WINDOW_MISMATCH);
  });

  it('keeps MER unavailable even when platform revenue is present', () => {
    expect(evaluatePlanningActual([row()], 'mer', 'EGP')).toEqual({
      status: 'INSUFFICIENT_EVIDENCE', reason: PLANNING_REASON.BUSINESS_REVENUE_SOURCE_UNAVAILABLE,
      currency: null, value: null,
    });
  });
});
