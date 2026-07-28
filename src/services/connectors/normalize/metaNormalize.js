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
import { logger } from '../../../utils/logger.js';

const PURCHASE_ACTIONS = new Set(['offsite_conversion.fb_pixel_purchase', 'omni_purchase', 'purchase']);

function actionValue(arr, match) {
  if (!Array.isArray(arr)) return 0;
  return num(arr.find((a) => match.has(a.action_type))?.value);
}

/** The measures every level shares. Extracted so CAMPAIGN and ADSET can't drift. */
function baseMeasures(r, currency, d) {
  const conversions = actionValue(r.actions, PURCHASE_ACTIONS);
  const revenueMajor = actionValue(r.action_values, PURCHASE_ACTIONS); // real claimed value; 0 if none
  const clicks = num(r.clicks ?? r.inline_link_clicks);
  return {
    channel: CHANNEL.META,
    source: DATA_SOURCE.META,
    date: d,
    currency,
    spendMinor: toMinor(num(r.spend), currency),
    revenueMinor: toMinor(revenueMajor, currency),
    impressions: Math.round(num(r.impressions)),
    clicks: Math.round(clicks),
    conversions: Math.round(conversions),
    frequency: r.frequency != null ? num(r.frequency) : null,
    // Unique people reached. null when Meta didn't report it, never a fabricated 0.
    reach: r.reach != null ? Math.round(num(r.reach)) : null,
    // Roster-only rows (no delivery data found, not a verified 0) carry the flag
    // forward so the sink lands the entity but no fabricated zero snapshot.
    rosterOnly: r._rosterOnly === true,
  };
}

/**
 * PURE: Meta's delivery status → the `EntityStatus` enum the schema accepts
 * (ACTIVE | PAUSED | ARCHIVED), or null when Meta said nothing usable.
 *
 * `effective_status` is preferred because it is the TRUE delivery state: an ad
 * set whose own `status` is ACTIVE but whose campaign is paused comes back as
 * CAMPAIGN_PAUSED, and it is not running. Reading `status` alone would call it
 * active and hand the diagnosis engine a delivering ad set that is stopped.
 *
 * Meta's effective_status vocabulary is much wider than our three values —
 * PENDING_REVIEW, DISAPPROVED, IN_PROCESS, WITH_ISSUES, PREAPPROVED,
 * PENDING_BILLING_INFO. Those are neither running nor paused, so they map to
 * null: "we do not know" is the honest answer, and passing one through raw
 * would throw on the Prisma enum column.
 *
 * @returns {'ACTIVE'|'PAUSED'|'ARCHIVED'|null}
 */
export function toEntityStatus(status, effectiveStatus) {
  const raw = effectiveStatus ?? status;
  if (typeof raw !== 'string' || !raw) return null;
  const v = raw.toUpperCase();
  // CAMPAIGN_PAUSED / ADSET_PAUSED both mean "not delivering, by a pause".
  if (v.endsWith('PAUSED')) return 'PAUSED';
  if (v === 'ARCHIVED' || v === 'DELETED') return 'ARCHIVED';
  if (v === 'ACTIVE') return 'ACTIVE';
  return null; // in review / disapproved / with issues — unknown, never guessed
}

/**
 * Ad-set rows → ADSET NormalizedSnapshots.
 *
 * parentExternalId is the CAMPAIGN id, not the account: snapshotSink chains the
 * FK through PARENT_LEVEL (ADSET → CAMPAIGN → ACCOUNT), so pointing it at the
 * account would compute a campaign id that does not exist and orphan the ad-set.
 *
 * A row with no adset_id has no stable identity, and one with no campaign_id has
 * no resolvable parent — both are dropped rather than merged onto a garbage id.
 */
