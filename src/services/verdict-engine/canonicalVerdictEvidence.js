// ============================================================
// canonicalVerdictEvidence — the ONE evidence contract for campaign verdicts
// ============================================================
// KILL / HOLD / WATCH / SCALE now rest on exactly one kind of row: a canonical
// CUMULATIVE_30D campaign snapshot from a PLATFORM source. This module is where
// that is said, and the only place it is said.
//
// WHAT THIS ENDS
// --------------
// Before this, a verdict meant "whatever the last sync happened to measure".
// The operational reader takes the latest row by `date`, and `date` is the SYNC
// TIMESTAMP — so pressing Sync with a different preset could move a campaign
// from frequency 4.2 to 9.8 without a single thing changing about the campaign.
// The threshold never moved; the question it was being asked did.
//
// FILTER BEFORE LATEST, AND WHY THAT ORDER IS THE WHOLE POINT
// -----------------------------------------------------------
// The window filter is applied IN THE QUERY, before any latest-per-entity
// reduction. Reducing first and then asking "was that canonical?" is a
// different, wrong function: an operational row landed seconds later would win
// the `date` comparison and then be discovered to be the wrong window — and the
// campaign would report NO evidence while a perfectly good canonical row sat
// beside it, unread.
//
// NO FALLBACK, IN EITHER DIRECTION
// ---------------------------------
// A campaign with no canonical row has NO verdict evidence. Not its operational
// row, not a zero, not a stale value. `NO_CANONICAL_WINDOW` says the campaign
// exists and was not measured over the verdict window — which is a different
// claim from "it spent nothing", and only one of them is true.
//
// PLATFORM SOURCES ONLY (Phase D.3 Model A)
// ------------------------------------------
// GA4, Shopify and MANUAL revenue cannot enter here. Not because they are
// untrusted — the opposite, they are often the truer number — but because none
// of them can say what period it covers (Phase H ruled GA4 and MANUAL BLOCKED,
// and Shopify has no producer at all). Dividing canonical 30-day spend by
// revenue of unknown period produces a ratio that describes nothing. Their
// ingestion, persistence and every other surface are untouched; they are
// excluded from THIS path only.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { DATA_SOURCE, ENTITY_LEVEL, MEASUREMENT_WINDOW } from '../connectors/connectorTypes.js';
import { EVIDENCE_POPULATION, EVIDENCE_SELECTOR, EVIDENCE_REDUCTION } from './evidenceReference.js';

/** The one window a campaign verdict may be decided on. */
export const CANONICAL_VERDICT_WINDOW = MEASUREMENT_WINDOW.CUMULATIVE_30D;

/**
 * `equals`, not an `in` list. The operational reader's allow-list has to admit
 * two historical values; there is exactly one canonical verdict window, and a
 * list is an invitation to append a second.
 */
export const CANONICAL_VERDICT_WINDOW_FILTER = Object.freeze({ equals: CANONICAL_VERDICT_WINDOW });

/**
 * Sources whose rows describe MEDIA DELIVERY — spend, impressions, clicks and
 * the platform's own claimed conversion value, all measured over the period the
 * platform was asked about.
 *
 * An ALLOW-LIST, deliberately, not `NOT IN (GA4, SHOPIFY, MANUAL)`: a future
 * actual source added to DATA_SOURCE would silently become verdict evidence
 * under a deny-list, which is exactly the failure mode Phase G's operational
 * allow-list exists to prevent. A new PLATFORM still has to clear the canonical
 * window filter before it can be read, so listing it here grants nothing on its
 * own.
 */
export const PLATFORM_VERDICT_SOURCES = Object.freeze([
  DATA_SOURCE.META, DATA_SOURCE.GOOGLE, DATA_SOURCE.TIKTOK, DATA_SOURCE.SNAP, DATA_SOURCE.LINKEDIN,
]);

export const PLATFORM_SOURCE_FILTER = Object.freeze({ in: PLATFORM_VERDICT_SOURCES });

/**
 * The columns a verdict may see. Mirrors the entity graph's METRIC_SELECT
 * because the verdict tree is built from the same row shape — the difference is
 * entirely WHICH ROWS, never which fields.
 */
