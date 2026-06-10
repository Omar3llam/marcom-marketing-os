// ============================================================
// MetaConnector — Meta Ads behind the ChannelConnector contract
// ============================================================
// fetchRaw wraps the existing metaAdsService.fetchCampaignInsights (raw insights);
// normalize maps the REAL fields via the pure metaNormalize (NOT the legacy
// estimate-based normalizer). Credentials resolve from Integration (the source
// of truth) — never a loose config.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { fetchCampaignInsights } from '../metaAdsService.js';
import { ChannelConnector, assertNormalized } from './ChannelConnector.js';
import { metaNormalize } from './normalize/metaNormalize.js';
import { CHANNEL } from './connectorTypes.js';

export class MetaConnector extends ChannelConnector {
  channel = CHANNEL.META;

  async authenticate(workspaceId) {
    const integ = await prisma.integration.findUnique({
      where: { workspaceId_platform: { workspaceId, platform: 'META' } },
    });
    if (!integ || !integ.isActive || !integ.accessToken) {
      return { ok: false, error: 'Meta integration missing or inactive' };
    }
    const accountExternalId = integ.metadata?.accountId ?? integ.metadata?.adAccountId ?? null;
    if (!accountExternalId) return { ok: false, error: 'Meta integration has no accountId in metadata' };
    return {
      ok: true,
      accessToken: integ.accessToken, // decrypted at the DB layer
      accountExternalId,
      accountName: integ.metadata?.accountName ?? null,
      currency: integ.metadata?.currency ?? 'USD',
    };
  }

  async fetchRaw(auth, { datePreset = 'last_7d' } = {}) {
    const insights = await fetchCampaignInsights(auth.accessToken, auth.accountExternalId, datePreset);
    // Unwrap the service's per-row envelope to the raw Meta insight object.
    return (insights || []).map((row) => row._data || row);
  }

  normalize({ accountExternalId, accountName, currency, date = new Date(), rows = [] }) {
    const out = metaNormalize({ accountExternalId, accountName, currency, date, rows });
    return assertNormalized(out);
  }
}

export const metaConnector = new MetaConnector();
logger.debug('[MetaConnector] ready');
