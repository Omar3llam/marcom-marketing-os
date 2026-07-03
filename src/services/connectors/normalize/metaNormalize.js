// ============================================================
// metaNormalize — raw Meta insights → NormalizedSnapshot[] (PURE)
// ============================================================
// Reads the REAL Meta fields. Revenue = the purchase action_value, landed as-is
// (PLATFORM_CLAIMED); when Meta reports no purchase value we land 0, never an
// ESTIMATE. (The legacy normalizeInsightsForAnalysis derives ROAS from CTR +
// frequency — that is exactly the "platform-claimed number wearing a trusted
// badge" the governing rule forbids, so the connector does not use it.)
// ============================================================
import { toMinor } from '../../../lib/money.js';
import { num, accountRollup } from './fieldUtils.js';
import { CHANNEL, DATA_SOURCE } from '../connectorTypes.js';

const PURCHASE_ACTIONS = new Set(['offsite_conversion.fb_pixel_purchase', 'omni_purchase', 'purchase']);

function actionValue(arr, match) {
  if (!Array.isArray(arr)) return 0;
  return num(arr.find((a) => match.has(a.action_type))?.value);
}

/**
 * @param {{ accountExternalId, accountName?, currency, date, rows }} input
 *   rows = raw Meta insight objects (campaign-level)
 * @returns {NormalizedSnapshot[]} one ACCOUNT rollup + one CAMPAIGN row each
 */
export function metaNormalize({ accountExternalId, accountName = null, currency = 'USD', date, rows = [] }) {
  const d = date instanceof Date ? date : new Date(date);
  const campaigns = rows.map((r) => {
    const conversions = actionValue(r.actions, PURCHASE_ACTIONS);
    const revenueMajor = actionValue(r.action_values, PURCHASE_ACTIONS); // real claimed value; 0 if none
    const clicks = num(r.clicks ?? r.inline_link_clicks);
    return {
      externalId: String(r.campaign_id ?? r.campaign_name ?? 'unknown'),
      entityLevel: 'CAMPAIGN',
      parentExternalId: accountExternalId,
      channel: CHANNEL.META,
      source: DATA_SOURCE.META,
      name: r.campaign_name || 'Unnamed Campaign',
      // The Meta campaign objective (OUTCOME_LEADS / OUTCOME_SALES /
      // OUTCOME_AWARENESS / …) — carried through so the sink can store it on the
      // Campaign entity and the verdict engine can distinguish a true awareness
      // campaign from a conversion campaign with no measured revenue. null when
      // Meta didn't report it (only /campaigns carries it, not /insights).
      objective: r.objective ?? null,
      date: d,
      currency,
      spendMinor: toMinor(num(r.spend), currency),
      revenueMinor: toMinor(revenueMajor, currency),
      impressions: Math.round(num(r.impressions)),
      clicks: Math.round(clicks),
      conversions: Math.round(conversions),
      frequency: r.frequency != null ? num(r.frequency) : null,
      // Roster-only rows (no delivery data found, not a verified 0) carry the flag
      // forward so the sink lands the entity but no fabricated zero snapshot.
      rosterOnly: r._rosterOnly === true,
    };
  });

  // No campaigns → no rollup → land nothing (honest empty), never a phantom
  // account row summed from zero rows. See accountRollup's null contract.
  const account = accountRollup(campaigns, {
    accountExternalId, accountName, channel: CHANNEL.META, source: DATA_SOURCE.META, date: d, currency,
  });
  // The rollup is roster-only ONLY when no real campaign delivered — i.e. it would
  // be all zeros. With ≥1 real campaign the rollup reflects real spend (roster
  // rows add 0), so it lands; an all-roster rollup is skipped like its campaigns.
  if (account) account.rosterOnly = campaigns.every((c) => c.rosterOnly);
  return account ? [account, ...campaigns] : campaigns;
}
