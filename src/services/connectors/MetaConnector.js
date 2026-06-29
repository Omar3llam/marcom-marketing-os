// ============================================================
// MetaConnector — Meta Ads behind the ChannelConnector contract
// ============================================================
// fetchRaw wraps the existing metaAdsService.fetchCampaignInsights (raw insights);
// normalize maps the REAL fields via the pure metaNormalize (NOT the legacy
// estimate-based normalizer). Credentials resolve from marcom_credentials via
// credentialStore.resolveCredential (workspace-keyed) — never a loose config.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { fetchCampaignInsights, fetchAccountCurrency, fetchAllCampaigns, mergeMetaCampaigns } from '../metaAdsService.js';
import { resolveSyncCurrency } from '../../lib/currencyDetector.js';
import { ChannelConnector, assertNormalized } from './ChannelConnector.js';
import { metaNormalize } from './normalize/metaNormalize.js';
import { resolveCredential } from './credentialStore.js';
import { CHANNEL } from './connectorTypes.js';
import { DEFAULT_MANUAL_SYNC_DATE_PRESET } from './connectorConfig.js';

export class MetaConnector extends ChannelConnector {
  channel = CHANNEL.META;

  async authenticate(workspaceId) {
    const cred = await resolveCredential(workspaceId, CHANNEL.META);
    if (!cred || !cred.accessToken) return { ok: false, error: 'Meta credential missing or inactive' };
    if (!cred.accountId) return { ok: false, error: 'Meta credential has no accountId' };

    // Read the account's REAL currency from Meta; fall back to the workspace's
    // stored currency, then USD. fetchAccountCurrency never throws → a currency
    // lookup can never break the sync. This single field threads through
    // `...auth` → normalize → toMinor → every snapshot row's currency.
    const metaCurrency = await fetchAccountCurrency(cred.accessToken, cred.accountId);
    let ws = null;
    try {
      ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { currency: true } });
    } catch (err) {
      logger.warn({ workspaceId, err: err.message }, '[MetaConnector] workspace currency read failed; using platform/USD');
    }
    const { currency, source } = resolveSyncCurrency(metaCurrency, ws?.currency);
    if (source !== 'reported') {
      logger.warn({ workspaceId, accountId: cred.accountId, metaCurrency, reason: source }, '[MetaConnector] currency fallback');
    }

    // One-time correction: if the workspace still holds the default USD (or no
    // value) but Meta reports a real non-USD currency, persist it so the frontend
    // reads the right code. Fire-and-forget — never block the sync on this write.
    if (source === 'reported' && currency !== 'USD' && ws && (!ws.currency || ws.currency === 'USD')) {
      prisma.workspace.update({ where: { id: workspaceId }, data: { currency } })
        .then(() => logger.info({ workspaceId, currency }, '[MetaConnector] workspace currency corrected from Meta'))
        .catch((err) => logger.warn({ workspaceId, currency, err: err.message }, '[MetaConnector] workspace currency update failed'));
    }

    return {
      ok: true,
      accessToken: cred.accessToken,
      accountExternalId: cred.accountId,
      accountName: null,
      currency,
    };
  }

  async fetchRaw(auth, { datePreset = DEFAULT_MANUAL_SYNC_DATE_PRESET } = {}) {
    // Two edges, two roles:
    //   /insights  — campaigns that DELIVERED (real spend/revenue). PRIMARY: a
    //                failure here IS a sync failure, so it throws.
    //   /campaigns — the FULL roster incl. zero-spend. SECONDARY enrichment: a
    //                failure must never break the sync, so it degrades to
    //                "insights only" (mirrors how currency lookup never throws).
    const [insights, campaigns] = await Promise.all([
      fetchCampaignInsights(auth.accessToken, auth.accountExternalId, datePreset),
      fetchAllCampaigns(auth.accessToken, auth.accountExternalId).catch((err) => {
        logger.warn(
          { err: err.message, accountId: auth.accountExternalId },
          '[MetaConnector] fetchAllCampaigns failed — landing insights only (zero-spend campaigns omitted)',
        );
        return [];
      }),
    ]);
    // Every campaign lands: delivered ones keep their data, zero-spend ones get
    // honest zeros. mergeMetaCampaigns unwraps the SDK envelope on both inputs.
    return mergeMetaCampaigns(insights, campaigns);
  }

  normalize({ accountExternalId, accountName, currency, date = new Date(), rows = [] }) {
    const out = metaNormalize({ accountExternalId, accountName, currency, date, rows });
    return assertNormalized(out);
  }
}

export const metaConnector = new MetaConnector();
logger.debug('[MetaConnector] ready');
