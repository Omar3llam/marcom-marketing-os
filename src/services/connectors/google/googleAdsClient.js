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

const API_VERSION = 'v17';
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function ymd(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
}

/** PURE: the campaign-level GAQL report query for a date range. */
export function buildGaqlReportQuery({ since, until } = {}) {
  const end = until ? ymd(until) : ymd(new Date());
  const start = since ? ymd(since) : ymd(new Date(Date.now() - 7 * 86_400_000));
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

/** LIVE: refresh → GAQL searchStream → mapped raw rows. Throws (never fakes) without creds/network. */
export async function fetchGoogleCampaignMetrics(auth, dateRange = {}) {
  const { devToken } = requireEnv();
  const customerId = String(auth.accountExternalId || '').replace(/[^0-9]/g, '');
  if (!customerId) throw new Error('googleAdsClient: no Google customer id');

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
    body: JSON.stringify({ query: buildGaqlReportQuery(dateRange) }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`googleAdsClient: searchStream failed (${res.status})`);
  // searchStream returns an array of batches, each { results: [...] }.
  const rows = (Array.isArray(body) ? body : [body]).flatMap((batch) => batch.results || []);
  logger.info({ customerId, rows: rows.length }, '[googleAdsClient] fetched campaign metrics');
  return mapGoogleAdsResponse(rows);
}
