// ============================================================
// connectorRegistry — channel/platform → connector instance
// ============================================================
// The sync loop + ingestion resolve a connector through here, never calling
// Meta/CSV/Google services directly. Adding a channel = register one instance;
// nothing else changes.
// ============================================================
import { metaConnector } from './MetaConnector.js';
import { csvConnector } from './CsvConnector.js';
import { googleAdsConnector } from './GoogleAdsConnector.js';
import { CHANNEL } from './connectorTypes.js';

// Platform string (Integration.platform / DataSource) → connector.
const REGISTRY = Object.freeze({
  [CHANNEL.META]:   metaConnector,
  [CHANNEL.GOOGLE]: googleAdsConnector,
  CSV:              csvConnector,
});

/** Resolve a connector by platform/channel. Throws on an unknown platform. */
export function resolve(platform) {
  const c = REGISTRY[String(platform || '').toUpperCase()];
  if (!c) throw new Error(`connectorRegistry: no connector registered for "${platform}"`);
  return c;
}

/** Platforms that participate in the scheduled sync loop (credentialed pulls). */
export const SYNCABLE_PLATFORMS = Object.freeze([CHANNEL.META, CHANNEL.GOOGLE]);

export function isSyncable(platform) {
  return SYNCABLE_PLATFORMS.includes(String(platform || '').toUpperCase());
}
