// ============================================================
// MARCOM — Meta Ads Service
// Wraps the official facebook-nodejs-business-sdk (CJS).
// All public functions accept a plain accessToken string so the
// caller is responsible for decrypting it from the vault first.
// ============================================================
import { createRequire } from 'module';
import { logger } from '../utils/logger.js';
import { DEFAULT_MANUAL_SYNC_DATE_PRESET, dailyIngestionDays } from './connectors/connectorConfig.js';
// The canonical verdict window is a product decision and lives in ONE place.
// This module translates it into a Meta request; it never restates the number.
import { canonicalWindowBounds } from './verdict-engine/metricWindow.js';

// CJS interop — the Meta SDK ships as CommonJS
const require = createRequire(import.meta.url);
const bizSdk  = require('facebook-nodejs-business-sdk');

const { FacebookAdsApi, AdAccount } = bizSdk;

// Meta Graph API version pinned centrally
const API_VERSION = 'v21.0';
const GRAPH_BASE  = `https://graph.facebook.com/${API_VERSION}`;

// ── HELPERS ──────────────────────────────────────────────────

/**
 * R11 (I68) — the ONE way a token reaches Meta from this module.
 *
 * Every raw-fetch call site here used to append `&access_token=…` to the URL.
 * That put a 60-day workspace credential into the outbound URL of every one of
 * them, where access logs, proxies and APM spans record it. Meta accepts a
 * standard bearer header, and the OAuth flow for Google in this same codebase
 * already used one — the pattern was known, just applied unevenly.
 */
function bearer(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

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

  // R11 (I68) — the app secret and the token travel in the POST body, never in
  // the URL. Meta's oauth/access_token accepts either; a URL is recorded by
  // every access log, proxy and APM span on the path, and a request body is
  // not. encodeURIComponent made the URL well-formed, not private.
  const url  = `${GRAPH_BASE}/oauth/access_token`;
  const form = new URLSearchParams({
    grant_type:        'fb_exchange_token',
    client_id:         appId,
    client_secret:     appSecret,
    fb_exchange_token: shortToken,
  });

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    form.toString(),
  });
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
  // R11 (I68) — token in the Authorization header, not the query string.
  const url = `${GRAPH_BASE}/me/adaccounts?fields=id,name,account_status`;
  const res = await fetch(url, { headers: bearer(accessToken) });
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
    // R11 (I68) — token in the Authorization header, not the query string.
    const url = `${GRAPH_BASE}/${accountId}?fields=currency`;
    const res = await fetch(url, { headers: bearer(accessToken) });
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

