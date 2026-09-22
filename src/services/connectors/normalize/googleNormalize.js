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
import { currencyWithProvenance } from '../../../lib/currencyProvenance.js';
import { toMinor } from '../../../lib/money.js';
import { logger } from '../../../utils/logger.js';
import { num, accountRollup } from './fieldUtils.js';
import { CHANNEL, DATA_SOURCE, MEASUREMENT_WINDOW } from '../connectorTypes.js';

/** Google cost micros → integer minor units, via the currency's minor digits. */
export function microsToMinor(micros, currency) {
  return toMinor(num(micros) / 1e6, currency);
}

/**
 * @param {{ accountExternalId, accountName?, currency, date, rows }} input
 *   rows = [{ campaign:{id,name}, metrics:{ cost_micros, impressions, clicks, conversions, conversions_value } }]
 * @returns {NormalizedSnapshot[]} one ACCOUNT rollup + one CAMPAIGN row each
 */
export function googleNormalize({
  accountExternalId, accountName = null, currency, currencyProvenance, date, rows = [],
  // Window provenance. Defaults preserve the OPERATIONAL contract exactly, so
  // every existing caller is unchanged; only the canonical path passes these.
  measurementWindow = MEASUREMENT_WINDOW.ROLLING_WINDOW,
  windowStart = null,
  windowEnd = null,
}) {
  const denomination = currencyWithProvenance(currency, currencyProvenance);
  currency = denomination.currency;
  const d = date instanceof Date ? date : new Date(date);
  const campaigns = rows
    // R9 (I41) — a row with NEITHER a platform id NOR a name has no identity of
    // its own, and the old `?? 'unknown'` fallback gave every such row the SAME
    // one. detId is a pure function of externalId, so all of them collapsed onto
    // a single fabricated campaign entity whose spend was the sum of rows that
    // never belonged together. Missing identity must never become a shared
    // identity: drop the row, count it in the log, land nothing.
    //
    // This mirrors metaNormalize, which removed the identical fallback earlier;
    // Google kept it. The `id ?? name` fallback ITSELF is retained deliberately
    // (R9 §6) — a name is at least row-specific, and re-founding Google's
    // identity contract is not this pass's work.
    .filter((r) => {
      const c = r.campaign || {};
      if (c.id == null && c.name == null) {
        logger.warn({ accountExternalId }, '[googleNormalize] dropped a row with no campaign id or campaign name');
        return false;
      }
      return true;
    })
    .map((r) => {
      const m = r.metrics || {};
      const campaign = r.campaign || {};
      return {
        externalId: String(campaign.id ?? campaign.name),
        entityLevel: 'CAMPAIGN',
        parentExternalId: accountExternalId,
        channel: CHANNEL.GOOGLE,
        source: DATA_SOURCE.GOOGLE,
        name: campaign.name || 'Unnamed Campaign',
        date: d,
        // Window provenance (Phase C, extended by Phase D.3).
        //
        // OPERATIONAL (the default): ROLLING_WINDOW with NULL bounds. The GAQL
        // response rows carry no date range of their own (unlike Meta's
        // date_start/date_stop), and reconstructing one from the requested preset
        // would be OUR claim about the period rather than the platform's.
        //
        // CANONICAL: the caller passes CUMULATIVE_30D and the explicit bounds it
        // requested. That is NOT the same act. Phase D.3 §1 Option A accepted the
        // completed-query contract as the period evidence for Google — a decision
        // taken because Google omits zero-delivery days and so can never attest
        // coverage from its rows alone. The client corroborates that every
        // returned `segments.date` fell inside those bounds before it aggregates,
        // and refuses to build a row at all if one did not.
        measurementWindow,
        windowStart,
        windowEnd,
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
    measurementWindow,
  });
  return (account ? [account, ...campaigns] : campaigns)
    .map((row) => ({ ...row, ...denomination }));
}
