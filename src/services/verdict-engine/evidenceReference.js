// ============================================================
// evidenceReference — what a decision can say about the evidence under it
// ============================================================
// PURE. No DB, no clock, no workspace context, no env, no connectors. It takes
// metadata a reader ALREADY holds and returns the canonical shape; it derives no
// metric and reads nothing it was not handed.
//
// THE GAP THIS CLOSES (I18): a persisted Decision kept its conclusion, its
// values and its reasoning, and nothing about the rows underneath. Which
// population, which measurement window, which source, when it was OBSERVED, and
// how N rows became one number were all unanswerable from the row — and
// unanswerable from the database too, because MetricSnapshots are upserted on
// every sync, so "read it again" answers a different question.
//
// WHY THIS IS NOT `snapshotId`
// ----------------------------
// Three reasons, and each one alone is enough:
//   1. Every consequential surface is MULTI-ROW. One id cannot describe a
//      latest-per-entity reduction over eleven rows, or a blended row built from
//      a platform row AND an actual-revenue row with different dates.
//   2. A uuid is not stable evidence. The row it names can be upserted
//      underneath the decision, so identity without immutable CONTEXT still
//      cannot say what the decision saw.
//   3. An id says nothing about POPULATION. Canonical and operational rows are
//      different measurements, kept apart by the whole Evidence architecture;
//      a reference that cannot tell them apart re-merges them at the last step.
//
// TWO COUNTS, DELIBERATELY DIFFERENT
// ----------------------------------
//   `rowCount`  — how many rows the read CONSUMED, before reduction.
//   `rows`      — the rows that CONTRIBUTED, after it.
// A latest-per-entity verdict over 11 canonical rows is rowCount 11 with one
// contributor. Collapsing them to a single number would either hide the
// reduction (report 1) or overstate the evidence behind the figure (report 11
// contributors). Both are the multi-row lie this module exists to prevent.
//
// NOT CAPTURED vs NONE — the same distinction the reasoning artifact keeps.
// `sources: null` means no contributing row carried a source (the guardrail
// reader does not project one). `sources: []` means the read had no contributing
// rows at all. Collapsing them would make an unprojected column look like an
// absent measurement.
//
// THROWS, like figure(). A reference that cannot name its population, selector
// or reduction is not a weaker reference, it is a false one — and the caller is
// always a reader that knows all three by construction. The one caller that
// cannot establish provenance honestly writes NULL instead (see the allocation
// writer); it does not call this with placeholders.
// ============================================================

/**
 * The evidence populations the architecture keeps apart. NAMED, never inferred
 * later from `rootCause`, `verdict` or `source` — those are conclusions and row
 * fields, and reading a population out of them is how two measurements become
 * one at the last step.
 */
export const EVIDENCE_POPULATION = Object.freeze({
  CANONICAL_VERDICT: 'canonical-verdict',
  CANONICAL_FATIGUE: 'canonical-fatigue',
  OPERATIONAL:       'operational',
  ACTUAL_REVENUE:    'actual-revenue',
  MANUAL_REVENUE:    'manual-revenue',
});

const POPULATIONS = new Set(Object.values(EVIDENCE_POPULATION));

/** The selector that produced the rows — the function, by name. */
export const EVIDENCE_SELECTOR = Object.freeze({
  CANONICAL_VERDICT: 'selectCanonicalVerdictSnapshots',
  CANONICAL_FATIGUE: 'selectCanonicalFatigueSnapshots',
  OPERATIONAL:       'selectOperationalSnapshots',
});

/**
 * How several rows became the decision's input. These are the reductions the
 * code ACTUALLY performs, named after themselves.
 *
 * `LATEST_PER_STREAM_PER_DAY` is R4's Plan reduction and keeps its awkward name
 * on purpose: it is an OBSERVATION-day reduction over trailing-window rows, not
 * a daily series, and a tidier name would quietly claim the daily activity the
 * ingestion cannot produce.
 */
