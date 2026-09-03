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
// AND NOT WHEN WE COULD NOT LOOK (B5 F-2)
// ----------------------------------------
// There is a third claim, and it used to wear the second one's words: the read
// FAILED. `NO_CANONICAL_WINDOW` is a fact about the campaign; a failed query is
// a fact about us, and answering one question with the other is how a database
// outage was published as ten campaigns that were never measured. The reader
// below now throws CanonicalEvidenceUnavailableError instead. An empty array
// still means exactly what it always meant — the database answered, and there
// was nothing.
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
// C-07 — the two gating reasons below are members of the shared vocabulary, not
// strings this module owns. The constants stay exported (evidence/index.js
// re-exports them, and ~20 tests import them) as ALIASES of the vocabulary, so
// there is exactly one definition and the values cannot drift apart.
import { GATING_REASON } from '@marcom/runtime-contracts';
import {
  resolveCanonicalSnapshot, RESOLUTION, measurementAgeDays, MAX_CANONICAL_EVIDENCE_AGE_DAYS,
} from './metricWindow.js';

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
  // ── R13-D / B1 — the row states its own period ───────────────────────────
  // These three are PROJECTIONS, never predicates. The population is still
  // decided one place only — CANONICAL_VERDICT_WINDOW_FILTER in the `where`
  // below — and nothing downstream re-reads `measurementWindow` to choose rows.
  // Selecting a column is not filtering on one.
  //
  // Withheld until now because no consumer had to SAY the period; the filter
  // guaranteed it and that was enough for arithmetic. It is not enough for an
  // API. /entities/verdicts publishes spend, ROAS and CTR to a surface that has
  // to label them, and a payload that cannot state its own period leaves the
  // frontend to assume one — which is precisely how a ~37-month operational
  // aggregate reached a screen captioned "last 30 days".
  //
  // Projected rather than restated from CANONICAL_VERDICT_WINDOW: the constant
  // is what this reader ASKED for, the column is what the row ANSWERS. They
  // agree today because the filter makes them agree — and if they ever stop,
  // the honest thing to publish is what the row says, not what we intended.
  // `entityLevel` stays unprojected precisely because nothing publishes it.
  //
  // windowStart/windowEnd are nullable and carry the platform's OWN bounds
  // (Meta's date_start/date_stop). They stay null when the platform reported
  // none — never reconstructed from `date`, which is the sync timestamp.
  measurementWindow: true, windowStart: true, windowEnd: true,
});

/** The reason a campaign has no verdict. Distinct from every "no data" reason. */
export const NO_CANONICAL_WINDOW = GATING_REASON.NO_CANONICAL_WINDOW;

/**
 * The reason a campaign has no CURRENT verdict despite having been measured
 * properly (B5-01F).
 *
 * ── THE DISTINCTION THIS EXISTS TO KEEP ─────────────────────────────────────
 *   NO_CANONICAL_WINDOW    — we never measured this campaign over the verdict
 *                            window. Waiting on a first canonical sync.
 *   CANONICAL_EVIDENCE_STALE — we measured it, correctly, and the period we
 *                            measured ended too long ago to decide anything now.
 *
 * Same empty cell on screen, opposite fixes — one waits for a first sync, the
 * other for a fresh one — and the older of the two states is the one that
 * currently tells a fully-synced account to "connect a channel". Collapsing them
 * would be the same class of lie B5-01B/01C/01D each removed one layer down:
 * answering a question about the DATA'S AGE with a claim that the data never
 * existed.
 *
 * This is a GATING reason, not a failure: nothing is broken, and no error is
 * raised. The campaign simply cannot support a new verdict today.
 */
export const CANONICAL_EVIDENCE_STALE = GATING_REASON.CANONICAL_EVIDENCE_STALE;

/**
 * The stable identity of a FAILED canonical read. Matched on, never on a message.
 */
export const CANONICAL_EVIDENCE_READ_FAILED = 'CANONICAL_EVIDENCE_READ_FAILED';

