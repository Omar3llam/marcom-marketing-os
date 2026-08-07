// ============================================================
// counterfactualViewModel — enum keys → sentences, and nothing else
// ============================================================
// PRESENTATION MAPPING ONLY. This file never infers, ranks, reorders, filters or
// scores. The engine decided which alternatives were set aside, on what evidence
// and in what order; every one of those judgements is already made by the time
// this runs, and re-making any of them here would put a second opinion on screen
// that no stored decision can be audited against.
//
// If ranking or filtering is ever wanted, it belongs in the backend beside the
// engine that produced the ranking — not here. The give-away that this rule has
// been broken is a `.sort()`, a `.filter()` on substance, or a threshold.
//
// SCOPED TO COUNTERFACTUALS on purpose. `hypotheses[]` is a different shape with
// a different question ("why this") and will want its own model. A single
// reasoningViewModel is the right end state once both exist and their overlap is
// visible — inventing the abstraction now would be guessing at it.
// ============================================================
import { REASONING_LABELS } from './verdictEvidence.js';

const UNKNOWN_MECHANISM = 'Unknown mechanism';
const UNKNOWN_SIGNAL = 'Unknown signal';

/**
 * PURE: one observation → a rendered line.
 *
 * The fallback chain is deliberate and ordered by how much it claims:
 *   the label map     — a real sentence about a metric we know
 *   the raw metric    — the engine's own word, honest but terse ("CONV_RATE")
 *   'Unknown signal'  — we were handed something with no metric at all
 *
 * Falling through to the raw name rather than dropping the row matters: a metric
 * the map has not caught up with is still evidence the engine weighed, and
 * silently omitting it would understate the reasoning behind a decision.
 */
const toLine = (o, role, i) => ({
  // Stable while the engine's order is stable — which it is: `ranked` is sorted
  // deterministically and both lists are derived from it without re-sorting. A
  // bare index would be no worse today, but pairs the key to POSITION rather
  // than to content, so a future reorder would silently reuse a key across two
  // different rows. If the payload ever carries an id, use it instead.
  key:   `${o?.metric ?? 'unknown'}-${i}`,
  label: REASONING_LABELS.metrics[o?.metric]?.[role] ?? o?.metric ?? UNKNOWN_SIGNAL,
});

/**
 * PURE: counterfactuals[] → view models ready to render.
 *
 * @param {Array<object>|null|undefined} counterfactuals — verdict.counterfactuals,
 *   each `{ mechanism, labelKey, rejectedBy[], preferredBecause[], confidence }`.
 * @returns {Array<{mechanism, label, rejectedBy: Array, preferredBecause: Array}>}
 *   `[]` for anything unusable, so the caller renders nothing rather than
 *   branching on three kinds of absent.
 */
export function buildCounterfactualViewModel(counterfactuals) {
  if (!Array.isArray(counterfactuals) || counterfactuals.length === 0) return [];

  return counterfactuals.map((cf) => ({
    mechanism: cf?.mechanism ?? null,
    // Map, then the engine's own labelKey, then a placeholder. labelKey sits in
    // the middle because it IS the engine's name for the thing — worse than a
    // written sentence, far better than admitting we have no idea.
    label: REASONING_LABELS.mechanisms[cf?.mechanism]
      ?? cf?.labelKey
      ?? UNKNOWN_MECHANISM,
    rejectedBy:       (cf?.rejectedBy ?? []).map((o, i) => toLine(o, 'rejected', i)),
    preferredBecause: (cf?.preferredBecause ?? []).map((o, i) => toLine(o, 'preferred', i)),
  }));
}
