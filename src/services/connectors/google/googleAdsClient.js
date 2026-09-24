// ============================================================
// googleAdsClient — LIVE Google Ads access (hand-rolled REST GAQL)
// ============================================================
// Dynamically imported by GoogleAdsConnector.fetchRaw, so it loads ONLY on a real
// connect. Clean split:
//   PURE (unit-tested): buildGaqlReportQuery, mapGoogleAdsResponse — the GAQL
//     string + the Google API row → the { campaign, metrics } shape that
//     googleNormalize already consumes and is tested against.
//   NETWORK (unverifiable here — no creds/network): refreshAccessToken,
//     fetchGoogleCampaignMetrics. Fails loudly without env/creds; NEVER fakes rows.
// ============================================================
import { logger } from '../../../utils/logger.js';
import { canonicalWindowBounds } from '../../verdict-engine/metricWindow.js';

const API_VERSION = 'v24';
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function ymd(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
}

export function googleReportRange({ since, until } = {}) {
  const now = new Date();
  return {
    startDate: since ? ymd(since) : ymd(new Date(now.getTime() - 7 * 86_400_000)),
    endDate: until ? ymd(until) : ymd(now),
  };
}

/** PURE: the campaign-level GAQL report query for a date range. */
export function buildGaqlReportQuery({ since, until } = {}) {
  const { startDate: start, endDate: end } = googleReportRange({ since, until });
  return [
    'SELECT campaign.id, campaign.name,',
    'metrics.cost_micros, metrics.impressions, metrics.clicks,',
    'metrics.conversions, metrics.conversions_value',
    'FROM campaign',
    `WHERE segments.date BETWEEN '${start}' AND '${end}'`,
  ].join(' ');
}

/**
 * PURE: Google Ads searchStream result rows → the connector's raw shape. Google
 * returns camelCase + string numerics; we map to the snake_case { campaign,
 * metrics } googleNormalize expects, leaving cost in micros + conversions
 * fractional (the normalizer converts/preserves — connectors never "correct").
 */
export function mapGoogleAdsResponse(apiRows = []) {
  return apiRows.map((r) => {
    const c = r.campaign || {};
    const m = r.metrics || {};
    return {
      campaign: { id: String(c.id ?? ''), name: c.name ?? null },
      metrics: {
        cost_micros: num(m.costMicros ?? m.cost_micros),
        impressions: num(m.impressions),
        clicks: num(m.clicks),
        conversions: num(m.conversions),
        conversions_value: num(m.conversionsValue ?? m.conversions_value),
      },
    };
  });
}

// ============================================================
// CANONICAL 30-DAY PATH (Phase D.3)
// ============================================================
// Google's evidence contract is NOT Meta's, and the difference is the whole
// reason this path exists separately.
//
// Meta returns date_start/date_stop ON EVERY ROW, so a Meta canonical row
// carries the platform's own statement of what it measured. Google's GAQL
// response has no such field, and — critically — Google OMITS rows for days on
// which a campaign did not deliver. So a campaign's returned dates can never
// prove it was measured across the full period: an account dark at a weekend
// would look identical to a truncated response.
//
// The accepted contract (Phase D.3 §1, Option A) is therefore:
//
//   A successfully COMPLETED searchStream over an EXPLICIT date range is the
//   period evidence. `segments.date` is CORROBORATION that the range was
//   honoured — not the proof of coverage.
//
// That is a deliberate, named decision, not an inference. What it buys is that
// a legitimately dark day cannot silently shorten the window. What it costs is
// the one check Meta gets for free: we cannot detect a silently-short response
// whose missing days happen to be zero-delivery days. Recorded here so the next
// reader knows it was priced, not overlooked.
//
// What corroboration DOES enforce: every returned date must fall inside the
// requested range. A date outside it means the query was not honoured, and the
// whole refresh yields NO canonical rows rather than a window we cannot vouch
// for. Any error, any partial read — no canonical row. Never a fabricated zero.

