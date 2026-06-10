// Shared field helpers for connector normalizers. Pure.
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

/** Sum a NormalizedSnapshot[]'s base measures into one ACCOUNT-level rollup row. */
export function accountRollup(rows, { accountExternalId, accountName, channel, source, date, currency }) {
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
    frequency: null,
    ...acc,
  };
}
