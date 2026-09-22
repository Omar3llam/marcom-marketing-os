// ============================================================
// ga4Normalize — raw GA4 rows → ACTUAL-revenue descriptors (PURE)
// ============================================================
// GA4 is NOT a ChannelConnector in the ordinary sense: it does not own an ad
// channel and it does not MINT entities. It produces ACTUAL (recorded) revenue
// that decorates the EXISTING Meta/Google entity the platform connector already
// landed — tagged `source: GA4` so BlendedTruth reconciles platform-claimed vs
// actual on the SAME entityId (exactly what prisma/seed.js does by hand).
//
// Two honesty rules baked in here:
//   1. Only PAID-media rows count. Organic / direct / referral / email GA4
//      revenue is real revenue, but it is NOT a platform CLAIM to reconcile
//      against an ad channel — so we skip it rather than attribute it to META
//      or GOOGLE. The channel is inferred from GA4's session source/medium;
//      when we can't confidently map it to a known ad channel, we drop the row.
//   2. Rows that collapse to the same (channel, campaign) are SUMMED here. The
//      MetricSnapshot natural key is (entityId, level, date, granularity,
//      source); two un-summed GA4 rows on one entity would upsert over each
//      other and silently undercount — so aggregation is correctness, not polish.
// ============================================================
import { currencyWithProvenance } from '../../../lib/currencyProvenance.js';
import { toMinor } from '../../../lib/money.js';
import { num } from './fieldUtils.js';
import { CHANNEL, DATA_SOURCE } from '../connectorTypes.js';

// Mediums that mark a row as PAID ad traffic (the only rows that reconcile
// against an ad channel's claimed revenue). Anything else → not an ad actual.
const PAID_MEDIUMS = new Set([
  'cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'paid_social', 'paidsocial',
  'display', 'cpm', 'banner', 'cpv', 'social_paid',
]);

// Session-source substrings → ad channel. Conservative: matched on inclusion of
// a known token, else null (we never guess a channel we aren't sure of).
const META_SOURCES = ['facebook', 'fb', 'instagram', 'ig', 'meta', 'messenger', 'an'];
const GOOGLE_SOURCES = ['google', 'youtube', 'gdn', 'dv360', 'doubleclick'];

const lc = (v) => String(v ?? '').toLowerCase().trim();

/**
 * PURE: infer the ad CHANNEL a GA4 row reconciles against, or null.
 * Requires a PAID medium AND a recognisable ad source — either alone is
 * insufficient (organic facebook is not an ad claim; paid "newsletter" is not
 * an ad channel we track). Null ⇒ the row is dropped, never force-fit.
 */
export function channelFromSourceMedium(source, medium) {
  if (!PAID_MEDIUMS.has(lc(medium))) return null;
  const s = lc(source);
  if (META_SOURCES.some((t) => s.includes(t))) return CHANNEL.META;
  if (GOOGLE_SOURCES.some((t) => s.includes(t))) return CHANNEL.GOOGLE;
  return null;
}

/**
 * @param {{ currency?, date, rows }} input
 *   rows = [{ source, medium, campaignName, revenue, conversions }]
 *          (revenue in MAJOR currency units, as GA4's purchaseRevenue reports it)
 * @returns {Array<{ source, channel, campaignName, revenueMinor, conversions, date, currency }>}
 *          ACTUAL-revenue descriptors, summed per (channel, campaign). NOT
 *          NormalizedSnapshot[] — these never mint entities (see actualsSink).
 */
export function ga4Normalize({ currency, currencyProvenance, date, rows = [] }) {
  const denomination = currencyWithProvenance(currency, currencyProvenance);
  currency = denomination.currency;
  const d = date instanceof Date ? date : new Date(date);
  const byKey = new Map();
  for (const r of rows) {
    const channel = channelFromSourceMedium(r.source, r.medium);
    if (!channel) continue; // organic / unattributable — not an ad-channel actual
    const campaignName = r.campaignName ? String(r.campaignName).trim() : null;
    const key = `${channel}|${lc(campaignName)}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        source: DATA_SOURCE.GA4,
        channel,
        campaignName,
        revenueMinor: 0,
        conversions: 0,
        date: d,
        ...denomination,
      });
    }
    const agg = byKey.get(key);
    agg.revenueMinor += toMinor(num(r.revenue), currency);
    agg.conversions += num(r.conversions);
  }
  return [...byKey.values()];
}
