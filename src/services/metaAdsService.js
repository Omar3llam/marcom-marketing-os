// ============================================================
// MARCOM — Meta Ads Service
// Wraps the official facebook-nodejs-business-sdk (CJS).
// All public functions accept a plain accessToken string so the
// caller is responsible for decrypting it from the vault first.
// ============================================================
import { createRequire } from 'module';
import { logger } from '../utils/logger.js';
import { DEFAULT_MANUAL_SYNC_DATE_PRESET } from './connectors/connectorConfig.js';

// CJS interop — the Meta SDK ships as CommonJS
const require = createRequire(import.meta.url);
const bizSdk  = require('facebook-nodejs-business-sdk');

const { FacebookAdsApi, AdAccount } = bizSdk;

// Meta Graph API version pinned centrally
const API_VERSION = 'v21.0';
const GRAPH_BASE  = `https://graph.facebook.com/${API_VERSION}`;

// ── HELPERS ──────────────────────────────────────────────────

/**
 * Ensure adAccountId is prefixed with "act_".
 * Meta rejects bare numeric IDs without this prefix.
 */
function normalizeAccountId(id) {
  const s = String(id).trim();
  return s.startsWith('act_') ? s : `act_${s}`;
}

/**
 * Initialise the SDK for a single request.
 * The SDK stores its api instance globally — always re-init before use
 * when handling concurrent users so the token is always correct.
 */
function initSdk(accessToken) {
  const api = FacebookAdsApi.init(accessToken);
  api.setDebug(false);
  return api;
}

// ── PUBLIC API ───────────────────────────────────────────────

/**
 * Exchange a short-lived user token for a 60-day long-lived token.
 * Call this immediately after the OAuth callback.
 */
export async function exchangeForLongLivedToken(shortToken) {
  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error('META_APP_ID / META_APP_SECRET not configured');

  const url = `${GRAPH_BASE}/oauth/access_token`
    + `?grant_type=fb_exchange_token`
    + `&client_id=${encodeURIComponent(appId)}`
    + `&client_secret=${encodeURIComponent(appSecret)}`
    + `&fb_exchange_token=${encodeURIComponent(shortToken)}`;

  const res  = await fetch(url);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'Token exchange failed');
  // body.expires_in is in seconds from now
  const expiresAt = body.expires_in
    ? new Date(Date.now() + body.expires_in * 1000)
    : null;
  return { accessToken: body.access_token, expiresAt };
}

/**
 * Fetch all ad accounts the token has access to.
 * Returns [{id, name, accountStatus}] sorted by name.
 * id values are returned WITHOUT the "act_" prefix.
 */
export async function listAdAccounts(accessToken) {
  const url = `${GRAPH_BASE}/me/adaccounts`
    + `?fields=id,name,account_status`
    + `&access_token=${encodeURIComponent(accessToken)}`;
  const res  = await fetch(url);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'Could not fetch ad accounts');
  return (body.data || []).map(a => ({
    id:            a.id.replace(/^act_/, ''),
    name:          a.name,
    accountStatus: a.account_status,
  }));
}

/**
 * Read an ad account's ISO-4217 currency from the act_<id> node. Meta returns it
 * on the `currency` field (e.g. 'EGP', 'SAR', 'AED'). Returns the raw string, or
 * null on ANY failure — a currency lookup must NEVER break a sync, so this never
 * throws (the connector falls back to the workspace currency / USD).
 *
 * @param {string} accessToken
 * @param {string} adAccountId — with or without "act_" prefix
 * @returns {Promise<string|null>}
 */
export async function fetchAccountCurrency(accessToken, adAccountId) {
  try {
    const accountId = normalizeAccountId(adAccountId);
    const url = `${GRAPH_BASE}/${accountId}`
      + `?fields=currency`
      + `&access_token=${encodeURIComponent(accessToken)}`;
    const res  = await fetch(url);
    const body = await res.json();
    if (body?.error) {
      logger.warn({ adAccountId, err: body.error.message }, '[Meta] account currency fetch failed');
      return null;
    }
    return typeof body?.currency === 'string' ? body.currency : null;
  } catch (err) {
    logger.warn({ adAccountId, err: err.message }, '[Meta] account currency fetch error');
    return null;
  }
}

/**
 * Create a PAUSED test campaign to verify the token + account are valid.
 * Returns the campaign_id string.
 * This is a write operation — delete the campaign manually or let it sit.
 */
