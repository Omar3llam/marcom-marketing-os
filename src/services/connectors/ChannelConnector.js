// ============================================================
// ChannelConnector — the contract every channel implements
// ============================================================
// A connector's ONLY job: authenticate, fetch raw platform data, and normalize
// it into NormalizedSnapshot[] (the MetricSnapshot + entity-graph shape) with
// correct `channel` + `source` tags. It NEVER computes a verdict, a blended
// number, or an allocation — those live downstream in channel-agnostic engines.
//
//   class XConnector extends ChannelConnector {
//     channel = CHANNEL.X
//     async authenticate(workspaceId) -> { ok, accountRef, error? }
//     async fetchRaw(accountRef, dateRange) -> RawRow[]   // platform-native
//     normalize(rawRows) -> NormalizedSnapshot[]          // PURE, tagged
//   }
//
// @typedef {Object} NormalizedSnapshot
// @property {string}  externalId        platform-native id of the entity
// @property {string}  entityLevel       ACCOUNT | CAMPAIGN | ADSET | AD | CREATIVE
// @property {string?} parentExternalId  the parent entity's externalId (null at ACCOUNT)
// @property {string}  channel           CHANNEL enum
// @property {string}  source            DATA_SOURCE enum (platform-claimed or actual)
// @property {string}  name              human label for the entity
// @property {Date}    date              when this row was SYNCED (not what it measures)
// @property {string}  measurementWindow MEASUREMENT_WINDOW — the period the metrics
//                                       cover. REQUIRED: only the connector knows,
//                                       and nothing downstream can recover it.
// @property {Date?}   windowStart       the period the platform itself reported,
// @property {Date?}   windowEnd         null when it reported none (never inferred)
// @property {string}  currency          ISO 4217
// @property {string}  currencyProvenance CURRENCY_PROVENANCE origin; omitted means unknown
// @property {number}  spendMinor        integer minor units
// @property {number}  revenueMinor      integer minor units (platform-claimed, as-is)
// @property {number}  impressions
// @property {number}  clicks
// @property {number}  conversions       land as-is (Google's can be fractional); never "corrected"
// @property {number?} frequency         null where the platform has no equivalent
// ============================================================
import { CHANNEL, DATA_SOURCE, MEASUREMENT_WINDOW } from './connectorTypes.js';

export class ChannelConnector {
  /** @type {string} */ channel = null;

  // eslint-disable-next-line no-unused-vars
  async authenticate(workspaceId) {
    throw new Error(`${this.constructor.name}.authenticate not implemented`);
  }

  // eslint-disable-next-line no-unused-vars
  async fetchRaw(accountRef, dateRange) {
    throw new Error(`${this.constructor.name}.fetchRaw not implemented`);
  }

  // eslint-disable-next-line no-unused-vars
  normalize(rawRows) {
    throw new Error(`${this.constructor.name}.normalize not implemented`);
  }
}

/**
 * Structural guard: a NormalizedSnapshot row must carry the tags the sink +
 * BlendedTruth depend on, money as integers, and NO derived verdict/blend field.
 * Throws on the first malformed row — a connector that "helps" by deriving a
 * verdict/blend is rejected at the boundary.
 */
export function assertNormalized(rows) {
  if (!Array.isArray(rows)) throw new Error('normalize must return an array');
  const FORBIDDEN = ['verdict', 'blendedRoas', 'blendedRevenueMinor', 'allocation', 'recommendation'];
  for (const r of rows) {
    if (!r || typeof r !== 'object') throw new Error('NormalizedSnapshot must be an object');
    if (!Object.values(CHANNEL).includes(r.channel)) throw new Error(`bad channel tag: ${r.channel}`);
    if (!Object.values(DATA_SOURCE).includes(r.source)) throw new Error(`bad source tag: ${r.source}`);
    if (!r.externalId) throw new Error('NormalizedSnapshot.externalId required');
    for (const k of ['spendMinor', 'revenueMinor', 'impressions', 'clicks']) {
      if (!Number.isInteger(r[k])) throw new Error(`${k} must be an integer (minor units / counts): ${r[k]}`);
    }
    for (const k of FORBIDDEN) {
      if (k in r) throw new Error(`connector emitted a forbidden derived field "${k}" — connectors land rows, engines reason`);
    }
    // Window provenance (Phase C). Checked HERE as well as in snapshotSink so a
    // connector that forgets it fails at its own boundary with its own name in
    // the message, rather than several layers later inside the sink. The two
    // guards are deliberate duplication: this one is about authoring a
    // connector, that one is about nothing reaching the table without a period.
    // (Actual sources take the other path — assertActuals → actualsSink — and
    // are stamped LEGACY_UNKNOWN explicitly there.)
    if (!Object.values(MEASUREMENT_WINDOW).includes(r.measurementWindow)) {
      throw new Error(
        `NormalizedSnapshot.measurementWindow must be one of ${Object.values(MEASUREMENT_WINDOW).join('/')}: ${r.measurementWindow}`,
      );
    }
  }
  return rows;
}
