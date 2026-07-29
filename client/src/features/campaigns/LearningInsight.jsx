// ============================================================
// MARCOM / Lumi — LearningInsight
// ------------------------------------------------------------
// "9 of 12 similar decisions improved after action."
//
// The workspace's OWN track record, counted from its own resolved decisions.
// Every word here is load-bearing:
//
//   "similar decisions"  — matched on verdict + cause + level + objective +
//                          channel, not just verdict
//   "improved AFTER"     — correlational, never causal. Nothing here shows the
//                          action caused the change, and the copy must not imply
//                          it did.
//   "in your workspace"  — this workspace's own history, not a benchmark, not a
//                          population average, and not a model's belief.
//
// There is no "AI confidence" and no "Lumi thinks": this is arithmetic over
// rows the user's own account produced. Framing it as a machine's opinion would
// be strictly less trustworthy AND less true.
//
// Renders NOTHING without a defensible sample. The server already refuses below
// MIN_SAMPLE scored outcomes or with zero improvements; the same guard is
// repeated here so a future caller cannot route around it.
// ============================================================

const MIN_SAMPLE = 3; // mirrors decisionLearning.MIN_SAMPLE

export function LearningInsight({ learning }) {
  if (!learning) return null;

  const { total, improved, unscored = 0 } = learning;
  if (!(total >= MIN_SAMPLE) || !(improved > 0)) return null;

  return (
    <div className="mt-3 border-t border-lumi-border pt-3">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-lumi-muted">
        Workspace track record
      </p>

      <p className="text-xs leading-relaxed text-lumi-text">
        <span className="font-semibold text-signal-scale">{improved} of {total}</span>
        {' '}similar decision{total === 1 ? '' : 's'} improved after action.
      </p>

      <p className="mt-1 text-[10px] leading-relaxed text-lumi-muted">
        Based on outcomes from similar decisions in your workspace.
      </p>

      {/* Decisions whose outcome could not be scored are OUTSIDE the fraction
          above. Saying so keeps "9 of 12" from being read as "12 is everything
          we have" when it is twelve of fifteen. */}
      {unscored > 0 && (
        <p className="mt-0.5 text-[10px] leading-relaxed text-lumi-subtle">
          {unscored} more couldn&apos;t be measured and {unscored === 1 ? 'is' : 'are'} not counted.
        </p>
      )}
    </div>
  );
}