/**
 * Raised when the canonical evidence read itself could not complete.
 *
 * ── THE DISTINCTION THIS EXISTS TO KEEP (B5 F-2) ────────────────────────────
 * `NO_CANONICAL_WINDOW` above is a claim about the CAMPAIGN: we asked the
 * database, it answered, and this campaign was never measured over the verdict
 * window. This error is a claim about US: we could not ask.
 *
 * They used to be the same value. The reader ended in `.catch(() => [])`, so a
 * failed query returned an empty population, `latestCanonicalByEntity` built an
 * empty Map, and partitionByCanonicalEvidence placed EVERY campaign into
 * `absent` carrying `NO_CANONICAL_WINDOW` — byte-identical to a genuinely empty
 * canonical population, published as HTTP 200. An operator reading
 * `noCanonicalWindow: 10` could not tell which had happened, and neither could
 * any other observer, inside the system or outside it.
 *
 * A throw is the only shape a caller cannot mistake for an answer — the same
 * reasoning, and the same idiom, evaluateConnectorVerdicts already uses one
 * layer up. The two absences now differ in KIND, not merely in value, so
 * collapsing them again requires deleting this rather than dropping a field.
 *
 * `cause` carries the underlying error for logs and observability; nothing
 * outside this module reads its message, and no route surfaces it to a client.
 */
export class CanonicalEvidenceUnavailableError extends Error {
  constructor(message = 'Canonical verdict evidence could not be read', options = {}) {
    super(message, options);
    this.name = 'CanonicalEvidenceUnavailableError';
    this.code = CANONICAL_EVIDENCE_READ_FAILED;
  }
}

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
  // resolveCanonicalVerdictByEntity, below: N candidates validated structurally,
  // the survivors ranked by windowEnd (the period measured) rather than by
  // `date` (the instant we synced).
  reduction:         EVIDENCE_REDUCTION.CANONICAL_RESOLVED_PER_ENTITY,
});

/**
 * Canonical campaign evidence for a workspace.
 *
 * @param {string} workspaceId
 * @param {string[]} entityIds — campaign entity ids to fetch evidence for
 * @returns {Promise<Array>} canonical rows, date-ascending. EMPTY is a real
 *   answer ("not measured over this period"), never a cue to widen the query.
 * @throws {CanonicalEvidenceUnavailableError} when the query itself fails. An
 *   empty result means the database answered and there was nothing; this means
 *   it did not answer, and the two must never reach a caller as the same value.
 */
