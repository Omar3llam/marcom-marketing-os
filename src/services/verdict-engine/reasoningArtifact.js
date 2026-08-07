// ============================================================
// reasoningArtifact — what gets frozen onto a Decision row
// ============================================================
// PURE. No DB, no clock, no I/O.
//
// The verdict engine attaches `hypotheses` and `counterfactuals` to every node
// it scores. Those objects are built for a live response and are free to grow —
// a future field, a debug handle, a reference back into the entity that produced
// them. What lands in the database must NOT grow with them.
//
// TWO REASONS THIS IS A PROJECTION AND NOT A SPREAD:
//
//   1. A stored row is a CONTRACT with the future. Whatever shape goes in is the
//      shape a learning query written two quarters from now has to read. A
//      spread makes that shape whatever the engine happened to carry on the day
//      — so the same column would hold six different shapes across six months
//      of rows, and nothing could read them uniformly.
//
//   2. An entity blob would silently become a second copy of the truth. If a
//      node ever carried its campaign row, spreading it would freeze a snapshot
//      of that campaign inside the decision — and every reader would then have
//      two answers to "what was this campaign's spend", one of them stale
//      forever. Naming the fields is what keeps this a record of REASONING
//      rather than a record of data.
//
// IMMUTABLE BY CONSTRUCTION: these run only on create. resolvePrevious closes a
// superseded row out (status, resolvedAt, resolution, confidenceDelta) and never
// touches either column — the reasoning belongs to the moment the call was made,
// and rewriting it later would make the row lie about what it believed.
//
// NULL vs []: null means "never captured" — the honest state for every row
// written before these columns existed, and for a caller that supplied nothing.
// [] means "the engine ran and produced none", which is a real outcome (an early
// gate returns before any mechanism is projected). Collapsing them would make a
// thin campaign indistinguishable from a historical row.
// ============================================================

/**
 * PURE: one graded reading, as it stood when the verdict was issued.
 * `value` and `benchmark` are the numbers a reader can check the claim against;
 * without them a stored hypothesis says "CTR was weak" and cannot be audited.
 */
const toObservation = (o) => ({
  metric:    o?.metric    ?? null,
  value:     o?.value     ?? null,
  benchmark: o?.benchmark ?? null,
  severity:  o?.severity  ?? null,
});

const observations = (rows) => (Array.isArray(rows) ? rows.map(toObservation) : []);

/**
 * PURE: project the engine's hypotheses into the stored artifact.
 *
 * @param {Array<object>|null|undefined} hypotheses — projectHypotheses() output,
 *   ranked, each tagged with its producing pass.
 * @returns {Array<object>|null} null when nothing was supplied; [] when the
 *   engine supplied an empty list (see the NULL vs [] note above).
 */
export function toReasoningArtifact(hypotheses) {
  if (!Array.isArray(hypotheses)) return null;

  return hypotheses.map((h) => ({
    // The enum key, never a rendered string. diagnosisTypes' taxonomy rule
    // ("do not add dynamic labels") applies hardest at a persistence boundary:
    // prose would pin a stored row to one locale and one wording forever.
    id:       h?.id       ?? null,
    labelKey: h?.labelKey ?? null,
    // WHICH PASS produced this reasoning. Load-bearing, and the field most
    // likely to be dropped as noise: the relative post-pass can re-decide a
    // verdict from cohort rank and leaves these untouched, so without the tag a
    // reader cannot tell reasoning that DECIDED a verdict from reasoning that
    // merely accompanied one. A learning query that misses the distinction would
    // credit the absolute mechanism for a call the cohort actually made.
    source:   h?.source   ?? null,
    // Metric names only — the figures live in `observed`. Two shapes carrying
    // the same numbers is two shapes that can disagree.
    supports:    Array.isArray(h?.supports) ? [...h.supports] : [],
    contradicts: observations(h?.contradicts),
    observed:    observations(h?.observed),
    // Kept whole: { reasoning, data }. Splitting them would lose which half of a
    // low score was the rule's strength and which was the input quality.
    confidence: h?.confidence ?? null,
  }));
}

/**
 * PURE: project the engine's counterfactuals into the stored artifact.
 *
 * The half that cannot be rebuilt afterwards. `rejectedBy` is what argued
 * against an alternative and `preferredBecause` is the primary's evidence the
 * alternative would have left unexplained — both computed from MetricSnapshot
 * readings that are rolling aggregates, re-stamped on every sync. Once the sync
 * moves on, nothing can reconstruct what the comparison looked like.
 *
 * @param {Array<object>|null|undefined} counterfactuals — buildCounterfactuals()
 *   output. Empty by design below two hypotheses: with nothing to compare
 *   against there is no alternative to have set aside.
 * @returns {Array<object>|null}
 */
export function toCounterfactualArtifact(counterfactuals) {
  if (!Array.isArray(counterfactuals)) return null;

  return counterfactuals.map((c) => ({
    mechanism: c?.mechanism ?? null,
    labelKey:  c?.labelKey  ?? null,
    rejectedBy:       observations(c?.rejectedBy),
    preferredBecause: observations(c?.preferredBecause),
    // The ALTERNATIVE's own confidence as the projector scored it, never the
    // primary's. How strong the thing set aside was is the whole question a
    // counterfactual answers.
    confidence: c?.confidence ?? null,
  }));
}