function normalizeAdSets(rows, currency, d, accountExternalId) {
  const out = [];
  for (const r of rows) {
    if (r.adset_id == null) {
      logger.warn({ accountExternalId }, '[metaNormalize] dropped an ad-set row with no adset_id');
      continue;
    }
    if (r.campaign_id == null) {
      logger.warn({ accountExternalId, adSetId: r.adset_id }, '[metaNormalize] dropped an ad-set row with no campaign_id (no resolvable parent)');
      continue;
    }
    out.push({
      externalId: String(r.adset_id),
      entityLevel: 'ADSET',
      parentExternalId: String(r.campaign_id),
      name: r.adset_name || 'Unnamed Ad Set',
      // null when Meta said nothing usable — the sink then leaves the stored
      // status alone rather than asserting a state we were never told.
      status: toEntityStatus(r.status, r.effective_status),
      ...baseMeasures(r, currency, d),
    });
  }
  return out;
}

/**
 * @param {{ accountExternalId, accountName?, currency, date, rows }} input
 *   rows = raw Meta insight objects, CAMPAIGN-level and/or ADSET-level mixed.
 *   An ad-set row is identified by carrying `adset_id`; MetaConnector.fetchRaw
 *   concatenates both levels into one array because the ChannelConnector
 *   contract is `fetchRaw -> RawRow[]`.
 * @returns {NormalizedSnapshot[]} one ACCOUNT rollup + CAMPAIGN rows + ADSET rows
 */
export function metaNormalize({ accountExternalId, accountName = null, currency = 'USD', date, rows = [] }) {
  const d = date instanceof Date ? date : new Date(date);

  // Partition by shape before anything else. The two levels look alike but must
  // NOT be summed together — see the rollup note below.
  const adSetRows = rows.filter((r) => r.adset_id != null);
  const campaignRows = rows.filter((r) => r.adset_id == null);

  const adSets = normalizeAdSets(adSetRows, currency, d, accountExternalId);

  const campaigns = campaignRows
    // A row with NO campaign_id AND no campaign_name has no stable identity: the
    // old `?? 'unknown'` fallback made every such row collide onto one 'unknown'
    // entity id (detId), silently merging distinct campaigns. Drop them instead —
    // an unidentifiable row is malformed Meta data, not a real campaign.
    .filter((r) => {
      if (r.campaign_id == null && r.campaign_name == null) {
        logger.warn({ accountExternalId }, '[metaNormalize] dropped a row with no campaign_id or campaign_name');
        return false;
      }
      return true;
    })
    .map((r) => ({
      externalId: String(r.campaign_id ?? r.campaign_name),
      entityLevel: 'CAMPAIGN',
      parentExternalId: accountExternalId,
      name: r.campaign_name || 'Unnamed Campaign',
      // The Meta campaign objective (OUTCOME_LEADS / OUTCOME_SALES /
      // OUTCOME_AWARENESS / …) — carried through so the sink can store it on the
      // Campaign entity and the verdict engine can distinguish a true awareness
      // campaign from a conversion campaign with no measured revenue. null when
      // Meta didn't report it (only /campaigns carries it, not /insights).
      objective: r.objective ?? null,
      // Same drop, same level up: campaigns were stamped ACTIVE on every sync
      // too. Fixed at both levels at once — the sink is level-agnostic.
      status: toEntityStatus(r.status, r.effective_status),
      ...baseMeasures(r, currency, d),
    }));

  // The rollup sums CAMPAIGNS ONLY. Ad-set spend is a SUBSET of its campaign's,
  // so including both levels would roughly double every account-level figure —
  // a fabricated number of exactly the kind the account rollup exists to avoid.
  //
  // No campaigns → no rollup → land nothing (honest empty), never a phantom
  // account row summed from zero rows. See accountRollup's null contract.
  const account = accountRollup(campaigns, {
    accountExternalId, accountName, channel: CHANNEL.META, source: DATA_SOURCE.META, date: d, currency,
  });
  // The rollup is roster-only ONLY when no real campaign delivered — i.e. it would
  // be all zeros. With ≥1 real campaign the rollup reflects real spend (roster
  // rows add 0), so it lands; an all-roster rollup is skipped like its campaigns.
  if (account) account.rosterOnly = campaigns.every((c) => c.rosterOnly);
  return account ? [account, ...campaigns, ...adSets] : [...campaigns, ...adSets];
}