export async function verifyAndCreateTest(accessToken, adAccountId) {
  initSdk(accessToken);
  const accountId = normalizeAccountId(adAccountId);
  const account   = new AdAccount(accountId);

  const campaign = await account.createCampaign(
    [],   // fields to return in the response
    {
      name:                  'Lumi Verification Campaign',
      objective:             'OUTCOME_TRAFFIC',
      status:                'PAUSED',
      special_ad_categories: [],
    }
  );

  const campaignId = campaign?.id || campaign?._data?.id;
  logger.info({ campaignId, adAccountId }, '[Meta] Test campaign created');
  return campaignId;
}

// The fields requested from the Graph API. `action_values` is load-bearing for
// revenue honesty: metaNormalize reads the purchase action_value as the claimed
// revenue, and the connector sink derives ROAS from it. Without this field Meta
// omits revenue entirely → revenue lands 0 → ROAS reads null/unmeasured. Kept as
// an exported constant so the field can't be silently dropped again (the exact
// regression that made every connector campaign show "—" for ROAS).
export const CAMPAIGN_INSIGHT_FIELDS = Object.freeze([
  'campaign_name', 'campaign_id',
  'spend', 'impressions', 'reach', 'frequency',
  'clicks', 'ctr', 'cpm', 'cpc',
  'actions', 'action_values', 'cost_per_action_type',
  'date_start', 'date_stop',
]);

// Pagination safety bound. At Meta's 25/page insights default that's 1 250
// campaigns; far past any real account. A runaway (paging.next that never
// clears) stops here with a warning rather than looping forever.
const MAX_PAGES = 50;

/**
 * Walk every page of a Meta SDK Cursor into one plain array.
 *
 * The SDK's Cursor EXTENDS Array and is mutated in place by `.next()` (it does
 * NOT expose a `fetchAll()`). That made the old `Array.isArray(cursor) ? cursor`
 * guard a silent page-1-only read: `Array.isArray` is true for an Array subclass,
 * so only the first page (≤25 rows) was ever returned. We collect the current
 * page, then follow `paging.next` until exhausted. Rows are unwrapped from the
 * SDK's `_data` envelope to plain objects (every consumer already did this).
 *
 * @param {Array & { hasNext?: Function, next?: Function }} cursor
 * @returns {Promise<{ rows: Array, pages: number }>}
 */
export async function collectCursorPages(cursor) {
  const rows = [];
  let pages = 0;
  for (;;) {
    pages += 1;
    for (const row of cursor) rows.push(row?._data || row);
    const more = typeof cursor?.hasNext === 'function' && cursor.hasNext();
    if (!more || pages >= MAX_PAGES) break;
    await cursor.next(); // replaces the cursor's contents with the next page
  }
  if (pages >= MAX_PAGES && typeof cursor?.hasNext === 'function' && cursor.hasNext()) {
    logger.warn({ pages, collected: rows.length }, '[metaAdsService] pagination hit MAX_PAGES — result may be truncated');
  }
  return { rows, pages };
}

/**
 * Pull campaign-level insights. The window defaults to the shared MANUAL preset
 * (reach as far back as Meta serves) — every real caller passes an explicit
 * datePreset today, so this default is the bare-call safety net, not policy.
 * Returns an array of insight objects — keys include:
 *   campaign_name, spend, impressions, reach, frequency,
 *   clicks, ctr, cpm, cpc, actions, action_values, cost_per_action_type
 *
 * NOTE: /insights only returns campaigns that DELIVERED in the window — a
 * zero-spend campaign never appears here, even with date_preset 'maximum'. The
 * connector pairs this with fetchAllCampaigns + mergeMetaCampaigns to land the
 * full roster. This function paginates (see collectCursorPages) so an account
 * with more delivered campaigns than one page no longer truncates to page 1.
 *
 * @param {string}  accessToken
 * @param {string}  adAccountId   — with or without "act_" prefix
 * @param {string}  [datePreset]  — e.g. 'last_7d', 'last_30d', 'last_90d', 'maximum'
 */
export async function fetchCampaignInsights(accessToken, adAccountId, datePreset = DEFAULT_MANUAL_SYNC_DATE_PRESET) {
  initSdk(accessToken);
  const accountId = normalizeAccountId(adAccountId);
  const account   = new AdAccount(accountId);

  const cursor = await account.getInsights(
    CAMPAIGN_INSIGHT_FIELDS,
    {
      level:        'campaign',
      date_preset:  datePreset,
    }
  );

  // Collect ALL pages — not just page 1 (the SDK Cursor has no fetchAll()).
  const { rows, pages } = await collectCursorPages(cursor);

  // Raw-count observability at the fetch boundary — logged before any
  // normalize/storage step touches the data. This is the number that answers
  // "did Meta return N rows, or did something downstream drop them?" The next
  // visible count is post-normalize in snapshotSink ([snapshotSink] landed);
  // a divergence (beyond the +1 account rollup normalize adds) is a real
  // finding, not something to assume away.
  logger.info(
    { accountId, datePreset, rawCount: rows.length, pages },
    '[metaAdsService] fetchCampaignInsights raw response',
  );

  return rows;
}