export const CANONICAL_VERDICT_SELECT = Object.freeze({
  entityId: true, date: true, source: true, currency: true,
  spendMinor: true, revenueMinor: true, impressions: true, clicks: true, conversions: true,
  // roas and ctr are derived BY snapshotSink from this row's own totals at write
  // time, so both sides of each ratio come from one measurement. The verdict
  // engine re-derives them from the raw fields anyway; these ride along for the
  // display projection.
  roas: true, ctr: true,
  frequency: true, reach: true,
  actionMetrics: true, dailyBudgetMinor: true,
});

/** The reason a campaign has no verdict. Distinct from every "no data" reason. */
export const NO_CANONICAL_WINDOW = 'NO_CANONICAL_WINDOW';

/**
 * R5 / I18: what a decision built on THIS selector can say about its evidence.
 *
 * It lives here because this module owns the three facts in it — the population,
 * the selector's own name, and the one window it can return. A reader that
 * retyped them would be a second place that decides what canonical evidence is,
 * and the two would drift exactly where it matters.
 *
 * `rowCount` is the reader's to add: it is a property of the read, not of the
 * population. Spread this, then name the count.
 */
export const CANONICAL_VERDICT_EVIDENCE_BASIS = Object.freeze({
  population:        EVIDENCE_POPULATION.CANONICAL_VERDICT,
  selector:          EVIDENCE_SELECTOR.CANONICAL_VERDICT,
  measurementWindow: CANONICAL_VERDICT_WINDOW,
  // latestCanonicalByEntity, below: N rows ranked by `date`, the newest kept.
  reduction:         EVIDENCE_REDUCTION.LATEST_PER_ENTITY,
});

/**
 * Canonical campaign evidence for a workspace.
 *
 * @param {string} workspaceId
 * @param {string[]} entityIds — campaign entity ids to fetch evidence for
 * @returns {Promise<Array>} canonical rows, date-ascending. EMPTY is a real
 *   answer ("not measured over this period"), never a cue to widen the query.
 */
export async function selectCanonicalVerdictSnapshots(workspaceId, entityIds = []) {
  if (!workspaceId || !Array.isArray(entityIds) || entityIds.length === 0) return [];

  return prisma.metricSnapshot.findMany({
    where: {
      workspaceId,
      entityId:          { in: entityIds },
      entityLevel:       ENTITY_LEVEL.CAMPAIGN,
      measurementWindow: CANONICAL_VERDICT_WINDOW_FILTER,
      source:            PLATFORM_SOURCE_FILTER,
    },
    select:  CANONICAL_VERDICT_SELECT,
    orderBy: { date: 'asc' },
  }).catch((err) => {
    logger.debug({ err: err.message, workspaceId }, '[canonicalVerdictEvidence] read failed');
    return [];
  });
}

/**
 * PURE: the latest canonical observation per campaign.
 *
 * Applied to rows the QUERY already narrowed to canonical/platform/campaign —
 * so "latest" only ever ranks rows that are all equally eligible. Running this
 * over an unfiltered set would be the filter-after-latest bug this module
 * exists to prevent, which is why it takes rows rather than fetching them.
 *
 * @returns {Map<string, object>} entityId → canonical snapshot
 */
export function latestCanonicalByEntity(rows = []) {
  const latest = new Map();
  for (const r of rows) {
    if (!r || r.entityId == null) continue;
    const held = latest.get(r.entityId);
    if (!held || new Date(r.date).getTime() >= new Date(held.date).getTime()) latest.set(r.entityId, r);
  }
  return latest;
}

/**
 * PURE: split campaign identities by whether canonical evidence exists.
 *
 * `withEvidence` pairs each identity with its canonical row; `absent` names the
 * campaigns that have none. Absence is RETURNED, not swallowed: a campaign that
 * vanishes silently is indistinguishable from one that was never synced, and
 * the surface needs to be able to say which.
 *
 * @param {Array<{id:string,name?:string}>} identities
 * @param {Map<string,object>} evidenceByEntity
 */
export function partitionByCanonicalEvidence(identities = [], evidenceByEntity = new Map()) {
  const withEvidence = [];
  const absent = [];
  for (const identity of identities) {
    if (!identity || !identity.id) continue;
    const snapshot = evidenceByEntity.get(identity.id);
    if (snapshot) withEvidence.push({ identity, snapshot });
    else absent.push({ id: identity.id, name: identity.name ?? null, reason: NO_CANONICAL_WINDOW });
  }
  return { withEvidence, absent };
}
