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
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { ChannelConnector, assertNormalized } from './ChannelConnector.js';
import { googleNormalize } from './normalize/googleNormalize.js';
import { CHANNEL } from './connectorTypes.js';

export class GoogleAdsConnector extends ChannelConnector {
  channel = CHANNEL.GOOGLE;

  async authenticate(workspaceId) {
    const integ = await prisma.integration.findUnique({
      where: { workspaceId_platform: { workspaceId, platform: 'GOOGLE' } },
    });
    if (!integ || !integ.isActive || !integ.accessToken) {
      return { ok: false, error: 'Google integration missing or inactive' };
    }
    const accountExternalId = integ.metadata?.customerId ?? integ.metadata?.accountId ?? null;
    if (!accountExternalId) return { ok: false, error: 'Google integration has no customerId in metadata' };
    return {
      ok: true,
      accessToken: integ.accessToken,
      refreshToken: integ.refreshToken,
      accountExternalId,
      accountName: integ.metadata?.accountName ?? null,
      currency: integ.metadata?.currency ?? 'USD',
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
