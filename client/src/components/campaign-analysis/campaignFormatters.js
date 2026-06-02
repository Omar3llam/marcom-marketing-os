import { formatCurrency } from '@/lib/currencyFormatter.js';

/**
 * Format currency with dynamic currency code.
 * @param {number} n - Numeric amount
 * @param {string} currency - ISO 4217 currency code (default: "USD")
 * @returns {string} - Formatted currency string
 */
export function fmtCurrency(n, currency = 'USD') {
  return formatCurrency(n, currency);
}

export function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export function roasColor(v) {
  if (v < 1.0) return 'text-trend-danger';
  if (v < 2.5) return 'text-trend-warning';
  return 'text-trend-positive';
}

export function freqColor(v) {
  if (v > 5)   return 'text-trend-danger';
  if (v > 3.5) return 'text-trend-warning';
  return 'text-lumi-text';
}
