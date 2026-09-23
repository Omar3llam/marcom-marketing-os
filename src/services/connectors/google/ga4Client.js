// ============================================================
// ga4Client — LIVE Google Analytics 4 Data API access (runReport)
// ============================================================
// Dynamically imported by GA4Connector.fetchRaw, so it loads ONLY on a real
// connect. Same clean split as googleAdsClient:
//   PURE (unit-tested): presetToDateRange, buildRunReportBody, mapGa4Response —
//     the request body + the GA4 API response → the { source, medium,
//     campaignName, revenue, conversions } shape ga4Normalize consumes.
//   NETWORK (unverifiable here — no creds/network): refreshAccessToken,
//     fetchGa4Revenue. Fail loudly without env/creds; NEVER fabricate rows.
//
// GA4 reconciles ACTUAL recorded revenue against platform claims, so we pull the
// purchase/transaction revenue split by session source/medium/campaign — the
// dimensions ga4Normalize maps to an ad channel + campaign.
// ============================================================
import { logger } from '../../../utils/logger.js';
import { exactRevenueWindow, unknownRevenueWindow } from '../../../lib/revenueMeasurementWindow.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function ymd(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
}

// GA4 has no `maximum`/`last_Nd` preset vocabulary (that is Meta's). Map the
// connector's shared presets to an explicit day-range; GA4 caps to its own
// retention server-side. Unknown preset → a safe 90-day default.
const PRESET_DAYS = Object.freeze({ maximum: 540, last_90d: 90, last_30d: 30, last_7d: 7 });

/** PURE: a { startDate, endDate } day-range for a shared date preset. */
export function presetToDateRange(datePreset, now = new Date()) {
  const days = PRESET_DAYS[datePreset] ?? 90;
  const start = new Date(now.getTime() - days * 86_400_000);
  return { startDate: ymd(start), endDate: ymd(now) };
}

/** PURE: the GA4 Data API runReport request body for a date range. */
export function buildRunReportBody(dateRange = {}) {
  const range = dateRange.startDate ? dateRange : presetToDateRange(dateRange.datePreset);
  return {
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    dimensions: [
      { name: 'sessionSource' },
      { name: 'sessionMedium' },
      { name: 'sessionCampaignName' },
    ],
    metrics: [
      { name: 'purchaseRevenue' },
      { name: 'transactions' },
    ],
    keepEmptyRows: false,
    limit: 100000,
  };
}

/**
 * PURE: GA4 runReport response → the connector raw shape. GA4 returns parallel
 * dimensionValues / metricValues arrays positioned by the request order above.
 */
// GA4 dateRanges are inclusive calendar days in the property's time zone.
// Translate both local midnights to UTC instants. In particular, the end is
// the instant just before the NEXT local midnight, not the sync timestamp or
// UTC midnight on endDate. Missing response timeZone is genuinely unknown.
function localMidnight(dateString, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString ?? '')) return null;
  const day = new Date(`${dateString}T00:00:00.000Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== dateString) return null;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch { return null; }
  let instant = day.getTime();
  for (let i = 0; i < 4; i += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
    const delta = shown - day.getTime();
    if (delta === 0) return new Date(instant);
    instant -= delta;
  }
  return null;
}

export function ga4ResponseWindow(requestBody, responseBody) {
  const range = requestBody?.dateRanges?.[0];
  const timeZone = responseBody?.metadata?.timeZone;
  if (!range || !timeZone || requestBody.dateRanges.length !== 1) return unknownRevenueWindow();
  const start = localMidnight(range.startDate, timeZone);
  const endDay = new Date(`${range.endDate}T00:00:00.000Z`);
  if (!Number.isFinite(endDay.getTime()) || endDay.toISOString().slice(0, 10) !== range.endDate) return unknownRevenueWindow();
  const nextDay = new Date(endDay.getTime() + 86_400_000).toISOString().slice(0, 10);
  const nextMidnight = localMidnight(nextDay, timeZone);
  return start && nextMidnight
    ? exactRevenueWindow(start, new Date(nextMidnight.getTime() - 1))
    : unknownRevenueWindow();
}

export function mapGa4Response(body = {}, requestBody = null) {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const window = requestBody ? ga4ResponseWindow(requestBody, body) : null;
  return rows.map((r) => {
    const dims = r.dimensionValues || [];
    const mets = r.metricValues || [];
    return {
      source: dims[0]?.value ?? null,
      medium: dims[1]?.value ?? null,
      campaignName: dims[2]?.value ?? null,
      revenue: num(mets[0]?.value),       // purchaseRevenue (major units)
      conversions: num(mets[1]?.value),   // transactions
      ...(window ?? {}),
    };
  });
}

// ── NETWORK (exercised only on a real connect) ──────────────────
function requireEnv() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('ga4Client: GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET not configured — connect real credentials to enable.');
  }
  return { clientId, clientSecret };
}

export async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = requireEnv();
  if (!refreshToken) throw new Error('ga4Client.refreshAccessToken: no refresh token');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`ga4Client: token refresh failed (${body.error || res.status})`);
  return body.access_token;
}

/**
 * LIVE: refresh → GA4 Data API runReport → mapped raw rows. The GA4 property id
 * is auth.propertyId (e.g. "properties/123456789" or the bare numeric id).
 * Throws (never fakes) without creds/network.
 */
export async function fetchGa4Revenue(auth, dateRange = {}) {
  requireEnv();
  const propertyId = String(auth.propertyId || '').replace(/^properties\//, '').replace(/[^0-9]/g, '');
  if (!propertyId) throw new Error('ga4Client: no GA4 property id');

  const accessToken = auth.refreshToken ? await refreshAccessToken(auth.refreshToken) : auth.accessToken;
  if (!accessToken) throw new Error('ga4Client: no access token');

  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const requestBody = buildRunReportBody(dateRange);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`ga4Client: runReport failed (${res.status})`);
  const mapped = mapGa4Response(body, requestBody);
  logger.info({ propertyId, rows: mapped.length }, '[ga4Client] fetched GA4 revenue');
  return mapped;
}
