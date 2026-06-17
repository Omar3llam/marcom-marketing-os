// ============================================================
// csvNormalize — parsed CSV rows → NormalizedSnapshot[] (PURE)
// ============================================================
// Maps a Meta-Ads-Manager-style CSV export (the existing csvParser output:
// { rowData }) to the unified shape. Tolerant, case-insensitive column aliases;
// lands what's present, 0/null where a column is absent (never a guess). CSV has
// no native channel → defaults to META (matching how CSV is treated today).
// ============================================================
import { toMinor } from '../../../lib/money.js';
import { num, pick, accountRollup } from './fieldUtils.js';
import { CHANNEL, DATA_SOURCE } from '../connectorTypes.js';

const COLS = {
  campaign: ['Campaign name', 'campaign_name', 'Campaign'],
  spend: ['Amount spent', 'Amount spent (USD)', 'spend', 'Spend'],
  revenue: ['Purchases conversion value', 'Website purchases conversion value', 'conversion value', 'revenue'],
  impressions: ['Impressions', 'impressions'],
  clicks: ['Link clicks', 'Clicks (all)', 'clicks'],
  conversions: ['Purchases', 'Results', 'Website purchases', 'conversions'],
  frequency: ['Frequency', 'frequency'],
};

/**
 * @param {{ accountExternalId, accountName?, currency, date, channel?, source?, rows }} input
 *   rows = csvParser output: [{ rowData }] OR plain row objects
 * @returns {NormalizedSnapshot[]} one ACCOUNT rollup + one CAMPAIGN row each
 */
export function csvNormalize({ accountExternalId, accountName = null, currency = 'USD', date, channel = CHANNEL.META, source = DATA_SOURCE.META, rows = [] }) {
  const d = date instanceof Date ? date : new Date(date);
  const campaigns = rows.map((raw, i) => {
    const row = raw?.rowData ?? raw ?? {};
    const name = pick(row, COLS.campaign) || `Row ${i + 1}`;
    return {
      externalId: String(name),
      entityLevel: 'CAMPAIGN',
      parentExternalId: accountExternalId,
      channel,
      source,
      name: String(name),
      date: d,
      currency,
      spendMinor: toMinor(num(pick(row, COLS.spend)), currency),
      revenueMinor: toMinor(num(pick(row, COLS.revenue)), currency),
      impressions: Math.round(num(pick(row, COLS.impressions))),
      clicks: Math.round(num(pick(row, COLS.clicks))),
      conversions: Math.round(num(pick(row, COLS.conversions))),
      frequency: pick(row, COLS.frequency) != null ? num(pick(row, COLS.frequency)) : null,
    };
  });

  // No rows → no rollup → land nothing, never a phantom account summed from zero.
  const account = accountRollup(campaigns, { accountExternalId, accountName, channel, source, date: d, currency });
  return account ? [account, ...campaigns] : campaigns;
}