/** Account-local reporting timezone from Meta itself; never a workspace guess. */
export async function fetchAccountTimezone(accessToken, adAccountId) {
  try {
    const accountId = normalizeAccountId(adAccountId);
    const res = await fetch(`${GRAPH_BASE}/${accountId}?fields=timezone_name`, { headers: bearer(accessToken) });
    const body = await res.json();
    if (!res.ok || body?.error) return null;
    return typeof body?.timezone_name === 'string' ? body.timezone_name : null;
  } catch (err) {
    logger.warn({ adAccountId, err: err.message }, '[Meta] account timezone fetch failed');
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
 * @returns {Promise<{ rows: Array, pages: number, truncated: boolean }>}
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
  // Truncation is RETURNED, not only logged. A partial fetch that looks complete
  // is the failure this codebase keeps correcting; callers need to be able to
  // say "incomplete" out loud rather than land a subset as if it were the whole
  // account. Matters most at ad-set level, where row counts are 3–10x campaigns.
  const truncated = pages >= MAX_PAGES && typeof cursor?.hasNext === 'function' && cursor.hasNext();
  if (truncated) {
    logger.warn({ pages, collected: rows.length }, '[metaAdsService] pagination hit MAX_PAGES — result may be truncated');
  }
  return { rows, pages, truncated };
}

// Legacy direct callers require an array. Carry pagination evidence without
// changing iteration, row values or JSON serialization (same side-channel as
// MetaConnector.fetchRaw). Consumers must read it before merging/spreading.
function campaignRowsWithCompleteness({ rows, pages, truncated }) {
  Object.defineProperty(rows, 'fetchMeta', {
    value: Object.freeze({ pages, truncated }),
    enumerable: false,
  });
  return rows;
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
  const collected = await collectCursorPages(cursor);
  const { rows, pages, truncated } = collected;

  // Raw-count observability at the fetch boundary — logged before any
  // normalize/storage step touches the data. This is the number that answers
  // "did Meta return N rows, or did something downstream drop them?" The next
  // visible count is post-normalize in snapshotSink ([snapshotSink] landed);
  // a divergence (beyond the +1 account rollup normalize adds) is a real
  // finding, not something to assume away.
  logger.info(
    { accountId, datePreset, rawCount: rows.length, pages, truncated },
    '[metaAdsService] fetchCampaignInsights raw response',
  );

  return campaignRowsWithCompleteness(collected);
}

/** A Date → Meta's `YYYY-MM-DD`, in UTC. Matches metaPerformanceSync's format. */
export function toMetaDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * PURE: the exact params the canonical 30-day insights request sends.
 *
 * Extracted so the request itself is assertable — that `time_increment` is
 * ABSENT is a load-bearing property of this phase (it is what makes the row
 * cumulative, and therefore what makes reach/frequency usable), and a property
 * that important should be pinned against the real object rather than a proxy
 * for it.
 *
 * The 30 is never written here: canonicalWindowBounds owns it.
 */
export function canonicalInsightsParams(level, now = new Date(), { limit: limitOverride } = {}) {
  const spec = CANONICAL_LEVELS.find((l) => l.level === level);
  if (!spec) {
    // Levels are enumerated, not free text. ACCOUNT in particular is NOT a
    // canonical fetch level: metaNormalize derives the account row by summing
    // CAMPAIGNS, and asking Meta for it separately would produce a second,
    // differently-derived account figure with no way to tell which is right.
    throw new Error(`canonicalInsightsParams: "${level}" is not a canonical level`);
  }
  const { start, end } = canonicalWindowBounds(now);
  return {
    level,
    // Inclusive both ends, exactly like canonicalWindowBounds — so the period we
    // ask Meta for and the period the contract defines are the same 30 days.
    time_range: { since: toMetaDay(start), until: toMetaDay(end) },
    // NO time_increment. Its absence is the difference between one cumulative
    // row per entity and one row per day.
    //
    // The page size is the LEVEL's, not the caller's, so this function fully
    // describes the request for a level rather than describing most of it and
    // leaving the rest to whoever calls it.
    ...((limitOverride ?? spec.limit) ? { limit: limitOverride ?? spec.limit } : {}),
  };
}

/**
 * The CANONICAL 30-day verdict fetch (Phase F) — the first producer of
 * CUMULATIVE_30D rows.
 *
 * ── Why `time_range` and not `date_preset: 'last_30d'` ──────────────────────
 * A preset is Meta's definition of "30 days", and Meta is free to mean "the 30
 * days ending yesterday", or to shift on the account's timezone. The canonical
 * verdict window is a PRODUCT decision owned by metricWindow.js, so we state the
 * exact period and let Meta echo it back in date_start/date_stop rather than
 * asking a question whose answer we would then have to trust and validate.
 *
 * This is also why Phase F is not "change DEFAULT_CRON_SYNC_DATE_PRESET to
 * last_30d": that would leave the verdict window a property of a sync preset,
 * which is the coupling this whole track exists to break. Sync request window
 * and verdict measurement window are now different concepts with different
 * owners.
 *
 * ── NOT daily ───────────────────────────────────────────────────────────────
 * NO `time_increment`. This deliberately returns ONE cumulative row per campaign
 * for the whole period — which is what makes `reach` and `frequency` usable:
 * both are window-level quantities that cannot be rebuilt from daily rows (they
 * need unique-person de-duplication that daily rows do not carry).
 *
 * @param {string} accessToken
 * @param {string} adAccountId
 * @param {{ now?: Date }} [opts]
 * @returns {Promise<{ rows: Array, windowStart: Date, windowEnd: Date }>}
 */
export async function fetchCanonicalInsights(accessToken, adAccountId, { now = new Date(), level = 'campaign' } = {}) {
  const spec = CANONICAL_LEVELS.find((l) => l.level === level);
  if (!spec) throw new Error(`fetchCanonicalInsights: "${level}" is not a canonical level`);

  initSdk(accessToken);
  const accountId = normalizeAccountId(adAccountId);
  const account = new AdAccount(accountId);
  const { start, end } = canonicalWindowBounds(now);

  const cursor = await account.getInsights(spec.fields, canonicalInsightsParams(level, now));

  // Same pagination as the operational path — deliberately reused, not
  // reimplemented. `truncated` matters MORE here than at campaign level: ad-set
  // and ad rows outnumber campaigns several-fold, so a canonical fetch is the
  // likelier one to hit MAX_PAGES, and a partial canonical population that looks
  // complete is exactly the failure this track keeps correcting.
  const { rows, pages, truncated } = await collectCursorPages(cursor);
  logger.info(
    { accountId, level, since: toMetaDay(start), until: toMetaDay(end), rawCount: rows.length, pages, truncated },
    '[metaAdsService] fetchCanonicalInsights (30d cumulative) raw response',
  );
  return { rows, windowStart: start, windowEnd: end, truncated };
}

// ── DAILY ADDITIVE INSIGHTS (Phase E / R8) ──────────────────────────────────
//
// The third Meta read, and the first one that returns a TRUE DAILY OBSERVATION:
// one row per campaign PER DAY, each measuring exactly one day of delivery.
//
// WHY IT EXISTS. Every other insights read in this file returns a trailing
// aggregate — the operational fetch over whatever preset the trigger chose, the
// canonical fetch over exactly 30 days. Neither can answer "what did this
// campaign do on Tuesday", and the difference between two overlapping trailing
// windows is NOT that answer: it is one day added minus one day dropped off the
// tail, which is a statement about the tail.
//
// The fields are DELIBERATELY NARROWER than every other list here.
// `reach` and `frequency` are absent, and their absence is load-bearing: they
// are window-level quantities (metricWindow.NON_AGGREGABLE_REASON) that count
// unique people. A daily reach is a real number about a different question, and
// carrying it beside additive daily metrics is an invitation to sum it. The
// canonical fetch is where those two belong, and it already serves them.
//
// `ctr`/`cpm`/`cpc` are absent for a milder reason: they are ratios of the
// additive primitives on the same row, so asking for them adds a second source
// of truth for a number we can derive exactly. snapshotSink derives them once,
// from this row's own clicks and impressions.
export const DAILY_INSIGHT_FIELDS = Object.freeze([
  'campaign_name', 'campaign_id',
  'spend', 'impressions', 'clicks',
  'actions', 'action_values',
  // The period, and the whole reason this read can be trusted. Meta echoes back
  // which day each row covers; a row that does not say, or says something other
  // than one day, is refused at normalize (metaDailyNormalize).
  'date_start', 'date_stop',
]);

// Rows scale as campaigns × days, so the page size is the largest the other
// levels use rather than the campaign default of 25.
const DAILY_PAGE_SIZE = 500;

/**
 * PURE: the exact params a daily additive request sends.
 *
 * Extracted for the same reason as canonicalInsightsParams: that
 * `time_increment` is PRESENT and equal to 1 is the single property that makes
 * the response daily, and a property that load-bearing is pinned against the
 * real object rather than a proxy for it.
 *
 * `time_range` rather than a preset, for the reason Phase F established: a
 * preset is Meta's definition of a period, and we would then have to trust and
 * validate what it meant. We state the days we want and check what comes back.
 *
 * @param {Date} [now] — the observation instant; the range ends on its UTC day
 * @param {number} [days] — trailing day count (a REQUEST bound, see connectorConfig)
 */
export function dailyInsightsParams(now = new Date(), days = dailyIngestionDays()) {
  const end = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(end.getTime())) throw new Error('dailyInsightsParams: invalid `now`');
  if (!Number.isInteger(days) || days < 1) {
    throw new Error('dailyInsightsParams: days must be a positive integer (a zero-day request ingests nothing while reporting success)');
  }
  // Inclusive both ends, like canonicalWindowBounds: `days` days means `days`
  // days of delivery, not one more or one fewer.
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return {
    // CAMPAIGN ONLY in R8. Ad-set and ad rows outnumber campaigns several-fold
    // and multiplying either by `days` is how a fetch hits MAX_PAGES and lands a
    // truncated population that looks complete. Widening the level is its own
    // change, with its own pagination argument.
    level: 'campaign',
    time_range: { since: toMetaDay(start), until: toMetaDay(end) },
    // THE line. Without it Meta returns one aggregate row for the whole range;
    // with it, one row per day. Everything this phase claims rests on it.
    time_increment: 1,
    limit: DAILY_PAGE_SIZE,
  };
}