// Entity attributes fetched from the /campaigns edge — NOT metrics. These exist
// so the sync can land EVERY campaign, including zero-spend ones the /insights
// edge omits. `id`/`name` are the keys metaNormalize maps to campaign_id/
// campaign_name; effective_status/status carry the real delivery state.
export const CAMPAIGN_LIST_FIELDS = Object.freeze([
  'id', 'name', 'status', 'effective_status',
  'created_time', 'objective', 'daily_budget', 'lifetime_budget',
]);

// One page of /campaigns is small (default 25); ask for a larger page to cut
// round-trips. Meta caps this server-side and returns up to its own max.
const CAMPAIGN_PAGE_SIZE = 200;

/**
 * Fetch ALL campaigns for an account from the /campaigns edge — regardless of
 * spend or delivery. Unlike /insights (which omits campaigns that didn't deliver
 * in the window), this returns the full roster so the connector can land
 * zero-spend campaigns too. Paginates via collectCursorPages.
 *
 * @param {string} accessToken
 * @param {string} adAccountId — with or without "act_" prefix
 * @returns {Promise<Array>} raw campaign objects ({ id, name, status, ... })
 */
export async function fetchAllCampaigns(accessToken, adAccountId) {
  initSdk(accessToken);
  const accountId = normalizeAccountId(adAccountId);
  const account   = new AdAccount(accountId);

  const cursor = await account.getCampaigns(CAMPAIGN_LIST_FIELDS, { limit: CAMPAIGN_PAGE_SIZE });
  const { rows, pages } = await collectCursorPages(cursor);

  logger.info(
    { accountId, campaignCount: rows.length, pages },
    '[metaAdsService] fetchAllCampaigns roster',
  );

  return rows;
}

/**
 * PURE merge: fold the /campaigns roster into the /insights rows so EVERY
 * campaign lands, not only those that delivered. Insight rows (which carry real
 * spend/revenue/impressions) WIN and pass through untouched; any campaign absent
 * from insights is appended as a roster-only row flagged `_rosterOnly: true`.
 *
 * `_rosterOnly` is the load-bearing distinction: a roster row means "no delivery
 * data was found for this campaign in the window", NOT "verified zero". The sink
 * (snapshotSink) lands the ENTITY for these (so the campaign still appears in the
 * list) but writes NO MetricSnapshot — so the UI shows "—" (unknown), never a
 * fabricated 0. This is what stops an empty/short-window fetch from overwriting
 * real metrics with zeros (the manual-sync data-loss bug).
 *
 * @param {Array} insights  raw insight rows from fetchCampaignInsights
 * @param {Array} campaigns raw campaign rows from fetchAllCampaigns
 * @returns {Array} insight-shaped rows for metaNormalize
 */
export function mergeMetaCampaigns(insights = [], campaigns = []) {
  // `objective` lives on the /campaigns roster edge (fetchAllCampaigns), NOT on
  // /insights. Fold it onto BOTH delivered insight rows and roster-only rows so
  // the verdict engine can tell a true awareness campaign from a conversion
  // campaign with no measured revenue. Only stamped when KNOWN — an absent
  // objective adds no key (keeps rows byte-identical when Meta omits it).
  const objectiveById = new Map();
  for (const c of campaigns || []) {
    const cd = c?._data || c;
    if (cd?.id != null && cd.objective != null) objectiveById.set(String(cd.id), cd.objective);
  }
  const withObjective = (row, id) => {
    const objective = row.objective ?? objectiveById.get(String(id));
    return objective != null ? { ...row, objective } : row;
  };

  const insightRows = (insights || []).map((row) => {
    const r = row?._data || row;
    return withObjective(r, r?.campaign_id);
  });
  const withInsights = new Set();
  for (const r of insightRows) {
    if (r?.campaign_id != null) withInsights.add(String(r.campaign_id));
  }

  const rosterOnly = [];
  for (const c of campaigns || []) {
    const cd = c?._data || c;
    const id = cd?.id != null ? String(cd.id) : null;
    if (!id || withInsights.has(id)) continue; // unkeyable, or already has real data
    const rrow = {
      campaign_id:   id,
      campaign_name: cd.name || 'Unnamed Campaign',
      spend:         '0',
      impressions:   '0',
      clicks:        '0',
      _rosterOnly:   true, // no delivery data found — "unknown", never a verified 0
    };
    rosterOnly.push(cd.objective != null ? { ...rrow, objective: cd.objective } : rrow);
  }

  return [...insightRows, ...rosterOnly];
}

