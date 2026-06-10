// ============================================================
// GoogleAdsConnector — the second real channel
// ============================================================
// normalize() is pure + fully unit-tested (micros→minor, fractional conversions
// preserved, null where Google has no equivalent). authenticate/fetchRaw are
// scaffolded against Integration(platform:'GOOGLE') + the Google Ads API and are
// exercised ONLY on a real connect (no creds/network in this environment) — they
// are intentionally thin and clearly marked. Nothing downstream changes: the
// moment Google snapshots land tagged source:GOOGLE on a GOOGLE Account, blended
// truth reconciles Meta-vs-Google for free.
// ============================================================
import { logger } from '../../utils/logger.js';
import { ChannelConnector, assertNormalized } from './ChannelConnector.js';
import { googleNormalize } from './normalize/googleNormalize.js';
import { resolveCredential } from './credentialStore.js';
import { CHANNEL } from './connectorTypes.js';

export class GoogleAdsConnector extends ChannelConnector {
  channel = CHANNEL.GOOGLE;

  async authenticate(workspaceId) {
    const cred = await resolveCredential(workspaceId, CHANNEL.GOOGLE);
    if (!cred || !cred.accessToken) return { ok: false, error: 'Google credential missing or inactive' };
    if (!cred.accountId) return { ok: false, error: 'Google credential has no customerId' };
    return {
      ok: true,
      accessToken: cred.accessToken,
      refreshToken: cred.refreshToken,
      accountExternalId: cred.accountId,
      accountName: null,
      currency: 'USD',
    };
  }

  // LIVE: exercised only on real connect. Pulls campaign-level metrics for the
  // date range via the Google Ads API (GAQL). Kept thin; verified once real
  // credentials exist — see PR notes.
  async fetchRaw(auth, dateRange = {}) {
    const { fetchGoogleCampaignMetrics } = await import('./google/googleAdsClient.js');
    return fetchGoogleCampaignMetrics(auth, dateRange);
  }

  normalize({ accountExternalId, accountName, currency, date = new Date(), rows = [] }) {
    const out = googleNormalize({ accountExternalId, accountName, currency, date, rows });
    return assertNormalized(out);
  }
}

export const googleAdsConnector = new GoogleAdsConnector();
logger.debug('[GoogleAdsConnector] ready (live fetch on real connect)');
