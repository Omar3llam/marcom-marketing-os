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
import { CHANNEL, DATA_SOURCE, MEASUREMENT_WINDOW } from '../connectorTypes.js';
import { logger } from '../../../utils/logger.js';

// ── The funnel, extracted rather than discarded ──────────────────────────────
// Meta returns `actions`/`action_values` as an open-ended array of
// {action_type, value}. We used to read ONE type out of it (purchase) and drop
// the array — so landing_page_view, add_to_cart and initiate_checkout arrived in
// every response, already paid for, and were thrown away. Layer 4 of the domain
// model (funnel diagnosis) is unimplementable without them: "CTR high + LPV low
// = landing page problem, NOT creative" cannot be said if LPV never lands.
//
// The map is the ONLY thing that changes when a platform adds an event — the
// storage is a JSONB bag, so no migration follows.
const ACTION_MAP = Object.freeze({
  // purchases — Meta reports the same event under several names depending on
  // pixel vs CAPI vs omni; they are the SAME purchase, so they sum into one key.
  'offsite_conversion.fb_pixel_purchase': 'purchase',
  'omni_purchase':                        'purchase',
  'purchase':                             'purchase',
  // funnel
  'landing_page_view':                    'lpv',
  'add_to_cart':                          'atc',
  'omni_add_to_cart':                     'atc',
  'offsite_conversion.fb_pixel_add_to_cart': 'atc',
  'initiate_checkout':                    'checkout',
  'omni_initiated_checkout':              'checkout',
  'offsite_conversion.fb_pixel_initiate_checkout': 'checkout',
  // leads
  'lead':                                 'lead',
  'omni_lead':                            'lead',
  // video (future-ready — no reader yet; landing them now means the history
  // exists when the creative layer lands, rather than starting from zero then)
  'video_view':                           'videoView',
  'video_p25_watched_actions':            'video25',
  'video_p50_watched_actions':            'video50',
  'video_p95_watched_actions':            'video95',
});

// The action types that mean "a purchase happened". Derived from ACTION_MAP so
// the two can never drift — this Set used to be maintained by hand alongside it.
const PURCHASE_ACTIONS = new Set(
  Object.entries(ACTION_MAP).filter(([, key]) => key === 'purchase').map(([type]) => type),
);

/**
 * PURE: collapse a Meta action array into { canonicalKey: value }.
 *
 * ── Why MAX across aliases and not SUM ──────────────────────────────────────
 * The aliases mapping to one canonical key are NOT a disjoint partition of the
 * event — they are overlapping measures of it. `omni_purchase` is Meta's
 * cross-surface aggregate and already CONTAINS the pixel purchases reported as
 * `offsite_conversion.fb_pixel_purchase`. Summing them double-counts, which
 * would silently inflate conversions and ROAS — the exact defect Layer 5.3 of
 * the domain model names ("2× purchases in Meta = CAPI without dedup").
 *
 * Max takes the most inclusive single measure: it never double-counts, never
 * under-reports, and — unlike the `.find()` it replaces — does not depend on the
 * order Meta happened to serialise the array in. Unknown action types are
 * ignored, never thrown on: Meta's vocabulary is open-ended and a new event must
 * not break a sync.
 */
export function collapseActions(arr, map = ACTION_MAP, suffix = '') {
  if (!Array.isArray(arr)) return {};
  const out = {};
  for (const a of arr) {
    const key = map[a?.action_type];
    if (!key) continue;
    const k = `${key}${suffix}`;
    const v = num(a.value);
    out[k] = out[k] == null ? v : Math.max(out[k], v);
  }
  return out;
}

/**
 * PURE: the whole funnel for one row → the `actionMetrics` JSONB bag.
 * Counts from `actions`, money from `action_values` under a `Value` suffix.
 *
 * Returns null — NOT {} — when nothing recognised was reported, so a reader can
 * tell "this platform sent no funnel data" from "every stage measured zero".
 */