/**
 * Format raw Meta insights into a human-readable string that Mode 5
 * can analyse directly (avoids huge JSON blobs in the prompt).
 */
export function formatInsightsForPrompt(insights, adAccountId) {
  if (!insights || insights.length === 0) {
    return 'No campaign data found for the selected date range.';
  }

  const lines = [
    `META ADS ACCOUNT: ${adAccountId}`,
    `CAMPAIGNS (${insights.length}):`,
    '',
  ];

  for (const row of insights) {
    const d = row._data || row;
    const conversions = (d.actions || []).find(a => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || '—';
    const leads       = (d.actions || []).find(a => a.action_type === 'lead')?.value || '—';
    const cpa         = (d.cost_per_action_type || []).find(a => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value
                     || (d.cost_per_action_type || []).find(a => a.action_type === 'lead')?.value
                     || '—';

    lines.push(
      `Campaign: ${d.campaign_name || 'Unnamed'}`,
      `  Spend: $${parseFloat(d.spend || 0).toFixed(2)}  |  Impressions: ${d.impressions || '—'}  |  Reach: ${d.reach || '—'}  |  Frequency: ${parseFloat(d.frequency || 0).toFixed(2)}`,
      `  CTR: ${parseFloat(d.ctr || 0).toFixed(2)}%  |  CPC: $${parseFloat(d.cpc || 0).toFixed(2)}  |  CPM: $${parseFloat(d.cpm || 0).toFixed(2)}`,
      `  Clicks: ${d.clicks || '—'}  |  Conversions: ${conversions}  |  Leads: ${leads}  |  CPA: $${cpa}`,
      `  Date range: ${d.date_start || '—'} → ${d.date_stop || '—'}`,
      '',
    );
  }

  return lines.join('\n');
}

/**
 * Normalize Meta API insights into campaign objects for orchestrator analysis.
 * Output matches the campaign shape the orchestrator analysis logic expects.
 *
 * @param {Array} insights - Raw Meta API insights from fetchCampaignInsights
 * @returns {Array} - Normalized campaign objects
 */
export function normalizeInsightsForAnalysis(insights) {
  if (!insights || insights.length === 0) return [];

  return insights.map((row) => {
    const d = row._data || row;

    // Extract conversions (results) from actions array
    const conversions = (d.actions || []).find(
      a => a.action_type === 'offsite_conversion.fb_pixel_purchase' || a.action_type === 'lead'
    )?.value || 0;

    const spend       = parseFloat(d.spend || 0);
    const impressions = parseInt(d.impressions || 0, 10);
    const reach       = parseInt(d.reach || 0, 10);
    const frequency   = parseFloat(d.frequency || 0);
    const ctr         = parseFloat(d.ctr || 0);
    const cpc         = parseFloat(d.cpc || 0);
    const results     = parseInt(conversions, 10);

    // Estimate ROAS from CTR + frequency (Meta insights carry no ROAS column here)
    const roasEstimate = estimateRoas(ctr, frequency);

    // Cost per result (CPA)
    const costPerResult = results > 0 ? spend / results : 0;

    // Stable composite ID (campaign_id from Meta or fallback slug)
    const campaignId = d.campaign_id
      ? `meta__${d.campaign_id}`
      : `meta__${String(d.campaign_name || 'unknown').toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;

    return {
      campaignId,
      campaignName:   d.campaign_name || 'Unnamed Campaign',
      adsetName:      'Campaign-level aggregate', // Meta API returns campaign-level, not adset
      deliveryStatus: 'ACTIVE', // Meta API doesn't return delivery_status at campaign level
      spend:          round2(spend),
      impressions,
      results,
      frequency:      round2(frequency),
      reach,
      costPerResult:  round2(costPerResult),
      ctr:            round2(ctr),
      cpc:            round2(cpc),
      roas:           round2(roasEstimate),
      // Preserve raw Meta API response for Claude context
      rawRecord:      d,
    };
  });
}

// ── Helpers (self-contained) ────

function estimateRoas(ctr, frequency) {
  const base       = 1.5;
  const ctrBonus   = ctr > 1 ? (ctr - 1) * 0.1 : 0;
  const freqFactor = frequency > 3 ? 1 - (frequency - 3) * 0.15 : 1;
  return Math.max(0.1, (base + ctrBonus) * freqFactor);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