export const EVIDENCE_REDUCTION = Object.freeze({
  LATEST_PER_ENTITY:         'latest-per-entity',
  LATEST_PER_STREAM:         'latest-per-stream',
  LATEST_PER_STREAM_PER_DAY: 'latest-per-stream-per-day',
  // B5-01E — candidates validated by canonicalEligibility, survivors ordered by
  // windowEnd (the period MEASURED), `date` demoted to a tie-break. Named apart
  // from LATEST_PER_ENTITY because it is a different reduction, and a stored
  // decision that says "latest-per-entity" when a resolver chose the row would
  // be describing a selection that never happened.
  CANONICAL_RESOLVED_PER_ENTITY: 'canonical-resolved-per-entity',
  EFFECTIVE_BY_ENTITY:       'effective-by-entity',
  SERIES:                    'series',
  SUM:                       'sum',
});

const REDUCTIONS = new Set(Object.values(EVIDENCE_REDUCTION));

/** PURE: an observation timestamp → ISO, or null. NEVER a fabricated fallback. */
const iso = (d) => {
  if (d == null) return null;
  const t = new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
};

/**
 * PURE: distinct non-null values in first-seen order.
 * Returns null when the rows exist but none carried the fact — "not captured",
 * which is a different answer from "there were none".
 */
const distinct = (rows, pick) => {
  if (rows.length === 0) return [];
  const out = [];
  for (const r of rows) {
    const v = pick(r);
    if (v != null && !out.includes(v)) out.push(v);
  }
  return out.length ? out : null;
};

/**
 * Build the canonical EvidenceReference.
 *
 * @param {object} args
 * @param {string} args.population — EVIDENCE_POPULATION value. Required.
 * @param {string} args.selector — the selector that read the rows. Required.
 * @param {string} args.reduction — EVIDENCE_REDUCTION value. Required.
 * @param {number} args.rowCount — rows CONSUMED by the read, before reduction.
 *   Required, and not derived from `rows`: the two are different facts.
 * @param {string|null} [args.measurementWindow] — the window these rows are
 *   known to represent. NULL when the population admits more than one and the
 *   rows' own window was not projected — an honest "not established", never a
 *   window reconstructed from a date, an entity age, or a preference between
 *   presets.
 * @param {Array<{entityId?:string, source?:string, observedAt?:Date|string}>} [args.rows]
 *   the rows that CONTRIBUTED after reduction. `observedAt` must come from
 *   MetricSnapshot.date — never a clock, never Decision.createdAt.
 * @param {Array<object>} [args.refs] — row-level references. Empty in Tier 1;
 *   populated only by a consumer that deliberately projects row identity.
 * @returns {{population,selector,measurementWindow,sources,observedAt,reduction,entityIds,rowCount,refs}}
 */
export function toEvidenceReference({
  population,
  selector,
  measurementWindow = null,
  reduction,
  rowCount,
  rows = [],
  refs = [],
} = {}) {
  if (!POPULATIONS.has(population)) {
    throw new Error(`toEvidenceReference: unknown evidence population "${population}" — a reference must NAME its population, never imply one`);
  }
  if (typeof selector !== 'string' || selector === '') {
    throw new Error('toEvidenceReference: selector required — the reference must say which read produced the rows');
  }
  if (!REDUCTIONS.has(reduction)) {
    throw new Error(`toEvidenceReference: unknown reduction "${reduction}" — name the reduction the code actually performs`);
  }
  if (!Number.isInteger(rowCount) || rowCount < 0) {
    throw new Error('toEvidenceReference: rowCount must be a non-negative integer (rows CONSUMED, not the one decision produced)');
  }
  if (!Array.isArray(rows) || !Array.isArray(refs)) {
    throw new Error('toEvidenceReference: rows and refs must be arrays');
  }

  const contributing = rows.filter(Boolean);

  return {
    population,
    selector,
    measurementWindow: measurementWindow ?? null,
    sources:    distinct(contributing, (r) => r.source ?? null),
    // From the evidence row's own observation timestamp. The temporal rule this
    // whole module rests on: `observedAt` is MetricSnapshot.date and nothing
    // else — not the decision's createdAt, not a reasoning row's generatedAt,
    // not the sync's start, not now.
    observedAt: distinct(contributing, (r) => iso(r.observedAt)),
    reduction,
    // Same null-vs-empty rule as the two above, rather than a special case:
    // [] means "no contributing rows", null would mean "the rows carried no
    // entity". The second is unreachable today — every evidence projection in
    // the codebase selects entityId, because it is the grouping key — and it
    // stays consistent so a future reader never has to remember an exception.
    entityIds:  distinct(contributing, (r) => r.entityId ?? null),
    rowCount,
    refs,
  };
}
