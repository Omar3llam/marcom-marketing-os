// ============================================================
// MARCOM / Lumi — HypothesisBlock  (Campaigns · "Why we believe this")
// ------------------------------------------------------------
// The mechanism the verdict rests on, and the readings it rests on. The other
// half of CounterfactualsBlock: this one names what we think IS happening, that
// one names what we checked and found was fine.
//
// Until now the only answer to "why" on a KILL was a clause pulled out of the
// rationale with a regex — the structured object had been on the wire the whole
// time and nothing read it.
//
// PURE RENDERER. Takes a view model, emits JSX, owns no vocabulary. Same
// contract as CounterfactualsBlock, so both can move to a feed or a narrative
// without dragging the label maps with them.
// ============================================================

/**
 * @param {{ viewModel: {label, observed: Array<{key, label}>, signalQuality}|null }} props
 *   Null renders nothing — which is also how the honesty gate expresses itself
 *   (see hypothesisViewModel): a verdict decided by cohort rank has no absolute
 *   mechanism to show, and an empty box would imply one went missing.
 */
export function HypothesisBlock({ viewModel }) {
  if (!viewModel) return null;

  return (
    <div className="mt-3 space-y-1.5">
      <p className="section-label text-lumi-muted">Why we believe this</p>

      <div className="space-y-1.5 rounded-lg border border-lumi-border bg-lumi-surface p-3">
        <p className="text-sm font-medium text-lumi-text">{viewModel.label}</p>

        {viewModel.observed?.length > 0 && (
          <div className="space-y-0.5">
            {/* "Key signals" — and still never "Evidence". Evidence is a domain
                object in Lumi with a narrower, load-bearing meaning: the
                engine's evidence[] rows carry a value AND the benchmark they
                were judged against. These are readings named in prose, and
                borrowing that word would claim a rigour this list does not have.
                "Signals" is the engine's own word for what these are. */}
            <p className="text-[11px] text-lumi-muted">Key signals:</p>
            {viewModel.observed.map((o) => (
              <p key={o.key} className="pl-2 text-xs leading-relaxed text-lumi-subtle">· {o.label}</p>
            ))}
          </div>
        )}

        {/* "Signal quality" — how well the readings above converge on THIS
            mechanism. Not "signal strength" and never "weak signal": both read
            as a judgement on the campaign, and this is a statement about our
            evidence for the judgement.
            Deliberately inside the card, not beside the header's verdict
            confidence: that number is the composed product this is one half of,
            and the two sitting adjacent would read as a contradiction whenever
            they landed in different bands. */}
        {viewModel.signalQuality && (
          <p className="text-[11px] text-lumi-subtle">Signal quality: {viewModel.signalQuality}</p>
        )}
      </div>
    </div>
  );
}