/**
 * Fetch true daily observations for one account.
 *
 * Returns the rows exactly as Meta sent them, plus the period we ASKED for —
 * which is used only as context for logging and for the caller's own bookkeeping.
 * It is never used to date a row: each row carries its own date_start/date_stop,
 * and metaDailyNormalize refuses any row that does not.
 *
 * @param {string} accessToken
 * @param {string} adAccountId
 * @param {{ now?: Date, days?: number }} [opts]
 * @returns {Promise<{ rows, requestedStart: Date, requestedEnd: Date, truncated: boolean, days: number }>}
 */
export async function fetchDailyInsights(accessToken, adAccountId, { now = new Date(), days = dailyIngestionDays() } = {}) {
  initSdk(accessToken);
  const accountId = normalizeAccountId(adAccountId);
  const account = new AdAccount(accountId);
  const params = dailyInsightsParams(now, days);

  const cursor = await account.getInsights(DAILY_INSIGHT_FIELDS, params);

  // Same pagination as every other level — reused, not reimplemented. Truncation
  // matters here because the row count is multiplied by `days`: a partial daily
  // population that looks complete would leave holes no reader could see.
  const { rows, pages, truncated } = await collectCursorPages(cursor);
  logger.info(
    {
      accountId, days, since: params.time_range.since, until: params.time_range.until,
      rawCount: rows.length, pages, truncated,
    },
    '[metaAdsService] fetchDailyInsights (time_increment=1) raw response',
  );
  return {
    rows,
    requestedStart: new Date(`${params.time_range.since}T00:00:00.000Z`),
    requestedEnd: new Date(`${params.time_range.until}T00:00:00.000Z`),
    truncated,
    days,
  };
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
  const collected = await collectCursorPages(cursor);
  const { rows, pages, truncated } = collected;

  logger.info(
    { accountId, campaignCount: rows.length, pages, truncated },
    '[metaAdsService] fetchAllCampaigns roster',
  );

  return campaignRowsWithCompleteness(collected);
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
// ── Delivery status ─────────────────────────────────────────────────────────
// `status` / `effective_status` live ONLY on the roster edges (/campaigns,
// /adsets). Meta's /insights never returns them, so a DELIVERING entity — the
// common case — has no status of its own and must inherit the roster's. Folding
// it on here is the only place both halves are in hand.
//
// Without this the status column reads `undefined` on every delivering row and
// falls back to the schema's ACTIVE default: a paused ad set that spent money
// last week would still assert it is running.

/** PURE: the status keys from a roster row, omitted entirely when unknown. */
function pickStatus(rosterRow) {
  const out = {};
  if (rosterRow?.status != null) out.status = rosterRow.status;
  if (rosterRow?.effective_status != null) out.effective_status = rosterRow.effective_status;
  return out;
}

/** PURE: index a roster by id → its status keys. */
function statusIndex(rosterRows = []) {
  const m = new Map();
  for (const row of rosterRows) {
    const r = row?._data || row;
    if (r?.id == null) continue;
    const s = pickStatus(r);
    if (Object.keys(s).length) m.set(String(r.id), s);
  }
  return m;
}

/**
 * PURE: fold the roster's status onto an insight row. A row that somehow carries
 * its own status keeps it; an unknown status adds NO key, so rows stay
 * byte-identical when Meta omits it (same contract as `objective`).
 */
function withStatus(row, index, id) {
  if (row?.status != null || id == null) return row;
  const s = index.get(String(id));
  return s ? { ...row, ...s } : row;
}

// ── Roster-only entity attributes ───────────────────────────────────────────
// `created_time` and `daily_budget` are requested in CAMPAIGN_LIST_FIELDS but,
// like `objective` and `status`, they live ONLY on the /campaigns edge —
// /insights never returns them. Without this fold they were present on
// roster-only rows and `undefined` on every campaign that actually DELIVERED,
// i.e. missing from 100% of the rows the verdict engine scores. That is the same
// class of silent gap the `withStatus` note above documents.
//
// Stamped only when KNOWN, so rows stay byte-identical when Meta omits them.
const ROSTER_ATTRS = Object.freeze(['created_time', 'daily_budget', 'lifetime_budget']);

/** PURE: index a roster by id → the entity attributes /insights never carries. */
function attrIndex(rosterRows = []) {
  const m = new Map();
  for (const row of rosterRows || []) {
    const r = row?._data || row;
    if (r?.id == null) continue;
    const attrs = {};
    for (const k of ROSTER_ATTRS) if (r[k] != null) attrs[k] = r[k];
    if (Object.keys(attrs).length) m.set(String(r.id), attrs);
  }
  return m;
}

/** PURE: fold roster attributes onto a row; the row's own values always win. */
function withRosterAttrs(row, index, id) {
  if (id == null) return row;
  const attrs = index.get(String(id));
  if (!attrs) return row;
  const missing = {};
  for (const [k, v] of Object.entries(attrs)) if (row?.[k] == null) missing[k] = v;
  return Object.keys(missing).length ? { ...row, ...missing } : row;
}

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

  const statusById = statusIndex(campaigns);
  const attrsById  = attrIndex(campaigns);
  const insightRows = (insights || []).map((row) => {
    const r = row?._data || row;
    const id = r?.campaign_id;
    return withRosterAttrs(withStatus(withObjective(r, id), statusById, id), attrsById, id);
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
      ...pickStatus(cd),
      // Entity attributes exist on a roster row even with no delivery: a campaign
      // created 2 days ago that hasn't spent is exactly the case the too-early
      // rule needs to recognise.
      ...(attrsById.get(id) ?? {}),
    };
    rosterOnly.push(cd.objective != null ? { ...rrow, objective: cd.objective } : rrow);
  }

  return [...insightRows, ...rosterOnly];
}

