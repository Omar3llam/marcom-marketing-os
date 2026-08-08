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
// It names the DECISION SOURCE and does not restate the evidence: the CTR
// comparison lives in the rationale clause above it, in the engine's own words.
// What it adds is what that sentence never carried — how many campaigns this was
// ranked against, and where in them it landed.
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

  const { rank, group, cohortSize } = viewModel;

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

        {/* Where in that cohort — and nothing else. The CTR comparison this
            once repeated is already in the rationale clause above, in the
            engine's own words; printing it again two lines down made one
            comparison look like two.

            The figures stay on the view model. They are what the rank was
            decided on, and a surface without a prose rationale beside it (a
            feed card, a narrative) will need them — this block simply is not
            the place they belong. */}
        {rank && (
          <p className="text-xs leading-relaxed text-lumi-subtle">
            {rank === 'BOTTOM' ? 'Bottom' : 'Top'} quartile
          </p>
        )}
      </div>
    </div>
  );
}
