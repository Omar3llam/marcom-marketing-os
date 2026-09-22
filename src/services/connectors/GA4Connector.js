// ============================================================
// GA4Connector — Google Analytics 4 as a cross-channel ACTUALS source
// ============================================================
// NOT an ordinary ChannelConnector: GA4 owns no ad channel and mints no
// entities. It pulls recorded (actual) revenue, normalizes it to per-(channel,
// campaign) descriptors, and LANDS them onto the EXISTING Meta/Google entities
// via actualsSink.landActuals — so it overrides land() instead of going through
// the entity-minting snapshotSink. `channel = 'GA4'` is only its credential /
// registry identity; the ROWS it lands carry the matched ad channel (META/
// GOOGLE) + source GA4, which is what makes BlendedTruth reconcile.
//
// Credentials resolve from marcom_credentials (platform 'ga4') via
// credentialStore; account_id holds the GA4 property id. fetchRaw hits the GA4
// Data API and is exercised ONLY on a real connect (no creds/network here) —
// thin and clearly marked, mirroring GoogleAdsConnector.
// ============================================================
import { CURRENCY_PROVENANCE } from '../../lib/currencyProvenance.js';
import { logger } from '../../utils/logger.js';
import { ChannelConnector } from './ChannelConnector.js';
import { ga4Normalize } from './normalize/ga4Normalize.js';
import { assertActuals, landActuals } from './actualsSink.js';
import { resolveCredential } from './credentialStore.js';

// GA4 is a credential/registry identity, not a CHANNEL enum value — its rows are
// tagged with the matched ad channel, never "GA4".
const GA4_PLATFORM = 'GA4';

export class GA4Connector extends ChannelConnector {
  channel = GA4_PLATFORM;

  async authenticate(workspaceId) {
    const cred = await resolveCredential(workspaceId, GA4_PLATFORM);
    if (!cred || !cred.accessToken) return { ok: false, error: 'GA4 credential missing or inactive' };
    if (!cred.accountId) return { ok: false, error: 'GA4 credential has no property id' };
    return {
      ok: true,
      accessToken: cred.accessToken,
      refreshToken: cred.refreshToken,
      propertyId: cred.accountId,
      currency: 'USD',
      currencyProvenance: CURRENCY_PROVENANCE.FALLBACK_DEFAULT,
    };
  }

  // LIVE: exercised only on a real connect. Pulls purchase revenue split by
  // session source/medium/campaign via the GA4 Data API. Kept thin; verified
  // once real credentials exist — see PR notes.
  async fetchRaw(auth, dateRange = {}) {
    const { fetchGa4Revenue } = await import('./google/ga4Client.js');
    return fetchGa4Revenue(auth, dateRange);
  }

  normalize({ currency, currencyProvenance, date = new Date(), rows = [] }) {
    return assertActuals(ga4Normalize({ currency, currencyProvenance, date, rows }));
  }

  // Override: actuals DECORATE existing entities, they don't mint. The sync loop
  // calls this instead of snapshotSink.landSnapshots when a connector defines it.
  async land(workspaceId, descriptors) {
    return landActuals(workspaceId, descriptors);
  }
}

export const ga4Connector = new GA4Connector();
logger.debug('[GA4Connector] ready (live fetch on real connect)');
