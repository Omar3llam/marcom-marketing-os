// ============================================================
// MARCOM / Lumi — Money (minor units) + rollup
// ============================================================
// Phase 1 data substrate. Money is stored as an INTEGER number of
// minor units (piastres, halalas, fils, cents) plus an ISO 4217
// currency code. Formatting happens ONLY at the presentation layer
// via formatCurrency(amountMinor, code, locale).
//
// This is the canonical backend/seed copy (ESM). Mirrors:
//   - client/src/lib/money.ts                 (Vite app)
//   - design-system-figma/.../primitives.jsx  (standalone demo)
// Keep the three in sync — the logic is intentionally tiny.
// ============================================================

/**
 * ISO 4217 minor-unit exponents. The number of decimal places a
 * currency uses. Most are 2; the Gulf dinars use 3; JPY uses 0.
 * Default when a code is unknown: 2.
 */
export const CURRENCY_MINOR_UNITS = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  EGP: 2,
  SAR: 2,
  AED: 2,
  QAR: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  JPY: 0,
};

/** Locale hints so separators/symbol placement match the market. */
const CURRENCY_LOCALES = {
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  EGP: 'ar-EG',
  SAR: 'ar-SA',
  AED: 'ar-AE',
  KWD: 'ar-KW',
  QAR: 'ar-QA',
  BHD: 'ar-BH',
  OMR: 'ar-OM',
  JOD: 'ar-JO',
};

/** Number of decimal places for a currency code (default 2). */
export function minorUnitDigits(code) {
  const c = (code || 'USD').toUpperCase().trim();
  return CURRENCY_MINOR_UNITS[c] ?? 2;
}

/**
 * Convert a major-unit amount (e.g. 84310.50 EGP) to integer minor
 * units (8431050). Rounds to the nearest minor unit.
 */
export function toMinor(amountMajor, code) {
  if (typeof amountMajor !== 'number' || !Number.isFinite(amountMajor)) return 0;
  return Math.round(amountMajor * 10 ** minorUnitDigits(code));
}

/** Convert integer minor units back to a major-unit number. */
export function fromMinor(amountMinor, code) {
  if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor)) return 0;
  return amountMinor / 10 ** minorUnitDigits(code);
}

/**
 * Format integer minor units as a localized currency string.
 *
 * @param {number} amountMinor - integer minor units
 * @param {string} code        - ISO 4217 code (EGP, SAR, AED, KWD, USD, …)
 * @param {string} [locale]    - BCP-47 locale; defaults per-currency
 * @returns {string} e.g. "EGP 84,310.00"  (non-finite → "—")
 */
export function formatCurrency(amountMinor, code = 'USD', locale) {
  if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor)) return '—';

  const currency = (code || 'USD').toUpperCase().trim();
  const digits = minorUnitDigits(currency);
  const major = fromMinor(amountMinor, currency);
  const loc = locale || CURRENCY_LOCALES[currency] || 'en-US';

  try {
    return new Intl.NumberFormat(loc, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    // Fallback if the runtime can't resolve the currency.
    const formatted = major.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    return `${currency} ${formatted}`;
  }
}

/**
 * Roll spend/revenue up the entity graph:
 *   creative → ad → ad set → campaign → account.
 *
 * Sums the leaf `spendMinor`/`revenueMinor` of every node in the
 * subtree rooted at `node`. The tree is plain objects with an
 * optional `children` array and optional `spendMinor`/`revenueMinor`
 * on leaves (creatives). Non-leaf own-values are also included if
 * present, so partial trees still total correctly.
 *
 * @param {{spendMinor?:number, revenueMinor?:number, children?:Array}} node
 * @returns {{spendMinor:number, revenueMinor:number}}
 */
export function rollup(node) {
  if (!node) return { spendMinor: 0, revenueMinor: 0 };

  const children = Array.isArray(node.children) ? node.children : [];

  if (children.length === 0) {
    return {
      spendMinor: node.spendMinor ?? 0,
      revenueMinor: node.revenueMinor ?? 0,
    };
  }

  return children.reduce(
    (acc, child) => {
      const r = rollup(child);
      acc.spendMinor += r.spendMinor;
      acc.revenueMinor += r.revenueMinor;
      return acc;
    },
    { spendMinor: 0, revenueMinor: 0 },
  );
}
