// ============================================================
// MetaConnector — Meta Ads behind the ChannelConnector contract
// ============================================================
// fetchRaw wraps the existing metaAdsService.fetchCampaignInsights (raw insights);
// normalize maps the REAL fields via the pure metaNormalize (NOT the legacy
// estimate-based normalizer). Credentials resolve from Integration (the source
// of truth) — never a loose config.
// ============================================================
import { logger } from '../../utils/logger.js';
import { fetchCampaignInsights } from '../metaAdsService.js';
import { ChannelConnector, assertNormalized } from './ChannelConnector.js';
import { metaNormalize } from './normalize/metaNormalize.js';
import { resolveCredential } from './credentialStore.js';
import { CHANNEL } from './connectorTypes.js';

export class MetaConnector extends ChannelConnector {
  channel = CHANNEL.META;

  async authenticate(workspaceId) {
    const cred = await resolveCredential(workspaceId, CHANNEL.META);
    if (!cred || !cred.accessToken) return { ok: false, error: 'Meta credential missing or inactive' };
    if (!cred.accountId) return { ok: false, error: 'Meta credential has no accountId' };
    return {
      ok: true,
      accessToken: cred.accessToken,
      accountExternalId: cred.accountId,
      accountName: null,
      currency: 'USD',
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
