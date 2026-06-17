// ============================================================
// googleNormalize — raw Google Ads rows → NormalizedSnapshot[] (PURE)
// ============================================================
// The careful mapper. Google reports differently than Meta:
//   - cost is MICROS (1e6) — convert to minor units via the currency's digits.
//   - conversions are FRACTIONAL + attribution-windowed — land as-is, never
//     "correct" them (the sink rounds only at the Int column boundary).
//   - conversions_value is the platform-claimed value, landed PLATFORM_CLAIMED.
//   - where Google has no equivalent (e.g. frequency on Search) → null, never a guess.
// ============================================================
import { toMinor } from '../../../lib/money.js';
import { num, accountRollup } from './fieldUtils.js';
import { CHANNEL, DATA_SOURCE } from '../connectorTypes.js';

/** Google cost micros → integer minor units, via the currency's minor digits. */
export function microsToMinor(micros, currency) {
  return toMinor(num(micros) / 1e6, currency);
}

/**
 * @param {{ accountExternalId, accountName?, currency, date, rows }} input
 *   rows = [{ campaign:{id,name}, metrics:{ cost_micros, impressions, clicks, conversions, conversions_value } }]
 * @returns {NormalizedSnapshot[]} one ACCOUNT rollup + one CAMPAIGN row each
 */
export function googleNormalize({ accountExternalId, accountName = null, currency = 'USD', date, rows = [] }) {
  const d = date instanceof Date ? date : new Date(date);
  const campaigns = rows.map((r) => {
    const m = r.metrics || {};
    const campaign = r.campaign || {};
    return {
      externalId: String(campaign.id ?? campaign.name ?? 'unknown'),
      entityLevel: 'CAMPAIGN',
      parentExternalId: accountExternalId,
      channel: CHANNEL.GOOGLE,
      source: DATA_SOURCE.GOOGLE,
      name: campaign.name || 'Unnamed Campaign',
      date: d,
      currency,
      spendMinor: microsToMinor(m.cost_micros, currency),
      revenueMinor: toMinor(num(m.conversions_value), currency), // claimed value, as-is
      impressions: Math.round(num(m.impressions)),
      clicks: Math.round(num(m.clicks)),
      conversions: num(m.conversions), // FRACTIONAL — preserved here; sink rounds for the Int column
      frequency: null, // Google Search has no frequency equivalent — null, not a guess
    };
  });

  // No rows → no rollup → land nothing, never a phantom account summed from zero.
  const account = accountRollup(campaigns, {
    accountExternalId, accountName, channel: CHANNEL.GOOGLE, source: DATA_SOURCE.GOOGLE, date: d, currency,
  });
  return account ? [account, ...campaigns] : campaigns;
}
