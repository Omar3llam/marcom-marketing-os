// ============================================================
// canonicalFatigueEvidence — the ONE evidence contract for fatigue
// ============================================================
// Every path that feeds forecastFatigue reads its rows through here:
//   FatigueForecastService   (campaign-level named forecast)
//   FatigueSweepService      (campaign/ad-set/ad persisted predictions)
//   ScenarioService          (leading fatigue signals)
//
// WHY ONE MODULE AND NOT THREE FILTERS (Phase K): before this, each of the three
// wrote its own `measurementWindow` predicate inline. Three predicates are three
// chances to drift, and a drift here does not fail loudly — it makes the same
// campaign fatigue-saturated on one screen and healthy on another, because the
// two screens silently measured different periods. The contract is the module,
// so there is exactly one place where "what counts as fatigue evidence" is said.
//
// WHAT IT REFUSES, AND WHY THAT IS THE POINT
// ------------------------------------------
// frequency and reach are LEVEL metrics — they are only meaningful against a
// stated period. Meta computes them over the requested window with real
// unique-person deduplication, which is why a 30-day frequency can never be
// reconstructed from daily rows (Σ reach double-counts every returning person,
// and frequency is impressions ÷ reach). So the only honest evidence for a
// 30-day fatigue judgement is a row that was ACTUALLY MEASURED over 30 days.
//
// That makes ROLLING_WINDOW, LEGACY_UNKNOWN and DAILY rows not "lower quality"
// but a different measurement. They are refused outright, never blended, and
// never used as a fallback: an entity with no canonical row has NO fatigue
// evidence, and the honest output is no forecast. `granularity` is deliberately
// NOT consulted — every writer hardcodes it to 'DAILY', so it proves nothing.
//
// NOT the Phase D canonical verdict resolver. That answers "may this row decide
// a verdict?" for spend/ROAS/revenue and stays inactive. This answers the much
// narrower "is this a 30-day fatigue observation?" and touches only the fatigue
// paths above. EntityGraphService.latestSnapshots — which feeds ROAS, CTR,
// spend and revenue to the verdict path — is untouched by design.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { MEASUREMENT_WINDOW } from '../connectors/connectorTypes.js';

/** The one window that constitutes fatigue evidence. */
export const CANONICAL_FATIGUE_WINDOW = MEASUREMENT_WINDOW.CUMULATIVE_30D;

/**
 * The Prisma `where` fragment. `equals` rather than an `in` list ON PURPOSE:
 * the operational reader's allow-list (OPERATIONAL_WINDOW_FILTER) has to admit
 * two historical values, but there is exactly one canonical fatigue window and a
 * list would be an invitation to append a second.
 */
export const CANONICAL_FATIGUE_WINDOW_FILTER = Object.freeze({ equals: CANONICAL_FATIGUE_WINDOW });

/**
 * The columns fatigue reasoning may see. Deliberately narrow: no spendMinor, no
 * roas, no revenueMinor. Phase K moves the fatigue metrics to canonical evidence
 * and nothing else, and a selector that cannot return money cannot accidentally
 * become the path by which a canonical figure reaches a verdict surface.
 */
export const CANONICAL_FATIGUE_SELECT = Object.freeze({
  entityId: true, entityLevel: true, date: true, frequency: true, reach: true, ctr: true,
});

/**
 * Canonical 30-day fatigue observations for a workspace.
 *
 * @param {string} workspaceId
 * @param {object} [opts]
 * @param {string[]|null} [opts.entityIds] — restrict to these entities (null = all)
 * @param {string|null}   [opts.entityLevel] — restrict to one level (null = all levels)
 * @param {Date|null}     [opts.since] — only observations at/after this instant
 * @returns {Promise<Array<{entityId,entityLevel,date,frequency,reach,ctr}>>}
 *   date-ascending. EMPTY when there is no canonical evidence — which is a real
 *   answer ("not measured over this period"), not a failure to find one, and
 *   must never be turned into an operational read by the caller.
 */
export async function selectCanonicalFatigueSnapshots(
  workspaceId,
  { entityIds = null, entityLevel = null, since = null } = {},
) {
  if (!workspaceId) return [];
  // An explicit empty id list means "these entities", of which there are none —
  // distinct from `null`, which means "no restriction". Querying `in: []` would
  // return nothing anyway; returning early keeps a pointless round-trip off the DB.
  if (Array.isArray(entityIds) && entityIds.length === 0) return [];

  return prisma.metricSnapshot.findMany({
    where: {
      workspaceId,
      measurementWindow: CANONICAL_FATIGUE_WINDOW_FILTER,
      // A row with no frequency carries no fatigue evidence. Filtering in the
      // query rather than in each caller's loop keeps the population the callers
      // reason about identical to the population the DB returned.
      frequency: { not: null },
      // Delivery actually happened. frequency is impressions ÷ reach, so a row
      // with no impressions describes an entity that did not run — not a
      // low-fatigue one. Letting it in would drag a least-squares fit toward zero
      // and read as "fatigue is falling" when nothing was served at all.
      impressions: { gt: 0 },
      ...(entityIds ? { entityId: { in: entityIds } } : {}),
      ...(entityLevel ? { entityLevel } : {}),
      ...(since ? { date: { gte: since } } : {}),
    },
    select:  CANONICAL_FATIGUE_SELECT,
    orderBy: { date: 'asc' },
  }).catch((err) => {
    logger.debug({ err: err.message, workspaceId, entityLevel }, '[canonicalFatigueEvidence] read failed');
    return [];
  });
}

/**
 * PURE: the most recent canonical observation per entity, keyed `entityId:entityLevel`.
 *
 * The key carries the level even though `detId` already hashes the level into
 * entityId — so a caller that assembles this map from hand-built rows (a test, a
 * future non-connector source) cannot collapse a campaign and an ad-set into one
 * entry just because it chose the same id for both. Levels are never merged and
 * frequency/reach are never summed: each entity's 30-day observation is its own.
 *
 * @param {Array<{entityId,entityLevel,date,frequency,reach}>} rows
 * @returns {Map<string, object>}
 */
export function latestCanonicalByEntity(rows = []) {
  const latest = new Map();
  for (const r of rows) {
    if (!r || !r.entityId) continue;
    const key = `${r.entityId}:${r.entityLevel}`;
    const held = latest.get(key);
    if (!held || new Date(r.date) >= new Date(held.date)) latest.set(key, r);
  }
  return latest;
}
