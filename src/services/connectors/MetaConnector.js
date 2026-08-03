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
import {
  fetchCampaignInsights, fetchAccountCurrency, fetchAllCampaigns, mergeMetaCampaigns,
  fetchAdSetInsights, fetchAllAdSets, mergeMetaAdSets,
  fetchAdInsights, fetchAllAds, mergeMetaAds,
} from '../metaAdsService.js';
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
    // SIX account-scoped edges, three levels, two roles each:
    //   /insights level=campaign — campaigns that DELIVERED. PRIMARY: a failure
    //                              here IS a sync failure, so it throws.
    //   /campaigns               — the FULL roster incl. zero-spend. SECONDARY.
    //   /insights level=adset    — ad-sets that DELIVERED. SECONDARY.
    //   /adsets                  — the FULL ad-set roster. SECONDARY.
    //   /insights level=ad       — ads that DELIVERED. SECONDARY.
    //   /ads                     — the FULL ad roster. SECONDARY.
    //
    // Every SECONDARY edge degrades to an empty result on failure rather than
    // breaking the sync (mirrors how the currency lookup never throws). Campaign
    // data is the substrate every engine already reads; losing ad-sets or ads
    // must not cost it.
    //
    // All six are account-scoped with a `level` param — Meta fans out
    // server-side, so this is O(1) requests, NOT one per campaign or ad-set.
    const softFail = (label, fallback) => (err) => {
      logger.warn({ err: err.message, accountId: auth.accountExternalId }, `[MetaConnector] ${label}`);
      return fallback;
    };

    const [insights, campaigns, adSetInsights, adSetRoster, adInsights, adRoster] = await Promise.all([
      fetchCampaignInsights(auth.accessToken, auth.accountExternalId, datePreset),
      fetchAllCampaigns(auth.accessToken, auth.accountExternalId).catch(
        softFail('fetchAllCampaigns failed — landing insights only (zero-spend campaigns omitted)', []),
      ),
      fetchAdSetInsights(auth.accessToken, auth.accountExternalId, datePreset).catch(
        softFail('fetchAdSetInsights failed — landing campaigns only (no ad-set drill-down this sync)', { rows: [], truncated: false }),
      ),
      fetchAllAdSets(auth.accessToken, auth.accountExternalId).catch(
        softFail('fetchAllAdSets failed — ad-set roster omitted (non-delivering ad-sets will not appear)', { rows: [], truncated: false }),
      ),
      // Ad level — SECONDARY like the two above. Losing ad detail must never cost
      // the campaign substrate every engine already reads.
      fetchAdInsights(auth.accessToken, auth.accountExternalId, datePreset).catch(
        softFail('fetchAdInsights failed — ad-level metrics omitted this sync', { rows: [], truncated: false }),
      ),
      fetchAllAds(auth.accessToken, auth.accountExternalId).catch(
        softFail('fetchAllAds failed — ad roster omitted (non-delivering ads will not appear)', { rows: [], truncated: false }),
      ),
    ]);

    // Every campaign and ad-set lands: delivered ones keep their data,
    // non-delivering ones carry _rosterOnly so the sink writes the entity but no
    // fabricated zero snapshot. Both merges unwrap the SDK envelope.
    const campaignRows = mergeMetaCampaigns(insights, campaigns);
    const adSetRows = mergeMetaAdSets(adSetInsights.rows, adSetRoster.rows);
    const adRows = mergeMetaAds(adInsights.rows, adRoster.rows);
    const rows = [...campaignRows, ...adSetRows, ...adRows];

    // Truncation rides as a property ON the returned array, not as a wrapper
    // object: ConnectorSyncService feeds fetchRaw's return straight into
    // `normalize({ rows })`, and every normalizer treats it as an array. A
    // `{ campaigns, adSets, syncMeta }` shape would break that contract for
    // Meta AND diverge it from Google/GA4. An array is still an object, so this
    // is a side-channel no consumer has to know about — but the sync loop can
    // read it and record an honest "this account was only partly read".
    // NON-enumerable on purpose. An ordinary property would make the array
    // unequal to a plain array of the same rows — breaking `toEqual` in every
    // existing test and changing what JSON.stringify emits. Hidden, it is a pure
    // side-channel: iteration, spread, filter and serialization are all
    // unaffected, and a caller that knows to look can still read it.
    Object.defineProperty(rows, 'fetchMeta', {
      value: Object.freeze({
        campaigns: campaignRows.length,
        adSetsFetched: adSetInsights.rows.length,
        adSetsMerged: adSetRows.length,
        adsFetched: adInsights.rows.length,
        adsMerged: adRows.length,
        // Ads are the level most likely to pass the page cap (they outnumber ad-sets
        // several-fold), so their truncation MUST reach the sync loop — otherwise a
        // partial read is recorded as a complete one.
        truncated: Boolean(
          adSetInsights.truncated || adSetRoster.truncated || adInsights.truncated || adRoster.truncated,
        ),
      }),
      enumerable: false,
    });
    return rows;
  }

  normalize({ accountExternalId, accountName, currency, date = new Date(), rows = [] }) {
    const out = metaNormalize({ accountExternalId, accountName, currency, date, rows });
    return assertNormalized(out);
  }
}

export const metaConnector = new MetaConnector();
logger.debug('[MetaConnector] ready');