// ============================================================
// Ad-set level — the same two-edge pattern, one level down
// ============================================================

// A SEPARATE constant, never a mutation of CAMPAIGN_INSIGHT_FIELDS: that one
// carries a comment explaining that dropping `action_values` once made every
// campaign render "—" for ROAS. Sharing a mutable list between two levels is how
// that regression comes back.
//
// Every metric here is identical to the campaign list (Meta serves the same
// measures at every level). The additions are the ids: `adset_id` is the
// entity's own identity, and `campaign_id` is its PARENT — the field
// metaNormalize maps to parentExternalId so snapshotSink can chain the FK.
export const ADSET_INSIGHT_FIELDS = Object.freeze([
  'adset_name', 'adset_id',
  'campaign_name', 'campaign_id',
  'spend', 'impressions', 'reach', 'frequency',
  'clicks', 'ctr', 'cpm', 'cpc',
  'actions', 'action_values', 'cost_per_action_type',
  'date_start', 'date_stop',
]);

// Entity attributes from the /adsets edge — NOT metrics. Mirrors
// CAMPAIGN_LIST_FIELDS; `campaign_id` is the parent link.
export const ADSET_LIST_FIELDS = Object.freeze([
  'id', 'name', 'campaign_id', 'status', 'effective_status',
]);

