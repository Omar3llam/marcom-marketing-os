// ============================================================
// MARCOM / Lumi — CalibrationSection (Home · how well-calibrated are the calls?)
// ------------------------------------------------------------
// The Proof Engine's gated one-liner, moved BELOW the decisions and renamed.
//
// ── Why "Decision Calibration" and not "Workspace Learning" ──────────────────
// Home now carries TWO outcome counters on DIFFERENT substrates, and naming them
// alike would make the page contradict itself:
//
//   this one  → Decisions with status EXECUTED|DISMISSED, scored against a
//               realized outcome. Answers "when Lumi says 80%, is it right 80%
//               of the time?" (DecisionAccuracyService)
//   #298's    → Decisions with a resolution AND an intentAt — a verdict that
//               MOVED after a human acted. Answers "how did comparable calls
//               turn out here?" (getSimilarOutcomes, "Workspace track record")
//
// Different questions, different denominators. A card can honestly read "9 of 12
// similar decisions improved" while this section reads "0 recorded", because
// they are not counting the same thing. Calling both "learning" would turn that
// into a visible contradiction rather than two distinct facts.
//
// The client NEVER re-derives a calibration number — `surface` is the backend's
// own RELIABLE gate (accuracyTypes.accuracySurface) and this renders what the
// gate allows, nothing more.
// ============================================================

export default function CalibrationSection({ surface, compact = false }) {
  if (!surface) return null;

  // Below RELIABLE coverage: state the progress, never a calibration number.
  // `scored`/`needed` are the backend's own counts. The rail drops the word
  // "verified" and the trailing noun purely for width — the claim is identical.
  const body = surface.gated
    ? (compact
      ? `Collecting outcomes — ${surface.scored} of ${surface.needed}`
      : `Collecting verified outcomes — ${surface.scored} of ${surface.needed} decisions recorded.`)
    : surface.headline;

  if (compact) {
    return (
      <div className="space-y-1">
        <p className="section-label text-lumi-muted">Decision Calibration</p>
        <p className="text-xs text-lumi-muted">{body}</p>
      </div>
    );
  }

  return (
    <section className="mb-6 border-t border-lumi-border pt-4">
      <p className="section-label mb-1">Decision Calibration</p>
      <p className={`text-xs ${surface.gated ? 'text-lumi-muted' : 'text-lumi-text'}`}>{body}</p>
    </section>
  );
}
