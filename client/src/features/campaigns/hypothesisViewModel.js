// ============================================================
// hypothesisViewModel — the mechanism the verdict actually rests on
// ============================================================
// PRESENTATION MAPPING ONLY. No inference, no ranking, no reordering. The engine
// ranked these; re-deciding any of it here would put a second opinion on screen
// that no stored decision can be audited against.
//
// SEPARATE FROM counterfactualViewModel, still. The two look similar and are
// not: a hypothesis is keyed `id`, a counterfactual `mechanism`; a hypothesis
// carries `observed`/`supports`/`contradicts`, a counterfactual `rejectedBy`/
// `preferredBecause`. A shared model would spend most of itself reconciling
// that. Merge them when the overlap is real, not because the names rhyme.
// ============================================================
import { REASONING_LABELS } from './verdictEvidence.js';

/**
 * PURE: hypotheses[0] → the "why we believe this" view model, or null.
 *
 * ── WHY [0] AND NOTHING ELSE ────────────────────────────────────────────────
 * buildCounterfactuals is literally `hypotheses.slice(1)`. Every hypothesis
 * after the first is ALREADY on screen as a counterfactual. Rendering the whole
 * array would print each alternative twice — once as a live candidate, once as
 * rejected — with the same evidence underneath and opposite framing.
 *
 * ── THE HONESTY GATE ────────────────────────────────────────────────────────
 * `source` records which pass produced the reasoning, and the relative post-pass
 * can re-decide a verdict from cohort rank while leaving the absolute pass's
 * hypotheses untouched. So a bottom-of-cohort HOLD upgraded to KILL carries
 * reasoning that describes the campaign but did NOT decide the call.
 *
 * Showing it anyway would attribute a verdict to a mechanism that had nothing to
 * do with it — and a marketer would go and act on that mechanism. Silence is the
 * honest state: the rationale already explains a relative verdict in its own
 * words ("weakest engagement in its group"), so nothing is lost but the wrong
 * answer.
 *
 * Today `source` is always 'absolute' (verdictEngine tags every projected
 * hypothesis), so this reads as "any relative upgrade suppresses the block". The
 * check is written on `source` rather than on relativeRank alone because the day
 * a relative pass produces its OWN reasoning, that reasoning SHOULD show — and a
 * gate written the short way would hide it.
 *
 * @param {Array<object>|null|undefined} hypotheses — verdict.hypotheses, ranked.
 * @param {string|null} relativeRank — 'TOP' | 'BOTTOM' when the cohort pass
 *   decided this verdict, null when the absolute pass did.
 * @returns {{id, label, observed: Array, confidence}|null}
 */
export function buildPrimaryHypothesisViewModel(hypotheses, relativeRank) {
  if (!Array.isArray(hypotheses) || hypotheses.length === 0) return null;

  const primary = hypotheses[0];
  if (!primary) return null;

  if (relativeRank != null && primary.source === 'absolute') return null;

  return {
    id: primary.id ?? null,
    // Map, then the engine's own key, then a placeholder — the same chain
    // counterfactualViewModel uses, for the same reason: a mechanism the map has
    // not caught up with is still a mechanism the engine weighed.
    label: REASONING_LABELS.mechanisms[primary.id] ?? primary.labelKey ?? 'Unknown mechanism',

    // The WEAK readings this hypothesis rests on — the `preferred` role, the
    // same one counterfactuals use for `preferredBecause`. Both are "a
    // measurement that argues FOR the primary explanation"; the only difference
    // is which block is doing the arguing.
    observed: (primary.observed ?? []).map((o, i) => ({
      key:   `${o?.metric ?? 'unknown'}-${i}`,
      label: REASONING_LABELS.metrics[o?.metric]?.preferred ?? o?.metric ?? 'Unknown signal',
    })),

    // Carried, not rendered — the block shows no number yet.
    // TODO (PR#334): `supports` joins this model when the confidence breakdown
    // lands. Omitted now rather than projected-and-unused: an unrendered field
    // in a view model reads as a rendering bug to whoever finds it next.
    confidence: primary.confidence ?? null,
  };
}
