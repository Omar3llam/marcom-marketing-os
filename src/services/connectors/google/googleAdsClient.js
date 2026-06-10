// ============================================================
// googleAdsClient — LIVE Google Ads API access (scaffold)
// ============================================================
// Dynamically imported by GoogleAdsConnector.fetchRaw, so it loads ONLY on a
// real connect — never at module-graph wiring time. This environment has no
// Google Ads credentials/network, so the live GAQL pull is a scaffold that fails
// loudly (never silently returns fake rows). The shape it MUST return is the
// input googleNormalize() is unit-tested against:
//   [{ campaign:{id,name}, metrics:{ cost_micros, impressions, clicks,
//      conversions, conversions_value } }]
//
// To finish (follow-up, with real creds): exchange Integration.refreshToken for
// an access token, run a GAQL report over campaign metrics for the date range,
// and map the response rows into the shape above. Reuse the Integration token
// path; do not invent new secret storage.
// ============================================================
import { logger } from '../../../utils/logger.js';

export async function fetchGoogleCampaignMetrics(auth, dateRange = {}) {
  logger.warn({ accountExternalId: auth?.accountExternalId, dateRange }, '[googleAdsClient] live fetch invoked — requires real Google Ads credentials');
  throw new Error('GoogleAdsClient.fetchGoogleCampaignMetrics: live Google Ads pull not configured in this environment — connect real credentials to enable.');
}