/**
 * PURE: the canonical 30-day GAQL query — DAILY rows for one explicit range.
 *
 * `segments.date` in the SELECT is what makes each returned row a single
 * calendar day, and is the field the corroboration check reads. The 30 is never
 * written here; canonicalWindowBounds owns it.
 */
export function buildCanonicalGaqlQuery(now = new Date()) {
  const { start, end } = canonicalWindowBounds(now);
  return [
    'SELECT campaign.id, campaign.name, segments.date,',
    'metrics.cost_micros, metrics.impressions, metrics.clicks,',
    'metrics.conversions, metrics.conversions_value',
    'FROM campaign',
    `WHERE segments.date BETWEEN '${ymd(start)}' AND '${ymd(end)}'`,
  ].join(' ');
}

/**
 * PURE: daily Google rows → the connector's raw shape, carrying the day.
 * Mirrors mapGoogleAdsResponse and adds `date` — the platform-attested calendar
 * day the corroboration check and the aggregation both key on.
 */
export function mapGoogleAdsDailyResponse(apiRows = []) {
  return mapGoogleAdsResponse(apiRows).map((row, i) => {
    const seg = apiRows[i]?.segments || {};
    return { ...row, date: seg.date ?? null };
  });
}

/**
 * PURE: fold DAILY rows into ONE 30-day observation per campaign.
 *
 * ONLY ADDITIVE METRICS ARE SUMMED — cost, impressions, clicks, conversions and
 * conversion value are disjoint across days, so Σ is exact. CTR and ROAS are
 * deliberately NOT computed here: snapshotSink derives them from the summed
 * totals, which is the only correct order (Σ of daily ratios is not the ratio of
 * the sums). Google reports no reach or frequency at all, so the metrics that
 * genuinely cannot be reconstructed from daily rows are simply absent — which is
 * exactly why daily→cumulative is legitimate HERE and nowhere else.
 *
 * @throws if a row carries a day outside the requested range — the query was not
 *   honoured, and no canonical row may be built from it.
 * @returns {Array} one row per campaign, in the shape googleNormalize consumes
 */
export function aggregateDailyToCanonical(dailyRows = [], { start, end } = {}) {
  const [lo, hi] = [ymd(start), ymd(end)];
  const byCampaign = new Map();

  for (const r of dailyRows) {
    const day = r?.date;
    // A row with no day cannot be corroborated against the requested range, and
    // an uncorroborated row is not evidence for a 30-day period.
    if (!day) throw new Error('aggregateDailyToCanonical: row has no segments.date — cannot corroborate the requested range');
    if (day < lo || day > hi) {
      throw new Error(`aggregateDailyToCanonical: row dated ${day} falls outside the requested ${lo}..${hi} — query not honoured`);
    }
    const id = r.campaign?.id;
    if (!id) continue;

    if (!byCampaign.has(id)) {
      byCampaign.set(id, {
        campaign: { id, name: r.campaign?.name ?? null },
        metrics: { cost_micros: 0, impressions: 0, clicks: 0, conversions: 0, conversions_value: 0 },
        days: new Set(),
      });
    }
    const agg = byCampaign.get(id);
    const m = r.metrics || {};
    agg.metrics.cost_micros       += num(m.cost_micros);
    agg.metrics.impressions       += num(m.impressions);
    agg.metrics.clicks            += num(m.clicks);
    agg.metrics.conversions       += num(m.conversions);
    agg.metrics.conversions_value += num(m.conversions_value);
    agg.days.add(day);
  }

  // `days` is reported, never used as a coverage gate: a campaign that delivered
  // on 6 of 30 days was still MEASURED across 30. Delivery period and
  // measurement period are different facts, and conflating them is what would
  // drop every weekend-dark account.
  return [...byCampaign.values()].map(({ campaign, metrics, days }) => ({
    campaign, metrics, observedDays: days.size,
  }));
}

/**
 * LIVE: the canonical 30-day refresh. Daily GAQL → corroborate → aggregate.
 * Throws on any failure so the caller lands NO canonical row (never a partial
 * one). Returns the REQUESTED bounds as the window, per the accepted contract.
 */
