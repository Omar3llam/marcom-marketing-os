// ============================================================
// MARCOM / Lumi — CohortBlock  (Campaigns · "Cohort ranking")
// ------------------------------------------------------------
// The third answer to "why this verdict", for the one class that could never
// give either of the other two.
//
// A relative KILL is decided by cohort rank, not by a mechanism — so the
// hypothesis it carries belongs to the absolute pass and the honesty gate hides
// it, and the counterfactuals go with it. Until now that left the loudest
// verdict in the product explained by a single sentence, with the cohort figures
// existing ONLY inside that sentence's prose.
//
// PURE RENDERER, same contract as HypothesisBlock and CounterfactualsBlock:
// takes a view model, emits JSX, owns no vocabulary. `group` arrives as the
// engine's own display-safe cohort word ('awareness' | 'conversion') — the same
// one the rationale above uses, deliberately, so the block and the sentence can
// never name one group two ways.
// ============================================================

/**
 * @param {{ viewModel: {rank, group, cohortSize, ctrPct, avgCtrPct}|null }} props
 *   Null renders nothing: an absolutely-decided verdict has no cohort, and an
 *   empty card would imply one went missing.
 */
export function CohortBlock({ viewModel }) {
  if (!viewModel) return null;

  const { rank, group, cohortSize, ctrPct, avgCtrPct } = viewModel;

  return (
    <div className="mt-3 space-y-1.5">
      <p className="section-label text-lumi-muted">Cohort ranking</p>

      <div className="space-y-1 rounded-lg border border-lumi-border bg-lumi-surface p-3">
        {/* The one fact the prose rationale never carried: how many campaigns
            this was actually ranked against. "Lowest CTR in the conversion
            group" reads the same whether the group held three campaigns or
            thirty, and those are very different claims. */}
        <p className="text-sm text-lumi-text">
          Ranked against {cohortSize} campaign{cohortSize === 1 ? '' : 's'}
          {group ? ` in the ${group} group` : ''}
        </p>

        <p className="text-xs leading-relaxed text-lumi-subtle">
          CTR {ctrPct}% vs {avgCtrPct}% group average
          {rank && ` · ${rank === 'BOTTOM' ? 'bottom' : 'top'} quartile`}
        </p>
      </div>
    </div>
  );
}