// Ad-sets outnumber campaigns several times over, so the default 25/page would
// hit MAX_PAGES (50) at ~1 250 rows. An explicit 200 raises the ceiling to
// ~10 000 — and collectCursorPages now REPORTS truncation rather than silently
// returning a subset, so passing the cap is visible either way.
const ADSET_PAGE_SIZE = 200;

/**
 * Pull ad-set-level insights for an account. ONE account-scoped call with
 * `level: 'adset'` — Meta fans out server-side, so this is O(1) requests, not
 * one per campaign.
 *
 * Like /insights at campaign level, this returns ONLY ad-sets that DELIVERED in
 * the window. Pair with fetchAllAdSets + mergeMetaAdSets for the full roster.
 *
 * @returns {Promise<{ rows: Array, truncated: boolean }>}
 */
export async function fetchAdSetInsights(accessToken, adAccountId, datePreset = DEFAULT_MANUAL_SYNC_DATE_PRESET) {
  initSdk(accessToken);
  const accountId = normalizeAccountId(adAccountId);
  const account   = new AdAccount(accountId);

  const cursor = await account.getInsights(
    ADSET_INSIGHT_FIELDS,
    {
      level:       'adset',
      date_preset: datePreset,
      limit:       ADSET_PAGE_SIZE,
    },
  );

  const { rows, pages, truncated } = await collectCursorPages(cursor);

  logger.info(
    { accountId, datePreset, rawCount: rows.length, pages, truncated },
    '[metaAdsService] fetchAdSetInsights raw response',
  );

  return { rows, truncated };
}

/**
 * Fetch ALL ad-sets for an account from the /adsets edge, regardless of
 * delivery. Mirrors fetchAllCampaigns.
 *
 * @returns {Promise<{ rows: Array, truncated: boolean }>}
 */
export async function fetchAllAdSets(accessToken, adAccountId) {
  initSdk(accessToken);
  const accountId = normalizeAccountId(adAccountId);
  const account   = new AdAccount(accountId);

  const cursor = await account.getAdSets(ADSET_LIST_FIELDS, { limit: ADSET_PAGE_SIZE });
  const { rows, pages, truncated } = await collectCursorPages(cursor);

  logger.info(
    { accountId, adSetCount: rows.length, pages, truncated },
    '[metaAdsService] fetchAllAdSets roster',
  );

  return { rows, truncated };
}

/**
 * PURE merge: fold the /adsets roster into the ad-set insight rows. Exact mirror
 * of mergeMetaCampaigns, including the `_rosterOnly` contract.
 *
 * A roster-only ad-set means "no delivery data found in this window", NOT
 * "verified zero". snapshotSink lands the ENTITY (so the ad-set appears in the
 * drill-down) but writes NO MetricSnapshot, so the UI reads "—" rather than a
 * fabricated 0 — and a short-window fetch cannot overwrite real metrics with
 * zeros. This is the PR #160 correction, applied one level down before it can
 * recur.
 *
 * An ad-set with no parent campaign_id is DROPPED: snapshotSink derives its FK
 * from parentExternalId, so a parentless row would compute a garbage campaign id
 * and either orphan the ad-set or attach it to the wrong campaign.
 *
 * @param {Array} insights raw rows from fetchAdSetInsights
 * @param {Array} adSets   raw rows from fetchAllAdSets
 * @returns {Array} insight-shaped ad-set rows for metaNormalize
 */