export async function selectCanonicalVerdictSnapshots(workspaceId, entityIds = []) {
  // A successful empty population, decided without a query: no workspace, or no
  // entities to ask about. Unchanged, and deliberately NOT an error — there is
  // nothing broken about asking for evidence on zero campaigns.
  if (!workspaceId || !Array.isArray(entityIds) || entityIds.length === 0) return [];

  try {
    return await prisma.metricSnapshot.findMany({
      where: {
        workspaceId,
        entityId:          { in: entityIds },
        entityLevel:       ENTITY_LEVEL.CAMPAIGN,
        measurementWindow: CANONICAL_VERDICT_WINDOW_FILTER,
        source:            PLATFORM_SOURCE_FILTER,
      },
      select:  CANONICAL_VERDICT_SELECT,
      orderBy: { date: 'asc' },
    });
  } catch (err) {
    // ERROR, not debug. The previous level matched the previous behaviour — a
    // best-effort read whose failure cost nothing. It costs the whole verdict
    // surface for this workspace, so it is logged like the dependency failure it
    // is, with the workspace and a stable code an alert can match on.
    logger.error(
      { err: err.message, workspaceId, code: CANONICAL_EVIDENCE_READ_FAILED, entityCount: entityIds.length },
      '[canonicalVerdictEvidence] canonical evidence read failed — no verdict can be decided for this workspace',
    );
    // NO FALLBACK, in any direction. Not the operational rows, not a stale
    // in-memory result, not an empty set. The evidence required to decide is
    // unavailable, and "no verdict" is the honest outcome of that.
    throw new CanonicalEvidenceUnavailableError(undefined, { cause: err });
  }
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
 * PURE: the canonical snapshot per campaign, chosen by STRUCTURAL RESOLUTION.
 *
 * ── WHAT THIS REPLACES, AND WHY (B5 F-3A / F-4) ─────────────────────────────
 * `latestCanonicalByEntity` above ranks on `date`, and `date` is the SYNC
 * TIMESTAMP. That is a fact about when we pulled a row, not about what period it
 * measures, and the two come apart exactly when it matters: re-syncing an older
 * canonical period stamps it with a NEWER `date`, so the stale measurement wins
 * and decides the verdict. Proven on this trunk — ranking by `date` selected a
 * June–July window over a July–August one for the same campaign.
 *
 * `resolveCanonicalSnapshot` was written for this, tested, and then left with
 * zero production callers (F-4). It is called here rather than reimplemented:
 * it validates each candidate structurally and orders the survivors by
 * `windowEnd` — the most recently MEASURED period, with `date` demoted to an
 * exact-tie break, which is all a sync timestamp was ever entitled to decide.
 *
 * Grouping is by entityId (not by `entityId|source`, which resolveCanonicalByStream
 * uses) because this reader's contract is one snapshot per campaign, and its
 * query has already narrowed the population to CAMPAIGN level and platform
 * sources. Within that population a campaign's rows are competing measurements
 * of the same thing, which is precisely what the resolver is for.
 *
 * NO FALLBACK. An entity whose candidates are all structurally invalid gets no
 * snapshot — never the newest raw row — and lands in `absent` as
 * NO_CANONICAL_WINDOW, the same honest absence as having no rows at all.
 *
 * `rejected` is returned for observability and tests. It is NOT surfaced by the
 * API: this slice changes which row is selected, not the vocabulary the product
 * explains absence in.
 *
 * @returns {{ selected: Map<string,object>, rejected: Map<string,Array> }}
 */
export function resolveCanonicalVerdictByEntity(rows = [], { now = new Date() } = {}) {
  const byEntity = new Map();
  for (const r of rows) {
    if (!r || r.entityId == null) continue;
    const held = byEntity.get(r.entityId);
    if (held) held.push(r); else byEntity.set(r.entityId, [r]);
  }

  const selected = new Map();
  const rejected = new Map();
  for (const [entityId, candidates] of byEntity) {
    const result = resolveCanonicalSnapshot(candidates, { now });
    if (result.status === RESOLUTION.OK && result.snapshot) selected.set(entityId, result.snapshot);
    if (result.rejected.length) rejected.set(entityId, result.rejected);
  }
  return { selected, rejected };
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
export function partitionByCanonicalEvidence(identities = [], evidenceByEntity = new Map(), { now = new Date() } = {}) {
  const withEvidence = [];
  const absent = [];
  const stale = [];
  for (const identity of identities) {
    if (!identity || !identity.id) continue;
    const snapshot = evidenceByEntity.get(identity.id);
    if (!snapshot) {
      absent.push({ id: identity.id, name: identity.name ?? null, reason: GATING_REASON.NO_CANONICAL_WINDOW });
      continue;
    }

    // B5-01F — THE FRESHNESS GATE. The row is structurally valid (it survived
    // the resolver); the only question left is whether the period it measures is
    // recent enough to decide anything TODAY.
    //
    // Age comes from windowEnd, never from `date`. A re-sync of a January period
    // lands today and is still January evidence.
    const ageDays = measurementAgeDays(snapshot.windowEnd, now);
    // A null age means we could not establish when this measurement ended, and
    // an unprovable age is not a fresh one. It should be unreachable — a row
    // without bounds is MISSING_PERIOD and never survives resolution — so this
    // is the belt to that braces, resolved in the only direction that cannot
    // fabricate currency.
    if (ageDays == null || ageDays > MAX_CANONICAL_EVIDENCE_AGE_DAYS) {
      stale.push({
        id: identity.id,
        name: identity.name ?? null,
        reason: GATING_REASON.CANONICAL_EVIDENCE_STALE,
        // The facts a caller needs to explain the gate without recomputing it.
        // C-07 — and now a caller finally does: they cross the wire and reach
        // the surface instead of being dropped with the reason at the door.
        measurementAgeDays: ageDays,
        windowEnd: snapshot.windowEnd ?? null,
        maxAgeDays: MAX_CANONICAL_EVIDENCE_AGE_DAYS,
      });
      continue;
    }

    withEvidence.push({ identity, snapshot });
  }
  return { withEvidence, absent, stale };
}