export function extractActionMetrics(actions = [], actionValues = []) {
  const merged = { ...collapseActions(actions), ...collapseActions(actionValues, ACTION_MAP, 'Value') };
  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * PURE: the value of one canonical event out of an action array (0 when absent).
 * Same max-across-aliases rule as collapseActions — see the note there for why
 * this must not sum.
 */
function actionValue(arr, match) {
  if (!Array.isArray(arr)) return 0;
  let best = 0;
  for (const a of arr) if (match.has(a?.action_type)) best = Math.max(best, num(a.value));
  return best;
}

/** PURE: a Meta timestamp → Date, or null. Never an Invalid Date. */
function toDate(v) {
  if (v == null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
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
    // ── Window provenance (Phase C) ──────────────────────────────────────────
    // Meta serves ONE aggregate row per entity for the requested `date_preset`
    // (no time_increment), so this is a trailing-window aggregate — never the
    // daily observation `granularity: 'DAILY'` has always claimed.
    //
    // The period is Meta's OWN statement of what it measured, not our preset:
    // date_start/date_stop have been in CAMPAIGN_INSIGHT_FIELDS all along and
    // were dropped here until now. Landing them keeps `last_90d` and `maximum`
    // rows distinguishable without an enum value per preset — and covers the
    // arbitrary presets the sync route still accepts from a client.
    //
    // null when Meta omitted them (a merged roster-only row) — unreported, never
    // a range reconstructed from `d`, which is the SYNC time and would silently
    // describe a 90-day row as one day long.
    measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW,
    windowStart: toDate(r.date_start),
    windowEnd: toDate(r.date_stop),
    currency,
    spendMinor: toMinor(num(r.spend), currency),
    revenueMinor: toMinor(revenueMajor, currency),
    impressions: Math.round(num(r.impressions)),
    clicks: Math.round(clicks),
    conversions: Math.round(conversions),
    frequency: r.frequency != null ? num(r.frequency) : null,
    // Unique people reached. null when Meta didn't report it, never a fabricated 0.
    reach: r.reach != null ? Math.round(num(r.reach)) : null,
    // The full funnel bag (lpv/atc/checkout/lead/video + their *Value money
    // twins). null when the platform reported no recognised action — distinct
    // from a measured zero, and the reason downstream can say "funnel blind"
    // honestly instead of diagnosing a drop-off it never observed.
    actionMetrics: extractActionMetrics(r.actions, r.action_values),
    // Configured daily budget, minor units — passed through, NOT converted.
    // Meta already serves budgets in the account currency's smallest unit
    // ("1000" = 10.00 EGP), unlike `spend`, which is major units and does go
    // through toMinor above. Multiplying here would store every budget 100× too
    // large. (mergeMetaCampaigns folds this onto delivering rows; it lives on the
    // /campaigns edge only.)
    dailyBudgetMinor: r.daily_budget != null ? Math.round(num(r.daily_budget)) : null,
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
 * Ad rows → AD NormalizedSnapshots.
 *
 * parentExternalId is the AD-SET id: snapshotSink chains the FK through
 * PARENT_LEVEL (AD → ADSET → CAMPAIGN → ACCOUNT), so pointing it at the campaign
 * would compute an ad-set id that does not exist and orphan the ad.
 *
 * A row with no ad_id has no stable identity, and one with no adset_id has no
 * resolvable parent — both are dropped rather than merged onto a garbage id.
 * (Same two guards as normalizeAdSets, one level down.)
 */
function normalizeAds(rows, currency, d, accountExternalId) {
  const out = [];
  for (const r of rows) {
    if (r.ad_id == null) {
      logger.warn({ accountExternalId }, '[metaNormalize] dropped an ad row with no ad_id');
      continue;
    }
    if (r.adset_id == null) {
      logger.warn({ accountExternalId, adId: r.ad_id }, '[metaNormalize] dropped an ad row with no adset_id (no resolvable parent)');
      continue;
    }
    out.push({
      externalId: String(r.ad_id),
      entityLevel: 'AD',
      parentExternalId: String(r.adset_id),
      name: r.ad_name || 'Unnamed Ad',
      // toEntityStatus, NOT the raw Meta string: `status` feeds a Prisma
      // EntityStatus enum column, and Meta's vocabulary is far wider
      // (PENDING_REVIEW, DISAPPROVED, WITH_ISSUES…). Passing one through raw
      // would throw on the upsert; null means "we were not told", and the sink
      // then leaves the stored value alone.
      status: toEntityStatus(r.status, r.effective_status),
      // Creative age. mergeMetaAds folds `created_time` from the /ads roster onto
      // delivering rows, so this is populated for real ads, not only dormant ones.
      platformCreatedTime: toDate(r.created_time),
      // actionMetrics rides along inside baseMeasures — including the video
      // quartiles, which only exist at this level in any useful form.
      ...baseMeasures(r, currency, d),
    });
  }
  return out;
}

/**
 * @param {{ accountExternalId, accountName?, currency, date, rows }} input
 *   rows = raw Meta insight objects, CAMPAIGN / ADSET / AD level mixed.
 *   Levels are identified by their id keys — an AD row carries `ad_id`, an
 *   ad-set row `adset_id` and no `ad_id`. MetaConnector.fetchRaw concatenates
 *   all three into one array because the ChannelConnector contract is
 *   `fetchRaw -> RawRow[]`.
 * @returns {NormalizedSnapshot[]} one ACCOUNT rollup + CAMPAIGN + ADSET + AD rows
 */
export function metaNormalize({ accountExternalId, accountName = null, currency = 'USD', date, rows = [] }) {
  const d = date instanceof Date ? date : new Date(date);

  // ── THREE-WAY PARTITION (architectural invariant) ─────────────────────────
  // Partition by shape before anything else. The three levels look alike but
  // must NOT be summed together — see the rollup note below.
  //
  // ORDER IS LOAD-BEARING: most-specific key FIRST. An AD-level insight row
  // carries `adset_id` too — that is its PARENT link, requested in
  // AD_INSIGHT_FIELDS precisely so the FK can be chained. A two-way partition
  // keyed on `adset_id` would therefore swallow every ad row into adSetRows and
  // normalize it as an ad-set, where `externalId` becomes the AD's id, detId
  // hashes it to a DIFFERENT entity id than the real ad-set… and the ad lands as
  // a phantom ad-set sibling of its own parent, inflating ad-set counts and
  // double-counting nothing visibly. Checking `ad_id` first is the only thing
  // that prevents it. Never reorder these three lines.
  const adRows       = rows.filter((r) => r.ad_id != null);
  const adSetRows    = rows.filter((r) => r.ad_id == null && r.adset_id != null);
  const campaignRows = rows.filter((r) => r.ad_id == null && r.adset_id == null);

  const adSets = normalizeAdSets(adSetRows, currency, d, accountExternalId);
  const ads    = normalizeAds(adRows, currency, d, accountExternalId);

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
      // Platform-side creation time — a CAMPAIGN-only entity attribute, like
      // objective. It is the only honest basis for days-running, which gates the
      // too-early verdict rule. Lives on /campaigns only, so mergeMetaCampaigns
      // folds it onto delivering rows; null when Meta didn't report it.
      platformCreatedTime: toDate(r.created_time),
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
    measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW,
  });
  // The rollup is roster-only ONLY when no real campaign delivered — i.e. it would
  // be all zeros. With ≥1 real campaign the rollup reflects real spend (roster
  // rows add 0), so it lands; an all-roster rollup is skipped like its campaigns.
  if (account) account.rosterOnly = campaigns.every((c) => c.rosterOnly);
  // Ads append AFTER ad-sets. Order is not load-bearing for correctness — the
  // sink sorts ops by LEVEL_ORDER so parents always upsert first — but keeping
  // the array in hierarchy order makes a raw dump readable.
  return account
    ? [account, ...campaigns, ...adSets, ...ads]
    : [...campaigns, ...adSets, ...ads];
}