export function mergeMetaAdSets(insights = [], adSets = []) {
  const statusById = statusIndex(adSets);
  const insightRows = [];
  const withInsights = new Set();

  for (const row of insights || []) {
    const r = row?._data || row;
    if (r?.adset_id == null) continue; // unkeyable — no stable identity
    insightRows.push(r);
    withInsights.add(String(r.adset_id));
  }

  const rosterOnly = [];
  for (const a of adSets || []) {
    const ad = a?._data || a;
    const id = ad?.id != null ? String(ad.id) : null;
    if (!id || withInsights.has(id)) continue; // unkeyable, or already has real data
    if (ad.campaign_id == null) {
      logger.warn({ adSetId: id }, '[metaAdsService] ad-set roster row has no campaign_id — dropped');
      continue;
    }
    rosterOnly.push({
      adset_id:    id,
      adset_name:  ad.name || 'Unnamed Ad Set',
      campaign_id: String(ad.campaign_id),
      spend:       '0',
      impressions: '0',
      clicks:      '0',
      _rosterOnly: true, // no delivery data found — "unknown", never a verified 0
      ...pickStatus(ad),
    });
  }

  return [...insightRows.map((r) => withStatus(r, statusById, r?.adset_id)), ...rosterOnly];
}

// ============================================================
// Ad level — the same two-edge pattern, one level further down
// ============================================================

// A SEPARATE frozen constant, never a reference to or mutation of
// ADSET_INSIGHT_FIELDS. The comment on that one explains why: sharing a mutable
// field list between levels is how the dropped-`action_values` regression came
// back. The measures are identical (Meta serves the same ones at every level);
// what differs is the identity pair — `ad_id` is this entity, `adset_id` is its
// PARENT, and metaNormalize maps that to parentExternalId so snapshotSink can
// chain the FK. `campaign_id` rides along for debugging only; the partition keys
// on `ad_id` first, so its presence changes nothing.
export const AD_INSIGHT_FIELDS = Object.freeze([
  'ad_name', 'ad_id',
  'adset_id', 'campaign_id',
  'spend', 'impressions', 'reach', 'frequency',
  'clicks', 'ctr', 'cpm', 'cpc',
  'actions', 'action_values', 'cost_per_action_type',
  'date_start', 'date_stop',
]);

// Entity attributes from the /ads edge — NOT metrics. `adset_id` is the parent
// link. `created_time` is the ad's platform creation time (creative age); like
// `objective` on campaigns it lives ONLY on the roster edge, so mergeMetaAds
// folds it onto delivering rows — see AD_ROSTER_ATTRS.
export const AD_LIST_FIELDS = Object.freeze([
  'id', 'name', 'adset_id', 'status', 'effective_status', 'created_time',
]);

// Ads outnumber ad-sets several-fold, which outnumber campaigns several-fold.
// At 200/page the MAX_PAGES (50) ceiling lands at ~10 000 rows — reachable on a
// real account. 500 raises it to ~25 000, and collectCursorPages REPORTS
// truncation rather than silently returning a subset, so passing the cap stays
// visible either way (fetchMeta.truncated carries it to the sync loop).
const AD_PAGE_SIZE = 500;

/**
 * Ad-level insights for an account. ONE account-scoped call with `level: 'ad'` —
 * Meta fans out server-side, so this is O(1) requests, not one per ad-set.
 *
 * Like every /insights level, this returns ONLY ads that DELIVERED in the
 * window. Pair with fetchAllAds + mergeMetaAds for the full roster.
 *
 * @returns {Promise<{ rows: Array, truncated: boolean }>}
 */
export async function fetchAdInsights(accessToken, adAccountId, datePreset = DEFAULT_MANUAL_SYNC_DATE_PRESET) {
  initSdk(accessToken);
  const accountId = normalizeAccountId(adAccountId);
  const account   = new AdAccount(accountId);

  const cursor = await account.getInsights(
    AD_INSIGHT_FIELDS,
    {
      level:       'ad',
      date_preset: datePreset,
      limit:       AD_PAGE_SIZE,
    },
  );

  const { rows, pages, truncated } = await collectCursorPages(cursor);

  logger.info(
    { accountId, datePreset, rawCount: rows.length, pages, truncated },
    '[metaAdsService] fetchAdInsights raw response',
  );

  return { rows, truncated };
}

