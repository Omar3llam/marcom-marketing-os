// ============================================================
// Connectors — shared types, tags, and deterministic id helper
// ============================================================
// THE GOVERNING RULE (load-bearing): a connector ONLY authenticates, fetches
// raw platform data, and normalizes it into the EXISTING MetricSnapshot +
// entity-graph shape with the correct `channel` + `source` tags. It NEVER
// computes a verdict, a blended number, or an allocation. A connector-derived
// ROAS is a platform-claimed number wearing a trusted badge — so connectors
// land base measures + null-where-absent, and the SINK derives the definitional
// ratios (ctr/roas/cpa) in one place.
//
// The tags that make BlendedTruth light up (verified against
// BlendedTruthService.buildChannelInputs): an ACCOUNT-level snapshot whose
// `entityId` is a <channel>-channel Account, tagged `source: <platform enum>`
// (META|GOOGLE|…) for platform-claimed, or GA4|SHOPIFY for actual.
// ============================================================
import { createHash } from 'node:crypto';

// Mirror of the Prisma `Channel` + `DataSource` enums (no runtime Prisma import).
export const CHANNEL = Object.freeze({ META: 'META', GOOGLE: 'GOOGLE', TIKTOK: 'TIKTOK', SNAP: 'SNAP', LINKEDIN: 'LINKEDIN' });
export const DATA_SOURCE = Object.freeze({ META: 'META', GOOGLE: 'GOOGLE', TIKTOK: 'TIKTOK', SNAP: 'SNAP', LINKEDIN: 'LINKEDIN', GA4: 'GA4', SHOPIFY: 'SHOPIFY', MANUAL: 'MANUAL' });
export const ENTITY_LEVEL = Object.freeze({ ACCOUNT: 'ACCOUNT', CAMPAIGN: 'CAMPAIGN', ADSET: 'ADSET', AD: 'AD', CREATIVE: 'CREATIVE' });

// Parent level for each level — drives the entity-graph upsert order in the sink.
export const PARENT_LEVEL = Object.freeze({ CAMPAIGN: 'ACCOUNT', ADSET: 'CAMPAIGN', AD: 'ADSET', CREATIVE: 'AD' });

// What period a snapshot's metrics cover (Prisma enum MeasurementWindow).
//
// Distinct from GRANULARITY, which every writer hardcodes to DAILY and which
// therefore proves nothing — including on rows holding 90 days or Meta's full
// retention. A normalizer DECLARES this per row and snapshotSink REFUSES a row
// without it, so no snapshot can inherit a window nobody established.
//
// ROLLING_WINDOW is what every live sync produces today. CUMULATIVE_30D is the
// canonical verdict window (verdict-engine/metricWindow.js) and arrives in
// Phase F; DAILY arrives in Phase E. A ROLLING_WINDOW row is never promoted to
// either because its dates happen to look right.
export const MEASUREMENT_WINDOW = Object.freeze({
  LEGACY_UNKNOWN: 'LEGACY_UNKNOWN',
  ROLLING_WINDOW: 'ROLLING_WINDOW',
  DAILY:          'DAILY',
  CUMULATIVE_30D: 'CUMULATIVE_30D',
});

// ── THE OPERATIONAL READ POPULATION (Phase G) ───────────────────────────────
//
// Every reader that existed before Phase F was written against ONE population:
// the rows a live sync produces, one per entity per sync. Phase F added a second
// population to the same table — a canonical 30-day row landed by the same run,
// carrying the same entityId, the same source and the SAME `date`, because
// ConnectorSyncService stamps one `now` across the whole run. Those readers were
// never told, and could not tell the rows apart: not one of them selected
// `measurementWindow`. So a reader picking "the latest row" was choosing between
// a 30-day measurement and a ~37-month one on Postgres heap order, and a reader
// summing by day was adding them together.
//
// THIS IS AN ALLOW-LIST, DELIBERATELY, AND NOT `not: CUMULATIVE_30D`.
//
// Exclusion protects against the population that already burned us. An
// allow-list protects against the next one — DAILY (Phase E) is already named in
// the enum above with no producer yet, and would silently become a second
// observation for every series builder the day one appears. A reader must state
// which population it consumes; anything it has not been designed for is not its
// business by default. That is the actual lesson of the Phase F regression, and
// exclusion would have taught the wrong half of it.
//
// DAILY is therefore NOT here, even though no row carries it today. Adding it is
// Phase E's job, made deliberately, one reader at a time.
//
// LEGACY_UNKNOWN is here and must stay: it covers every pre-Phase-C row AND every
// ACTUAL-revenue row (GA4 / MANUAL), which the blended-truth and overlay paths
// legitimately read. Dropping it would blank actual revenue everywhere — a far
// larger behaviour change than the one this exists to prevent.
export const OPERATIONAL_MEASUREMENT_WINDOWS = Object.freeze([
  MEASUREMENT_WINDOW.LEGACY_UNKNOWN,
  MEASUREMENT_WINDOW.ROLLING_WINDOW,
]);

/**
 * PURE: may an operational reader consume a row from this window?
 * Unknown / future / unset values are refused — that is the point of the list.
 */
export function isOperationalWindow(measurementWindow) {
  return OPERATIONAL_MEASUREMENT_WINDOWS.includes(measurementWindow);
}

/**
 * The Prisma `where` fragment for an operational metric read. Spread as
 * `` so every such query says out
 * loud which population it is asking for.
 *
 * NOT for: row-cardinality reads (an admin count of the table must count every
 * row that exists), the write path's own upserts, or Phase D's canonical
 * resolver, which consumes exactly the population this one excludes.
 */
export const OPERATIONAL_WINDOW_FILTER = Object.freeze({ in: OPERATIONAL_MEASUREMENT_WINDOWS });

export const CONNECTOR_STALE_HOURS = Number(process.env.CONNECTOR_STALE_HOURS || 24);

/**
 * Deterministic UUID (v5-style) so a re-sync upserts entities in place — the
 * entity tables have no unique constraint on externalId, so we derive a stable
 * id from (workspaceId, channel, level, externalId). Distinct namespace from the
 * seed's `det()` so connector + seed ids never collide.
 */
export function detId(...parts) {
  const hex = createHash('sha1').update(`marcom-connector:${parts.join('|')}`).digest('hex');
  const s = hex.slice(0, 32).split('');
  s[12] = '5';
  s[16] = ((parseInt(s[16], 16) & 0x3) | 0x8).toString(16);
  const j = s.join('');
  return `${j.slice(0, 8)}-${j.slice(8, 12)}-${j.slice(12, 16)}-${j.slice(16, 20)}-${j.slice(20, 32)}`;
}

/** Honest staleness: keyed off the last SUCCESSFUL sync, never a failed attempt. */
export function isStale(lastSuccessfulSync, now = new Date(), staleHours = CONNECTOR_STALE_HOURS) {
  if (!lastSuccessfulSync) return true;
  const ageMs = now.getTime() - new Date(lastSuccessfulSync).getTime();
  return ageMs > staleHours * 60 * 60 * 1000;
}
