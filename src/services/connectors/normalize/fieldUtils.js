// Shared field helpers for connector normalizers. Pure.
import { combineRevenueWindows, exactRevenueWindow } from '../../../lib/revenueMeasurementWindow.js';
export const num = (v) => {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Case-insensitive column pick over an object, trying each alias in order. */
export function pick(row, aliases) {
  const lower = {};
  for (const k of Object.keys(row)) lower[k.toLowerCase().trim()] = row[k];
  for (const a of aliases) {
    const hit = lower[a.toLowerCase()];
    if (hit != null && hit !== '') return hit;
  }
  return null;
}

/**
 * Sum a NormalizedSnapshot[]'s base measures into one ACCOUNT-level rollup row.
 * Returns null when there are no rows to summarize — rolling up zero campaigns
 * would fabricate a phantom account snapshot (the "1 snapshot on an account with
 * zero in-window delivery" symptom), which the governing rule forbids: a metric
 * row must trace to real data, never be manufactured from nothing. Callers land
 * the rollup only when it exists.
 */
export function accountRollup(rows, { accountExternalId, accountName, channel, source, date, currency, measurementWindow = null }) {
  if (!rows.length) return null;
  // The rollup covers exactly the period its children cover — they all came
  // from one request. Inherited rather than re-derived, and REQUIRED: an account
  // row that could not say what it measures has no business being written, and
  // snapshotSink will reject it downstream anyway.
  if (!measurementWindow) {
    throw new Error('accountRollup: measurementWindow is required — an account row must state the period it covers');
  }
  // Children of one request share a window; take the first that reported one.
  // Never widened to min/max: that would describe a range no row measured.
  const withWindow = rows.find((r) => r.windowStart != null || r.windowEnd != null) || {};
  const spendWindows = rows.map((r) => exactRevenueWindow(r.spendWindowStartUtc, r.spendWindowEndUtc));
  const spendWindow = combineRevenueWindows(spendWindows);
  const acc = { spendMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0 };
  for (const r of rows) {
    acc.spendMinor += r.spendMinor;
    acc.revenueMinor += r.revenueMinor;
    acc.impressions += r.impressions;
    acc.clicks += r.clicks;
    acc.conversions += r.conversions;
  }
  return {
    externalId: accountExternalId,
    entityLevel: 'ACCOUNT',
    parentExternalId: null,
    channel,
    source,
    name: accountName || accountExternalId,
    date,
    currency,
    measurementWindow,
    windowStart: withWindow.windowStart ?? null,
    windowEnd: withWindow.windowEnd ?? null,
    spendWindowStartUtc: spendWindow.windowStart,
    spendWindowEndUtc: spendWindow.windowEnd,
    frequency: null,
    ...acc,
  };
}
