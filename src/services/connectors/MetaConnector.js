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
  fetchCampaignInsights, fetchAccountCurrency, fetchAccountTimezone, fetchAllCampaigns, mergeMetaCampaigns,
  fetchAdSetInsights, fetchAllAdSets, mergeMetaAdSets,
  fetchAdInsights, fetchAllAds, mergeMetaAds, fetchCanonicalAllLevels, fetchDailyInsights,
} from '../metaAdsService.js';
import { resolveSyncCurrencyWithProvenance } from '../../lib/currencyProvenance.js';
import { ChannelConnector, assertNormalized } from './ChannelConnector.js';
import { metaNormalize } from './normalize/metaNormalize.js';
import { metaDailyNormalize } from './normalize/metaDailyNormalize.js';
import { resolveCredential } from './credentialStore.js';
import { CHANNEL, MEASUREMENT_WINDOW } from './connectorTypes.js';
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
    const [metaCurrency, accountTimeZone] = await Promise.all([
      fetchAccountCurrency(cred.accessToken, cred.accountId),
      fetchAccountTimezone(cred.accessToken, cred.accountId),
    ]);
    let ws = null;
    try {
      ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { currency: true } });
    } catch (err) {
      logger.warn({ workspaceId, err: err.message }, '[MetaConnector] workspace currency read failed; using platform/USD');
    }
    const { currency, source, currencyProvenance } = resolveSyncCurrencyWithProvenance(metaCurrency, ws?.currency);
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
      currencyProvenance,
      accountTimeZone,
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
    const failedEdges = new Set();
    const softFail = (edge, label, fallback) => (err) => {
      failedEdges.add(edge);
      logger.warn({ err: err.message, accountId: auth.accountExternalId }, `[MetaConnector] ${label}`);
      return fallback;
    };

    const [insights, campaigns, adSetInsights, adSetRoster, adInsights, adRoster] = await Promise.all([
      fetchCampaignInsights(auth.accessToken, auth.accountExternalId, datePreset),
      fetchAllCampaigns(auth.accessToken, auth.accountExternalId).catch(
        softFail('campaignRoster', 'fetchAllCampaigns failed — landing insights only (zero-spend campaigns omitted)', []),
      ),
      fetchAdSetInsights(auth.accessToken, auth.accountExternalId, datePreset).catch(
        softFail('adSetInsights', 'fetchAdSetInsights failed — landing campaigns only (no ad-set drill-down this sync)', { rows: [], truncated: false }),
      ),
      fetchAllAdSets(auth.accessToken, auth.accountExternalId).catch(
        softFail('adSetRoster', 'fetchAllAdSets failed — ad-set roster omitted (non-delivering ad-sets will not appear)', { rows: [], truncated: false }),
      ),
      // Ad level — SECONDARY like the two above. Losing ad detail must never cost
      // the campaign substrate every engine already reads.
      fetchAdInsights(auth.accessToken, auth.accountExternalId, datePreset).catch(
        softFail('adInsights', 'fetchAdInsights failed — ad-level metrics omitted this sync', { rows: [], truncated: false }),
      ),
      fetchAllAds(auth.accessToken, auth.accountExternalId).catch(
        softFail('adRoster', 'fetchAllAds failed — ad roster omitted (non-delivering ads will not appear)', { rows: [], truncated: false }),
      ),
    ]);

    // Every campaign and ad-set lands: delivered ones keep their data,
    // non-delivering ones carry _rosterOnly so the sink writes the entity but no
    // fabricated zero snapshot. Both merges unwrap the SDK envelope.
    const campaignRows = mergeMetaCampaigns(insights, campaigns);
    const adSetRows = mergeMetaAdSets(adSetInsights.rows, adSetRoster.rows);
    const adRows = mergeMetaAds(adInsights.rows, adRoster.rows);
    const rows = [...campaignRows, ...adSetRows, ...adRows];

    // Read the campaign side-channel BEFORE merging loses array metadata.
    // Fixed edge order makes simultaneous failures deterministic; never infer
    // completeness from a row count or fabricate measurements for a failed edge.
    const edges = [
      ['campaignInsights', insights.fetchMeta], ['campaignRoster', campaigns.fetchMeta],
      ['adSetInsights', adSetInsights], ['adSetRoster', adSetRoster],
      ['adInsights', adInsights], ['adRoster', adRoster],
    ];
    const truncatedEdges = Object.freeze(edges.filter(([, meta]) => meta?.truncated).map(([edge]) => edge));
    const failed = Object.freeze(edges.filter(([edge]) => failedEdges.has(edge)).map(([edge]) => edge));

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
        truncated: truncatedEdges.length > 0,
        truncatedEdges,
        failedEdges: failed,
        incomplete: truncatedEdges.length > 0 || failed.length > 0,
      }),
      enumerable: false,
    });
    return rows;
  }

  normalize({ accountExternalId, accountName, currency, currencyProvenance, accountTimeZone, date = new Date(), rows = [] }) {
    const out = metaNormalize({ accountExternalId, accountName, currency, currencyProvenance, accountTimeZone, date, rows });
    return assertNormalized(out);
  }

  /**
   * The CANONICAL 30-day verdict fetch (Phase F) — campaign level only.
   *
   * Deliberately separate from fetchRaw rather than folded into it. fetchRaw
   * serves the OPERATIONAL sync: whatever window the trigger asked for, across
   * six edges, feeding the entity graph and every non-verdict surface. This
   * serves the DECISION: exactly one period, campaign grain, whatever the
   * trigger was. Merging them would put the verdict window back under the
   * control of a sync preset, which is the coupling this track exists to break.
   *
   * Campaign level only because that is the grain the verdict path reads
   * (getConnectorCampaigns → connectorVerdictService). Ad-set and ad rows stay
   * operational until something judges them on a canonical window.
   */
  async fetchCanonicalRaw(auth, { now = new Date() } = {}) {
    // ALL THREE canonical levels, one shared 30-day period (Phase L). Campaign
    // alone was Phase F; the fatigue paths observe `frequency` at ad-set and ad
    // level too, and a shared evidence contract cannot hold while two of the
    // three consumers have no canonical population to read.
    return fetchCanonicalAllLevels(auth.accessToken, auth.accountExternalId, { now });
  }

  /**
   * Normalize a canonical fetch. The window is DECLARED here — the rows carry
   * Meta's own date_start/date_stop and the requested period is only a fallback
   * for a row that reports none.
   *
   * The declaration is not a promise the row keeps: if Meta returns a period
   * that is not exactly the canonical window, the row still lands with its REAL
   * dates and the Phase D resolver rejects it as PROVENANCE_MISMATCH. That is
   * the intended outcome — an honest unusable row beats a corrected one.
   */
  /**
   * The DAILY additive fetch (Phase E / R8) — campaign level, `time_increment=1`.
   *
   * A THIRD read, separate from both others for the same reason they are
   * separate from each other: it answers a different question. fetchRaw refreshes
   * the account over whatever preset the trigger chose; fetchCanonicalRaw
   * measures the decision period; this one records what happened on each day.
   *
   * Nothing here decides how far back to look — connectorConfig owns that, as a
   * REQUEST bound. And nothing here decides what a row measures: Meta says so,
   * per row, and metaDailyNormalize refuses any row that does not.
   */
  async fetchDailyRaw(auth, { now = new Date(), days } = {}) {
    return fetchDailyInsights(auth.accessToken, auth.accountExternalId, { now, ...(days ? { days } : {}) });
  }

  /**
   * Normalize a daily fetch. Returns `{ snapshots, rejected }` rather than a bare
   * array — unlike every other normalize on this connector — because refusal is
   * a first-class outcome here: a run in which Meta stopped honouring
   * `time_increment` produces zero snapshots and a pile of NOT_ONE_DAY, and the
   * caller must be able to tell that from an account that simply did not deliver.
   */
  normalizeDaily({ accountExternalId, currency, currencyProvenance, accountTimeZone, date = new Date(), rows = [] }) {
    return metaDailyNormalize({ accountExternalId, currency, currencyProvenance, accountTimeZone, date, rows });
  }

  normalizeCanonical({ accountExternalId, accountName, currency, currencyProvenance, accountTimeZone, date = new Date(), rows = [], windowStart, windowEnd }) {
    const out = metaNormalize({
      accountExternalId, accountName, currency, currencyProvenance, accountTimeZone, date, rows,
      measurementWindow: MEASUREMENT_WINDOW.CUMULATIVE_30D,
      requestedWindowStart: windowStart ?? null,
      requestedWindowEnd: windowEnd ?? null,
    });
    return assertNormalized(out);
  }
}

export const metaConnector = new MetaConnector();
logger.debug('[MetaConnector] ready');
