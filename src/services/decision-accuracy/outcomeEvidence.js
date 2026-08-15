// ============================================================
// outcomeEvidence — what a recorded outcome can say about what it measured
// ============================================================
// R6 (I19), and the honesty of the whole PR rests on this file's first
// paragraph, so it is stated before any code.
//
// WHAT THIS IS
//   A recorded outcome is HUMAN-REPORTED. The operator says what happened after
//   they acted; the numbers are theirs. This projection does not compute those
//   numbers, does not check them, and must never be read as having produced
//   them. What it records is the evidence LUMI HOLDS for that entity over the
//   period the operator says they measured — the real MetricSnapshot rows, the
//   real sources, the real observation timestamps, and how many the read
//   consumed.
//
//   So the claim the stored reference makes is exactly: "this is what was in the
//   database for that entity over that period, at the moment the result was
//   recorded." It is a provenance record for the human's measurement, not a
//   platform measurement of the outcome. R6 deliberately does NOT build the
//   second thing: R4 established that MetricSnapshot rows are trailing-window
//   observations, so a causal before/after delta is not derivable from them, and
//   a column that looked like one would be the worst kind of fabrication — the
//   plausible kind.
//
// WHY IT IS PROJECTED SERVER-SIDE
//   The client sends what it measured, never the provenance of it. A
//   client-supplied `sources` array is a claim about the database made by
//   something that cannot see the database, and the one thing worse than no
//   provenance is provenance that disagrees with the rows.
//
// THE POPULATION IS OPERATIONAL, AND SAID SO
//   Not canonical. A canonical verdict window is a different measurement kept
//   apart by the entire Evidence architecture (I4), and an outcome asks about
//   whatever was synced across the operator's period — LEGACY_UNKNOWN and
//   ROLLING_WINDOW rows, from any source including GA4 and MANUAL. Naming it
//   OPERATIONAL is what stops the two populations meeting in a JSON column.
//
// TWO COUNTS, R5's RULE UNCHANGED
//   `rowCount` is what the read CONSUMED — every operational row for that entity
//   synced at or after the window opened. The contributing rows are those whose
//   observation falls inside the window. The gap between the two numbers is the
//   part of the entity's history the outcome deliberately does not rest on, and
//   collapsing them would hide it.
//
// AN EMPTY READ IS A RESULT, NOT A FAILURE
//   A window Lumi synced nothing across yields rowCount 0 with empty lists —
//   "we looked and there was nothing", which is a fact about the account and is
//   allowed to be recorded. It is NOT the same as null (the R5 distinction: not
//   captured), and it does not block an operator from recording what they saw
//   with their own eyes in the ads manager.
// ============================================================
import { selectOperationalSnapshots } from '../evidence/index.js';
import {
  toEvidenceReference, EVIDENCE_POPULATION, EVIDENCE_SELECTOR, EVIDENCE_REDUCTION,
} from '../verdict-engine/evidenceReference.js';

/**
 * The projection this read owns, named here rather than inherited. `date` is the
 * SYNC timestamp (it becomes `observedAt`), `measurementWindow` says what the
 * rows themselves claim to cover, and nothing else is pulled: this read exists
 * to describe evidence, not to read metrics off it.
 */
export const OUTCOME_EVIDENCE_SELECT = Object.freeze({
  entityId: true, date: true, source: true, measurementWindow: true,
});

/**
 * PURE: the one measurement window the contributing rows agree on, or null.
 *
 * A single observed value is a fact about those rows. Two different values is
 * "not established" — and the honest answer there is null, not a preference
 * between them and not the first one seen. The operational population admits
 * more than one window by design, so this genuinely happens.
 */
export function agreedMeasurementWindow(rows = []) {
  const seen = new Set();
  for (const r of rows) if (r?.measurementWindow != null) seen.add(r.measurementWindow);
  return seen.size === 1 ? [...seen][0] : null;
}

/**
 * Establish the evidence provenance for a recorded outcome.
 *
 * DOES NOT CATCH. `selectOperationalSnapshots` lets a read error propagate and
 * so does this: a failed read means "we could not establish provenance", and the
 * caller refuses the recording rather than writing a result whose reference
 * silently says the account had no evidence. The operator's numbers are still in
 * the form; a 500 they can retry is better than a row that lies quietly.
 *
 * @param {string} workspaceId — from trusted context, NEVER a request field (I2)
 * @param {object} args
 * @param {string} args.entityId — INHERITED from the decision, never operator-set
 * @param {string} args.entityLevel — likewise
 * @param {Date}   args.windowStart — the measured period, as the operator stated it
 * @param {Date}   args.windowEnd
 * @returns {Promise<object>} an EvidenceReference (never null; see the header)
 */
export async function projectOutcomeEvidence(workspaceId, { entityId, entityLevel, windowStart, windowEnd } = {}) {
  if (!workspaceId) throw new Error('projectOutcomeEvidence: workspaceId required');
  if (!entityId) throw new Error('projectOutcomeEvidence: entityId required');

  const rows = await selectOperationalSnapshots(workspaceId, {
    // The sync-recency bound, which is the only temporal filter this seam has.
    // The upper bound is applied below rather than asked for, so `rowCount`
    // keeps meaning "rows the read consumed" — see the header.
    since: windowStart,
    entityIds: [entityId],
    // The seam omits this from the query when it is null, which is the right
    // behaviour for a decision that somehow carries no level: ask about the
    // entity at every level rather than about none of them.
    entityLevel: entityLevel ?? null,
    select: OUTCOME_EVIDENCE_SELECT,
  });

  const endMs = windowEnd instanceof Date ? windowEnd.getTime() : new Date(windowEnd).getTime();
  const contributing = rows.filter((r) => {
    const t = r?.date == null ? NaN : new Date(r.date).getTime();
    // A row with no usable observation timestamp cannot be placed inside the
    // window, so it is not claimed as evidence for it. It still counted toward
    // rowCount, because the read did consume it.
    return Number.isFinite(t) && (!Number.isFinite(endMs) || t <= endMs);
  });

  return toEvidenceReference({
    population:        EVIDENCE_POPULATION.OPERATIONAL,
    selector:          EVIDENCE_SELECTOR.OPERATIONAL,
    measurementWindow: agreedMeasurementWindow(contributing),
    // No reduction was applied — the whole in-window series contributes. SERIES
    // is the name for that, and it must not be dressed up as a latest-per-entity
    // or a daily anything: the rows are trailing-window observations (R4).
    reduction:         EVIDENCE_REDUCTION.SERIES,
    rowCount:          rows.length,
    rows: contributing.map((r) => ({
      entityId: r.entityId,
      source:   r.source ?? null,
      // MetricSnapshot.date and nothing else. Never the clock, never measuredAt,
      // never the window bounds the operator typed.
      observedAt: r.date,
    })),
  });
}