export async function fetchGoogleCanonicalMetrics(auth, { now = new Date() } = {}) {
  const { devToken } = requireEnv();
  const customerId = String(auth.accountExternalId || '').replace(/[^0-9]/g, '');
  if (!customerId) throw new Error('googleAdsClient: no Google customer id');

  const { start, end } = canonicalWindowBounds(now);
  const accessToken = await refreshAccessToken(auth.refreshToken);
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': devToken,
      'login-customer-id': customerId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: buildCanonicalGaqlQuery(now) }),
  });
  const body = await res.json();
  // A non-OK response is a FAILURE, never a partial read. searchStream has no
  // page token: a completed stream is the whole result set, and a broken one
  // surfaces as an error — which is the property the accepted contract rests on.
  if (!res.ok) throw new Error(`googleAdsClient: canonical searchStream failed (${res.status})`);

  const daily = mapGoogleAdsDailyResponse(
    (Array.isArray(body) ? body : [body]).flatMap((batch) => batch.results || []),
  );
  const rows = aggregateDailyToCanonical(daily, { start, end });
  logger.info(
    { customerId, dailyRows: daily.length, campaigns: rows.length, since: ymd(start), until: ymd(end) },
    '[googleAdsClient] canonical 30d aggregated',
  );
  return { rows, windowStart: start, windowEnd: end };
}

// ── NETWORK (exercised only on a real connect) ──────────────────
function requireEnv() {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!devToken || !clientId || !clientSecret) {
    throw new Error('googleAdsClient: GOOGLE_ADS_DEVELOPER_TOKEN / GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET not configured — connect real credentials to enable.');
  }
  return { devToken, clientId, clientSecret };
}

export async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = requireEnv();
  if (!refreshToken) throw new Error('googleAdsClient.refreshAccessToken: no refresh token');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`googleAdsClient: token refresh failed (${body.error || res.status})`);
  return body.access_token;
}

/** Read the customer's immutable reporting timezone from Google Ads itself. */
export async function fetchGoogleCustomerTimezone(auth) {
  try {
    const { devToken } = requireEnv();
    const customerId = String(auth.accountExternalId || '').replace(/[^0-9]/g, '');
    if (!customerId) return null;
    const accessToken = await refreshAccessToken(auth.refreshToken);
    const res = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': devToken,
        'login-customer-id': customerId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'SELECT customer.time_zone FROM customer' }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const rows = (Array.isArray(body) ? body : [body]).flatMap((batch) => batch.results || []);
    return rows.length === 1 && typeof rows[0]?.customer?.timeZone === 'string'
      ? rows[0].customer.timeZone : null;
  } catch (err) {
    logger.warn({ err: err.message }, '[googleAdsClient] customer timezone unavailable');
    return null;
  }
}

/** LIVE: refresh → GAQL searchStream → mapped raw rows. Throws (never fakes) without creds/network. */
export async function fetchGoogleCampaignMetrics(auth, dateRange = {}) {
  const { devToken } = requireEnv();
  const customerId = String(auth.accountExternalId || '').replace(/[^0-9]/g, '');
  if (!customerId) throw new Error('googleAdsClient: no Google customer id');

  const accessToken = await refreshAccessToken(auth.refreshToken);
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`;
  const range = googleReportRange(dateRange);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': devToken,
      'login-customer-id': customerId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: buildGaqlReportQuery({ since: range.startDate, until: range.endDate }) }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`googleAdsClient: searchStream failed (${res.status})`);
  // searchStream returns an array of batches, each { results: [...] }.
  const rows = (Array.isArray(body) ? body : [body]).flatMap((batch) => batch.results || []);
  logger.info({ customerId, rows: rows.length }, '[googleAdsClient] fetched campaign metrics');
  const mapped = mapGoogleAdsResponse(rows);
  // The successful completed query, not its sync timestamp or sparse campaign
  // rows, establishes the requested period under the accepted Google contract.
  Object.defineProperty(mapped, 'reportedRange', { value: Object.freeze(range) });
  return mapped;
}