/**
 * Fetch ALL ads for an account from the /ads edge, regardless of delivery.
 * Mirrors fetchAllAdSets.
 *
 * @returns {Promise<{ rows: Array, truncated: boolean }>}
 */
export async function fetchAllAds(accessToken, adAccountId) {
  initSdk(accessToken);
  const accountId = normalizeAccountId(adAccountId);
  const account   = new AdAccount(accountId);

  const cursor = await account.getAds(AD_LIST_FIELDS, { limit: AD_PAGE_SIZE });
  const { rows, pages, truncated } = await collectCursorPages(cursor);

  logger.info(
    { accountId, adCount: rows.length, pages, truncated },
    '[metaAdsService] fetchAllAds roster',
  );

  return { rows, truncated };
}

// The ad-level roster attributes /insights never returns. Same fold as
// ROSTER_ATTRS at campaign level, and it exists for the same reason: without it
// `created_time` would be present on roster-only ads and `undefined` on every ad
// that actually DELIVERED — i.e. missing from exactly the rows worth judging,
// which would silently null out creative age for the whole account.
const AD_ROSTER_ATTRS = Object.freeze(['created_time']);

/** PURE: index an ad roster by id → the attributes /insights never carries. */
function adAttrIndex(rosterRows = []) {
  const m = new Map();
  for (const row of rosterRows || []) {
    const r = row?._data || row;
    if (r?.id == null) continue;
    const attrs = {};
    for (const k of AD_ROSTER_ATTRS) if (r[k] != null) attrs[k] = r[k];
    if (Object.keys(attrs).length) m.set(String(r.id), attrs);
  }
  return m;
}

/**
 * PURE merge: fold the /ads roster into the ad insight rows. Exact mirror of
 * mergeMetaAdSets, including the `_rosterOnly` contract.
 *
 * A roster-only ad means "no delivery data found in this window", NOT "verified
 * zero": snapshotSink lands the ENTITY but writes NO MetricSnapshot, so the ad
 * appears with "—" rather than a fabricated 0.
 *
 * An ad with no parent `adset_id` is DROPPED. snapshotSink derives its FK from
 * parentExternalId, so a parentless row would compute a garbage ad-set id and
 * either orphan the ad or attach it to the wrong ad-set.
 *
 * @param {Array} insights raw rows from fetchAdInsights
 * @param {Array} ads      raw rows from fetchAllAds
 * @returns {Array} insight-shaped ad rows for metaNormalize
 */
