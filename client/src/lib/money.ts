// ============================================================
// MARCOM / Lumi — Money (minor units) + rollup  [client mirror]
// ============================================================
// Money is stored as an INTEGER number of minor units plus an ISO
// 4217 currency code; formatting happens only here, at the
// presentation layer, via formatCurrency(amountMinor, code, locale).
//
// Canonical logic lives in src/lib/money.js (backend/seed). This is
// the typed client mirror. NOTE: the older client/src/lib/
// currencyFormatter.js formats MAJOR-unit numbers and is kept for
// existing callers — this module is the minor-unit substrate.
// ============================================================

/**
 * ISO 4217 minor-unit exponents (decimal places). Most are 2; the
 * Gulf dinars use 3; JPY uses 0. Default for unknown codes: 2.
 */
export const CURRENCY_MINOR_UNITS: Record<string, number> = {
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

const CURRENCY_LOCALES: Record<string, string> = {
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
export function minorUnitDigits(code: string): number {
  const c = (code || 'USD').toUpperCase().trim();
  return CURRENCY_MINOR_UNITS[c] ?? 2;
}

/** Major-unit amount → integer minor units (rounded). */
export function toMinor(amountMajor: number, code: string): number {
  if (typeof amountMajor !== 'number' || !Number.isFinite(amountMajor)) return 0;
  return Math.round(amountMajor * 10 ** minorUnitDigits(code));
}

/** Integer minor units → major-unit number. */
export function fromMinor(amountMinor: number, code: string): number {
  if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor)) return 0;
  return amountMinor / 10 ** minorUnitDigits(code);
}

/**
 * Format integer minor units as a localized currency string.
 * Non-finite input returns the em-dash placeholder "—".
 */
export function formatCurrency(amountMinor: number, code = 'USD', locale?: string): string {
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
    const formatted = major.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    return `${currency} ${formatted}`;
  }
}

export interface RollupNode {
  spendMinor?: number;
  revenueMinor?: number;
  children?: RollupNode[];
}

export interface RollupTotal {
  spendMinor: number;
  revenueMinor: number;
}

/**
 * Roll spend/revenue up the entity graph:
 * creative → ad → ad set → campaign → account. Sums leaf
 * spendMinor/revenueMinor across the subtree rooted at `node`.
 */
export function rollup(node: RollupNode | null | undefined): RollupTotal {
  if (!node) return { spendMinor: 0, revenueMinor: 0 };

  const children = Array.isArray(node.children) ? node.children : [];

  if (children.length === 0) {
    return {
      spendMinor: node.spendMinor ?? 0,
      revenueMinor: node.revenueMinor ?? 0,
    };
  }

  return children.reduce<RollupTotal>(
    (acc, child) => {
      const r = rollup(child);
      acc.spendMinor += r.spendMinor;
      acc.revenueMinor += r.revenueMinor;
      return acc;
    },
    { spendMinor: 0, revenueMinor: 0 },
  );
}