export function mergeMetaAds(insights = [], ads = []) {
  const statusById = statusIndex(ads);
  const attrsById  = adAttrIndex(ads);
  const insightRows = [];
  const withInsights = new Set();

  for (const row of insights || []) {
    const r = row?._data || row;
    if (r?.ad_id == null) continue; // unkeyable — no stable identity
    insightRows.push(r);
    withInsights.add(String(r.ad_id));
  }

  const rosterOnly = [];
  for (const a of ads || []) {
    const ad = a?._data || a;
    const id = ad?.id != null ? String(ad.id) : null;
    if (!id || withInsights.has(id)) continue; // unkeyable, or already has real data
    if (ad.adset_id == null) {
      logger.warn({ adId: id }, '[metaAdsService] ad roster row has no adset_id — dropped');
      continue;
    }
    rosterOnly.push({
      ad_id:       id,
      ad_name:     ad.name || 'Unnamed Ad',
      adset_id:    String(ad.adset_id),
      spend:       '0',
      impressions: '0',
      clicks:      '0',
      _rosterOnly: true, // no delivery data found — "unknown", never a verified 0
      ...pickStatus(ad),
      // A creative made 2 days ago that has not delivered still has an age.
      ...(attrsById.get(id) ?? {}),
    });
  }

  return [
    ...insightRows.map((r) => withRosterAttrs(withStatus(r, statusById, r?.ad_id), attrsById, r?.ad_id)),
    ...rosterOnly,
  ];
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

// ════════════════════════════════════════════════════════════
// CANONICAL 30-DAY INGESTION — the levels (Phase L)
// ------------------------------------------------------------
// Phase F produced canonical rows at CAMPAIGN only. Phase K then proved that is
// not enough: the fatigue paths observe `frequency` at ad-set and ad level too,
// and a shared evidence contract cannot hold when two of three consumers have no
// canonical population to read.
//
// Declared as a table rather than three near-identical functions so the property
// that matters — every level asks for the SAME period with the SAME shape — is
// structural instead of a thing three copies have to keep agreeing about.
//
// ACCOUNT is deliberately absent. metaNormalize derives the account row by
// summing CAMPAIGNS; asking Meta for an account-level insight would produce a
// second, differently-derived account figure with nothing to say which is right.
//
// The page limits mirror the operational fetches exactly (ADSET/AD raise the
// per-page ceiling because their row counts are 3–10x campaigns) — same
// pagination, same MAX_PAGES, same truncation reporting.
const CANONICAL_LEVELS = Object.freeze([
  Object.freeze({ level: 'campaign', fields: CAMPAIGN_INSIGHT_FIELDS }),
  Object.freeze({ level: 'adset',    fields: ADSET_INSIGHT_FIELDS, limit: ADSET_PAGE_SIZE }),
  Object.freeze({ level: 'ad',       fields: AD_INSIGHT_FIELDS,    limit: AD_PAGE_SIZE }),
]);

/** The canonical levels, for callers and tests that need to enumerate them. */
export const CANONICAL_LEVEL_NAMES = Object.freeze(CANONICAL_LEVELS.map((l) => l.level));

/**
 * Every canonical level for one account, over ONE canonical period.
 *
 * The window is computed ONCE and shared by all three requests. Computing it per
 * level would let a sync that straddles midnight ask for two different 30-day
 * periods and land them as if they described the same measurement — the exact
 * class of mismatch canonicalEligibility exists to catch, arriving from our own
 * producer instead of from Meta.
 *
 * PER-LEVEL FAILURE ISOLATION. A level that throws contributes no rows and is
 * reported in `failed`; the levels that succeeded still land. There is no
 * fabricated empty result standing in for a failed request — a level that could
 * not be read has NO canonical rows, which is what the resolver reads as
 * NO_CANONICAL_WINDOW, and that is the honest state. Nothing here can break the
 * operational sync: ConnectorSyncService already runs the whole canonical
 * refresh best-effort.
 *
 * Rows from all levels are returned CONCATENATED, which is what metaNormalize
 * already expects — it identifies a row's level from its own id keys (`ad_id` →
 * AD, `adset_id` without `ad_id` → ADSET, neither → CAMPAIGN), exactly as it does
 * for the operational fetch. So no normalizer change is needed for this phase.
 *
 * @returns {Promise<{ rows, windowStart, windowEnd, truncated, failed, byLevel }>}
 */
export async function fetchCanonicalAllLevels(
  accessToken,
  adAccountId,
  // `fetchLevel` is an injection seam, and it exists for a specific reason: this
  // module loads the Meta SDK through createRequire (the SDK is CommonJS), and
  // vi.mock cannot intercept a createRequire call — a test that mocks
  // 'facebook-nodejs-business-sdk' here silently makes REAL network requests.
  // Per-level failure isolation is the property most worth testing and the one
  // least reachable through the real SDK, so the seam is the honest way to reach
  // it. Production never passes it.
  { now = new Date(), fetchLevel = fetchCanonicalInsights } = {},
) {
  const { start, end } = canonicalWindowBounds(now);
  const rows = [];
  const byLevel = {};
  const failed = [];
  let truncated = false;

  for (const { level } of CANONICAL_LEVELS) {
    try {
      const res = await fetchLevel(accessToken, adAccountId, { now, level });
      rows.push(...res.rows);
      byLevel[level] = res.rows.length;
      if (res.truncated) truncated = true;
    } catch (err) {
      // Isolated on purpose: one level failing must not cost the others their
      // canonical evidence. Recorded so the caller can say which level is
      // missing rather than reporting a uniformly empty canonical refresh.
      failed.push({ level, error: err.message });
      logger.warn(
        { adAccountId, level, err: err.message },
        '[metaAdsService] canonical fetch failed for one level — other levels unaffected',
      );
    }
  }

  // EVERY level failed → this is not "the account had nothing", it is "we could
  // not read the account", and the two must not arrive at the caller looking the
  // same. Returning an empty success here would report canonicalSnapshots: 0 —
  // indistinguishable from a genuinely dormant account — so the whole refresh
  // fails and ConnectorSyncService records it as a canonical failure (which it
  // already handles best-effort, without touching the operational sync).
  // A PARTIAL failure still returns: the levels that answered keep their rows.
  if (failed.length === CANONICAL_LEVELS.length) {
    throw new Error(`canonical refresh failed at every level: ${failed.map((f) => `${f.level} (${f.error})`).join('; ')}`);
  }

  logger.info(
    { adAccountId, since: toMetaDay(start), until: toMetaDay(end), byLevel, failed: failed.length, truncated },
    '[metaAdsService] fetchCanonicalAllLevels complete',
  );
  return { rows, windowStart: start, windowEnd: end, truncated, failed, byLevel };
}
